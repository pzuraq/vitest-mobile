# Architecture

End-to-end walkthrough of how `vitest-mobile` gets a test file from the user's
editor into a Hermes VM on a simulator, and how results flow back to the
Vitest reporter in the terminal. Inline module-level comments document each
piece locally; this document wires them together.

Quick pointer to the per-module docs, for when you need specifics:

| File                                | Covers                                                                                         |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `src/node/pool.ts`                  | Pool lifecycle, three-atomic-buckets config pattern, `isolate=false`/`maxWorkers=1` invariants |
| `src/node/metro-runner.ts`          | Metro programmatic start, config preparation, offline bundle build                             |
| ,                                   | `src/runtime/runtime.ts`                                                                       | `HarnessRuntime` — root DI container, owns connection/state/registry diff |
| `src/runtime/connection.ts`         | WebSocket lifecycle, `flatParse` once per frame, fan-out to subscribers                        |
| `src/runtime/worker.ts`             | `vitest/worker.init()` with pass-through `serialize`/`deserialize` (matches upstream)          |
| `src/runtime/runner.ts`             | `ReactNativeRunner` — the `VitestRunner` we hand to `@vitest/runner`                           |
| `src/runtime/tasks.ts`              | Per-task reactive side-table (status/duration/error) + tree helpers + aggregate helpers        |
| `src/runtime/test-context.ts`       | `require.context`-backed test file lookup + HMR notify callback                                |
| `src/babel/test-wrapper-plugin.ts`  | How test files are wrapped in `exports.__run` + HMR dispose hook                               |
| `src/babel/vitest-compat-plugin.ts` | Babel rewrites that make Vitest's dist loadable under Metro                                    |

## 1. Process topology

