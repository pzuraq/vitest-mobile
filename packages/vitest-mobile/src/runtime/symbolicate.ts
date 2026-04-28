/**
 * Stack trace symbolication via Metro's /symbolicate endpoint.
 *
 * Translates Hermes bundle-relative stack frames into original source locations
 * so test failures show clickable file:line references.
 */

import type { TaskResult } from '@vitest/runner';
import type { TestError } from '@vitest/utils';
import { getMetroBaseUrl } from './network-config';

/** Shapes we symbolicate in-place; matches vitest errors plus optional `stackStr` / `codeFrame`. */
type SymbolicateableError = Partial<TestError> & { stackStr?: string; codeFrame?: string };

/** Full task result or a minimal `{ errors }` shape (e.g. tests). */
type SymbolicateableResult = TaskResult | { errors?: SymbolicateableError[] } | undefined;

interface StackFrame {
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
 * Frame matchers, applied in order to each non-empty stack line. First
 * match wins. Each pattern captures 3 or 4 groups: optional methodName,
 * file, line, column. When `methodName` is undefined (either the pattern
 * has no name capture at all, or the capture was optional and absent),
 * we fall back to `<anonymous>`.
 *
 * The file portion is allowed to contain colons (URLs, Windows paths) —
 * patterns anchor on the trailing `:line:col`.
 */
const FRAME_PATTERNS: readonly RegExp[] = [
  // Hermes: name@file:line:col
  /^(.+?)@(.*):(\d+):(\d+)$/,
  // Hermes internal: name address at file:line:col
  /^(.+?)\s+address at\s+(.+):(\d+):(\d+)$/,
  // V8: at name (file:line:col)
  /^at\s+(.+?)\s+\((.+):(\d+):(\d+)\)$/,
  // V8 anonymous: at file:line:col  (no name capture — fills as <anonymous>)
  /^at\s+()(.+):(\d+):(\d+)$/,
  // Vitest pretty stack: ❯ [name] path/to/file.ts:10:5
  /^❯\s+(?:(.+?)\s+)?(.+):(\d+):(\d+)$/,
];

/**
 * Parse a Hermes/JSC/V8/Vitest-pretty stack trace string into structured
 * frames. Hermes format is `functionName@file:line:col`; V8 format is
 * `at functionName (file:line:col)`. The file part can contain colons
 * (URLs, Windows paths) so patterns anchor on the final `:number:number`.
 */
function parseStack(stack: string): { frames: StackFrame[]; message: string } {
  const lines = stack.split('\n');
  const frames: StackFrame[] = [];
  let messageEnd = 0;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;

    for (const pattern of FRAME_PATTERNS) {
      const match = trimmed.match(pattern);
      if (!match) continue;
      if (frames.length === 0) messageEnd = i;
      frames.push({
        methodName: match[1] || '<anonymous>',
        file: normalizeMetroFile(match[2]),
        lineNumber: parseInt(match[3], 10),
        column: parseInt(match[4], 10),
      });
      break;
    }
  }

  const message = lines.slice(0, messageEnd).join('\n') || lines[0] || '';
  return { frames, message };
}

/**
 * Paths inside vitest-mobile's runtime shim (matchers, poll/retry, setup).
 * These appear at the top of any assertion-failure stack because the throw
 * originates inside the matcher; filtering them here surfaces the user's
 * test frame (when present) instead of our internal machinery.
 */
const INTERNAL_RUNTIME_RE = /vitest-mobile[/\\](?:src|dist)[/\\]runtime[/\\]/;

function isInternalRuntimeFrame(filePath: string | undefined): boolean {
  return !!filePath && INTERNAL_RUNTIME_RE.test(filePath);
}

function isBundleOrHttpFrame(f: StackFrame): boolean {
  return f.file.includes('.bundle') || f.file.startsWith('http://') || f.file.startsWith('https://');
}

/**
 * Second round-trip: Metro can render a snippet for a single on-disk
 * `StackFrame` (project-relative or absolute) via getCodeFrame + readFile
 * on the main server — no source map when `urls` is empty.
 */
