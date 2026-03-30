/**
 * Context — React context for the test container and render bridge.
 */

import React, { createContext, useContext, useRef, useState, useCallback } from 'react';
import { View, type ViewStyle } from 'react-native';

type SetContentFn = (content: React.ReactNode) => void;

interface TestContainerContextValue {
  containerRef: React.RefObject<View | null>;
  setTestContent: SetContentFn;
}

const TestContainerContext = createContext<TestContainerContextValue | null>(null);

// Module-level bridge so render() can call setTestContent without React context
let globalSetTestContent: SetContentFn | null = null;
let globalContainerRef: React.RefObject<View | null> | null = null;

// Ready signal — resolves when TestContainerProvider mounts
let resolveReady: (() => void) | null = null;
const readyPromise = new Promise<void>(resolve => {
  resolveReady = resolve;
});

/** Wait for the TestContainerProvider to mount. Call before running tests. */
export function waitForContainerReady(): Promise<void> {
  if (globalSetTestContent) return Promise.resolve();
  return readyPromise;
}

export function getGlobalSetTestContent(): SetContentFn {
  if (!globalSetTestContent) {
    throw new Error('TestContainerProvider is not mounted yet.');
  }
  return globalSetTestContent;
}

export function getGlobalContainerRef(): React.RefObject<View | null> {
  if (!globalContainerRef) {
    throw new Error('TestContainerProvider is not mounted yet.');
  }
  return globalContainerRef;
}

const containerStyle: ViewStyle = {
  flex: 1,
  width: '100%',
};

export function TestContainerProvider({ children }: { children: React.ReactNode }) {
  const containerRef = useRef<View | null>(null);
  const [testContent, setTestContent] = useState<React.ReactNode>(null);

  const stableSetContent = useCallback((content: React.ReactNode) => {
    setTestContent(content);
  }, []);

  // Expose to module scope and signal ready.
  // Intentional render-time side effect: these globals let render() reach the
  // container without threading React context through the entire call chain.
  // eslint-disable-next-line react-hooks/globals
  globalSetTestContent = stableSetContent;
  // eslint-disable-next-line react-hooks/globals
  globalContainerRef = containerRef;
  resolveReady?.();

  return (
    <TestContainerContext.Provider value={{ containerRef, setTestContent: stableSetContent }}>
      {children}
      <View ref={containerRef} testID="test-container" style={containerStyle}>
        {testContent}
      </View>
    </TestContainerContext.Provider>
  );
}

export function useTestContainer() {
  const ctx = useContext(TestContainerContext);
  if (!ctx) throw new Error('useTestContainer must be used within TestContainerProvider');
  return ctx;
}
