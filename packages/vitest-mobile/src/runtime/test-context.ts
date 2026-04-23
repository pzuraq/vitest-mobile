/**
 * Test file registry — `require.context`-backed lookup of test files.
 *
 * Owns the module-level `require.context` (which the inline-app-root babel
 * plugin needs to see as a literal call site at this exact location) and
 * exposes a `TestRegistry` class for the runtime to consume via DI.
 *
 * The HMR plumbing — re-publishing key set after Metro re-evaluates this
 * module — uses one contained globalThis escape hatch (the `_notify`
 * callback). Everything else flows through the runtime's owner chain.
 *
 * Two `process.env.*` accesses are inlined at build time by
 * `inline-app-root-plugin` (see `src/babel/`). Metro's
 * `unstable_allowRequireContext` static analyzer requires the first arg to
 * `require.context()` to be a string LITERAL after Babel runs.
 *
 *   process.env.VITEST_MOBILE_APP_ROOT      → relative path (e.g. "../../..")
 *   process.env.VITEST_MOBILE_APP_ROOT_ABS  → absolute app root (for ROOT_PREFIX)
 */

import './global-types';

declare const module: { hot?: { accept(callback?: (() => void) | void): void; dispose(callback?: () => void): void } };

if (!process.env.VITEST_MOBILE_APP_ROOT || !process.env.VITEST_MOBILE_APP_ROOT_ABS) {
  throw new Error(
    'vitest-mobile: VITEST_MOBILE_APP_ROOT(_ABS) not inlined at bundle time — is the inline-app-root babel plugin in the Metro transformer chain?',
  );
}

const ctx = require.context(
  process.env.VITEST_MOBILE_APP_ROOT,
  true,
  // Marker regex — replaced at transform time by `inline-app-root-plugin`
  // with the regex derived from Vitest's `cfg.include` patterns.
  /__VM_TEST_PATTERN__/,
  // sync: each `ctx(key)` returns module exports synchronously via `require(key)`,
  // no Promise / microtask hop per file. All matched files are inlined into the
  // bundle (no separate lazy chunks) — fine at small/medium scale, and avoids
  // dev-server chunk fetches when `runner.importFile` runs each file.
  'sync',
);

const ROOT_PREFIX = process.env.VITEST_MOBILE_APP_ROOT_ABS + '/';

function toAbs(key: string): string {
  return ROOT_PREFIX + key.replace(/^\.\//, '');
}

function toKeyForAbs(absFilePath: string): string | null {
  if (!absFilePath.startsWith(ROOT_PREFIX)) return null;
  const candidate = './' + absFilePath.slice(ROOT_PREFIX.length);
  return ctx.keys().includes(candidate) ? candidate : null;
}

let notifyCallback: (() => void) | null = null;

export const getPaths = (notify: () => void) => {
  notifyCallback = notify;

  return new Set(ctx.keys().map(toAbs));
};

export const getTestRun = (absPath: string, notify: () => void): void => {
  const key = toKeyForAbs(absPath);

  if (!key) throw new Error(`[test-context] Unknown test file: ${absPath}`);

  const mod = ctx(key) as { __run?: (cb?: () => void) => void };

  if (!mod?.__run) throw new Error(`[test-context] Test file ${absPath} does not have a __run function`);

  mod.__run(notify);
};

if (module.hot) {
  module.hot.accept();
  module.hot.dispose(() => {
    notifyCallback?.();
  });
}
