# vitest-mobile

## Project Structure

Monorepo with workspaces:

- `packages/vitest-mobile/` — the main package (Vitest custom pool + runtime + native modules + CLI)
- `test-packages/` — test modules (counter, greeting, toggle, todo-list)

Root-level files (`index.js`, `index.ios.js`, `babel.config.cjs`, `vitest.config.ts`) are auto-generated harness entry points.

## Architecture Overview

The test harness has two modes:

- **Explorer mode** (default): Standalone UI for browsing/running tests without Vitest
- **Connected mode**: Headless mode driven by Vitest pool over WebSocket

Test files are transformed by a Babel plugin (`vitest-mobile/babel-plugin`) that wraps `describe()`/`it()` calls in an `exports.__run` function, making them safe to `require()` without an active runner context. The runner calls `__run()` inside `startTests()` where vitest's suite collector is active.

## CLI Commands

All commands: `npx vitest-mobile <command>`

### Device & App Lifecycle

```bash
# Boot iOS simulator
npx vitest-mobile boot-device ios

# Build the harness binary (requires Xcode, takes ~5min first time)
npx vitest-mobile build ios

# Install harness binary on device
npx vitest-mobile install ios

# Build + install in one step
npx vitest-mobile bootstrap ios

# Launch app manually on simulator
xcrun simctl terminate booted com.vitest.mobile.harness
xcrun simctl launch booted com.vitest.mobile.harness --initialUrl "http://127.0.0.1:8081"
```

### Debugging & Inspection

```bash
# Evaluate JS in the running app via Chrome DevTools Protocol
npx vitest-mobile debug eval "<expression>"

# Open the JS debugger on the device
npx vitest-mobile debug open

# Take a screenshot of the simulator
npx vitest-mobile screenshot --platform ios
```

### Running Tests

```bash
# Via Vitest (connected mode — pool drives execution)
npx vitest run
npx vitest dev

# Build the package
npm run build

# Watch mode (rebuilds on source changes — run alongside Expo)
npm run dev
```

## In-Test APIs

```typescript
import { render, cleanup, waitFor, screenshot, pause } from 'vitest-mobile/runtime';
```

- `render(<Component />)` — renders into the test container, returns a `Screen` with locator methods
- `cleanup()` — unmounts the rendered component
- `waitFor(() => expect(...))` — retries an assertion until it passes
- `screenshot(name?)` — captures the emulator screen, returns host file path (PNG). No-ops in standalone/explorer mode.
- `pause({ label?, screenshot? })` — blocks test execution. In explorer mode, shows a Continue button. In connected mode, blocks until resumed via Enter key or CLI.
- `screen.dumpTree()` — returns an indented text representation of the rendered view tree
- `screen.getTree()` — returns a structured `ViewTreeNode` object
- `screen.findByTestId(id)` — async find element by testID
- `screen.getByTestId(id)` — sync find (throws if not found)
- `element.tap()` — simulate touch
- `element.type(text)` — simulate text input
- `expect(element).toHaveText(text)` — assert element text
- `expect(element).toBeVisible()` — assert element visibility

## CDP Evaluation Patterns

The `debug eval` command is the primary tool for inspecting app state from outside.

### Hermes Bridgeless Limitations

