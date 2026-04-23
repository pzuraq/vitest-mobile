/**
 * `vitest/worker` `init()` adapter — bridges the device's WebSocket transport
 * (`DevicePoolConnection`) to the vitest pool's birpc-style protocol.
 *
 * `runTests` / `collectTests` are passed in directly by `HarnessRuntime.start`,
 * which constructs them as reactive methods on `TestRunnerService` so they can
 * resolve their dependencies via `getContext(HarnessCtx)` when invoked.
 */

import { init } from 'vitest/worker';
import type { DevicePoolConnection } from './connection';
import { ensureRuntimePolyfills } from './polyfills';
import { setupExpect } from './expect-setup';
import { WorkerGlobalState } from 'vitest';

type VitestWorker = Parameters<typeof init>[0];
type RunTestsHandler = VitestWorker['runTests'];
type CollectTestsHandler = VitestWorker['collectTests'];

export function createVitestWorker(
  conn: DevicePoolConnection,
  runTests: RunTestsHandler,
  collectTests: CollectTestsHandler,
): void {
  const wrapState = (state: WorkerGlobalState): WorkerGlobalState => {
    // Expose `state` as `globalThis.__vitest_worker__` so downstream packages
    // (e.g. `@vitest/snapshot` matchers) can locate the rpc handle via
    // Vitest's standard `getWorkerState()` lookup. Mirrors Vitest's
    // `provideWorkerState`.
    Object.defineProperty(globalThis, '__vitest_worker__', {
      value: state,
      configurable: true,
      writable: true,
      enumerable: false,
    });
    return state;
  };

  init({
    post: (response: unknown) => {
      conn.post(response);
    },
    on: (handler: (data: unknown) => void) => {
      conn.on(handler);
    },
    off: (handler: (data: unknown) => void) => {
      conn.off(handler);
    },
    serialize: (value: unknown) => value,
    deserialize: (value: unknown) => value,
    // Replaces `setupBaseEnvironment` from `vitest/worker`. We don't load an
    // environment (jsdom/happy-dom/node) — Hermes provides the globals we need
    // — so all we do is install polyfills and wire up `@vitest/expect`. Module
    // freshness across reruns is Metro HMR's job.
    setup: async () => {
      ensureRuntimePolyfills();
      setupExpect();
      return async () => {};
    },
    runTests: (state, traces) => runTests(wrapState(state), traces),
    collectTests: (state, traces) => collectTests(wrapState(state), traces),
  });
}
