import React, { useMemo } from 'react';
import { ScrollView, TouchableOpacity, StyleSheet, View } from 'react-native';
import { useTheme } from '@shopify/restyle';
import { component } from 'signalium/react';
import type { Task } from '@vitest/runner';
import { Text } from './atoms';
import { MiniTree } from './TestTree';
import { statusIcon, statusColor } from './status-utils';
import type { Theme } from './theme';
import {
  aggregateDuration,
  aggregateStatus,
  countByStatus,
  detailBreadcrumb,
  detailNode,
  getChildren,
  getTaskFields,
  taskKind,
  taskLabel,
} from '../tasks';

interface TestDetailViewProps {
  onBack: () => void;
  onRerun: () => void;
  onStop: () => void;
  onDrillDown: (task: Task) => void;
}

export const TestDetailView = component<TestDetailViewProps>(function TestDetailView({
  onBack,
  onRerun,
  onStop,
  onDrillDown,
}) {
  const { colors } = useTheme<Theme>();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const node = detailNode();
  if (!node) return null;
  const breadcrumb = detailBreadcrumb();
  const kind = taskKind(node);
  const isLeaf = kind === 'test';
  const isGroup = !isLeaf;

  const status = isLeaf ? (getTaskFields(node.id)?.status.value ?? 'pending') : aggregateStatus(node);
  const duration = isLeaf ? getTaskFields(node.id)?.duration.value : aggregateDuration(node);
  const error = isLeaf ? getTaskFields(node.id)?.error.value : undefined;

  const counts = isGroup ? countByStatus(node) : null;
  const isRunning = status === 'running';

  const failedChildren = isGroup
    ? getChildren(node).filter(child => {
        const childStatus =
          taskKind(child) === 'test' ? (getTaskFields(child.id)?.status.value ?? 'pending') : aggregateStatus(child);
        return childStatus === 'fail';
      })
    : [];

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.backButton}>← Tests</Text>
        </TouchableOpacity>
        {isRunning ? (
          <TouchableOpacity onPress={onStop} style={styles.stopButton}>
            <Text style={styles.stopText}>■ Stop</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={onRerun} style={styles.rerunButton}>
            <Text style={styles.rerunText}>↻ {isGroup ? 'Rerun All' : 'Rerun'}</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView style={styles.scrollContent} contentContainerStyle={styles.scrollContentInner}>
        <View style={styles.identity}>
          <View style={styles.identityRow}>
            <Text style={[styles.identityIcon, { color: statusColor(status, colors) }]}>{statusIcon(status)}</Text>
            <Text style={styles.identityName} numberOfLines={2}>
              {taskLabel(node)}
            </Text>
          </View>
          {breadcrumb.length > 0 && <Text style={styles.breadcrumb}>{breadcrumb.join(' > ')}</Text>}
          <View style={styles.identityMeta}>
            {isRunning ? (
              <Text style={styles.metaRunning}>Running...</Text>
            ) : duration != null && duration > 0 ? (
              <Text style={styles.metaDuration}>{Math.round(duration)}ms</Text>
            ) : null}
          </View>
          {counts && (
            <Text style={styles.countsText}>
              {counts.passed} passed · {counts.failed} failed
              {counts.pending > 0 ? ` · ${counts.pending} pending` : ''}
            </Text>
          )}
        </View>

        {isGroup && getChildren(node).length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Tests</Text>
            <MiniTree tasks={getChildren(node)} onSelectNode={onDrillDown} />
          </View>
        )}

        {!isGroup && error && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Error</Text>
            <View style={styles.errorBlock}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          </View>
        )}

        {isGroup && failedChildren.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Errors ({failedChildren.length})</Text>
            {failedChildren.map(child => {
              const childIsLeaf = taskKind(child) === 'test';
              const childError = childIsLeaf ? getTaskFields(child.id)?.error.value : undefined;
              return (
                <TouchableOpacity key={child.id} onPress={() => onDrillDown(child)} style={styles.errorBlock}>
                  <Text style={styles.errorChildName}>✗ {taskLabel(child)}</Text>
                  {childError && <Text style={styles.errorText}>{childError}</Text>}
                  {!childIsLeaf && <Text style={styles.errorDrillHint}>Tap to see details →</Text>}
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>
    </View>
  );
});

const createStyles = (colors: Theme['colors']) =>
  StyleSheet.create({
    container: {
      flex: 1,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    backButton: {
      color: colors.accent,
      fontSize: 15,
      fontWeight: '600',
    },
    rerunButton: {
      backgroundColor: colors.surfaceActive,
      paddingHorizontal: 14,
      paddingVertical: 6,
      borderRadius: 6,
    },
    rerunText: {
      color: colors.accent,
      fontSize: 13,
      fontWeight: '600',
    },
    stopButton: {
      backgroundColor: colors.fail,
      paddingHorizontal: 14,
      paddingVertical: 6,
      borderRadius: 6,
    },
    stopText: {
      color: colors.white,
      fontSize: 13,
      fontWeight: '600',
    },
    scrollContent: {
      flex: 1,
    },
    scrollContentInner: {
      paddingBottom: 16,
    },
    identity: {
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    identityRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
    },
    identityIcon: {
      fontSize: 18,
      fontWeight: '700',
      marginTop: 1,
    },
    identityName: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.text,
      flex: 1,
    },
    breadcrumb: {
      fontSize: 12,
      color: colors.textDim,
      marginTop: 4,
    },
    identityMeta: {
      marginTop: 4,
    },
    metaRunning: {
      fontSize: 12,
      color: colors.warning,
    },
    metaDuration: {
      fontSize: 12,
      color: colors.textDim,
    },
    countsText: {
      fontSize: 12,
      color: colors.textMuted,
      marginTop: 4,
    },
    section: {
      paddingHorizontal: 16,
      paddingTop: 16,
    },
    sectionTitle: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textMuted,
      marginBottom: 8,
    },
    errorBlock: {
      backgroundColor: 'rgba(248,113,113,0.1)',
      borderRadius: 8,
      padding: 12,
      marginBottom: 8,
    },
    errorChildName: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.fail,
      marginBottom: 4,
    },
    errorText: {
      fontSize: 12,
      fontFamily: 'monospace',
      color: colors.fail,
    },
    errorDrillHint: {
      fontSize: 11,
      color: colors.textDim,
      marginTop: 4,
    },
  });
