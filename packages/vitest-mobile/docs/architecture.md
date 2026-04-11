# vitest-mobile Architecture

vitest-mobile is a bidirectional testing framework that bridges Vitest (Node.js host) with a React Native app (device/simulator). It has two runtime environments connected by WebSocket:

- **Host (Node.js)**: Vitest pool worker, Metro dev server, device control
- **Device (Hermes/RN)**: Test runner, React component renderer, native TurboModule for view queries

```
+-----------------------+         WebSocket          +-------------------------+
|     HOST (Node.js)    |  <======================>  |   DEVICE (Hermes/RN)    |
|                       |    flatted-encoded BiRPC   |                         |
|  Vitest pool worker   |                            |  ReactNativeRunner      |
|  Metro dev server     |                            |  @vitest/runner         |
|  Device control (adb/ |                            |  TurboModule (JSI)      |
|    simctl)            |                            |  Explorer UI            |
|  Screenshot capture   |                            |  Test component render  |
+-----------------------+                            +-------------------------+
```

## Build Targets

tsup produces six entry points from `src/`:

| Entry                       | Target  | Format  | Role                                   |
| --------------------------- | ------- | ------- | -------------------------------------- |
| `node/index`                | Node 18 | ESM+CJS | Vite plugin, pool worker factory       |
| `node/pool`                 | Node 18 | ESM+CJS | Custom Vitest pool implementation      |
| `runtime/index`             | ES2022  | CJS     | Device-side harness (bundled by Metro) |
| `runtime/vitest-shim`       | ES2022  | CJS     | Metro resolves `vitest` to this        |
| `babel/test-wrapper-plugin` | Node 18 | CJS     | Babel plugin for test file wrapping    |
| `metro/withNativeTests`     | Node 18 | CJS     | Metro config helper                    |
| `cli/index`                 | Node 18 | ESM     | CLI binary                             |

---

## Host Side

### Vitest Plugin (`node/index.ts`)

Entry point for Vitest integration. Exports `nativePlugin(options)` which returns a Vite plugin that:

- Configures `test.pool` to use the native pool worker
- Forces `maxWorkers = 1` (one pool instance per platform)
- Registers a custom reporter that sends `__native_run_start` / `__native_run_end` messages to the device so the explorer UI can track run boundaries

Creates a singleton worker per platform, reused across Vitest watch-mode runs.

**Review: look for** correct reporter lifecycle (does run-start fire before first file? does run-end fire after last file?), and whether the singleton pattern handles Vitest restarts cleanly.

### Pool Worker (`node/pool.ts`)

The largest file in the package (~680 lines). Implements the Vitest custom pool interface. All per-worker state is closure-scoped inside `createNativePoolWorker()`.

**Initialization sequence (`doStart()`):**

1. Resolve isolated instance resources (instanceId, wsPort, metroPort, per-instance outputDir)
2. Check environment (Xcode / Android SDK / simulators)
3. Build or locate harness binary (`ensureHarnessBinary`)
4. Boot or select isolated device/emulator (`ensureDevice`)
5. Generate test registry (glob for test files, write import map)
6. Register platform on shared WebSocket server
7. Start Metro for this instance (no default reuse)
8. Install + launch app on selected device
9. Wait for device to connect (30s timeout)
10. Send initial `start` message with Vitest config

**Message routing:** The pool acts as a relay between Vitest and the device. It intercepts certain messages (screenshot requests, pause/resume, rerun requests) and forwards BiRPC messages for test lifecycle.

**Pause handling:** When the device sends `__pause`, the pool prints terminal status, captures an auto-screenshot, and listens for Enter on stdin or a `.vitest-mobile-resume` file (for editor integration). On resume, it sends `__resume` back to the device.

**Review: look for** race conditions in the connection handshake (what if the device connects before doStart finishes?), cleanup correctness on abort/error paths, and whether the rerun callback correctly maps registry keys back to absolute file paths.

### Connection Manager (`node/connections.ts`)

Manages a single shared WebSocket server across platforms. When a device connects, it waits for a `__hello` message (5s timeout) to identify the platform, then hands the socket to the correct pool worker.

**Review: look for** socket leak on timeout or invalid hello, and whether unregisterPlatform cleans up properly when Vitest stops.

### Metro Runner (`node/metro-runner.ts`)

Starts Metro programmatically using `metro.runServer()` and `metro-config.loadConfig()`. Configures:

- Custom resolver that redirects `vitest` imports to `vitest-shim` and `vitest-mobile/test-registry` to the generated file
- Babel config with the test-wrapper plugin
- React Native dev middleware integration (Chrome DevTools, debugger)
- Generated entry wiring that passes resolved WS/Metro ports to `createTestHarness`

**Review: look for** correct resolver behavior (does it handle nested imports? edge cases in module resolution?), and whether Metro config merging respects user overrides.

### Device Control (`node/device.ts`)

Boot, launch, stop, and screenshot commands for iOS simulators (`xcrun simctl`) and Android emulators (`adb`). Uses shared helpers from `exec-utils.ts`.

**Review: look for** error handling on device commands (timeouts, missing binaries), and whether the iOS scheme approval logic is correct.

### Harness Builder (`node/harness-builder.ts`)

Creates the React Native app binary that hosts tests. Runs `npx @react-native-community/cli init`, customizes the project (bundle ID, deployment target, etc.), builds with Xcode/Gradle, and caches the result.

**Review: look for** cache invalidation correctness (does it rebuild when native modules change?), lock file handling, and whether the build commands work on both Intel and Apple Silicon.

### Error Formatting (`node/symbolicate.ts`, `node/code-frame.ts`)

- **symbolicate.ts**: Parses Hermes and V8 stack traces, sends them to Metro's `/symbolicate` endpoint to map bundle offsets back to source locations
- **code-frame.ts**: Generates syntax-highlighted code snippets with error carets, similar to Babel's code frame output

**Review: look for** correct stack frame parsing (Hermes format is `method@file:line:col`, V8 is `at method (file:line:col)`), and whether symbolication handles source maps from node_modules.

---

## Device Side (Runtime)

### Harness Root (`runtime/harness.tsx`)

`createTestHarness(config)` returns the root React component. On mount it:

1. Loads all test files from the generated registry (`loadAllTestFiles()`)
2. Connects to the Vitest pool WebSocket (`connectToVitest()`)
3. Renders the `TestExplorer` UI

The app always shows the explorer UI. In connected mode, the pool drives test execution and the explorer observes via events. In standalone mode, tests can be browsed but not run (no pool).

**Review: look for** initialization ordering (does the WS connect before or after test files load? does it matter?).

### WebSocket + Test Loop (`runtime/setup.ts`)

Establishes the WebSocket connection to the pool and handles the full test execution lifecycle.

**Key state:**

- `ws` / `vitestRpc` -- WebSocket client and BiRPC handler
- `storedConfig` -- VitestRunnerConfig cached from first run
- `_taskQueue` -- serial promise chain ensuring one run/collect at a time
- `_runAbortController` -- cancels the current run when a new one starts

**Message handlers** (received from pool):

- `__vitest_worker_request__` with `type: 'start'` -- store config, invalidate module cache
- `type: 'run'` -- abort existing run, enqueue `handleRun()`
- `type: 'collect'` -- enqueue `handleCollect()`
- `type: 'cancel'` -- abort current run
- `__reload` -- call `DevSettings.reload()` for full JS reload
- `__resume` -- unblock paused test
- `__screenshot_response__` -- resolve pending screenshot promise

**`handleRun(context)`** creates a `ReactNativeRunner`, calls `startTests()` from `@vitest/runner`, and emits `TestEvent`s as each test completes. On error, it symbolicates the stack before sending to the pool.

**Module invalidation:** `invalidateAllTestModules()` walks Metro's module table and resets all `.test.tsx` modules so the next `require()` re-executes the factory.

**HMR listener:** `registerHmrRerunListener()` watches for Metro HMR dispose callbacks (fired by the babel plugin) and batches rerun requests to the pool with an 80ms debounce.