```
┌───────────────────────── Node (pool process) ──────────────────────────┐
│                                                                        │
│  Vitest CLI / Vite dev server                                          │
│       │                                                                │
│       │  (custom PoolWorker, isolate=false, maxWorkers=1)              │
│       ▼                                                                │
│  NativePoolWorker (pool.ts)                                            │
│       │                                                                │
│       ├── Metro (metro-runner.ts) — serves JS bundle                   │
│       ├── WebSocket server (connections.ts) — pool ↔ device protocol   │
│       ├── Harness binary cache (harness-builder.ts)                    │
│       └── Device driver (device/ios.ts, device/android.ts)             │
│                                                                        │
└─────────────────────┬──────────────────────────────┬───────────────────┘
                      │ HTTP :8081+ (bundle)         │ WebSocket :17878+
                      ▼                              ▼
┌────────────────── Simulator / Emulator ────────────────────────────────┐
│                                                                        │
│  Harness RN app (Hermes)                                               │
│       │                                                                │
│       │  harness.tsx mounts → HarnessRuntime.start()                   │
│       ▼                                                                │
│  DevicePoolConnection (all frames `flatted` → one parse, fan-out)      │
│       │                                                                │
│       ├── `worker.ts` → vitest/worker.init() (+ birpc via same on/off) │
│       │       ├── setup()   → polyfills + expect                       │
│       │       ├── runTests() → HarnessRuntime.runTests()               │
│       │       └── collectTests() → HarnessRuntime.runCollectTests()    │
│       ├── pool messages: pause, resume, error (via isPoolMessage)      │
│       │                                                                │
│  HarnessRuntime (runtime.ts) — root DI container                       │
│       ├── collectedFiles: Signal<File[]>  (reactive test-tree state)   │
│       ├── taskState: Map<id, ReactiveTaskFields> (per-task signals)    │
│       ├── registry diff: debounced created/deleted/updated → pool      │
│       └── _currentState: WorkerGlobalState (set during runTests)       │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

Key invariants:

- **One WebSocket session per platform.** The pool plugin serializes all
  traffic over a single connection to a single RN app instance.
- **Single JS VM across test files.** `isolate=false` + `maxWorkers=1` in
  `node/index.ts::nativePlugin` makes Vitest batch every file in a run into
  one task with `ctx.files = [all]`. The RN VM shares state across files,
  matching physical reality. `isolate` must be set unconditionally (Vitest
  defaults it to `true`, not `undefined`).
- **Metro is in-process.** Started programmatically by `metro-runner.ts`.
  No separate `npx expo start` or `npx metro` process.

## 2. Startup sequence

The sequence from `npx vitest run --project ios` to "ready to run tests":

1. **Vitest boots.** Sees `test.pool = poolRunner` from `nativePlugin`.
   Calls `createPoolWorker()` → `NativePoolWorker`.
2. **Plugin config mutation.** `nativePlugin.configureVitest()` sets
   `test.isolate = false` and `test.maxWorkers = 1`. Mirrors `test.include`
   into `InternalPoolOptions.testPatterns`.
3. **Pool `start()` returns immediately.** Real bring-up happens in
   `doStart()` which runs in the background under a ref'd keep-alive so
   Vitest's 90s `WORKER_START_TIMEOUT` doesn't fire.
4. **`doStart()` phases** (all in `pool.ts`):
   - `resolveInstance()` — picks free WS + Metro ports, mints an instance ID,
     registers in `~/.vitest-mobile/instances.json`.
   - `checkAndReportEnvironment()` — validates Xcode / SDKs / ADB / JDK.
   - `resolveHarness()` — looks up the cached harness binary in
     `~/.cache/vitest-mobile/builds/<cacheKey>/` or errors with a
     `npx vitest-mobile bootstrap <platform>` hint. Sets
     `runtime.harnessProjectDir`.
   - `resolveDevice()` — picks a simulator/emulator, boots if necessary.
   - `installHarness()` — `simctl install` / `adb install`, skipped if the
     device already has the matching cache-key.
   - `registerPlatform()` — plug this pool's WS handler into the shared
     server for its platform.
   - `setupBundleServer()` — `startMetroServer()` OR a static file server
     if a pre-built bundle is on disk.
   - `launchAndWaitForApp()` — launch the app; wait for it to connect back.
5. **App boots on device.** Harness root component mounts, constructs
   `HarnessRuntime`, and calls `runtime.start()` from a `useEffect`.
   The runtime creates the `DevicePoolConnection`, registers the
   `vitest/worker.init()` adapter, and opens the WebSocket.
6. **`start` message.** Vitest sends `{__vitest_worker_request__: true, type: 'start', …}`
   through the pool. Pool answers `started` synchronously (so Vitest's
   `START_TIMEOUT` is satisfied) and asynchronously forwards to device once
   connected.
7. **Device-side `setup()`.** Installs runtime polyfills (process,
   performance, structuredClone, DOMException, EventTarget), wires
   `@vitest/expect` + chai. Module freshness for reruns is **Metro HMR's job**
   — we don't manually invalidate anything. See `worker.ts::setup`,
   `polyfills.ts`, `expect-setup.ts`, and `runner.ts::importFile`.

## 3. Run sequence

Normal `run` dispatch:

1. **Vitest sends `run`** with `context.files: FileSpecification[]` through
   the worker protocol. With `isolate=false` + `maxWorkers=1`, Vitest batches
   all files into a single `run` call. Pool relays the flatted frame over
   WebSocket.
2. **Device parses once, fans out.** `connection.ts` `flatParse`s the frame
   and delivers the object to every `conn.on` subscriber. `init()`'s
   `onMessage` and birpc's listener both see it; non-Vitest frames are ignored
   internally, same as Node workers with structured data.
3. **init's switch handles `run`.** Calls `worker.runTests(state)` which
   delegates to `HarnessRuntime.runTests(state)`.
4. **`runTests` stashes `_currentState` and loops per-file:**
   ```
   this._currentState = state;
   for (const file of state.ctx.files) {
     const runner = new ReactNativeRunner(state.config, this)
     await startTests([file], runner)        ← @vitest/runner drives it
   }
   // finally: this._currentState = null
   ```
5. **`startTests` calls `runner.importFile(file.filepath)`.**
   `ReactNativeRunner.importFile` calls `runtime.runTest(filepath)` which
   uses the `require.context` in `test-context.ts` to resolve the module
   and invoke its `__run()` wrapper. The babel wrapper put all
   `describe`/`it`/hook calls inside `__run`, so this is where suite
   registration actually happens against `@vitest/runner`'s current state.
6. **`startTests` walks the registered suite tree.** Fires `onCollected`,
   per-task `onTaskUpdate` events.
7. **`ReactNativeRunner.onCollected` / `onTaskUpdate` forward via the runtime.**
   The runner calls `runtime.onCollected(files)` / `runtime.onTaskUpdate(packs, events)`.
   The runtime first updates the device-side reactive layer (`tasks.ts`)
   so the explorer UI reflects results without a pool round-trip, then
   forwards to `_currentState.rpc.onCollected(files)` / `rpc.onTaskUpdate(packs, events)` —
   birpc calls serialized via flatted, sent through `worker.post`, delivered
   to the pool's birpc transport in `node/pool.ts`, which dispatches them
   into Vitest's reporter pipeline exactly as if they came from a Node worker.
8. **Errors symbolicate before leaving the device.** `runner.onTaskUpdate`
   and `onAfterRunTask` call `symbolicateErrors()` which posts to Metro's
   `/symbolicate` endpoint and rewrites stacks in place. Reporters see
   resolved source locations.
9. **Vitest's reporter renders.** Terminal updates via the same code paths it
   uses for Node workers.

`collect` is the same flow with `collectTests` instead of `startTests` — the
runner collects suite metadata but doesn't execute.

## 4. The rerun loop

Two device-initiated rerun paths share one wire format. The plugin
unregisters Vite's FilesWatcher to keep this the only rerun source in dev
mode.

**Path A — single-file HMR rerun.** The user edits a test file; Metro's
HMR re-evaluates the module and fires `module.hot.dispose()` (added by the
babel test-wrapper plugin). The dispose closure calls the `notifyCallback`
in `test-context.ts`, which triggers `HarnessRuntime.scheduleUpdate()`.

**Path B — registry key set change.** Metro HMR re-evaluates
`test-context.ts` itself (e.g. a new test file was added). The
`module.hot.dispose()` hook fires the `notifyCallback`, which triggers
the same `scheduleUpdate()` path on the runtime.

```
┌────── device ─────────┐       ┌────── pool ───────────┐       ┌── vitest ──┐
│                       │       │                       │       │            │
│  Path A: test-file    │       │                       │       │            │
│   save → HMR dispose  │       │                       │       │            │
│  Path B: test-context │       │                       │       │            │
│   re-eval → dispose   │       │                       │       │            │
│       │               │       │                       │       │            │
│       ▼               │       │                       │       │            │
│  HarnessRuntime       │       │                       │       │            │
│    scheduleUpdate()   │       │                       │       │            │
│    → flushUpdate()    │       │                       │       │            │
│    diffs prev/next    │       │                       │       │            │
│    keys, sends:       │       │                       │       │            │
│    { type: 'update',  │       │                       │       │            │
│      data: {          │       │                       │       │            │
│        created, deleted,      │                       │       │            │
│        updated } }    │───────▶  handleUpdate          │       │            │
│                       │       │   gated on             │       │            │
│                       │       │   _initialRunStarted   │       │            │
│                       │       │       │               │       │            │
│                       │       │       ▼               │       │            │
│                       │       │  _onUpdate(data)      │       │            │
│                       │       │   → vitest.watcher    │──────▶│ rerun /    │
│                       │       │     .onFileCreate()   │       │ create /   │
│                       │       │   → vitest.rerunTest- │       │ delete     │
│                       │       │     Specifications()  │       │     │      │
│                       │       │                       │       │     ▼      │
│                       │       │                       │       │ (sched.    │
│                       │       │                       │       │  new run)  │
│                       │       │  { type: 'run',       │       │     │      │
│                       │       │    context:           │◀──────│            │
│                       │       │    { files: […] } }   │       │            │
│                       │       │       │               │       │            │
│                       │◀──────│  relay (flatted) ─────│       │            │
│  init dispatches run  │       │                       │       │            │
│  (→ §3 step 3)        │       │                       │       │            │
│                       │       │                       │       │            │
└───────────────────────┘       └───────────────────────┘       └────────────┘
```

Critical bits:

- **Vitest-canonical absolute paths on the wire.** The `require.context` in
  `test-context.ts` maps Metro-relative keys to absolute paths using
  `process.env.VITEST_MOBILE_APP_ROOT_ABS` (inlined by the
  `inline-app-root-plugin` at bundle time). The runtime's `flushUpdate()`
  diffs the key set and posts the absolute paths. These match
  `slash(path.resolve(cwd, file))` — the form Vitest stores in its
  `testFilesList` — so the pool hands `data.updated` straight to
  `vitest.getModuleSpecifications()` with no translation.
- **Debounced updates.** `scheduleUpdate()` debounces by 80ms so rapid HMR
  dispose callbacks are batched into a single `update` message.
- **Pool state is one bit + per-connection capture.** `_initialRunStarted`
  flips true when Vitest sends its first `run`. Device-initiated `update`
  messages are ignored until then, preventing stale replays on first connect.
- **The rerun is Vitest-native.** HMR / registry changes don't bypass Vitest;
  they're just triggers. Vitest still builds the `FileSpecification[]`,
  sends `run`, awaits reporter finalization, etc. The device is
  fundamentally in the "worker" role the whole time.
- **Vitest's own watcher is disabled in dev mode.** `configureVitest` in
  `nativePlugin` calls `vitest.watcher.unregisterWatcher()` so there's no
  duplicate race between Vite's file watcher and our device-driven rerun.

## 5. Runtime state model

`HarnessRuntime` owns two pieces of reactive state consumed by the explorer UI:

- **`collectedFiles: Signal<File[]>`** — the canonical Vitest `File[]` tree.
  Updated by `applyCollected()` which merges incoming files (replacing entries
  with the same `filepath`, appending new ones). The explorer's `TestTree`,
  `PeekBar`, and `TestDetailView` all derive from this.
- **`taskState: Map<string, ReactiveTaskFields>`** — per-task signal fields
  (`status`, `duration`, `error`) keyed by `task.id`. Populated by
  `applyCollected()` (walks the tree) and poked by `applyTaskUpdate()` (from
  result packs). **Entries persist for the lifetime of the runtime** — we
  never reap stale task ids, so previously-seen tests stay visible in the
  explorer even across reruns.

Both live on `HarnessRuntime` (not module-level globals). The explorer
resolves the runtime via `getContext(HarnessCtx)` through Signalium's owner
chain, set up by the harness's `<ContextProvider>`.

Reactive aggregates (`aggregateStatus`, `aggregateDuration`, `countByStatus`)
in `tasks.ts` walk the Vitest task tree and read from `taskState` via
the context chain. Event handlers in view components (which lack a reactive
scope) read `runtime.collectedFiles.value` directly.

## 6. Protocol surface

**Every** WebSocket frame is `flatted` — including simple `{ type: 'update' }`
control messages (they serialize to a one-element flatted array). The pool
(`relayToDevice`) and device (`DevicePoolConnection.post`) always round-trip
this way, so there is a single `flatParse` on each side. No `JSON`/`flatted`
split, no `deserialize` hook in `init()`; transport matches upstream's
pass-through worker shape (compare `CustomPoolWorker` in `vitest-pool-example`).

### Pool → Device (flatted, through `init()`'s `post` / `on` transport)

| Type      | init handles? | Effect on device                                                                                                                                      |
| --------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start`   | ✅            | `setup()` — polyfills + expect, stash `setupContext`                                                                                                  |
| `run`     | ✅            | `runTests(state)` — see §3                                                                                                                            |
| `collect` | ✅            | `collectTests(state)` — collect without executing                                                                                                     |
| `stop`    | Never reached | Pool replies `stopped` synchronously, never relays                                                                                                    |
| `cancel`  | No case       | Silently dropped — upstream Vitest handles cancel in `runBaseTests` (which we skip); the device cancels locally instead via `HarnessRuntime.cancel()` |

