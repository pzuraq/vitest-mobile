/**
 * Headless test harness — connects to Vitest and provides TestContainerProvider.
 *
 * Used as the root component in both the prebuilt binary and ejected apps.
 * No UI beyond a minimal status bar.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { TestContainerProvider } from './context';
import { connectToVitest, onStatusChange } from './setup';
import type { HarnessStatus } from './setup';

interface TestHarnessConfig {
  port?: number;
}

function TestHarnessInner({ port = 7878 }: { port: number }) {
  const [status, setStatus] = useState<HarnessStatus>({
    state: 'connecting',
    message: 'Connecting to Vitest...',
  });

  useEffect(() => {
    connectToVitest({ port });
    return onStatusChange(setStatus);
  }, [port]);

  const bg =
    status.state === 'done' && status.failed === 0
      ? '#4ade80'
      : status.state === 'done' || status.state === 'error'
        ? '#f87171'
        : '#94a3b8';

  return (
    <View style={[styles.status, { backgroundColor: bg }]}>
      <Text style={styles.text}>{status.message}</Text>
    </View>
  );
}

/**
 * Create the root test harness component.
 * Test files are discovered via the virtual test registry (no module map needed).
 */
export function createTestHarness(config: TestHarnessConfig = {}) {
  return function TestHarness() {
    return (
      <TestContainerProvider>
        <TestHarnessInner port={config.port ?? 7878} />
      </TestContainerProvider>
    );
  };
}

const styles = StyleSheet.create({
  status: { padding: 16, alignItems: 'center' },
  text: { fontSize: 14, fontWeight: '600', color: '#1a1a2e' },
});
