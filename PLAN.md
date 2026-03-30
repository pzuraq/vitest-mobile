# React Native In-Process Test Runner

## Project Summary

We're building a lightweight test runner that executes component-level tests **inside a running React Native app**, using real native rendering. Tests are written with a familiar Vitest/Jest-like API (`describe`, `it`, `expect`), but unlike traditional approaches, the test code runs in the same JS context as the components under test — meaning you get full inline control (import components directly, pass arbitrary props, swap providers, change mock responses between assertions) while rendering real native views.

This is a proof-of-concept to validate the architecture. The goal is a working demo where:

1. An Expo app boots as a test harness
2. It discovers and runs `.test.tsx` files bundled by Metro
3. Tests render real React Native components into the app's view hierarchy
4. A query/interaction layer lets tests find elements by testID/text, tap them, type into them, and assert on their state
5. Results stream over WebSocket to a CLI process that prints them

## Why This Architecture

The problem we're solving: teams (and AI) writing React Native tests with heavy mocking (jest.mock everywhere) that pass but catch zero real bugs. The tests are fictions.

**RNTL + Jest/Vitest in Node**: Runs in a simulated environment. Easy to mock, no real rendering. Tests don't catch real bugs.

**Detox**: Real native rendering, but tests run in a separate process. You can't write JSX in your tests, can't pass props inline, can't easily test 50 configurations of a component. Every scenario must be pre-built into a harness app.

**Vitest Browser Mode (web)**: Perfect model — tests run in the same context as the component, real rendering, full inline control. But it's web only.

**This project**: The Vitest browser mode model applied to React Native. Tests run in-process with real native rendering AND full inline control. No mocking escape hatch — the only fake boundary is the network (via MSW).

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  CLI Reporter                        │
│  (Node process — receives results, prints to terminal│
│   in standard test-runner format)                    │
└──────────────────────┬──────────────────────────────┘
                       │ WebSocket
┌──────────────────────▼──────────────────────────────┐
│              React Native Harness App                │
│  (Expo app running on simulator/device)              │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │  Test Runtime                                  │  │
│  │  - discovers test files via require.context    │  │
│  │  - collects describe/it/beforeEach blocks      │  │
│  │  - executes tests sequentially                 │  │
│  │  - reports results over WebSocket              │  │
│  └──────────────┬─────────────────────────────────┘  │
│                 │                                     │
│  ┌──────────────▼─────────────────────────────────┐  │
│  │  Render API                                    │  │
│  │  - render(<Component />) mounts into a real    │  │
│  │    View inside the harness app                 │  │
│  │  - cleanup() unmounts between tests            │  │
│  │  - wraps in configurable provider tree         │  │
│  └──────────────┬─────────────────────────────────┘  │
│                 │                                     │
│  ┌──────────────▼─────────────────────────────────┐  │
│  │  Query & Interaction Layer                     │  │
│  │  - getByTestId, getByText, queryByTestId       │  │
│  │  - tap(), longPress(), type(), scroll()        │  │
│  │  - toBeVisible(), toHaveText(), toBeTruthy()   │  │
│  │  - built-in retry/polling for async UI         │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │  MSW (Mock Service Worker)                     │  │
│  │  - setupServer() running in-process            │  │
│  │  - shared handlers per module                  │  │
│  │  - tests can swap handlers inline              │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │  Test Container View                           │  │
│  │  (a real RN View where components mount)       │  │
│  └────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

All of this is bundled together by Metro as a single app. Test files are `.test.tsx` files that Metro compiles like any other module. No separate bundler, no serialization boundary, no IPC.

## Project Structure

