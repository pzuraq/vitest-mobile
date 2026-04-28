import React, { useMemo } from 'react';
import { TouchableOpacity, StyleSheet, View, TextInput } from 'react-native';
import { useTheme } from '@shopify/restyle';
import { component } from 'signalium/react';
import { Text } from './atoms';
import type { Theme } from './theme';
import { searchQuery, statusFilter, type StatusFilter } from '../store';

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'failed', label: 'Failed' },
  { key: 'passed', label: 'Passed' },
  { key: 'skipped', label: 'Skipped' },
];

export const FilterPills = component(function FilterPills() {
  const { colors } = useTheme<Theme>();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const active = statusFilter.value;

  return (
    <View style={styles.row}>
      {FILTERS.map(f => (
        <TouchableOpacity
          key={f.key}
          onPress={() => {
            statusFilter.value = f.key;
          }}
          style={[styles.pill, active === f.key && styles.pillActive]}
        >
          <Text variant="caption" style={[styles.pillText, active === f.key && styles.pillTextActive]}>
            {f.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
});

export const SearchBar = component(function SearchBar() {
  const { colors } = useTheme<Theme>();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const value = searchQuery.value;

  return (
    <View style={styles.searchContainer}>
      <TextInput
        style={styles.searchInput}
        placeholder="Filter tests..."
        placeholderTextColor={colors.textDim}
        value={value}
        onChangeText={text => {
          searchQuery.value = text;
        }}
        autoCorrect={false}
        autoCapitalize="none"
      />
    </View>
  );
});

const createStyles = (colors: Theme['colors']) =>
  StyleSheet.create({
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
      backgroundColor: colors.surfaceActive,
    },
    pillActive: {
      backgroundColor: colors.accent,
    },
    pillText: {
      fontSize: 12,
      color: colors.textMuted,
    },
    pillTextActive: {
      color: colors.white,
    },
    searchContainer: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      backgroundColor: colors.surface,
    },
    searchInput: {
      backgroundColor: colors.bg,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      color: colors.text,
      fontSize: 13,
      borderWidth: 1,
      borderColor: colors.border,
    },
  });
