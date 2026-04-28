import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, View, StyleSheet, Dimensions } from 'react-native';
import { useTheme } from '@shopify/restyle';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { component, useContext } from 'signalium/react';
import type { File, Task } from '@vitest/runner';
import { SimpleBottomSheet, type SimpleBottomSheetRef } from './SimpleBottomSheet';
import { TestContainer } from '../context';
import { resume } from '../pause';
import { HarnessCtx } from '../runtime';
import { getMetroBaseUrl } from '../network-config';
import { PeekBar } from './PeekBar';
import { TestTree } from './TestTree';
import { TestDetailView } from './TestDetailView';
import { FilterPills, SearchBar } from './FilterPills';
import { Text } from './atoms';
import type { Theme } from './theme';
import { detailTaskId, isConnected, isPaused } from '../store';

export const RunnerView = component(function RunnerView() {
  const { colors } = useTheme<Theme>();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const runtime = useContext(HarnessCtx);

  const connected = isConnected.value;
  const paused = isPaused.value;
  const detailId = detailTaskId.value;
  const hasDetail = detailId !== null;

  const sheetRef = useRef<SimpleBottomSheetRef>(null);
  const snapPoints = useMemo(() => ['45%', '70%'], []);

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

  const peekThreshold = screenHeight * 0.18;
  const maxSheetHeight = screenHeight * maxSheetPct;

  const containerScale = sheetAnimatedHeight.interpolate({
    inputRange: [0, peekThreshold, maxSheetHeight],
    outputRange: [1, 1, minScale],
    extrapolate: 'clamp',
  });

  // Open the detail panel as soon as something is selected.
  useEffect(() => {
    if (hasDetail) sheetRef.current?.snapToIndex(1);
  }, [hasDetail]);

  const handleSelectNode = useCallback((task: Task) => {
    detailTaskId.value = task.id;
  }, []);

  const handleDetailBack = useCallback(() => {
    detailTaskId.value = null;
  }, []);

  const handleDrillDown = useCallback((child: Task) => {
    detailTaskId.value = child.id;
  }, []);

  const handleRerun = useCallback(() => {
    const id = detailTaskId.value;
    if (!id || !runtime) return;
    const files = collectFilePathsForTaskId(runtime.collectedFiles.value, id);
    if (files.length === 0) return;
    runtime.send({ type: 'update', data: { created: [], deleted: [], updated: files } });
  }, [runtime]);

  const handleRerunAll = useCallback(() => {
    if (!runtime) return;
    const files = runtime.collectedFiles.value.map(f => f.filepath);
    if (files.length === 0) return;
    runtime.send({ type: 'update', data: { created: [], deleted: [], updated: files } });
  }, [runtime]);

  const handleStop = useCallback(() => {
    runtime?.cancel();
  }, [runtime]);

  const handleOpenDebugger = useCallback(() => {
    fetch(`${getMetroBaseUrl()}/open-debugger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => {
      /* ignore */
    });
  }, []);

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
          <PeekBar onDebug={handleOpenDebugger} onRerunAll={handleRerunAll} onStop={handleStop} />
        )}

        {connected && (
          <View style={styles.sheetBody}>
            {hasDetail ? (
              <TestDetailView
                onBack={handleDetailBack}
                onRerun={handleRerun}
                onStop={handleStop}
                onDrillDown={handleDrillDown}
              />
            ) : (
              <View style={styles.treeLayout}>
                <View style={styles.treeHeader}>
                  <Text style={styles.treeTitle}>Tests</Text>
                </View>

                <FilterPills />

                <TestTree onSelectNode={handleSelectNode} />

                {paused && (
                  <View style={styles.pauseBar}>
                    <Text style={styles.pauseText}>Paused</Text>
                    <Text onPress={() => resume()} style={styles.continueButton}>
                      Continue
                    </Text>
                  </View>
                )}

                <SearchBar />
              </View>
            )}
          </View>
        )}
      </SimpleBottomSheet>
    </View>
  );
});

/** Walk the tree starting at task id; return the filepath of every File ancestor or descendant under a non-File task. */
function collectFilePathsForTaskId(files: readonly File[], id: string): string[] {
  const out = new Set<string>();
  for (const file of files) {
    if (file.id === id) {
      out.add(file.filepath);
      continue;
    }
    if (containsId(file, id)) {
      out.add(file.filepath);
    }
  }
  return Array.from(out);
}

function containsId(task: Task, id: string): boolean {
  if (task.id === id) return true;
  if ('tasks' in task && Array.isArray(task.tasks)) {
    for (const child of task.tasks as Task[]) {
      if (containsId(child, id)) return true;
    }
  }
  return false;
}

const createStyles = (colors: Theme['colors']) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.surface,
    },
    testContainerWrapper: {
      flex: 1,
      backgroundColor: colors.testContainerBg,
    },
    disconnectedContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 32,
      paddingHorizontal: 24,
    },
    disconnectedDot: {
      fontSize: 24,
      color: colors.textDim,
      marginBottom: 8,
    },
    disconnectedTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.textMuted,
      marginBottom: 4,
    },
    disconnectedSubtitle: {
      fontSize: 13,
      color: colors.textDim,
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
      borderBottomColor: colors.border,
    },
    treeTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '600',
    },
    pauseBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 10,
      backgroundColor: colors.warning,
    },
    pauseText: {
      color: colors.black,
      fontSize: 14,
      fontWeight: '600',
    },
    continueButton: {
      color: colors.black,
      fontSize: 14,
      fontWeight: '700',
      backgroundColor: 'rgba(0,0,0,0.15)',
      paddingHorizontal: 14,
      paddingVertical: 6,
      borderRadius: 6,
      overflow: 'hidden',
    },
  });
