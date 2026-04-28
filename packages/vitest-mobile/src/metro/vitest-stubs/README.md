# vitest-stubs

Stub modules that stand in for Node built-ins and Vite/Vitest internals
when the device runtime statically imports `vitest/worker`. On Hermes
those modules don't exist, so Metro throws "unable to resolve" at bundle
time without these stubs.

## How modules map to files

Wiring lives in [assets/templates/node/metro.config.cjs](../../../assets/templates/node/metro.config.cjs).
It holds a `STUBBED_MODULES` set — the allow-list of module names we
intercept — and derives each one's on-disk path by splitting the module
specifier on `:` and `/`, then checks if a dedicated stub file exists at
that path. If yes, use it; if no, fall back to `empty.js`.

```
node:fs            -> stubs/node/fs.js
node:fs/promises   -> stubs/node/fs/promises.js
node:module        -> stubs/node/module.js
vite/module-runner -> stubs/vite/module-runner.js
@edge-runtime/vm   -> no file -> stubs/empty.js
happy-dom          -> no file -> stubs/empty.js
@opentelemetry/api -> no file -> stubs/empty.js
```

Adding a new no-op stub is a one-line change to `STUBBED_MODULES`.
Adding one with real safe-default behaviour is two steps: drop a file at
the derived path and append the name to `STUBBED_MODULES`.

## Rules of thumb for a dedicated stub

- Cover **module-top loads** — every named export that Vitest / pathe /
  another transitive dep reads at module-top must be present (even if the
  value is trivially empty). Module-top failures break the whole import
  chain and surface as `Cannot read property X of undefined` elsewhere.
- Cover **direct-call runtime usage** from module-top of dependent chunks.
  `pathe`, `tinyrainbow`, and a handful of Vitest helpers call into
  `path.resolve` / `pathToFileURL` / `performance.now` etc. _while loading
  their own module_. These need safe defaults (`''`, `[]`, identity fns)
  rather than proxies that throw.
- Our runtime paths never reach Vitest's own `setupEnvironment` /
  `runBaseTests` / module-runner code, so the stubs' "deep" behaviour is
  free to be no-op — if a runtime path unexpectedly reaches one, we
  prefer a clear `throw new Error('[vitest-mobile] fs.X not supported
on device')` over silent undefined.

Two stubs deserve highlighting because Vitest reads specific named
exports at module-top:

- `node/module.js` exports `builtinModules = []`. `modules.BJuCwlRJ.js`
  calls `require('node:module').builtinModules.filter(id => !id.includes(':'))`
  at module-top and expects a real array.
- `vite/module-runner.js` exports real `class ModuleRunner {}` /
  `class EvaluatedModules {}` / `class ESModulesEvaluator {}`.
  `evaluatedModules.Dg1zASAC.js` does `class VitestEvaluatedModules
extends EvaluatedModules {}` — `extends` needs a real constructor on
  the right-hand side.

## The other incompatibility class — non-literal `import(expr)`

Vitest's dist also has dynamic `import(variable)` call-sites (coverage
provider loader, custom environment loader, native module runner,
OpenTelemetry SDK path). Metro's Babel transform rejects non-literal
dynamic imports at parse time. Rather than stubbing each affected chunk,
the [`vitest-compat-plugin`](../../babel/vitest-compat-plugin.ts)
rewrites the offending `import(expr)` to `Promise.reject(new Error(...))`
for all files under `node_modules/vitest/` and `node_modules/@vitest/*`.
That covers future chunks automatically (no per-release hash-regex stub
chasing) and keeps runtime semantics — if some path unexpectedly invokes
one of these loaders, it rejects with a clear error instead of hanging.

Historically this folder also contained `vitest-coverage.js` and
`vitest-native-module-runner.js` that swapped whole hashed chunks; they
were redundant once the Babel plugin landed and have been removed.

## When to update

| Scenario                                                                                              | What to do                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Metro errors with "unable to resolve" for a new `node:*` or vendor module imported by `vitest/worker` | Add the module name to `STUBBED_MODULES` in `assets/templates/node/metro.config.cjs`. If the module needs real named exports at module-top, also drop a file at the derived path (`node/<name>.js`, `vite/<name>.js`, etc.). Otherwise it auto-falls-back to `empty.js`. |
| Something at module-top throws `Cannot read property X of undefined` tracing back to a stubbed module | The stub needs a real value for `X`. Either edit the existing dedicated file, or create one at the derived path and move the module out of the "empty fallback" case.                                                                                                    |
| Metro errors with "Invalid call at line N: import(...)" inside a Vitest dist chunk                    | Usually already handled by `vitest-compat-plugin`; if the path isn't in `node_modules/vitest/` or `@vitest/`, extend `isVitestInternalFile`.                                                                                                                             |
| A chunk filename hash changes in a minor Vitest release                                               | No action needed — nothing matches by filename hash.                                                                                                                                                                                                                     |