### Pool → Device (our subprotocol — `isPoolMessage` on the parsed object)

| Type     | Effect                                                                              |
| -------- | ----------------------------------------------------------------------------------- |
| `resume` | Unblocks a paused test via `resumePause()`                                          |
| `error`  | Shows an error toast in the harness UI; `haltReconnection` stops the reconnect loop |

### Device → Pool (our subprotocol — `isDeviceMessage` on the parsed object)

| Type         | Effect on pool                                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `pause`      | `PauseController.start()` — blocks, prints TTY prompt, optional screenshot                                              |
| `pauseEnded` | `PauseController.end()` — device resumed itself                                                                         |
| `update`     | Forward `data.{created,deleted,updated}` to `vitest.watcher` / `rerunTestSpecifications`, gated on `_initialRunStarted` |
| `cancel`     | (Echo-back is currently inert; see "Known Quirks")                                                                      |

### Device → Pool (flatted, birpc responses through `init`'s transport)

- `onCollected(files)` — fires from `ReactNativeRunner.onCollected` via `runtime.onCollected`.
- `onTaskUpdate(packs, events)` — fires from `onTaskUpdate` via `runtime.onTaskUpdate`.

These look like ordinary birpc calls from the pool's POV; they hit the
`RuntimeRPC` surface the reporter pipeline consumes.

