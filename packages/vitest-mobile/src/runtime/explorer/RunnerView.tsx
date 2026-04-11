import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, View, StyleSheet, Dimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SimpleBottomSheet, type SimpleBottomSheetRef } from './SimpleBottomSheet';
import { TestContainer } from '../context';
import { resume } from '../pause';
import { onStatusChange, onTestEvent } from '../state';
import { sendToPool } from '../setup';
import { getMetroBaseUrl } from '../network-config';
import { PeekBar } from './PeekBar';
import { TestTree } from './TestTree';
import { TestDetailView } from './TestDetailView';
import { FilterPills, SearchBar } from './FilterPills';
import { Text } from './atoms';
import {
  buildFileTree,
  mergeTestResults,
  setFileStatus,
  filterByStatus,
  filterBySearch,
  getBreadcrumb,
  collectFilePaths,
  collectTestNames,
  findNodeById,
} from './tree-utils';
import type { TestModule, TestTreeNode, ModuleStatus, StatusFilter } from './types';

interface Props {
  modules: TestModule[];
}

/**
 * RunnerView is a pure observer of pool-driven test execution.
 * It subscribes to TestEvent from state.ts and updates the UI.
 * All test execution is driven by the pool (vitest).
 * Rerun requests are sent to the pool via sendToPool().
 */
