/**
 * Runtime polyfills that must run before loading certain dependencies.
 */

import { g } from './global-types';

function ensureStructuredClonePolyfill(): void {
  if (typeof structuredClone !== 'undefined') return;

  const fallback = <T>(value: T): T => {
    // Explorer state trees are plain JSON-serializable objects.
    return JSON.parse(JSON.stringify(value)) as T;
  };

  (g as unknown as { structuredClone?: typeof structuredClone }).structuredClone =
    fallback as unknown as typeof structuredClone;
}

function ensureDOMExceptionPolyfill(): void {
  if (typeof DOMException !== 'undefined') return;

  class DOMExceptionPolyfill extends Error {
    constructor(message = '', name = 'Error') {
      super(message);
      this.name = name;
    }
  }

  (g as unknown as { DOMException?: typeof DOMException }).DOMException =
    DOMExceptionPolyfill as unknown as typeof DOMException;
}

/**
 * Vitest's worker chunks reference the global `process` object at module top
 * (memoryUsage.bind, listeners.bind, platform === 'win32', env reads, etc).
 * Hermes has no `process`, so we install a minimal shim before `vitest/worker`
 * is statically imported. The real hot paths (env reads, memoryUsage) are all
 * bound and called later — we just need the structure to exist at module load.
 */
function ensureProcessPolyfill(): void {
  const gAny = g as unknown as { process?: Record<string, unknown> };
  // React Native ships a partial `process` (usually just `env`). Merge our
  // fields in without overwriting anything that's already present — Vitest's
  // dist reads a bunch of Node-shaped fields (cwd, memoryUsage, listeners,
  // platform, …) at module-top.
  const existing = (gAny.process ?? {}) as Record<string, unknown>;
  const defaults: Record<string, unknown> = {
    env: {},
    platform: 'hermes',
    arch: 'arm64',
    versions: {},
    argv: [],
    memoryUsage: () => ({ heapUsed: 0, heapTotal: 0, rss: 0, external: 0, arrayBuffers: 0 }),
    listeners: () => [],
    on: () => undefined,
    off: () => undefined,
    removeListener: () => undefined,
    exit: () => undefined,
    nextTick: (fn: () => void) => queueMicrotask(fn),
    cwd: () => '/',
    stdout: { isTTY: false, write: () => true },
    stderr: { isTTY: false, write: () => true },
  };
  for (const [key, value] of Object.entries(defaults)) {
    if (existing[key] === undefined) existing[key] = value;
  }
  gAny.process = existing;
}

function ensurePerformancePolyfill(): void {
  const gAny = g as unknown as { performance?: { now: () => number } };
  if (gAny.performance && typeof gAny.performance.now === 'function') return;
  gAny.performance = { now: () => Date.now() };
}

/**
 * Placeholder `globalThis.__vitest_worker__`.
 *
 * Vitest's bundled `test.<hash>.js` chunk runs `const globalExpect =
 * createExpect()` at module-top, and the resulting expect has a
 * `get testPath()` getter that reads `getWorkerState().filepath`. That
 * getter fires synchronously during the `createExpect` initialisation
 * (likely via one of chai's plugin hooks), which means the global must
 * exist by the time `vitest/worker` is imported — our real
 * `provideWorkerState` in `run.ts` runs too late (only inside runTests /
 * collectTests).
 *
 * The placeholder is a minimal `WorkerGlobalState` shape. `run.ts` replaces
 * it wholesale via `Object.defineProperty` before any test code runs.
 */
function ensureWorkerStatePlaceholder(): void {
  const gAny = g as unknown as Record<string, unknown>;
  if (gAny.__vitest_worker__) return;
  Object.defineProperty(gAny, '__vitest_worker__', {
    value: {
      filepath: '',
      current: undefined,
      config: {},
      providedContext: {},
      ctx: { files: [] },
      rpc: null,
      onCancel: () => undefined,
      onCleanup: () => undefined,
      durations: { environment: 0, prepare: 0 },
      environment: { name: 'hermes' },
      metaEnv: {},
      evaluatedModules: undefined,
      resolvingModules: undefined,
      moduleExecutionInfo: undefined,
    },
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

export function ensureRuntimePolyfills(): void {
  ensureProcessPolyfill();
  ensurePerformancePolyfill();
  ensureWorkerStatePlaceholder();
  ensureStructuredClonePolyfill();
  ensureDOMExceptionPolyfill();

  // Chai 6.x uses EventTarget for plugin events. Hermes doesn't provide it.
  if (typeof EventTarget === 'undefined') {
    g.Event = class Event {
      type: string;
      constructor(type: string) {
        this.type = type;
      }
    } as typeof globalThis.Event;

    g.EventTarget = class EventTarget {
      private _listeners: Record<string, Function[]> = {};

      addEventListener(type: string, listener: Function) {
        (this._listeners[type] ??= []).push(listener);
      }

      removeEventListener(type: string, listener: Function) {
        const list = this._listeners[type];
        if (list) this._listeners[type] = list.filter(l => l !== listener);
      }

      dispatchEvent(event: { type: string }) {
        for (const listener of this._listeners[event.type] ?? []) listener(event);
        return true;
      }
    } as unknown as typeof globalThis.EventTarget;
  }
}

// Ensure polyfills are applied as soon as this module is loaded.
ensureRuntimePolyfills();