async function tryCodeFrameForSourceFileFrame(f: StackFrame): Promise<string | undefined> {
  if (isBundleOrHttpFrame(f) || isInternalRuntimeFrame(f.file) || f.file.includes('node_modules')) {
    return;
  }
  try {
    const res = await fetch(`${getMetroBaseUrl()}/symbolicate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stack: [f] }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { codeFrame?: { content?: string; fileName?: string } | null };
    if (isInternalRuntimeFrame(data.codeFrame?.fileName)) return;
    return data.codeFrame?.content;
  } catch {
    return;
  }
}

function isRelevantFrame(f: StackFrame): boolean {
  const file = f.file;
  if (!file) return false;
  if (file.includes('node_modules')) return false;
  if (file.includes('InternalBytecode')) return false;
  if (file.startsWith('address at')) return false;
  if (isInternalRuntimeFrame(file)) return false;
  return true;
}

/**
 * Rebuild a stack string in V8 format with only relevant frames.
 *
 * Strips library/runtime noise (node_modules, babel helpers, Hermes internals)
 * so vitest's reporter surfaces the test file location with a code snippet.
 */
function rebuildStack(message: string, frames: StackFrame[]): string {
  const relevant = frames.filter(isRelevantFrame);
  const toUse = relevant.length > 0 ? relevant : frames;

  const lines = toUse.map(f => `    at ${f.methodName} (${f.file}:${f.lineNumber}:${f.column})`);
  return message + '\n' + lines.join('\n');
}

interface SymbolicateResult {
  stack: string;
  codeFrame?: string;
}

/**
 * Symbolicate a stack trace string using Metro's endpoint.
 *
 * Returns the rewritten stack plus — when Metro can resolve the first relevant
 * frame to a readable source file — a pre-rendered `@babel/code-frame` snippet
 * Metro attaches to its response. Falls back to the original stack and an
 * undefined code frame if symbolication fails.
 */
export async function symbolicate(stack: string): Promise<SymbolicateResult> {
  const { frames, message } = parseStack(stack);
  if (frames.length === 0) return { stack };
  const framesForSymbolication = frames.filter(
    f => f.file.includes('.bundle') || f.file.startsWith('http://') || f.file.startsWith('https://'),
  );
  if (framesForSymbolication.length === 0) return { stack };

  try {
    const res = await fetch(`${getMetroBaseUrl()}/symbolicate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stack: framesForSymbolication }),
    });

    if (!res.ok) return { stack };

    const data = (await res.json()) as {
      stack?: StackFrame[];
      codeFrame?: { content?: string; fileName?: string } | null;
    };
    const mapped = data.stack ?? framesForSymbolication;
    // Substitute only bundle/http frames with Metro's symbolicated result;
    // keep prepended in-memory frames (e.g. test call sites from
    // expect.element) in place.
    const needsBundle = isBundleOrHttpFrame;
    let mi = 0;
    const mergedFrames = frames.map(f => {
      if (needsBundle(f)) {
        const next = mapped[mi++];
        return next ?? f;
      }
      return f;
    });
    // Drop Metro's codeFrame when it points at our own runtime internals —
    // otherwise every matcher failure renders a snippet of expect-setup.ts
    // or retry.ts instead of something useful.
    let codeFrame = isInternalRuntimeFrame(data.codeFrame?.fileName) ? undefined : data.codeFrame?.content;

    // First response codeFrame is built from the bundle-side stack (often
    // expect-setup or retry). After merging, the first *relevant* frame is
    // usually the test file — same as Vitest browser / old pool path: ask
    // Metro to render @babel/code-frame for that on-disk file only.
    if (!codeFrame) {
      const firstRelevant = mergedFrames.find(isRelevantFrame);
      if (firstRelevant) {
        codeFrame = (await tryCodeFrameForSourceFileFrame(firstRelevant)) ?? codeFrame;
      }
    }

    const rebuilt = rebuildStack(message, mergedFrames);
    return { stack: rebuilt, codeFrame };
  } catch {
    return { stack };
  }
}

/**
 * Symbolicate all error stacks in a vitest test result in-place. Also
 * populates `err.codeFrame` with the snippet Metro produces so Vitest's
 * reporter can render a highlighted source excerpt under each failure.
 */
export async function symbolicateErrors(result: SymbolicateableResult): Promise<void> {
  if (!result?.errors?.length) return;

  await Promise.all(
    result.errors.map(async (err: SymbolicateableError) => {
      let codeFrame: string | undefined;
      if (err.stack) {
        const r = await symbolicate(err.stack);
        err.stack = r.stack;
        codeFrame = r.codeFrame;
      }
      if (err.stackStr) {
        const r = await symbolicate(err.stackStr);
        err.stackStr = r.stack;
        codeFrame = codeFrame ?? r.codeFrame;
      }
      if (codeFrame && !err.codeFrame) {
        err.codeFrame = codeFrame;
      }
    }),
  );
}
