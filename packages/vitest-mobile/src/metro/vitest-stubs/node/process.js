/**
 * Stub for `node:process` — most of Vitest's `process.*` usage reads the
 * global process (see runtime/polyfills.ts for that). A few paths do
 * `import process from 'node:process'`; proxy to globalThis.process.
 */

const g = globalThis.process ?? {};
export const env = g.env ?? {};
export const platform = g.platform ?? 'hermes';
export const versions = g.versions ?? {};
export const argv = g.argv ?? [];
export const cwd = g.cwd ?? (() => '/');
export const exit = g.exit ?? (() => {});
export const nextTick = g.nextTick ?? (fn => queueMicrotask(fn));

export default g;
