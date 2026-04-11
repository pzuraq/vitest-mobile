import React, { useCallback, useState } from 'react';
import { TouchableOpacity, StyleSheet, View, ScrollView } from 'react-native';
import { Text } from './atoms';
import { statusIcon, statusColor } from './status-utils';
import type { TestTreeNode } from './types';

interface TreeRowProps {
  node: TestTreeNode;
  depth: number;
  expanded: boolean;
  onToggle: () => void;
  onDetail: () => void;
}

function TreeRow({ node, depth, expanded, onToggle, onDetail }: TreeRowProps) {
  const hasChildren = node.children.length > 0;
  const isLeaf = node.type === 'test';

  return (
    <View style={[styles.row, { paddingLeft: 16 + depth * 16 }]}>
      {/* Chevron for groups — separate tap zone */}
      {!isLeaf ? (
        <TouchableOpacity
          onPress={onToggle}
          style={styles.chevronZone}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.chevron}>{expanded ? '▼' : '▶'}</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.chevronSpacer} />
      )}

      {/* Row body — tap for detail view */}
      <TouchableOpacity onPress={onDetail} style={styles.rowBody}>
        <Text style={[styles.statusIcon, { color: statusColor(node.status) }]}>{statusIcon(node.status)}</Text>
        <Text numberOfLines={1} style={[styles.label, isLeaf && styles.labelLeaf]}>
          {node.label}
        </Text>
        {node.duration != null && node.duration > 0 && (
          <Text style={styles.duration}>{Math.round(node.duration)}ms</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

interface TestTreeProps {
  nodes: TestTreeNode[];
  onSelectNode: (node: TestTreeNode) => void;
  scrollable?: boolean;
}

export function TestTree({ nodes, onSelectNode, scrollable = true }: TestTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleNode = useCallback((id: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  function renderNodes(nodes: TestTreeNode[], depth: number): React.ReactNode[] {
    const elements: React.ReactNode[] = [];
    for (const node of nodes) {
      const isExpanded = !collapsed.has(node.id);
      elements.push(
        <TreeRow
          key={node.id}
          node={node}
          depth={depth}
          expanded={isExpanded}
          onToggle={() => toggleNode(node.id)}
          onDetail={() => onSelectNode(node)}
        />,
      );
      if (isExpanded && node.children.length > 0 && node.type !== 'test') {
        elements.push(...renderNodes(node.children, depth + 1));
      }
    }
    return elements;
  }

  const content = renderNodes(nodes, 0);

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
}

/**
 * Mini tree used inside the detail view for groups.
 * Flat list of child tests with status — tappable to drill deeper.
 */
interface MiniTreeProps {
  nodes: TestTreeNode[];
  onSelectNode: (node: TestTreeNode) => void;
}

export function MiniTree({ nodes, onSelectNode }: MiniTreeProps) {
  return (
    <View style={styles.miniContainer}>
      {nodes.map(node => (
        <TouchableOpacity key={node.id} onPress={() => onSelectNode(node)} style={styles.miniRow}>
          <Text style={[styles.statusIcon, { color: statusColor(node.status) }]}>{statusIcon(node.status)}</Text>
          <Text numberOfLines={1} style={styles.miniLabel}>
            {node.label}
          </Text>
          {node.status === 'running' ? (
            <Text style={styles.miniDuration}>Running...</Text>
          ) : node.duration != null && node.duration > 0 ? (
            <Text style={styles.miniDuration}>{Math.round(node.duration)}ms</Text>
          ) : null}
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 40,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#334155',
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
    color: '#64748b',
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
    color: '#e2e8f0',
    marginLeft: 6,
  },
  labelLeaf: {
    fontWeight: '400',
  },
  duration: {
    fontSize: 11,
    color: '#64748b',
    marginLeft: 8,
  },
  emptyContainer: {
    padding: 24,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 13,
    color: '#64748b',
  },
  miniContainer: {
    backgroundColor: '#0f172a',
    borderRadius: 8,
    overflow: 'hidden',
  },
  miniRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1e293b',
  },
  miniLabel: {
    flex: 1,
    fontSize: 12,
    color: '#e2e8f0',
    marginLeft: 6,
  },
  miniDuration: {
    fontSize: 10,
    color: '#64748b',
    marginLeft: 8,
  },
});
