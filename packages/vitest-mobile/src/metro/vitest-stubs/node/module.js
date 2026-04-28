/**
 * Stub for `node:module`.
 *
 * Consumed at module-top by two callers:
 *
 *   1. Vitest's inspector.ts — `createRequire(import.meta.url)`. The returned
 *      thunk is invoked lazily from paths we never take.
 *   2. Vitest's `chunks/modules.BJuCwlRJ.js` — reads `builtinModules` at
 *      module-top and calls `.filter(...)` on it:
 *
 *        var nodeBuiltins = require('node:module').builtinModules
 *          .filter(id => !id.includes(":"));
 *        function isNodeBuiltin(id) {
 *          if (id.startsWith("node:")) return true;
 *          return nodeBuiltins.includes(id);
 *        }
 *
 *      On Hermes there are no Node builtins, and the only call site is a
 *      `node:` prefix guard that short-circuits before consulting the list.
 *      Exporting an empty array keeps the module-top `.filter` call safe
 *      and leaves `isNodeBuiltin("fs")` returning false (correct on device).
 */

export function createRequire() {
  const req = id => {
    throw new Error(`[vitest-mobile] require('${id}') not supported on device`);
  };
  req.resolve = id => {
    throw new Error(`[vitest-mobile] require.resolve('${id}') not supported on device`);
  };
  return req;
}

export function isBuiltin(id) {
  return typeof id === 'string' && /^node:/.test(id);
}

export const builtinModules = [];

export const Module = class Module {};

export default { createRequire, isBuiltin, builtinModules, Module };
