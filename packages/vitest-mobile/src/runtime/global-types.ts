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
// module evaluation. When non-null AND isLikelyComponentType() returns true,
// Metro adds an implicit module.hot.accept() — making the component module a
// "hot boundary" that prevents HMR propagation to parent modules (test files).
//
// We need two modes:
//   Normal (not paused): HMR updates bubble to test files → trigger reruns.
//   Paused: Fast Refresh captures updates in-place → live component editing.
//
// Three mechanisms work together:
//
// 1. Registration-only shim — keeps __ReactRefresh truthy so Metro's module
//    wrappers call $RefreshReg$() from initial load, building component families.
//    But isLikelyComponentType() returns false → no implicit self-accept → HMR
//    bubbles to test files during normal runs.
//
// 2. performFullRefresh suppression — when we swap to the real Refresh during
//    pause, Metro detects "invalidated boundary" (module wasn't a boundary
//    before, now it is) and calls performFullRefresh(). We suppress this.
//
// 3. Manual performReactRefresh() — after suppressing the full reload, we
//    trigger the component swap ourselves since Metro's normal path was
//    short-circuited.

const gRecord = globalThis as unknown as Record<string, unknown>;
const REFRESH_KEY = ((gRecord.__METRO_GLOBAL_PREFIX__ as string) ?? '') + '__ReactRefresh';
const _savedReactRefresh = gRecord[REFRESH_KEY];
const _typedRefresh = _savedReactRefresh as Record<string, (...args: unknown[]) => unknown> | null;

const _origPerformFullRefresh = _typedRefresh?.performFullRefresh;
let _suppressFullRefresh = false;
if (_typedRefresh && _origPerformFullRefresh) {
  _typedRefresh.performFullRefresh = (...args: unknown[]) => {
    if (_suppressFullRefresh) {
      try {
        _typedRefresh.performReactRefresh();
      } catch {
        /* best-effort */
      }
      return;
    }
    return _origPerformFullRefresh.apply(_typedRefresh, args);
  };
}

const _registrationOnlyRefresh: Record<string, unknown> | null = _typedRefresh
  ? {
      register: (...args: unknown[]) => _typedRefresh.register(...args),
      createSignatureFunctionForTransform: (...args: unknown[]) =>
        _typedRefresh.createSignatureFunctionForTransform(...args),
      setSignature: _typedRefresh.setSignature
        ? (...args: unknown[]) => _typedRefresh.setSignature!(...args)
        : undefined,
      getFamilyByType: (...args: unknown[]) => _typedRefresh.getFamilyByType?.(...args),
      getFamilyByID: _typedRefresh.getFamilyByID
        ? (...args: unknown[]) => _typedRefresh.getFamilyByID!(...args)
        : undefined,
      isLikelyComponentType: () => false,
      performReactRefresh: () => {},
      performFullRefresh: _typedRefresh.performFullRefresh,
    }
  : null;

gRecord[REFRESH_KEY] = _registrationOnlyRefresh;

export function enableFastRefresh(): void {
  _suppressFullRefresh = true;
  gRecord[REFRESH_KEY] = _savedReactRefresh;
}

export function disableFastRefresh(): void {
  _suppressFullRefresh = false;
  gRecord[REFRESH_KEY] = _registrationOnlyRefresh;
}
