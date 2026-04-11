/**
 * Stack trace symbolication via Metro's /symbolicate endpoint (node-side).
 *
 * Translates Hermes bundle-relative stack frames into original source locations
 * so test failures show clickable file:line references. Runs on the pool host,
 * matching the vitest browser pattern of server-side source map resolution.
 */

import type { BiRpcMessage } from './code-frame';

interface StackFrame {
  file: string;
  lineNumber: number;
  column: number;
  methodName: string;
}

function parseStack(stack: string): { frames: StackFrame[]; message: string } {
  const lines = stack.split('\n');
  const frames: StackFrame[] = [];
  let messageEnd = 0;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;

    const hermesMatch = trimmed.match(/^(.+?)@(.*):(\d+):(\d+)$/);
    if (hermesMatch) {
      if (frames.length === 0) messageEnd = i;
      frames.push({
        methodName: hermesMatch[1],
        file: hermesMatch[2],
        lineNumber: parseInt(hermesMatch[3], 10),
        column: parseInt(hermesMatch[4], 10),
      });
      continue;
    }

    const v8Match = trimmed.match(/^at\s+(.+?)\s+\((.+):(\d+):(\d+)\)$/);
    if (v8Match) {
      if (frames.length === 0) messageEnd = i;
      frames.push({
        methodName: v8Match[1],
        file: v8Match[2],
        lineNumber: parseInt(v8Match[3], 10),
        column: parseInt(v8Match[4], 10),
      });
      continue;
    }

    const v8AnonMatch = trimmed.match(/^at\s+(.+):(\d+):(\d+)$/);
    if (v8AnonMatch) {
      if (frames.length === 0) messageEnd = i;
      frames.push({
        methodName: '<anonymous>',
        file: v8AnonMatch[1],
        lineNumber: parseInt(v8AnonMatch[2], 10),
        column: parseInt(v8AnonMatch[3], 10),
      });
      continue;
    }

    const internalMatch = trimmed.match(/^(.+?)\s+address at\s+(.+):(\d+):(\d+)$/);
    if (internalMatch) {
      if (frames.length === 0) messageEnd = i;
      frames.push({
        methodName: internalMatch[1],
        file: internalMatch[2],
        lineNumber: parseInt(internalMatch[3], 10),
        column: parseInt(internalMatch[4], 10),
      });
      continue;
    }
  }

  const message = lines.slice(0, messageEnd).join('\n') || lines[0] || '';
  return { frames, message };
}

function isRelevantFrame(f: StackFrame): boolean {
  const file = f.file;
  if (!file) return false;
  if (file.includes('node_modules')) return false;
  if (file.includes('InternalBytecode')) return false;
  if (file.startsWith('address at')) return false;
  return true;
}

function rebuildStack(message: string, frames: StackFrame[]): string {
  const relevant = frames.filter(isRelevantFrame);
  const toUse = relevant.length > 0 ? relevant : frames;

  const lines = toUse.map(f => `    at ${f.methodName} (${f.file}:${f.lineNumber}:${f.column})`);
  return message + '\n' + lines.join('\n');
}

async function symbolicateStack(stack: string, metroPort: number): Promise<string> {
  const { frames, message } = parseStack(stack);
  if (frames.length === 0) return stack;

  try {
    const res = await fetch(`http://127.0.0.1:${metroPort}/symbolicate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stack: frames }),
    });

    if (!res.ok) return stack;

    const data = (await res.json()) as { stack: StackFrame[] };
    const mapped = data.stack ?? frames;

    return rebuildStack(message, mapped);
  } catch {
    return stack;
  }
}

/**
 * Symbolicate error stacks in an onTaskUpdate or onUnhandledError BiRpc message.
 * Rewrites stack/stackStr fields in-place by calling Metro's /symbolicate endpoint.
 */
export async function symbolicateMessage(msg: BiRpcMessage, metroPort: number): Promise<void> {
  if (msg?.m !== 'onTaskUpdate') return;
  const packs = msg?.a?.[0] as
    | [string, { errors?: Array<{ stack?: string; stackStr?: string }> } | undefined, unknown][]
    | undefined;
  if (!Array.isArray(packs)) return;

  const promises: Promise<void>[] = [];

  for (const pack of packs) {
    const result = pack?.[1];
    if (!result?.errors?.length) continue;
    for (const err of result.errors) {
      if (err.stack) {
        promises.push(
          symbolicateStack(err.stack, metroPort).then(s => {
            err.stack = s;
          }),
        );
      }
      if (err.stackStr) {
        promises.push(
          symbolicateStack(err.stackStr, metroPort).then(s => {
            err.stackStr = s;
          }),
        );
      }
    }
  }

  await Promise.all(promises);
}
