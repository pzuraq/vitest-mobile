/**
 * Context — React container for the test render bridge.
 *
 * The container view itself is a `React.RefObject` because it points at a
 * native view. `testContent` and `contentKey` are React `useState` (not
 * Signalium signals) so that writes from outside the React tree (the
 * `render()` API) flow through React's normal scheduler, keeping per-test
 * children re-renders synchronous.
 *
 * Test-time `render()` and `cleanup()` go through module-level setter refs
 * registered by the provider during its first render — this is the bridge
 * between vitest's test-time helpers and React's render lifecycle, and is
 * unavoidable since tests don't run inside the React render tree.
 *
 * The harness's `useEffect`-deferred wiring *usually* guarantees this
 * provider has mounted before any pool `runTests` invocation, but on slow
 * devices (Android CI) the initial render tree may not have committed by
 * the time the first test body runs. `waitForContainerReady()` provides a
 * proper barrier that `onBeforeRunFiles` awaits to close this race.
 */

import React, { useCallback, useRef, useState } from 'react';
import { View, type ViewStyle } from 'react-native';

let globalContainerRef: React.RefObject<View | null> | null = null;
let _renderKey = 0;

// React state setters get registered by the provider during its first render;
// the `render()` API and `cleanup()` write through these (going through React's
// scheduler) instead of a signal so children inside `testContent` stay reactive
// to their own state changes.
let globalSetTestContent: ((content: React.ReactNode) => void) | null = null;
let globalSetContentKey: ((key: number) => void) | null = null;

// Resolved when the provider's first render sets the globals. On slow devices
// (Android CI) the initial React tree may not have committed by the time the
// first test body calls `render()`, so we await this instead of assuming timing.
let _mountedResolve: (() => void) | null = null;
const _mountedPromise = new Promise<void>(r => {
  _mountedResolve = r;
});

/** Replace the rendered test content. Called by `render()` and `cleanup()`. */
export function setTestContentValue(content: React.ReactNode): void {
  if (!globalSetTestContent) {
    throw new Error('TestContainerProvider is not mounted yet.');
  }
  globalSetTestContent(content);
}

export function getGlobalContainerRef(): React.RefObject<View | null> {
  if (!globalContainerRef) {
    throw new Error('TestContainerProvider is not mounted yet.');
  }
  return globalContainerRef;
}

/**
 * Resolves once `TestContainerProvider` has completed its first render and
 * registered the module-level globals. Safe to call multiple times.
 */
export function waitForContainerReady(): Promise<void> {
  return _mountedPromise;
}

/** Increment the render key to force React to destroy and recreate the content tree. */
export function nextRenderKey(): void {
  _renderKey++;
  globalSetContentKey?.(_renderKey);
}

const containerStyle: ViewStyle = {
  flex: 1,
  width: '100%',
};

interface TestContainerContextValue {
  containerRef: React.RefObject<View | null>;
  testContent: React.ReactNode;
  contentKey: number;
}

const TestContainerContext = React.createContext<TestContainerContextValue | null>(null);

export function TestContainer(): React.ReactElement | null {
  const ctx = React.useContext(TestContainerContext);
  if (!ctx) return null;
  return (
    <View
      ref={ctx.containerRef}
      testID="test-container"
      collapsable={false}
      collapsableChildren={false}
      style={containerStyle}
    >
      {ctx.testContent && (
        <View key={ctx.contentKey} collapsable={false}>
          {ctx.testContent}
        </View>
      )}
    </View>
  );
}

export function TestContainerProvider({ children }: { children: React.ReactNode }) {
  const containerRef = useRef<View | null>(null);
  const [content, setContent] = useState<React.ReactNode>(null);
  const [key, setKey] = useState(0);

  const stableSetContent = useCallback((next: React.ReactNode) => setContent(next), []);
  const stableSetKey = useCallback((next: number) => setKey(next), []);

  // Register the global ref + setters synchronously during render so the
  // `render()` API and child `<TestContainer/>` components can find them on
  // their first invocation.
  if (!globalContainerRef) {
    globalContainerRef = containerRef;
  }
  globalSetTestContent = stableSetContent;
  globalSetContentKey = stableSetKey;

  if (_mountedResolve) {
    _mountedResolve();
    _mountedResolve = null;
  }

  return (
    <TestContainerContext.Provider value={{ containerRef, testContent: content, contentKey: key }}>
      {children}
    </TestContainerContext.Provider>
  );
}