export function RunnerView({ modules }: Props) {
  const insets = useSafeAreaInsets();
  const allFiles = useMemo(() => modules.flatMap(m => m.files), [modules]);

  // Tree state
  const [tree, setTree] = useState<TestTreeNode[]>(() => buildFileTree(allFiles));
  const treeRef = useRef(tree);
  treeRef.current = tree;

  // Run state
  const [running, setRunning] = useState(false);
  const [passed, setPassed] = useState(0);
  const [failed, setFailed] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [completedFiles, setCompletedFiles] = useState(0);
  const [totalFiles, setTotalFiles] = useState(allFiles.length);

  // Current test tracking for peek bar
  const [currentTestPath, setCurrentTestPath] = useState<string[]>(modules.map(m => m.name));
  const [currentTestName, setCurrentTestName] = useState<string | null>(null);
  const [currentStatus, setCurrentStatus] = useState<ModuleStatus>('pending');

  // UI state
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [detailNode, setDetailNode] = useState<TestTreeNode | null>(null);
  const [paused, setPaused] = useState(false);
  const [connected, setConnected] = useState(false);

  const sheetRef = useRef<SimpleBottomSheetRef>(null);
  const snapPoints = useMemo(() => ['45%', '70%'], []);

  // Scale the test container to fit above the sheet as it rises.
  // The container keeps its full-screen layout size but is scaled down visually,
  // with a translateY offset to anchor it below the safe area (status bar / island).
  const screenHeight = useMemo(() => Dimensions.get('window').height, []);
  const topInset = insets.top;
  const [sheetAnimatedHeight] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const h = sheetRef.current?.animatedHeight;
    if (!h) return;
    const id = h.addListener(({ value }) => sheetAnimatedHeight.setValue(value));
    return () => h.removeListener(id);
  }, [sheetAnimatedHeight]);

  const usableHeight = screenHeight - topInset;
  const maxSheetPct = 0.7;
  const minScale = Math.max((screenHeight * (1 - maxSheetPct) - topInset) / usableHeight, 0.25);

  // The peek height is the sheet's resting size (handle + status bar, ~150px).
  // The viewport stays full-size until the sheet is dragged above this threshold.
  const peekThreshold = screenHeight * 0.18;
  const maxSheetHeight = screenHeight * maxSheetPct;

  const containerScale = sheetAnimatedHeight.interpolate({
    inputRange: [0, peekThreshold, maxSheetHeight],
    outputRange: [1, 1, minScale],
    extrapolate: 'clamp',
  });

  // No translateY needed — transformOrigin pins the scale to the top edge.

  useEffect(() => {
    return onStatusChange(status => {
      setPaused(status.state === 'paused');
      const isConnected =
        status.state === 'connected' ||
        status.state === 'running' ||
        status.state === 'paused' ||
        status.state === 'done';
      setConnected(isConnected);
    });
  }, []);

  // Track display paths from file-start events
  const displayPathsRef = useRef(new Map<string, string>());

  // Subscribe to pool-driven test events
  useEffect(() => {
    let currentFile = '';

    return onTestEvent(event => {
      switch (event.type) {
        case 'run-start': {
          const fileCount = Math.max(event.fileCount ?? 1, 1);
          setPassed(0);
          setFailed(0);
          setSkipped(0);
          setCompletedFiles(0);
          setTotalFiles(fileCount);
          displayPathsRef.current.clear();
          setRunning(true);
          break;
        }

        case 'file-start': {
          currentFile = event.file ?? '';
          if (event.displayPath) {
            displayPathsRef.current.set(currentFile, event.displayPath);
          }
          const display = event.displayPath ?? currentFile;
          setCurrentTestPath([display]);
          setCurrentTestName(null);
          setCurrentStatus('running');

          setTree(prev => {
            const next = structuredClone(prev);
            const fileNode = findNodeById(next, currentFile);
            if (fileNode && event.displayPath) {
              fileNode.label = event.displayPath;
            }
            setFileStatus(next, currentFile, 'running');
            treeRef.current = next;
            return next;
          });
          break;
        }

        case 'test-done': {
          const file = event.file ?? currentFile;
          if (event.state === 'pass') setPassed(p => p + 1);
          if (event.state === 'fail') setFailed(f => f + 1);
          if (event.state === 'skip') setSkipped(s => s + 1);

          const suitePath = event.suitePath ?? [];
          const display = event.displayPath ?? displayPathsRef.current.get(file) ?? file;
          setCurrentTestPath([display, ...suitePath]);
          setCurrentTestName(event.testName ?? null);
          setCurrentStatus(event.state === 'pass' ? 'pass' : event.state === 'fail' ? 'fail' : 'running');

          setTree(prev => {
            const next = structuredClone(prev);
            mergeTestResults(next, file, [
              {
                id: event.testId ?? event.testName ?? '',
                name: event.testName ?? '',
                state: event.state ?? 'pending',
                duration: event.duration,
                error: event.error,
                suitePath: event.suitePath,
              },
            ]);
            treeRef.current = next;
            return next;
          });
          break;
        }

        case 'file-done': {
          setCompletedFiles(c => c + 1);
          break;
        }

        case 'run-done': {
          setRunning(false);
          setCurrentStatus('idle');
          break;
        }
      }
    });
  }, [allFiles]);

  // Detail view navigation
  const handleSelectNode = useCallback((node: TestTreeNode) => {
    setDetailNode(node);
    sheetRef.current?.snapToIndex(1);
  }, []);

  const handleDetailBack = useCallback(() => {
    setDetailNode(null);
  }, []);

  const handleRerun = useCallback((node: TestTreeNode) => {
    const files = collectFilePaths(node);
    if (files.length === 0) return;

    let pattern: string | undefined;
    if (node.type === 'test' && node.testName) {
      pattern = `^${escapeRegex(node.testName)}$`;
    } else if (node.type !== 'file' && node.type !== 'group') {
      const names = collectTestNames(node);
      if (names.length > 0) {
        pattern = names.map(n => `^${escapeRegex(n)}$`).join('|');
      }
    }

    sendToPool({ __rerun: true, files, testNamePattern: pattern, label: node.label });
  }, []);

  const handleRerunAll = useCallback(() => {
    sendToPool({ __rerun: true, files: allFiles, label: 'all' });
  }, [allFiles]);

  const handleStop = useCallback(() => {
    sendToPool({ __cancel: true });
  }, []);

  const handleOpenDebugger = useCallback(() => {
    fetch(`${getMetroBaseUrl()}/open-debugger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => {
      /* ignore */
    });
  }, []);

  const handleDrillDown = useCallback((child: TestTreeNode) => {
    setDetailNode(child);
  }, []);

  // Filtered tree
  const filteredTree = useMemo(() => {
    let result = tree;
    result = filterByStatus(result, statusFilter);
    result = filterBySearch(result, searchQuery);
    return result;
  }, [tree, statusFilter, searchQuery]);

  // Keep detail node in sync with tree updates
  const currentDetailNode = useMemo(() => {
    if (!detailNode) return null;
    return findNodeById(tree, detailNode.id) ?? detailNode;
  }, [tree, detailNode]);

  const detailBreadcrumb = useMemo(() => {
    if (!currentDetailNode) return [];
    return getBreadcrumb(tree, currentDetailNode.id);
  }, [tree, currentDetailNode]);

  return (
    <View style={styles.root}>
      <Animated.View
        style={[
          styles.testContainerWrapper,
          {
            paddingTop: topInset,
            marginTop: sheetAnimatedHeight.interpolate({
              inputRange: [0, peekThreshold, maxSheetHeight],
              outputRange: [0, 0, topInset + 8],
              extrapolate: 'clamp',
            }),
            transformOrigin: 'top center',
            transform: [{ scale: containerScale }],
            borderRadius: containerScale.interpolate({
              inputRange: [minScale, 1],
              outputRange: [12, 0],
              extrapolate: 'clamp',
            }),
            borderWidth: containerScale.interpolate({
              inputRange: [minScale, 0.99, 1],
              outputRange: [1, 1, 0],
              extrapolate: 'clamp',
            }),
            borderColor: 'rgba(148,163,184,0.25)',
            overflow: 'hidden',
          },
        ]}
      >
        <TestContainer />
      </Animated.View>

      <SimpleBottomSheet
        ref={sheetRef}
        snapPoints={snapPoints}
        enableDynamicSizing
        maxDynamicContentSize={150}
        index={-1}
      >
        {!connected ? (
          <View style={styles.disconnectedContainer}>
            <Text style={styles.disconnectedDot}>○</Text>
            <Text style={styles.disconnectedTitle}>Vitest not connected</Text>
            <Text style={styles.disconnectedSubtitle}>Waiting for vitest dev server...</Text>
          </View>
        ) : (
          <PeekBar
            running={running}
            passed={passed}
            failed={failed}
            skipped={skipped}
            completedFiles={completedFiles}
            totalFiles={totalFiles}
            currentTestPath={currentTestPath}
            currentTestName={currentTestName}
            currentStatus={currentStatus}
            onDebug={handleOpenDebugger}
            onRerunAll={handleRerunAll}
            onStop={handleStop}
          />
        )}

        {connected && (
          <View style={styles.sheetBody}>
            {currentDetailNode ? (
              <TestDetailView
                node={currentDetailNode}
                breadcrumb={detailBreadcrumb}
                running={running && currentDetailNode.status === 'running'}
                onBack={handleDetailBack}
                onRerun={() => handleRerun(currentDetailNode)}
                onStop={handleStop}
                onDrillDown={handleDrillDown}
              />
            ) : (
              <View style={styles.treeLayout}>
                {/* Fixed header */}
                <View style={styles.treeHeader}>
                  <Text style={styles.treeTitle}>Tests</Text>
                </View>

                <FilterPills active={statusFilter} onChange={setStatusFilter} />

                {/* Scrollable test tree */}
                <TestTree nodes={filteredTree} onSelectNode={handleSelectNode} />

                {paused && (
                  <View style={styles.pauseBar}>
                    <Text style={styles.pauseText}>Paused</Text>
                    <Text onPress={() => resume()} style={styles.continueButton}>
                      Continue
                    </Text>
                  </View>
                )}

                {/* Fixed at bottom */}
                <SearchBar value={searchQuery} onChangeText={setSearchQuery} />
              </View>
            )}
          </View>
        )}
      </SimpleBottomSheet>
    </View>
  );
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#1e293b',
  },
  testContainerWrapper: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  disconnectedContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
    paddingHorizontal: 24,
  },
  disconnectedDot: {
    fontSize: 24,
    color: '#64748b',
    marginBottom: 8,
  },
  disconnectedTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#94a3b8',
    marginBottom: 4,
  },
  disconnectedSubtitle: {
    fontSize: 13,
    color: '#64748b',
  },
  sheetBody: {
    flex: 1,
    overflow: 'hidden',
  },
  treeLayout: {
    flex: 1,
  },
  treeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#334155',
  },
  treeTitle: {
    color: '#e2e8f0',
    fontSize: 16,
    fontWeight: '600',
  },
  pauseBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#fbbf24',
  },
  pauseText: {
    color: '#1a1a2e',
    fontSize: 14,
    fontWeight: '600',
  },
  continueButton: {
    color: '#1a1a2e',
    fontSize: 14,
    fontWeight: '700',
    backgroundColor: 'rgba(0,0,0,0.15)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
    overflow: 'hidden',
  },
});
