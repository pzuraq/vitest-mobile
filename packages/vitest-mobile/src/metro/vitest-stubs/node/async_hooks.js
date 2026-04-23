/**
 * Stub for `node:async_hooks` — Vitest's detectAsyncLeaks uses `createHook`,
 * but we never call detectAsyncLeaks. The hook object only needs
 * `enable`/`disable` for module-top type-compatibility.
 */

export const createHook = () => ({
  enable() {},
  disable() {},
});

export class AsyncLocalStorage {
  run(_store, callback) {
    return callback();
  }
  getStore() {
    return undefined;
  }
  enterWith() {}
  exit() {}
  disable() {}
}

export default { createHook, AsyncLocalStorage };