- `require()` does NOT work in CDP eval — use `globalThis` for accessing registered globals
- Use `globalThis` not `global` (doesn't exist in Hermes)
- `Runtime.enable` times out — the debug command skips it automatically
- `__r.getModules()` may return empty with lazy bundling
- `__r.resolveWeak()` only works at bundle time, not dynamically

### Useful Eval Expressions

```bash
# Check test file registry
npx vitest-mobile debug eval "JSON.stringify(Object.keys(globalThis.__TEST_FILES__ || {}))"

# Check if a test module has the babel plugin's __run wrapper
npx vitest-mobile debug eval "(function() { var f = globalThis.__TEST_FILES__; var m = f && f['counter/counter.test.tsx'](); return JSON.stringify({ hasRun: typeof m?.__run, keys: Object.keys(m || {}) }); })()"

# Check HMR listener state
npx vitest-mobile debug eval "globalThis.__TEST_HMR_LISTENERS__?.size ?? 'none'"

# Trigger HMR listeners manually (simulate file change)
npx vitest-mobile debug eval "(function() { var l = globalThis.__TEST_HMR_LISTENERS__; if (l) { l.forEach(function(fn) { fn('counter/counter.test.tsx'); }); return 'notified ' + l.size; } return 'no listeners'; })()"
```

## Agent Workflow for Component Development

1. Write a component + test with `pause()` at the point you want to inspect
2. Run the test via the Explorer UI or `npx vitest dev`
3. Test executes up to `pause()`, shows Continue button (explorer) or blocks (connected)
4. Take a screenshot: `npx vitest-mobile screenshot`
5. Inspect the view tree via `screen.dumpTree()` in the test
6. Edit the component — Metro HMR updates it live on the device
7. Take more screenshots to see changes
8. When satisfied, remove `pause()` and the test runs to completion

## Development Workflow

1. Make code change in `packages/vitest-mobile/src/`
2. tsup watch (`npm run dev`) rebuilds `dist/`
3. Metro detects change in `dist/` and serves updated bundle
4. App reloads (may need manual relaunch — see Common Issues)
5. Verify via screenshot + CDP eval + log tailing

## Common Issues

**"Requiring unknown module NNN"** — Module code not in the bundle. Caused by lazy bundling or missing static dependencies.

**"Vitest failed to find the current suite"** — `describe()`/`it()` called without runner context. The babel plugin should prevent this. Check:

- `babel.config.cjs` includes `'vitest-mobile/babel-plugin'`
- Clear Metro cache: `npx expo start --dev-client --clear`

**App crashes on reload (`r`)** — Dev client serves 1-module bundle. Workaround:

```bash
xcrun simctl terminate booted com.vitest.mobile.harness
xcrun simctl launch booted com.vitest.mobile.harness --initialUrl "http://127.0.0.1:8081"
```

**"No development build installed"** — Rebuild native binary:

```bash
npx vitest-mobile bootstrap ios
```

## Key Files

### Package Source (`packages/vitest-mobile/src/`)

| Path                                  | Purpose                                                  |
| ------------------------------------- | -------------------------------------------------------- |
| `runtime/harness.tsx`                 | Root component — mode switching (explorer vs connected)  |
| `runtime/explorer/TestExplorer.tsx`   | Navigation root for explorer mode                        |
| `runtime/explorer/RunnerView.tsx`     | Module list + test runner with results panel             |
| `runtime/explorer/TestTree.tsx`       | Collapsible test tree + mini tree                        |
| `runtime/explorer/TestDetailView.tsx` | Full-screen detail view for test results                 |
| `runtime/runner.ts`                   | VitestRunner implementation — importFile, onAfterRunTask |
| `runtime/vitest-shim.ts`              | Metro resolves `vitest` → this shim                      |
| `runtime/expect-setup.ts`             | Sets up chai + @vitest/expect for Hermes                 |
| `runtime/setup.ts`                    | WebSocket connection to Vitest pool (connected mode)     |
| `runtime/context.tsx`                 | TestContainerProvider — where render() puts components   |
| `runtime/pause.ts`                    | Pause/resume test execution                              |
| `runtime/screenshot.ts`               | Screenshot API                                           |
| `babel/test-wrapper-plugin.ts`        | Babel plugin wrapping test files                         |
| `metro/withNativeTests.ts`            | Metro config helper                                      |
| `node/pool.ts`                        | Vitest custom pool worker                                |
| `node/symbolicate.ts`                 | Stack trace symbolication via Metro (pool-side)          |
| `node/device.ts`                      | Device management (boot, launch, screenshot)             |
| `node/code-frame.ts`                  | Syntax-highlighted code snippets for errors              |
| `cli/index.ts`                        | CLI dispatcher                                           |
| `cli/debug.ts`                        | CDP debugging tools                                      |

### Root App Files

| Path                               | Purpose                                                      |
| ---------------------------------- | ------------------------------------------------------------ |
| `index.js` / `index.ios.js`        | Auto-generated — creates harness, registers with AppRegistry |
| `babel.config.cjs`                 | Auto-generated — includes test-wrapper babel plugin          |
| `vitest.config.ts`                 | Vitest config for connected mode (ios + android projects)    |
| `test-packages/*/tests/*.test.tsx` | Test files                                                   |

## Known Gaps

- **Cannot run tests programmatically via CDP** — `require()` doesn't work in Hermes CDP eval. Tests must be triggered via Explorer UI or HMR file changes.
- **HMR re-runs not fully working** — Notification chain works but re-execution has issues with module cache and test result collection. Active area of development.
- **No console log streaming to agent** — `Runtime.enable` times out on Hermes bridgeless. Logs only appear in Expo terminal.
- **test.only / it.only may not work** — Needs verification in standalone mode.
- **App reload fragile** — Pressing `r` sometimes produces 1-module bundle. Use terminate + relaunch.
- **No programmatic tap** — `xcrun simctl io booted tap` not supported on iOS. CLI `tap`/`type-text` commands exist but limited.
