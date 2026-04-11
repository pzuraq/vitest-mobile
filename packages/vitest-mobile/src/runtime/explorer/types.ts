export interface TestModule {
  name: string;
  files: string[];
}

export type ModuleStatus = 'idle' | 'pending' | 'running' | 'pass' | 'fail';

export interface ConsoleLogEntry {
  level: 'log' | 'warn' | 'error';
  message: string;
  timestamp: number;
}

export interface TestTreeNode {
  id: string;
  label: string;
  type: 'group' | 'file' | 'describe' | 'test';
  children: TestTreeNode[];
  status: ModuleStatus;
  duration?: number;
  error?: string;
  filePath?: string;
  testName?: string;
  consoleLogs?: ConsoleLogEntry[];
}

export type StatusFilter = 'all' | 'failed' | 'passed' | 'skipped';