```
rn-test-runner/
├── app/                          # Expo harness app
│   ├── app.json
│   ├── metro.config.js
│   ├── App.tsx                   # Entry point — boots test runtime
│   └── package.json
│
├── packages/
│   ├── test-runtime/             # The core test framework
│   │   ├── src/
│   │   │   ├── index.ts          # Public API: describe, it, expect, render, etc.
│   │   │   ├── collector.ts      # Collects describe/it/hook registrations into a tree
│   │   │   ├── runner.ts         # Walks the tree, executes tests, handles lifecycle
│   │   │   ├── reporter.ts       # WebSocket client — sends results to CLI
│   │   │   ├── render.tsx        # render() — mounts components into the harness view
│   │   │   ├── queries.ts        # getByTestId, getByText, queryBy*, findBy*
│   │   │   ├── interactions.ts   # tap(), type(), scroll(), longPress()
│   │   │   ├── matchers.ts       # toBeVisible(), toHaveText(), toHaveStyle()
│   │   │   ├── retry.ts          # Polling/retry logic for async assertions
│   │   │   └── context.tsx       # React context for the test container ref
│   │   └── package.json
│   │
│   └── cli/                      # Node-side CLI reporter
│       ├── src/
│       │   ├── index.ts          # Entry: starts WebSocket server, formats output
│       │   └── formatter.ts      # Pretty-prints results (pass/fail/error/timing)
│       └── package.json
│
├── modules/                      # Example UI modules to test against
│   └── counter/
│       ├── CounterModule.tsx      # A simple component with state + fetch
│       ├── mocks/
│       │   └── handlers.ts       # MSW handlers for this module
│       └── tests/
│           └── counter.test.tsx   # Test file — the thing developers write
│
└── package.json                  # Workspace root
```

## Implementation Plan

### Phase 1: Expo Harness App Shell

**Goal**: A bare Expo app that boots, renders a container view, and has a WebSocket connection ready.

1. Initialize an Expo project (`npx create-expo-app@latest rn-test-runner --template blank-typescript`)
2. The `App.tsx` should render:
   - A status bar area showing "Running tests..." / "Tests complete: X passed, Y failed"
   - A `View` with a ref that will serve as the test container (where components under test get mounted)
   - This container should be full-width, flexible height — the component under test renders here visually
3. Set up a WebSocket client that connects to `ws://localhost:7878` (the CLI reporter). This will be used later.
4. Verify it runs on iOS simulator via `npx expo start --ios`

**Key decision**: Use Expo SDK 52+ with the new architecture (Fabric) enabled by default.

### Phase 2: Test Runtime Core (collector + runner)

**Goal**: `describe`, `it`, `beforeEach`, `afterEach`, `beforeAll`, `afterAll` work and execute in order.

Build `packages/test-runtime/`:

1. **`collector.ts`** — The registration system:
   - `describe(name, fn)` creates a suite node in a tree
   - `it(name, fn)` creates a test node
   - `beforeEach(fn)`, `afterEach(fn)`, `beforeAll(fn)`, `afterAll(fn)` attach hooks to the current suite
   - Calling `describe()` at the top level of a test file registers it into a global suite tree
   - Support nesting: `describe` inside `describe`
   - `it.only()` and `it.skip()` for dev convenience

2. **`runner.ts`** — The executor:
   - Takes the collected suite tree
   - Walks it depth-first
   - For each suite: run `beforeAll` hooks, then for each test: run `beforeEach` hooks → test fn → `afterEach` hooks, then `afterAll` hooks
   - Catch errors/assertion failures per test, record pass/fail/error/duration
   - Tests run **sequentially** (no parallelism — we have one native view container)
   - Emit events: `onTestStart`, `onTestPass`, `onTestFail`, `onSuiteStart`, `onSuiteEnd`, `onRunComplete`

3. **`expect` / matchers** — Use `@vitest/expect` directly as a dependency. It's a standalone package that works in any JS runtime. Import it and re-export it. This gives you the full `expect()` API (toBe, toEqual, toBeTruthy, toThrow, etc.) for free. We'll add custom matchers (toBeVisible, toHaveText) on top later.

4. **Test discovery** — In the harness app entry point, use Expo's `require.context` to discover all `*.test.tsx` files:

   ```ts
   const ctx = require.context('./modules', true, /\.test\.tsx$/);
   ctx.keys().forEach((key) => ctx(key)); // importing runs the describe() registrations
   ```

   Then call `runner.run()` to execute everything.

