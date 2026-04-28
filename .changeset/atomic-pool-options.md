---
'vitest-mobile': major
---

Restructure plugin options and rewrite the device-side runtime.

### Breaking: plugin options

`nativePlugin(...)` options are now nested into `harness` / `device` / `metro` groups:

```ts
// Before
nativePlugin({ platform: 'ios', headless: true, bundle: true, metro: customizerFn });

// After
nativePlugin({ platform: 'ios', device: { headless: true }, metro: { bundle: true, customize: customizerFn } });
```

Removed `promptForNewDevice` and `skipIfUnavailable`. Missing environments now throw instead of soft-skipping.

### Runtime rewrite

- `setup.ts`, `ControlBridge`, `TestRegistry`, `TestRunnerService`, `run.ts`, `state.ts` collapsed into a single `HarnessRuntime` root that owns connection, state, registry diff, and RPC forwarding.
- Generated test-registry module replaced by `require.context` in `test-context.ts` (backed by new `inline-app-root-plugin`).
- Explorer UI walks Vitest's native task tree directly; old `TestTreeNode` parallel tree deleted.
- `ReactNativeRunner` simplified to `(config, runtime)` — delegates `onCollected`/`onTaskUpdate` to the runtime.
- Task state (`collectedFiles`, `taskState`) lives on the runtime instance; entries are append-only across reruns.

### Other

- New `vitest-compat-plugin.ts` rewrites Vitest dist for Hermes/Metro. Hermes-safe `node:*` stubs added.
- Pool-side: `PauseController`, Metro log tailing, bundle server, and pool message types extracted into dedicated modules.
