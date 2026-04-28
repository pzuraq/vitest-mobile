import React, { useMemo } from 'react';
import { ThemeProvider } from '@shopify/restyle';
import { getTheme, type ThemeMode } from './theme';
import { RunnerView } from './RunnerView';

interface TestExplorerProps {
  themeMode?: ThemeMode;
}

export function TestExplorer({ themeMode = 'dark' }: TestExplorerProps) {
  const theme = useMemo(() => getTheme(themeMode), [themeMode]);
  return (
    <ThemeProvider theme={theme}>
      <RunnerView />
    </ThemeProvider>
  );
}