**Review: look for** correctness of the serial task queue (can a stale run's callbacks fire after abort?), whether `invalidateAllTestModules` catches all test file patterns, and reconnection logic (the `_wasEverConnected` path triggers a full reload).

### Test Runner (`runtime/runner.ts`)

Implements `VitestRunner` from `@vitest/runner`:

- `onBeforeRunFiles` -- wait for test container, setup expect
- `importFile` -- resolve registry key, invalidate Metro module, `require()` test file, call `__run()` (the babel-wrapped test body)
- `onAfterRunTask` -- symbolicate errors, call `cleanup()`
- `onCollected` / `onTaskUpdate` -- forward to pool via BiRPC

Uses `resolveRegistryKey()` (from `registry-utils.ts`) to map Vitest's absolute file paths to the short keys used by the test registry (e.g., `counter/counter.test.tsx`).

**Review: look for** whether `importFile` handles missing/renamed files gracefully, and whether module invalidation correctly targets the right Metro module (the matching is by substring on `verboseName`).

### Render API (`runtime/render.tsx`)

`render(element, options)` mounts a React component into the test container:

1. Increment render key (forces React to destroy and recreate the tree)
2. Set content via global setter from `context.tsx`
3. Yield multiple times + flush UI queue (waits for Fabric commit pipeline)
4. Return a `Screen` with locator methods

`cleanup()` unmounts and flushes. Called after each test by the runner.

**Review: look for** whether the yield/flush sequence is sufficient for all component types (especially async components or those with layout effects), and whether cleanup prevents stale native node references.

### View Tree Queries (`runtime/tree.ts`, `runtime/locator.ts`)

**tree.ts** wraps the `VitestMobileHarness` TurboModule. All query methods are **synchronous** -- they block the JS thread while dispatching to the UI thread via `dispatch_sync` (iOS) / `CountDownLatch` (Android).

**locator.ts** implements the `Locator` class -- a lazy, re-evaluating reference to an element. Each access re-runs the native query, so assertions always see current state. Methods:

- `query()` / `element()` / `elements()` -- sync lookups
- `tap()` -- uses `Harness.simulatePress` (native touch synthesis) with fallback to handler lookup
- `type()` -- uses `Harness.typeIntoView` (native text input) with fallback to handler lookup
- `text` / `exists` / `props` -- sync getters

`createLocatorAPI()` returns the full API surface (`getByTestId`, `findByText`, `getAllByTestId`, etc.).

Note: `findHandler()` in tree.ts always returns `undefined` -- handler-based fallbacks in `tap()` / `type()` / `longPress()` will always throw. Only the native JSI path works.

**Review: look for** whether synchronous blocking is safe in all execution contexts (it relies on the JS thread being separate from the UI thread, which is true in New Architecture but not in legacy bridge mode).

### Expect Setup (`runtime/expect-setup.ts`)

Initializes `@vitest/expect` with Chai in the Hermes runtime. Runtime polyfills are applied up-front from `runtime/polyfills.ts` so Chai and Vitest expect can be loaded safely in Hermes.

Also provides `expect.element(locator)` for retrying assertions against locators, using `poll()` from `retry.ts`.

**Review: look for** whether the polyfill is complete enough for Chai's usage (the EventTarget polyfill is minimal), and whether the expect state (`assertionCalls`, etc.) resets correctly between tests.

### Pause (`runtime/pause.ts`)

`pause({ label?, screenshot? })` blocks test execution until resumed. In dev mode, it:

1. Sends `__pause` to the pool (triggers terminal status + auto-screenshot)
2. Re-enables Fast Refresh (so the developer can edit components while paused)
3. Blocks on a promise until `resume()` is called
4. On resume, disables Fast Refresh and continues

In run mode (CI), pause throws immediately to prevent hanging builds.

**Review: look for** whether the abort signal correctly interrupts the pause promise, and whether Fast Refresh toggle has race conditions with HMR.

### Native Harness Module (`runtime/native-harness.ts`)

Loads the `VitestMobileHarness` TurboModule via `TurboModuleRegistry.getEnforcing()`, with a fallback to `NativeModules` for legacy bridge mode.

The TurboModule interface provides:

- `queryByTestId`, `queryAllByTestId`, `queryByText`, `queryAllByText` -- synchronous view queries
- `getText`, `isVisible` -- element inspection
- `dumpViewTree` -- full tree dump
- `simulatePress` -- native touch synthesis
- `typeIntoView`, `typeChar` -- native text input
- `flushUIQueue` -- drain pending UI operations

**Review: look for** whether the module handles the case where native code isn't linked (e.g., running in Expo Go without a dev build).

### Vitest Shim (`runtime/vitest-shim.ts`)

Metro resolves `import { describe, it } from 'vitest'` to this file. It re-exports the real functions from `@vitest/runner` so test files work without modification.

**Review: look for** whether all commonly-used vitest exports are covered (vi.fn, vi.mock, etc. are NOT -- only runner primitives).

---

## Babel Plugin (`babel/test-wrapper-plugin.ts`)

Transforms `*.test.{ts,tsx}` files so that:

- Import/export declarations stay at the top level (Metro needs them)
- All other statements (`describe`, `it`, etc.) are wrapped in `exports.__run = function() { ... }`
- `module.hot.accept()` makes the file its own HMR boundary
- `module.hot.dispose()` notifies `globalThis.__TEST_HMR_LISTENERS__` with the test key

This wrapping is critical: without it, `describe()` / `it()` calls execute on `require()` outside a runner context, causing "Vitest failed to find the current suite" errors. The runner calls `__run()` inside `startTests()` where the suite collector is active.

**Review: look for** whether the plugin handles edge cases (test files with no test calls, files that re-export from other test files, files with top-level side effects that should NOT be deferred).

---

## Metro Config (`metro/withNativeTests.ts`, `metro/generateTestRegistry.ts`)

**withNativeTests** is the user-facing Metro config helper. It:

- Generates the test registry file
- Sets up a file watcher that regenerates when test files are added/removed
- Configures the resolver to redirect `vitest` and `vitest-mobile/test-registry` imports
- Adds `react-native` to `unstable_conditionNames` for proper platform resolution

**generateTestRegistry** globs for test files and writes a JS module that:

- Exports `testFileKeys` (array of display keys like `"counter/counter.test.tsx"`)
- Exports `importTestFile(key)` (dynamic import thunk for lazy loading)
- Exports `loadAllTestFiles()` (preload all test bundles)
- Initializes `globalThis.__TEST_HMR_LISTENERS__` (Set for HMR callbacks)

**Review: look for** whether the file watcher debounce (300ms) is sufficient, whether the generated module handles special characters in file paths, and whether `toDisplayKey()` produces unique keys (it could collide if two packages have the same test filename).

---

## Explorer UI

### TestExplorer (`runtime/explorer/TestExplorer.tsx`)

Groups test files from the registry by module name and renders `<RunnerView>`.

### RunnerView (`runtime/explorer/RunnerView.tsx`)

The main UI controller. Subscribes to `onTestEvent()` and `onStatusChange()` from state.ts and maintains the test tree, run metrics, and UI state.

Layout: full-screen `TestContainer` (where test components render) with a bottom sheet overlay containing the test browser.

The test container scales down as the bottom sheet rises, anchored below the safe area. This uses `Animated.interpolate` on the sheet's animated height.

**Review: look for** whether the tree cloning (`structuredClone`) in event handlers causes performance issues with large test suites, and whether the animated scaling handles orientation changes.

### SimpleBottomSheet (`runtime/explorer/SimpleBottomSheet.tsx`)

Pure RN implementation using `Animated` + `PanResponder`. No external animation library. Supports snap points (percentage or pixel), dynamic content sizing, and velocity-based snap selection.

### Tree Utilities (`runtime/explorer/tree-utils.ts`)

Pure functions for building and filtering the test tree:

- `buildFileTree` -- create initial tree from file keys
- `mergeTestResults` -- walk suitePath to create describe nodes, add test leaves
- `propagateStatus` -- aggregate child status upward (fail > running > pass > idle > pending)
- `filterByStatus` / `filterBySearch` -- prune tree for display

**Review: look for** correctness of `propagateStatus` precedence, whether `mergeTestResults` handles duplicate test names within a describe, and whether tree filtering preserves parent nodes correctly.

---

## Message Protocol

All WebSocket messages are JSON (plain or flatted-encoded for circular references).

### Pool to Device

| Message                                                           | Purpose                      |
| ----------------------------------------------------------------- | ---------------------------- |
| `{ __vitest_worker_request__: true, type: 'start', context }`     | Initialize session           |
| `{ __vitest_worker_request__: true, type: 'run', context }`       | Execute test files           |
| `{ __vitest_worker_request__: true, type: 'collect', context }`   | Collect test structure       |
| `{ __vitest_worker_request__: true, type: 'cancel' }`             | Abort current run            |
| `{ __native_run_start: true, fileCount, testCount }`              | Run boundary (from reporter) |
| `{ __native_run_end: true, reason }`                              | Run boundary (from reporter) |
| `{ __resume: true }`                                              | Unblock paused test          |
| `{ __reload: true }`                                              | Request full JS reload       |
| `{ __screenshot_response__: true, requestId, filePath?, error? }` | Screenshot result            |

### Device to Pool

| Message                                              | Purpose                               |
| ---------------------------------------------------- | ------------------------------------- |
| `{ __hello: true, platform }`                        | Connection handshake                  |
| `{ __screenshot_request__: true, requestId, name? }` | Request screenshot                    |
| `{ __pause: true, label?, screenshot? }`             | Test paused                           |
| `{ __pause_ended: true }`                            | Pause ended                           |
| `{ __rerun: true, files, testNamePattern?, label }`  | Request rerun (from HMR or UI)        |
| `{ __cancel: true }`                                 | Cancel run (from UI)                  |
| BiRPC messages (flatted)                             | Test results, errors, collected files |