## 7. What we deliberately skip from Vitest's Node worker path

`runBaseTests` in `packages/vitest/src/runtime/workers/base.ts` is the
entry point Vitest calls in its own Node/Vite workers. We don't use it
because its dependencies don't hold on Hermes:

| Dropped                                          | Why                                                                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `setupGlobalEnv`                                 | No `process`, no Node stdio, no `uncaughtException` listener                                                 |
| `startCoverageInsideWorker`                      | Coverage providers need `inspector`/`v8` APIs                                                                |
| `resolveSnapshotEnvironment`                     | Default resolver wants `node:fs`                                                                             |
| `detectAsyncLeaks`                               | Needs `async_hooks`                                                                                          |
| `closeInspector`                                 | No Node inspector                                                                                            |
| `resolveTestRunner` (monkey-patches)             | No Vite `TestModuleRunner` to hand in; we wire `onCollected`/`onTaskUpdate` ourselves on `ReactNativeRunner` |
| `NativeModuleRunner` / `startVitestModuleRunner` | Module loading is Metro's job                                                                                |
| `resetModules` in isolate branch                 | No Vite module graph                                                                                         |
| `vi.resetConfig()` / `vi.restoreAllMocks()`      | No `vi` on device                                                                                            |

Vitest Browser does exactly the same thing — see
`packages/browser/src/client/tester/tester.ts::executeTests` in the Vitest
source. Both browser and vitest-mobile are peer implementations of the
same layer; the shared API surface between the three is just
`@vitest/runner`'s `startTests` / `collectTests`.