5. **Validation**: Create a dummy test file that just does basic assertions (no rendering yet):
   ```ts
   describe('sanity', () => {
     it('math works', () => {
       expect(1 + 1).toBe(2);
     });
   });
   ```
   Log results to console. Verify they run when the app boots.

### Phase 3: Render API

**Goal**: `render(<Component />)` mounts a real React Native component into the harness app's view, and `cleanup()` unmounts it.

1. **`context.tsx`** — A React context that holds a ref to the container View in the harness app:

   ```tsx
   const TestContainerContext = createContext<React.RefObject<View> | null>(
     null
   );
   ```

   The harness app's `App.tsx` provides this context wrapping the test container View.

2. **`render.tsx`** — The render function:
   - This is the trickiest part. We need to imperatively mount a component tree into the container view.
   - Approach: use a **state-based mount**. The harness app maintains state `[testContent, setTestContent] = useState<ReactNode>(null)`. The container renders `{testContent}`. `render()` calls `setTestContent(element)` and waits for the next frame (or `act()`) to ensure it's committed.
   - Expose `setTestContent` via a global or module-scoped ref so the test runtime can call it.
   - `render()` returns a `screen` object with query methods bound to the mounted tree.
   - `cleanup()` calls `setTestContent(null)`.
   - Between tests, `afterEach` calls `cleanup()` automatically.

3. **Provider wrapping**: `render()` should accept an optional `wrapper` option for wrapping the component in providers:

   ```ts
   render(<CounterModule />, {
     wrapper: ({ children }) => (
       <ThemeProvider><QueryClientProvider>{children}</QueryClientProvider></ThemeProvider>
     )
   });
   ```

4. **Validation**: Render a simple `<Text testID="hello">Hello</Text>` component, log the fiber tree to confirm it mounted as a real native view.

### Phase 4: Query Layer

**Goal**: `getByTestId`, `getByText`, `queryByTestId`, etc. return elements from the rendered native component tree.

1. **`queries.ts`** — Element querying:
   - Traverse the React fiber tree starting from the container's fiber node
   - Find nodes matching testID or text content
   - `getByTestId(id)` — returns element, throws if not found
   - `queryByTestId(id)` — returns element or null
   - `getByText(text)` — finds by text content
   - `getAllByTestId(id)` — returns array
   - Each returned "element" is a wrapper object (a `NativeElement`) that holds a reference to the fiber node and exposes interaction/assertion methods

2. **`retry.ts`** — Async retry logic:
   - Many queries need to wait for async UI updates
   - `findByTestId(id, { timeout: 3000 })` — polls every 50ms until found or timeout
   - This is similar to Vitest browser mode's `expect.element()` retry behavior
   - All assertion matchers should support retry mode: `await expect(screen.getByTestId('x')).toHaveText('hello')` retries until the text matches or times out

3. **Fiber tree traversal**:
   - Access the fiber tree via the container ref's `_internalFiberInstanceHandleDEV` or similar React internals
   - Walk the fiber tree recursively
   - For each fiber node, check `pendingProps.testID`, `pendingProps.children` (for text), `stateNode` (for native instance)
   - This is how RNTL works internally — look at their source for reference
   - **Important**: This relies on React internals that can change. For a POC this is fine. For production, we'd need a more stable access pattern (maybe a custom host config or accessibility inspection).

4. **Validation**: Render a component with several testIDs, query them, log the results.

### Phase 5: Interaction Layer

**Goal**: `tap()`, `type()`, `scroll()` trigger real interactions on the rendered components.

1. **`interactions.ts`** — Start with JS-level event dispatch:
   - For `tap()`: Find the element's layout coordinates, dispatch a press event via the React fiber's `onPress` prop, OR use `ReactTestUtils`-style event simulation targeting the fiber
   - For `type()`: Find TextInput fiber, update its value prop and trigger `onChangeText`
   - For `scroll()`: Trigger `onScroll` event with synthesized event data

2. **Pragmatic first pass**: For the POC, directly invoke the callback props found on the fiber:

   ```ts
   async tap() {
     const onPress = this.fiber.pendingProps.onPress
       || this.fiber.pendingProps.onPressIn;
     if (onPress) {
       await act(() => onPress());
     }
   }
   ```

   This isn't a "real" touch event dispatched through the native gesture system, but it's functionally equivalent for component testing — it triggers the same handler that a real tap would. This is the same approach RNTL's `fireEvent.press()` uses.

