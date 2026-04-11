/**
 * Stack trace symbolication via Metro's /symbolicate endpoint.
 *
 * Translates Hermes bundle-relative stack frames into original source locations
 * so test failures show clickable file:line references.
 */

import { getMetroBaseUrl } from './network-config';

export interface StackFrame {
  file: string;
  lineNumber: number;
  column: number;
  methodName: string;
}

function normalizeMetroFile(file: string): string {
  if (!file) return file;

  let normalized = file;

  // Vitest pretty stacks often prefix bundle paths with many "../".
  normalized = normalized.replace(/^(?:\.\.\/)+/, '');

  // Metro serves the runtime bundle at /index.bundle, but Vitest can report it
  // as ".vitest-mobile/index.bundle" or ".vitest-mobile/instances/<id>/index.bundle".
  // Strip the entire .vitest-mobile path prefix (including instance subdirs) so
  // the file reference maps back to the Metro-served bundle root.
  normalized = normalized.replace(/^\/?\.vitest-mobile\/(?:instances\/[^/]+\/)?/, '');
  normalized = normalized.replace(/\/\.vitest-mobile\/(?:instances\/[^/]+\/)?/g, '/');

  // Vitest pretty stacks also rewrite ?query to /&query.
  // Convert back so Metro can resolve source maps.
  normalized = normalized.replace(/\.bundle\/+&/g, '.bundle?');

  // If it's now a relative bundle path, make it an absolute Metro URL.
  if (!/^https?:\/\//.test(normalized) && normalized.includes('.bundle')) {
    normalized = `${getMetroBaseUrl()}/${normalized}`;
  }

  return normalized;
}

/**
 * Parse a Hermes/JSC stack trace string into structured frames.
 *
 * Hermes format:  functionName@file:line:col
 * V8 format:      at functionName (file:line:col)
 *
 * The file part can contain colons (URLs, Windows paths) so we anchor
 * on the final :number:number pattern.
 */
export function parseStack(stack: string): { frames: StackFrame[]; message: string } {
  const lines = stack.split('\n');
  const frames: StackFrame[] = [];
  let messageEnd = 0;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;

    // Hermes: name@file:line:col — match the last two :number segments
    const hermesMatch = trimmed.match(/^(.+?)@(.*):(\d+):(\d+)$/);
    if (hermesMatch) {
      if (frames.length === 0) messageEnd = i;
      frames.push({
        methodName: hermesMatch[1],
        file: normalizeMetroFile(hermesMatch[2]),
        lineNumber: parseInt(hermesMatch[3], 10),
        column: parseInt(hermesMatch[4], 10),
      });
      continue;
    }

    // V8: at name (file:line:col)
    const v8Match = trimmed.match(/^at\s+(.+?)\s+\((.+):(\d+):(\d+)\)$/);
    if (v8Match) {
      if (frames.length === 0) messageEnd = i;
      frames.push({
        methodName: v8Match[1],
        file: normalizeMetroFile(v8Match[2]),
        lineNumber: parseInt(v8Match[3], 10),
        column: parseInt(v8Match[4], 10),
      });
      continue;
    }

    // V8 anonymous: at file:line:col
    const v8AnonMatch = trimmed.match(/^at\s+(.+):(\d+):(\d+)$/);
    if (v8AnonMatch) {
      if (frames.length === 0) messageEnd = i;
      frames.push({
        methodName: '<anonymous>',
        file: normalizeMetroFile(v8AnonMatch[1]),
        lineNumber: parseInt(v8AnonMatch[2], 10),
        column: parseInt(v8AnonMatch[3], 10),
      });
      continue;
    }

    // Hermes internal: name address at file:line:col
    const internalMatch = trimmed.match(/^(.+?)\s+address at\s+(.+):(\d+):(\d+)$/);
    if (internalMatch) {
      if (frames.length === 0) messageEnd = i;
      frames.push({
        methodName: internalMatch[1],
        file: normalizeMetroFile(internalMatch[2]),
        lineNumber: parseInt(internalMatch[3], 10),
        column: parseInt(internalMatch[4], 10),
      });
      continue;
    }

    // Vitest pretty stack output format:
    //   ❯ functionName path/to/file.ts:10:5
    //   ❯ path/to/file.ts:10:5
    const vitestFrameMatch = trimmed.match(/^❯\s+(?:(.+?)\s+)?(.+):(\d+):(\d+)$/);
    if (vitestFrameMatch) {
      if (frames.length === 0) messageEnd = i;
      frames.push({
        methodName: vitestFrameMatch[1] ?? '<anonymous>',
        file: normalizeMetroFile(vitestFrameMatch[2]),
        lineNumber: parseInt(vitestFrameMatch[3], 10),
        column: parseInt(vitestFrameMatch[4], 10),
      });
      continue;
    }
  }

  const message = lines.slice(0, messageEnd).join('\n') || lines[0] || '';
  return { frames, message };
}

export function isRelevantFrame(f: StackFrame): boolean {
  const file = f.file;
  if (!file) return false;
  if (file.includes('node_modules')) return false;
  if (file.includes('InternalBytecode')) return false;
  if (file.startsWith('address at')) return false;
  return true;
}

/**
 * Rebuild a stack string in V8 format with only relevant frames.
 *
 * Strips library/runtime noise (node_modules, babel helpers, Hermes internals)
 * so vitest's reporter surfaces the test file location with a code snippet.
 */
export function rebuildStack(message: string, frames: StackFrame[]): string {
  const relevant = frames.filter(isRelevantFrame);
  const toUse = relevant.length > 0 ? relevant : frames;

  const lines = toUse.map(f => `    at ${f.methodName} (${f.file}:${f.lineNumber}:${f.column})`);
  return message + '\n' + lines.join('\n');
}

/**
 * Symbolicate a stack trace string using Metro's endpoint.
 * Returns the rewritten stack, or the original if symbolication fails.
 */
export async function symbolicateStack(stack: string): Promise<string> {
  const { frames, message } = parseStack(stack);
  if (frames.length === 0) return stack;
  const framesForSymbolication = frames.filter(
    f => f.file.includes('.bundle') || f.file.startsWith('http://') || f.file.startsWith('https://'),
  );
  if (framesForSymbolication.length === 0) return stack;

  try {
    const res = await fetch(`${getMetroBaseUrl()}/symbolicate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stack: framesForSymbolication }),
    });

    if (!res.ok) return stack;

    const data = (await res.json()) as { stack: StackFrame[] };
    const mapped = data.stack ?? framesForSymbolication;

    return rebuildStack(message, mapped);
  } catch {
    return stack;
  }
}

/**
 * Symbolicate all error stacks in a vitest test result in-place.
 */
export async function symbolicateErrors(
  result: { errors?: Array<{ stack?: string; stackStr?: string }> } | undefined,
): Promise<void> {
  if (!result?.errors?.length) return;

  await Promise.all(
    result.errors.map(async err => {
      if (err.stack) {
        err.stack = await symbolicateStack(err.stack);
      }
      if (err.stackStr) {
        err.stackStr = await symbolicateStack(err.stackStr);
      }
    }),
  );
}