Things we **don't** implement from `resolveTestRunner`'s monkey-patch that
technically could be wired (all just rpc forwards on `ReactNativeRunner`):

- `onCollectStart` → `rpc.onQueued(file)` — reporter "queued" state
- `onTestAnnotate` → `rpc.onTaskArtifactRecord(..., { type: 'internal:annotation', ... })`
- `onTestArtifactRecord` → `rpc.onTaskArtifactRecord(...)`
- Patching `file.prepareDuration` / `file.environmentLoad` — reporter summary timings

These are cosmetic; missing them doesn't break correctness.

## 8. Known quirks

- **Local cancel only.** The explorer Stop button calls
  `HarnessRuntime.cancel()` on the device, which aborts the in-flight
  `pause()` and lets `runTests` return cleanly so the next `run` from the
  pool can dispatch. There's no pool-initiated cancel today — Vitest's
  upstream `cancel` framing is dropped silently and `state.onCancel` is
  not wired.
- **`stop` never reaches the device.** Pool replies `stopped` synchronously
  so Vitest's 60s STOP_TIMEOUT is satisfied. Real teardown happens in
  `NativePoolWorker.stop()` which closes Metro, the WS session, and the
  instance record. The device just loses its connection and (in dev mode)
  sits idle waiting for a reconnect. With `isolate=false` + `maxWorkers=1`,
  Vitest batches all files into one task, so `stop()` is only called once
  at the end of the run.
- **`isolate=false` is non-negotiable.** The RN VM is shared across files
  and across reruns; pretending otherwise would require tearing down and
  re-bootstrapping the app per file, which defeats the whole HMR story.
- **Task state is append-only.** `taskState` on `HarnessRuntime` never reaps
  entries. Previously-seen task ids persist for the lifetime of the runtime.
  This is intentional — the explorer should be able to show every test it
  has ever observed, even across reruns where the file set changes.