3. **Future enhancement**: For truly realistic touch dispatch, build a small native module (Obj-C/Kotlin) that injects touch events into the native view hierarchy given coordinates. Detox's native libraries do exactly this. But for the POC, prop-based dispatch is sufficient and dramatically simpler.

4. **Validation**: Render the counter module, tap the increment button, verify the count text changes.

### Phase 6: CLI Reporter

**Goal**: A Node.js CLI tool that starts a WebSocket server, receives test results from the app, and prints them in a familiar test-runner format.

1. **`packages/cli/src/index.ts`**:
   - Start a WebSocket server on port 7878
   - Accept connection from the harness app
   - Receive JSON messages: `{ type: 'test:start', name, suite }`, `{ type: 'test:pass', name, duration }`, `{ type: 'test:fail', name, error, duration }`, `{ type: 'run:complete', passed, failed, total, duration }`
   - Print to stdout in a format similar to Vitest/Jest output:

     ```
     ✓ CounterModule > renders initial count (12ms)
     ✓ CounterModule > increments on press (45ms)
     ✗ CounterModule > handles API error (102ms)
       Error: expected "Error occurred" to be visible

     Tests: 2 passed, 1 failed, 3 total
     Time:  0.159s
     ```

2. **Run flow**:

   ```bash
   npx rn-test-cli   # starts WebSocket server, waits for connection
   # in another terminal (or scripted):
   npx expo start --ios  # boots the app, which runs tests and reports back
   ```

   Later this can be a single command that launches both.

3. **Validation**: Full loop — CLI starts, app boots, tests run, results appear in terminal.

### Phase 7: MSW Integration

**Goal**: Tests can intercept and mock network requests inline.

1. Install `msw` in the harness app. Use `setupServer()` (the Node-style API — MSW supports React Native via this path).
2. Create per-module mock handler files (e.g., `modules/counter/mocks/handlers.ts`)
3. In the test runtime's `beforeAll`/`afterEach`, start MSW and reset handlers.
4. Tests can override handlers inline:

   ```ts
   import { http, HttpResponse } from 'msw';

   it('shows error state on API failure', async () => {
     server.use(
       http.get('/api/count', () => HttpResponse.error())
     );
     const screen = render(<CounterModule />);
     await expect(screen.getByTestId('error-message')).toBeVisible();
   });
   ```

5. **Validation**: Counter module fetches data on mount, MSW intercepts it, test verifies the rendered result.

### Phase 8: Example Module + Demo Tests

**Goal**: A realistic example demonstrating the full capability.

Build `modules/counter/CounterModule.tsx`:

- Shows a count value (from state)
- Has an increment button
- Has a "load" button that fetches from an API and displays the result
- Has loading and error states
- Accepts props: `userId`, `variant` ("default" | "compact"), `onCountChange`

