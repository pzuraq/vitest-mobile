import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '@shopify/restyle';
import { component } from 'signalium/react';
import { Text } from './atoms';
import { statusColor, statusIcon } from './status-utils';
import type { Theme } from './theme';
import { harnessStatus } from '../store';
import {
  aggregateStatus,
  collectedFiles,
  countByStatus,
  fileLabel,
  getTaskFields,
  isFile,
  type UiTaskStatus,
} from '../tasks';
import type { File, Task } from '@vitest/runner';

interface PeekBarProps {
  onDebug: () => void;
  onRerunAll: () => void;
  onStop: () => void;
}

/**
 * Find the leaf-most task that is currently `'running'`. Used to populate
 * the peek bar's "current test" / breadcrumb. Falls back to the most recent
 * non-pending task if nothing is currently running, otherwise null.
 */
function findCurrentTest(files: readonly File[]): Task | null {
  let running: Task | null = null;
  let lastFinished: Task | null = null;
  function walk(task: Task) {
    if (task.type === 'test') {
      const status = getTaskFields(task.id)?.status.value ?? 'pending';
      if (status === 'running') {
        running = task;
      } else if (status === 'pass' || status === 'fail' || status === 'skip') {
        lastFinished = task;
      }
      return;
    }
    if ('tasks' in task && Array.isArray(task.tasks)) {
      for (const child of task.tasks as Task[]) walk(child);
    }
  }
  for (const file of files) walk(file);
  return running ?? lastFinished;
}

function buildBreadcrumb(task: Task | null): { filePath: string; testName: string | null } {
  if (!task) return { filePath: '', testName: null };
  // Walk up to find the file
  let cur: Task | undefined = task;
  while (cur && !isFile(cur)) cur = cur.suite as Task | undefined;
  const filePath = cur && isFile(cur) ? fileLabel(cur) : '';
  const testName = task.type === 'test' ? task.name : null;
  return { filePath, testName };
}

export const PeekBar = component(function PeekBar({ onDebug, onRerunAll, onStop }: PeekBarProps) {
  const { colors } = useTheme<Theme>();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const files = collectedFiles();
  const status = harnessStatus.value;
  const running = status.state === 'running';

  // Aggregate counts across all files
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const file of files) {
    const c = countByStatus(file);
    passed += c.passed;
    failed += c.failed;
    // "skipped" isn't reported separately by countByStatus; compute it directly.
    skipped += countSkipped(file);
  }

  const totalFiles = files.length;
  const completedFiles = files.filter(f => {
    const s = aggregateStatus(f);
    return s !== 'pending' && s !== 'running';
  }).length;
  const moduleCurrent =
    totalFiles > 0 ? (running ? Math.min(completedFiles + 1, totalFiles) : Math.min(completedFiles, totalFiles)) : 0;
  const moduleFraction = `${moduleCurrent}/${totalFiles}`;

  const currentTask = running ? findCurrentTest(files) : null;
  const { filePath, testName } = buildBreadcrumb(currentTask);
  const currentStatus: UiTaskStatus = currentTask
    ? (getTaskFields(currentTask.id)?.status.value ?? 'pending')
    : 'pending';

  const allDone = !running && completedFiles > 0;

  return (
    <View style={styles.container}>
      <View style={styles.topRow}>
        <Text variant="caption" numberOfLines={1} style={styles.filePath}>
          {filePath}
        </Text>
        <Text style={styles.moduleCounter}>{moduleFraction}</Text>
      </View>

      {testName && running ? (
        <Text variant="body" numberOfLines={1} style={[styles.testName, { color: statusColor(currentStatus, colors) }]}>
          {statusIcon(currentStatus)} {testName}
        </Text>
      ) : allDone ? (
        <Text
          variant="body"
          numberOfLines={1}
          style={[styles.testName, { color: failed > 0 ? colors.fail : colors.pass }]}
        >
          {failed > 0 ? 'Done — tests failed' : 'All tests passed'}
        </Text>
      ) : (
        <Text variant="body" numberOfLines={1} style={[styles.testName, { color: colors.warning }]}>
          ⋯ Waiting...
        </Text>
      )}

      <View style={styles.statsRow}>
        <View style={styles.statValues}>
          <Text style={[styles.statLabel, passed > 0 ? styles.statPassed : styles.statZero]}>{passed} passed</Text>
          <Text style={[styles.statLabel, failed > 0 ? styles.statFailed : styles.statZero]}>{failed} failed</Text>
          <Text style={[styles.statLabel, skipped > 0 ? styles.statSkipped : styles.statZero]}>{skipped} skipped</Text>
        </View>
        <View style={styles.actions}>
          <Text onPress={onDebug} style={styles.debugButton}>
            Debug
          </Text>
          {running ? (
            <Text onPress={onStop} style={styles.stopButton}>
              Stop
            </Text>
          ) : completedFiles > 0 ? (
            <Text onPress={onRerunAll} style={styles.rerunButton}>
              ▶ Rerun
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
});

function countSkipped(task: Task): number {
  if (task.type === 'test') {
    const status = getTaskFields(task.id)?.status.value ?? 'pending';
    return status === 'skip' ? 1 : 0;
  }
  if ('tasks' in task && Array.isArray(task.tasks)) {
    let n = 0;
    for (const child of task.tasks as Task[]) n += countSkipped(child);
    return n;
  }
  return 0;
}

const createStyles = (colors: Theme['colors']) =>
  StyleSheet.create({
    container: {
      paddingHorizontal: 16,
      paddingBottom: 8,
      paddingTop: 4,
    },
    topRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 2,
    },
    filePath: {
      color: colors.textDim,
      fontSize: 12,
      flex: 1,
      marginRight: 8,
    },
    actions: {
      flexDirection: 'row',
      gap: 12,
      marginLeft: 8,
    },
    debugButton: {
      color: colors.textMuted,
      fontSize: 13,
      fontWeight: '500',
    },
    stopButton: {
      color: colors.fail,
      fontSize: 13,
      fontWeight: '600',
    },
    rerunButton: {
      color: colors.accent,
      fontSize: 13,
      fontWeight: '600',
    },
    testName: {
      fontSize: 14,
      marginBottom: 4,
    },
    statsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    statValues: {
      flexDirection: 'row',
      gap: 10,
    },
    statLabel: {
      fontSize: 11,
      fontWeight: '500',
    },
    statPassed: {
      color: colors.pass,
    },
    statFailed: {
      color: colors.fail,
    },
    statSkipped: {
      color: colors.warning,
    },
    statZero: {
      color: colors.checkboxOff,
    },
    moduleCounter: {
      fontSize: 11,
      color: colors.textMuted,
      fontWeight: '600',
      marginLeft: 8,
    },
  });
