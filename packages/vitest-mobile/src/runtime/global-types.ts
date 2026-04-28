/**
 * Shared global type declarations for the Hermes/RN runtime.
 *
 * Hermes doesn't expose certain browser/Node globals (setImmediate, Event,
 * EventTarget) and our harness attaches custom properties to globalThis.
 * This module provides a typed view over those extensions.
 */

export interface VitestGlobalThis {
  Event?: typeof Event;
  EventTarget?: typeof EventTarget;
  expect?: unknown;
  setImmediate?: (fn: () => void) => unknown;
  [key: symbol]: unknown;
}

/**
 * Runtime value returned from `require.context()`. Same shape as webpack /
 * expo-router; Metro's polyfill generates a callable with `keys()`,
 * `resolve()`, and a stable `id` at bundle time.
 */
export interface RequireContext {
  keys(): string[];
  (id: string): unknown;
  <T>(id: string): T;
  resolve(id: string): string;
  id: string;
}

declare global {
  // `require` resolves through @types/node as `NodeRequire extends NodeJS.Require`.
  // Augmenting the inner interface places `.context` on the actual call target.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace NodeJS {
    interface Require {
      context(
        directory: string,
        useSubdirectories?: boolean,
        regExp?: RegExp,
        mode?: 'sync' | 'eager' | 'lazy' | 'lazy-once',
      ): RequireContext;
    }
  }
}

/** Typed accessor for globalThis in the Hermes runtime. */
export const g = globalThis as unknown as VitestGlobalThis;

/** Extract an error message from an unknown caught value. */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// ── React Fast Refresh toggle ────────────────────────────────────
//
// Metro's require polyfill checks global[prefix + '__ReactRefresh'] on every
// HMR update. When non-null, React Refresh boundaries intercept updates and
// prevent propagation to parent modules (test files). By nulling it out, HMR
// updates propagate through the normal module.hot.accept()/dispose() chain,
// reaching test files and triggering reruns.
//
// During pause(), we restore it so component edits render live.

const gRecord = globalThis as unknown as Record<string, unknown>;
const REFRESH_KEY = ((gRecord.__METRO_GLOBAL_PREFIX__ as string) ?? '') + '__ReactRefresh';
const _savedReactRefresh = gRecord[REFRESH_KEY];

gRecord[REFRESH_KEY] = null;

export function enableFastRefresh(): void {
  gRecord[REFRESH_KEY] = _savedReactRefresh;
}

export function disableFastRefresh(): void {
  gRecord[REFRESH_KEY] = null;
}