Write `modules/counter/tests/counter.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach } from 'test-runtime';
import { render, cleanup } from 'test-runtime';
import { server } from '../mocks/server';
import { http, HttpResponse } from 'msw';
import { CounterModule } from '../CounterModule';

beforeEach(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  cleanup();
});

describe('CounterModule', () => {
  it('renders initial count of zero', async () => {
    const screen = render(<CounterModule userId="123" />);
    await expect(screen.getByTestId('count-display')).toHaveText('0');
  });

  it('increments on press', async () => {
    const screen = render(<CounterModule userId="123" />);
    await screen.getByTestId('increment-btn').tap();
    await expect(screen.getByTestId('count-display')).toHaveText('1');
  });

  it('renders compact variant', async () => {
    const screen = render(<CounterModule userId="123" variant="compact" />);
    await expect(screen.getByTestId('compact-layout')).toBeVisible();
  });

  it('loads data from API and displays it', async () => {
    server.use(http.get('/api/data', () => HttpResponse.json({ value: 42 })));
    const screen = render(<CounterModule userId="123" />);
    await screen.getByTestId('load-btn').tap();
    await expect(screen.getByTestId('api-result')).toHaveText('42');
  });

  it('shows error state on network failure', async () => {
    server.use(http.get('/api/data', () => HttpResponse.error()));
    const screen = render(<CounterModule userId="123" />);
    await screen.getByTestId('load-btn').tap();
    await expect(screen.getByTestId('error-message')).toBeVisible();
  });

  it('shows loading state while fetching', async () => {
    server.use(
      http.get('/api/data', async () => {
        await new Promise((r) => setTimeout(r, 500));
        return HttpResponse.json({ value: 42 });
      })
    );
    const screen = render(<CounterModule userId="123" />);
    await screen.getByTestId('load-btn').tap();
    await expect(screen.getByTestId('loading-spinner')).toBeVisible();
    await expect(screen.getByTestId('api-result')).toHaveText('42');
  });

  it('calls onCountChange callback', async () => {
    const spy = { calls: [] as number[] };
    const screen = render(
      <CounterModule
        userId="123"
        onCountChange={(n: number) => spy.calls.push(n)}
      />
    );
    await screen.getByTestId('increment-btn').tap();
    await screen.getByTestId('increment-btn').tap();
    expect(spy.calls).toEqual([1, 2]);
  });
});
```

This demonstrates: multiple configurations via props, MSW handler swapping, async behavior testing, callback verification, error/loading states — all with inline control, no mocking of internals.

## Key Technical Decisions

### Fiber tree access for queries

The POC will access React's internal fiber tree to find elements by testID and text. This is the approach RNTL uses. It works, but it relies on React internals. For a production version, we'd explore more stable APIs (React's upcoming `react-native-testing` module, accessibility inspection, or a custom native module that queries the native view hierarchy).

### Interactions via prop invocation vs native touch dispatch

The POC will invoke `onPress`, `onChangeText`, etc. directly from the fiber tree. This is functionally correct for component testing. A production version could add a small native module for dispatching real touch events through the native gesture system, which would also test gesture handler configurations.

### Sequential execution

Tests run one at a time. There's one native view container. This is inherently serial for now. Parallelism could be achieved later by running multiple simulator instances, each connected to the same CLI reporter.

### `act()` usage

React state updates triggered by interactions need to be flushed. We'll use React's `act()` (from `react-test-renderer` or `react`) to wrap interactions and state updates, ensuring the UI is consistent before assertions run. The retry layer handles cases where `act()` isn't sufficient (e.g., async effects, timers).

### `@vitest/expect` as the assertion library

We use the standalone `@vitest/expect` package. It gives us `expect().toBe()`, `expect().toEqual()`, snapshot support, and the ability to add custom matchers. It has no dependency on Vitest the runner — it's just an assertion library that works in any JS environment.

## Success Criteria for POC

1. The Expo app boots on iOS simulator
2. Test files are auto-discovered and executed on launch
3. The counter module renders as real native views (you can see it on the simulator screen)
4. Tapping the increment button changes the displayed count
5. MSW intercepts a fetch call and the component displays the mocked response
6. Pass/fail results appear in the CLI terminal over WebSocket
7. A deliberately failing test shows a useful error message with the assertion diff

## Future Directions (Not in POC scope)

- **Watch mode**: Metro's hot reload re-evaluates changed test files and re-runs
- **Test filtering**: Run a single test file or describe block by name
- **Visual regression**: Screenshot the test container after render, compare to baseline
- **Real touch dispatch**: Native module for injecting touch events through the gesture system
- **Vitest compatibility layer**: Make the API close enough that existing Vitest tests can run with minimal changes
- **Web counterpart**: The same test files run in Vitest browser mode for web, with a thin adapter that swaps `render` and query implementations. Since the test API is identical, shared test logic works across both.
- **CI integration**: Script that boots simulator, runs tests, exits with appropriate code
- **Parallel execution**: Multiple simulator instances for faster runs
- **Android support**: Same architecture, different simulator. Should work with minimal platform-specific code since everything is JS-side except the harness app itself.
