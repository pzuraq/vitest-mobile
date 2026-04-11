# vitest-mobile

Run Vitest component tests inside a real React Native app with native touch synthesis. Tests execute in Hermes using real native views and real touch events — not mocked renderers or simulated interactions.

## Install

```bash
npm install -D vitest-mobile
```

## Setup

### 1. Scaffold the test app

```bash
npx vitest-mobile init ./test-app
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
import { nativePlugin } from 'vitest-mobile';

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
import { render, cleanup, waitFor } from 'vitest-mobile/runtime';
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

1. Pool auto-generates a `.vitest-mobile/test-registry.js` from your test include patterns
2. Starts Metro, launches the app, connects over WebSocket
3. Sends test files to run — Metro bundles them, Hermes executes them
4. Results flow back to Vitest

## Monorepo Setup

```ts
// vitest.config.ts (monorepo root)
import { defineConfig } from 'vitest/config';
import { nativePlugin } from 'vitest-mobile';

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
import { nativePlugin } from 'vitest-mobile';

nativePlugin({
  platform: 'android', // 'android' | 'ios' (default: 'android')
  appDir: './test-app', // path to your test harness app (default: './test-app')
  bundleId: 'com.vitest.mobile.harness', // app bundle ID (default: 'com.vitest.mobile.harness')
  port: 7878, // WebSocket port (default: 7878)
  metroPort: 8081, // Metro port (default: 8081)
  deviceId: 'emulator-5554', // optional: target a specific device
  skipIfUnavailable: false, // skip instead of failing when no device
});
```

Sets `test.pool` on your vitest config and defaults `test.include` to `**/native-tests/**/*.test.{ts,tsx}` if not set.

### Test API (`vitest-mobile/runtime`)

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
/// <reference types="vitest-mobile" />
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

The test app's `package.json` includes scripts for building and installing without a running device, making them suitable for CI.

### GitHub Actions (Android)

```yaml
jobs:
  native-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - uses: actions/setup-java@v4
        with: { distribution: temurin, java-version: 17 }
      - run: npm install
      - run: npm run build:android
        working-directory: test-app
      - uses: ReactiveCircus/android-emulator-runner@v2
        with:
          api-level: 35
          arch: x86_64
          script: |
            adb wait-for-device shell 'while [[ -z $(getprop sys.boot_completed) ]]; do sleep 1; done'
            npm run install:android --prefix test-app
            npx vitest run
```

### GitHub Actions (iOS)

```yaml
jobs:
  native-tests:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm install
      - run: npm run build:ios
        working-directory: test-app
      - name: Boot simulator
        run: |
          SIM_ID=$(xcrun simctl list devices available -j \
            | python3 -c "
          import sys, json
          d = json.load(sys.stdin)
          for runtime, devs in d['devices'].items():
            for dev in devs:
              if dev.get('isAvailable') and dev.get('udid'):
                print(dev['udid']); exit()
          ")
          xcrun simctl boot "$SIM_ID"
          xcrun simctl bootstatus "$SIM_ID" -b
      - run: npm run install:ios --prefix test-app
      - run: npx vitest run --config vitest.config.ios.ts
        env:
          VITEST_E2E_PLATFORM: ios

## License

MIT
```
