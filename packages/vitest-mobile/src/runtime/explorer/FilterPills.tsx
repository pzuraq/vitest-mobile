import React from 'react';
import { TouchableOpacity, StyleSheet, View, TextInput } from 'react-native';
import { Text } from './atoms';
import type { StatusFilter } from './types';

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'failed', label: 'Failed' },
  { key: 'passed', label: 'Passed' },
  { key: 'skipped', label: 'Skipped' },
];

interface FilterPillsProps {
  active: StatusFilter;
  onChange: (filter: StatusFilter) => void;
}

export function FilterPills({ active, onChange }: FilterPillsProps) {
  return (
    <View style={styles.row}>
      {FILTERS.map(f => (
        <TouchableOpacity
          key={f.key}
          onPress={() => onChange(f.key)}
          style={[styles.pill, active === f.key && styles.pillActive]}
        >
          <Text variant="caption" style={[styles.pillText, active === f.key && styles.pillTextActive]}>
            {f.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

interface SearchBarProps {
  value: string;
  onChangeText: (text: string) => void;
}

export function SearchBar({ value, onChangeText }: SearchBarProps) {
  return (
    <View style={styles.searchContainer}>
      <TextInput
        style={styles.searchInput}
        placeholder="Filter tests..."
        placeholderTextColor="#64748b"
        value={value}
        onChangeText={onChangeText}
        autoCorrect={false}
        autoCapitalize="none"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: '#334155',
  },
  pillActive: {
    backgroundColor: '#60a5fa',
  },
  pillText: {
    fontSize: 12,
    color: '#94a3b8',
  },
  pillTextActive: {
    color: '#ffffff',
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#334155',
    backgroundColor: '#1e293b',
  },
  searchInput: {
    backgroundColor: '#0f172a',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#e2e8f0',
    fontSize: 13,
    borderWidth: 1,
    borderColor: '#334155',
  },
});
