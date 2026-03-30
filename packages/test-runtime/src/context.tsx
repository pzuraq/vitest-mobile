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

  // Expose to module scope
  globalSetTestContent = stableSetContent;
  globalContainerRef = containerRef;

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
