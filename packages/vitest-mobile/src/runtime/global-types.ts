/**
 * Shared global type declarations for the Hermes/RN runtime.
 *
 * Hermes doesn't expose certain browser/Node globals (setImmediate, Event,
 * EventTarget) and our harness attaches custom properties to globalThis.
 * This module provides a typed view over those extensions.
 */

export interface MetroModule {
  isInitialized: boolean;
  importedAll: unknown;
  importedDefault: unknown;
  verboseName?: string;
  path?: string;
}

export interface VitestGlobalThis {
  Event?: typeof Event;
  EventTarget?: typeof EventTarget;
  DOMException?: typeof DOMException;
  expect?: unknown;
  setImmediate?: (fn: () => void) => unknown;
  window?: typeof globalThis;
  self?: typeof globalThis;
  __VITEST_METRO_PORT__?: number;
  __r?: { getModules?: () => Map<number, MetroModule> };
  __TEST_FILES__?: Record<string, () => unknown>;
  __TEST_HMR_LISTENERS__?: Set<(f?: string) => void>;
  [key: symbol]: unknown;
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
