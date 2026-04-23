import React, { useMemo } from 'react';
import { TouchableOpacity, StyleSheet, View, ScrollView } from 'react-native';
import { useTheme } from '@shopify/restyle';
import { component, useSignal } from 'signalium/react';
import type { Task } from '@vitest/runner';
import { Text } from './atoms';
import { statusIcon, statusColor } from './status-utils';
import type { Theme } from './theme';
import {
  aggregateDuration,
  aggregateStatus,
  collectedFiles,
  filterByStatus,
  filterBySearch,
  getChildren,
  getTaskFields,
  taskKind,
  taskLabel,
} from '../tasks';
import { searchQuery, statusFilter } from '../store';

interface TreeRowProps {
  task: Task;
  depth: number;
  collapsed: ReturnType<typeof useSignal<Set<string>>>;
  onSelect: (task: Task) => void;
}

const TreeRow = component<TreeRowProps>(function TreeRow({ task, depth, collapsed, onSelect }) {
  const { colors } = useTheme<Theme>();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const kind = taskKind(task);
  const isLeaf = kind === 'test';

  const fields = isLeaf ? getTaskFields(task.id) : null;
  const status = isLeaf ? (fields?.status.value ?? 'pending') : aggregateStatus(task);
  const duration = isLeaf ? fields?.duration.value : aggregateDuration(task);

  const collapsedSet = collapsed.value;
  const expanded = !collapsedSet.has(task.id);

  return (
    <View style={[styles.row, { paddingLeft: 16 + depth * 16 }]}>
      {!isLeaf ? (
        <TouchableOpacity
          onPress={() => {
            const next = new Set(collapsedSet);
            if (next.has(task.id)) next.delete(task.id);
            else next.add(task.id);
            collapsed.value = next;
          }}
          style={styles.chevronZone}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.chevron}>{expanded ? '▼' : '▶'}</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.chevronSpacer} />
      )}

      <TouchableOpacity onPress={() => onSelect(task)} style={styles.rowBody}>
        <Text style={[styles.statusIcon, { color: statusColor(status, colors) }]}>{statusIcon(status)}</Text>
        <Text numberOfLines={1} style={[styles.label, isLeaf && styles.labelLeaf]}>
          {taskLabel(task)}
        </Text>
        {duration != null && duration > 0 && <Text style={styles.duration}>{Math.round(duration)}ms</Text>}
      </TouchableOpacity>
    </View>
  );
});

interface TestTreeProps {
  onSelectNode: (task: Task) => void;
  scrollable?: boolean;
}

export const TestTree = component<TestTreeProps>(function TestTree({ onSelectNode, scrollable = true }) {
  const { colors } = useTheme<Theme>();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const collapsed = useSignal<Set<string>>(new Set());

  // Apply filters reactively over the canonical Vitest tree.
  const files = collectedFiles();
  const filteredByStatus = filterByStatus(files, statusFilter.value);
  const filtered = filterBySearch(filteredByStatus, searchQuery.value);

  function renderNodes(tasks: Task[], depth: number): React.ReactNode[] {
    const out: React.ReactNode[] = [];
    for (const task of tasks) {
      out.push(<TreeRow key={task.id} task={task} depth={depth} collapsed={collapsed} onSelect={onSelectNode} />);
      if (taskKind(task) !== 'test' && !collapsed.value.has(task.id)) {
        out.push(...renderNodes(getChildren(task), depth + 1));
      }
    }
    return out;
  }

  const content = renderNodes(filtered as unknown as Task[], 0);

  if (!scrollable) {
    return <View>{content}</View>;
  }

  return (
    <ScrollView style={styles.scrollView} keyboardShouldPersistTaps="handled">
      {content}
      {content.length === 0 && (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No tests match the filter</Text>
        </View>
      )}
    </ScrollView>
  );
});

interface MiniTreeProps {
  tasks: Task[];
  onSelectNode: (task: Task) => void;
}

export const MiniTree = component<MiniTreeProps>(function MiniTree({ tasks, onSelectNode }) {
  const { colors } = useTheme<Theme>();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.miniContainer}>
      {tasks.map(task => {
        const kind = taskKind(task);
        const isLeaf = kind === 'test';
        const fields = isLeaf ? getTaskFields(task.id) : null;
        const status = isLeaf ? (fields?.status.value ?? 'pending') : aggregateStatus(task);
        const duration = isLeaf ? fields?.duration.value : aggregateDuration(task);
        const isRunning = status === 'running';

        return (
          <TouchableOpacity key={task.id} onPress={() => onSelectNode(task)} style={styles.miniRow}>
            <Text style={[styles.statusIcon, { color: statusColor(status, colors) }]}>{statusIcon(status)}</Text>
            <Text numberOfLines={1} style={styles.miniLabel}>
              {taskLabel(task)}
            </Text>
            {isRunning ? (
              <Text style={styles.miniDuration}>Running...</Text>
            ) : duration != null && duration > 0 ? (
              <Text style={styles.miniDuration}>{Math.round(duration)}ms</Text>
            ) : null}
          </TouchableOpacity>
        );
      })}
    </View>
  );
});

const createStyles = (colors: Theme['colors']) =>
  StyleSheet.create({
    scrollView: {
      flex: 1,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 40,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    chevronZone: {
      width: 28,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chevronSpacer: {
      width: 28,
    },
    chevron: {
      fontSize: 10,
      color: colors.textDim,
    },
    rowBody: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      paddingRight: 16,
      paddingVertical: 8,
    },
    statusIcon: {
      width: 18,
      fontSize: 13,
      fontWeight: '700',
      textAlign: 'center',
    },
    label: {
      flex: 1,
      fontSize: 13,
      color: colors.text,
      marginLeft: 6,
    },
    labelLeaf: {
      fontWeight: '400',
    },
    duration: {
      fontSize: 11,
      color: colors.textDim,
      marginLeft: 8,
    },
    emptyContainer: {
      padding: 24,
      alignItems: 'center',
    },
    emptyText: {
      fontSize: 13,
      color: colors.textDim,
    },
    miniContainer: {
      backgroundColor: colors.bg,
      borderRadius: 8,
      overflow: 'hidden',
    },
    miniRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.surface,
    },
    miniLabel: {
      flex: 1,
      fontSize: 12,
      color: colors.text,
      marginLeft: 6,
    },
    miniDuration: {
      fontSize: 10,
      color: colors.textDim,
      marginLeft: 8,
    },
  });
