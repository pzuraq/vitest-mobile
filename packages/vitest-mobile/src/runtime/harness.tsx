/**
 * Test harness — root component for the test app.
 *
 * Always shows the explorer UI with a bottom sheet overlay on top of the test
 * container. Connects to the Vitest pool over WebSocket. If the pool is not
 * running, the explorer shows "Vitest not connected".
 *
 * The runtime services (connection, bridge, registry, test runner) are
 * constructed in render via `useRef`, then `start()`ed in a `useEffect` so the
 * React tree (and the test container `<View>`) is mounted before any pool
 * message can arrive. `<ContextProvider>` injects the runtime into the React
 * subtree; consumers reach it via `useContext(HarnessCtx)`.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import { LogBox } from 'react-native';
import './polyfills';

LogBox.ignoreLogs(['[vitest-mobile]', '[runner]', 'Require cycle']);
import { ContextProvider } from 'signalium/react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TestContainerProvider } from './context';
import { HarnessCtx, HarnessRuntime } from './runtime';
import { TestExplorer } from './explorer/TestExplorer';
import { configureRuntimeNetwork } from './network-config';

interface TestHarnessConfig {
  port?: number;
  host?: string;
  metroPort?: number;
  metroHost?: string;
  /** UI color scheme. Defaults to 'dark'. */
  theme?: 'light' | 'dark';
}

export function createTestHarness(config: TestHarnessConfig = {}) {
  const host = config.host ?? '127.0.0.1';
  const port = config.port ?? 7878;
  const metroHost = config.metroHost ?? '127.0.0.1';
  const metroPort = config.metroPort ?? 8081;
  const themeMode = config.theme ?? 'dark';

  configureRuntimeNetwork({
    wsHost: host,
    wsPort: port,
    metroHost,
    metroPort,
  });

  return function TestHarness() {
    // Construct the runtime once, in render. Children (Connection, Bridge,
    // Registry, TestRunner) are wired via `setScopeOwner` in the constructor;
    // the runtime itself acquires its scope when `<ContextProvider>` mounts.
    const runtimeRef = useRef<HarnessRuntime | null>(null);
    if (!runtimeRef.current) {
      runtimeRef.current = new HarnessRuntime();
    }
    const runtime = runtimeRef.current;

    // Defer the WebSocket open + worker-handler registration to after the
    // first render commit. By the time this effect fires, the test container
    // `<View>` is mounted on the native side, so any subsequent pool
    // `runTests` message can render into a ready container.
    useEffect(() => {
      runtime.start();
      return () => runtime.stop();
    }, [runtime]);

    const contexts = useMemo(() => [[HarnessCtx, runtime] as [typeof HarnessCtx, HarnessRuntime]], [runtime]);

    return (
      <ContextProvider contexts={contexts}>
        <SafeAreaProvider>
          <TestContainerProvider>
            <TestExplorer themeMode={themeMode} />
          </TestContainerProvider>
        </SafeAreaProvider>
      </ContextProvider>
    );
  };
}
