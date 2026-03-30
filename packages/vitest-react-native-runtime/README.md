# vitest-react-native-runtime

Run Vitest component tests inside a real React Native app with native touch synthesis. Tests execute in Hermes using real native views and real touch events — not mocked renderers or simulated interactions.

## Install

```bash
npm install -D vitest-react-native-runtime
```

## Setup

### 1. Scaffold the test app

```bash
npx vitest-react-native-runtime init ./test-app
```

This generates a minimal Expo app pre-configured with Metro module resolution for the test registry and Vitest shim.

### 2. Build and install

```bash
cd test-app
npm install
npx expo prebuild --clean
npx expo run:android   # or run:ios
```

### 3. Configure Vitest

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import { nativePlugin } from 'vitest-react-native-runtime';

export default defineConfig({
  plugins: [nativePlugin({ appDir: './test-app' })],
  test: {
    include: ['native-tests/**/*.test.tsx'],
  },
});
```

### 4. Write tests

```tsx
// native-tests/counter.test.tsx
import React from 'react';
import { describe, it, afterEach } from '@vitest/runner';
import { render, cleanup, waitFor } from 'vitest-react-native-runtime/runtime';
import { Counter } from '../src/Counter';

afterEach(async () => {
  await cleanup();
});

describe('Counter', () => {
  it('increments on tap', async () => {
    const screen = render(<Counter />);
    const count = await screen.findByTestId('count');
    expect(count).toHaveText('0');

    await screen.getByTestId('increment').tap();
    await waitFor(() => expect(count).toHaveText('1'));
  });
});
```

### 5. Run

```bash
npx vitest run
```

## How It Works

```
Vitest (Node)          Android/iOS emulator
┌──────────────┐       ┌────────────────────┐
│  Pool worker │──WS──▸│  Test harness app  │
│  Metro server│──JS──▸│  (Hermes runtime)  │
│              │       │                    │
│  Sends test  │       │  NativeHarness:    │
│  files to run│◂─results─│- View queries  │
└──────────────┘       │  - Touch synthesis │
                       └────────────────────┘
```

1. Pool auto-generates a `.vitest-native/test-registry.js` from your test include patterns
2. Starts Metro, launches the app, connects over WebSocket
3. Sends test files to run — Metro bundles them, Hermes executes them
4. Results flow back to Vitest

## Monorepo Setup

```ts
// vitest.config.ts (monorepo root)
import { defineConfig } from 'vitest/config';
import { nativePlugin } from 'vitest-react-native-runtime';

export default defineConfig({
  plugins: [
    nativePlugin({
      platform: 'android',
      appDir: './test-app',
    }),
  ],
  test: {
    include: ['packages/**/native-tests/**/*.test.tsx'],
  },
});
```

## API Reference

### `nativePlugin(options?)`

```ts
import { nativePlugin } from 'vitest-react-native-runtime';

nativePlugin({
  platform: 'android', // 'android' | 'ios' (default: 'android')
  appDir: './test-app', // path to your test harness app (default: './test-app')
  bundleId: 'com.vitest.nativetest', // app bundle ID (default: 'com.vitest.nativetest')
  port: 7878, // WebSocket port (default: 7878)
  metroPort: 8081, // Metro port (default: 8081)
  deviceId: 'emulator-5554', // optional: target a specific device
  skipIfUnavailable: false, // skip instead of failing when no device
});
```

Sets `test.pool` on your vitest config and defaults `test.include` to `**/native-tests/**/*.test.{ts,tsx}` if not set.

### Test API (`vitest-react-native-runtime/runtime`)

| Export                       | Description                                                       |
| ---------------------------- | ----------------------------------------------------------------- |
| `render(element, options?)`  | Mount a component into the test container. Returns `Screen`.      |
| `cleanup()`                  | Unmount and wait for commit.                                      |
| `waitFor(fn, options?)`      | Poll until `fn` doesn't throw. Default 3s timeout, 50ms interval. |
| `createTestHarness(config?)` | Create the root harness component (used in `App.tsx`).            |

### Screen / Locator

| Method                      | Description                                      |
| --------------------------- | ------------------------------------------------ |
| `screen.getByTestId(id)`    | Find element by `testID`. Returns `Locator`.     |
| `screen.getByText(text)`    | Find element containing text. Returns `Locator`. |
| `screen.getAllByTestId(id)` | Find all matching elements.                      |
| `screen.getAllByText(text)` | Find all elements containing text.               |
| `screen.queryByTestId(id)`  | Returns `Locator \| null` (no throw).            |
| `screen.queryByText(text)`  | Returns `Locator \| null` (no throw).            |
| `screen.findByTestId(id)`   | Async — waits until element appears.             |
| `screen.findByText(text)`   | Async — waits until text appears.                |
| `locator.tap()`             | Dispatch a real native tap event.                |
| `locator.longPress()`       | Dispatch a real native long press.               |
| `locator.type(text)`        | Type text into a focused input.                  |
| `locator.text`              | Current text content.                            |
| `locator.exists`            | Whether the element is in the tree.              |

### Custom Matchers

```ts
/// <reference types="vitest-react-native-runtime" />
```

| Matcher                                | Description                       |
| -------------------------------------- | --------------------------------- |
| `expect(locator).toBeVisible()`        | Element exists and is not hidden. |
| `expect(locator).toHaveText('...')`    | Text content matches exactly.     |
| `expect(locator).toContainText('...')` | Text content contains the string. |

## Adding Native Modules

If your components require native modules beyond the defaults, add them to your test app's `app.json` and rebuild:

```bash
cd test-app
# Edit app.json to add plugins (e.g. expo-camera)
npx expo prebuild --clean
npx expo run:android
```

## CI

### GitHub Actions (Android)

```yaml
jobs:
  native-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm install
      - uses: ReactiveCircus/android-emulator-runner@v2
        with:
          api-level: 35
          arch: x86_64
          script: npx vitest run
```

The test app must already be built and installed on the emulator image, or you can build it as part of the CI setup step.

### iOS (macOS runners only)

```bash
xcrun simctl boot <device-id>
npx vitest run --config vitest.config.ios.ts
```

## License

MIT
