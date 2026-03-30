/**
 * RN Test Harness — Entry point.
 *
 * Boots the test runtime, discovers test files, runs them,
 * and reports results via WebSocket and on-screen status.
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, SafeAreaView, ScrollView } from 'react-native';
import {
  TestContainerProvider,
  getRootSuite,
  run,
  connectReporter,
  disconnectReporter,
  createReporterCallbacks,
  cleanup,
  afterEach as registerAfterEach,
} from 'test-runtime';
import type { RunResult } from 'test-runtime';

// ── Test Discovery ──────────────────────────────────────────────────
// require.context (Metro) discovers all .test.tsx files under ../modules/
// Importing them executes the top-level describe()/it() registrations.
const testContext = require.context('../modules', true, /\.test\.tsx$/);
testContext.keys().forEach((key: string) => {
  console.log(`[harness] Discovered test file: ${key}`);
  testContext(key);
});

// Auto-cleanup after each test
registerAfterEach(async () => {
  await cleanup();
});

// ── App Component ───────────────────────────────────────────────────
export default function App() {
  const [status, setStatus] = useState<'idle' | 'running' | 'done'>('idle');
  const [result, setResult] = useState<RunResult | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  useEffect(() => {
    let mounted = true;

    async function runTests() {
      if (!mounted) return;
      setStatus('running');

      // Connect to CLI reporter (non-blocking if CLI isn't running)
      await connectReporter();

      const reporterCallbacks = createReporterCallbacks();
      const rootSuite = getRootSuite();

      const runResult = await run(rootSuite, {
        ...reporterCallbacks,
        onTestPass(name, path, duration) {
          reporterCallbacks.onTestPass?.(name, path, duration);
          if (mounted) {
            setLogs((prev) => [...prev, `✓ ${path.join(' > ')} (${duration}ms)`]);
          }
        },
        onTestFail(name, path, duration, error) {
          reporterCallbacks.onTestFail?.(name, path, duration, error);
          if (mounted) {
            setLogs((prev) => [
              ...prev,
              `✗ ${path.join(' > ')} (${duration}ms)\n  ${error.message}`,
            ]);
          }
        },
        onTestSkip(name, path) {
          reporterCallbacks.onTestSkip?.(name, path);
          if (mounted) {
            setLogs((prev) => [...prev, `○ ${path.join(' > ')} [skipped]`]);
          }
        },
        onRunComplete(result) {
          reporterCallbacks.onRunComplete?.(result);
        },
      });

      if (mounted) {
        setResult(runResult);
        setStatus('done');
      }

      // Disconnect after a short delay to ensure final messages are sent
      setTimeout(() => disconnectReporter(), 1000);
    }

    // Small delay to let the UI mount before tests start
    const timer = setTimeout(runTests, 300);
    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, []);

  const statusText =
    status === 'idle'
      ? 'Initializing...'
      : status === 'running'
        ? 'Running tests...'
        : `Done: ${result?.passed ?? 0} passed, ${result?.failed ?? 0} failed`;

  const statusColor =
    status === 'done' && result?.failed === 0
      ? '#4ade80'
      : status === 'done'
        ? '#f87171'
        : '#fbbf24';

  return (
    <TestContainerProvider>
      <SafeAreaView style={styles.root}>
        {/* Status bar */}
        <View style={[styles.statusBar, { backgroundColor: statusColor }]}>
          <Text style={styles.statusText}>{statusText}</Text>
        </View>

        {/* Test result log */}
        <ScrollView style={styles.logContainer}>
          {logs.map((log, i) => (
            <Text key={i} style={styles.logLine}>
              {log}
            </Text>
          ))}
        </ScrollView>

        {/* The test container is rendered inside TestContainerProvider */}
      </SafeAreaView>
    </TestContainerProvider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  statusBar: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  statusText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a2e',
  },
  logContainer: {
    flex: 1,
    padding: 12,
  },
  logLine: {
    fontSize: 13,
    fontFamily: 'Courier',
    color: '#e2e8f0',
    marginBottom: 4,
  },
});
