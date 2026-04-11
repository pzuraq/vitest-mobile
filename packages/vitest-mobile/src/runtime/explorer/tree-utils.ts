import type { TestTreeNode, ModuleStatus, StatusFilter, ConsoleLogEntry } from './types';

/**
 * Build a flat list of file nodes from registry keys.
 * Each file is a top-level node. Describe block hierarchy comes
 * from test results (mergeTestResults with suitePath).
 */
export function buildFileTree(fileKeys: string[], displayPaths?: Map<string, string>): TestTreeNode[] {
  return fileKeys.map(key => ({
    id: key,
    label: displayPaths?.get(key) ?? key,
    type: 'file' as const,
    children: [],
    status: 'pending' as ModuleStatus,
    filePath: key,
  }));
}

interface MergeableResult {
  id: string;
  name: string;
  state: 'pass' | 'fail' | 'skip' | 'pending';
  duration?: number;
  error?: string;
  suitePath?: string[];
  consoleLogs?: ConsoleLogEntry[];
}

/**
 * Merge test results into a file node, creating describe nodes
 * from suitePath and test leaf nodes.
 */
export function mergeTestResults(tree: TestTreeNode[], filePath: string, results: MergeableResult[]): void {
  const fileNode = findFileNode(tree, filePath);
  if (!fileNode) return;

  for (const result of results) {
    const suitePath = result.suitePath ?? [];

    // Walk/create describe nodes for the suite path
    let parent = fileNode;
    for (let i = 0; i < suitePath.length; i++) {
      const suiteName = suitePath[i];
      const suiteId = `${filePath}::suite::${suitePath.slice(0, i + 1).join('::')}`;
      let suiteNode = parent.children.find(c => c.id === suiteId);
      if (!suiteNode) {
        suiteNode = {
          id: suiteId,
          label: suiteName,
          type: 'describe',
          children: [],
          status: 'pending',
          filePath,
        };
        parent.children.push(suiteNode);
      }
      parent = suiteNode;
    }

    // Add/update the test leaf node
    const testId = `${filePath}::${result.id}`;
    const existing = parent.children.find(c => c.id === testId);
    const testNode: TestTreeNode = {
      id: testId,
      label: result.name,
      type: 'test',
      children: [],
      status:
        result.state === 'pass'
          ? 'pass'
          : result.state === 'fail'
            ? 'fail'
            : result.state === 'skip'
              ? 'idle'
              : 'pending',
      duration: result.duration,
      error: result.error,
      filePath,
      testName: result.name,
      consoleLogs: result.consoleLogs,
    };

    if (existing) {
      Object.assign(existing, testNode);
    } else {
      parent.children.push(testNode);
    }
  }

  propagateStatus(tree);
}

function findFileNode(nodes: TestTreeNode[], filePath: string): TestTreeNode | null {
  for (const node of nodes) {
    if (node.filePath === filePath) return node;
    const found = findFileNode(node.children, filePath);
    if (found) return found;
  }
  return null;
}

/** Update a file node's status. Clears children only when starting a new run. */
export function setFileStatus(tree: TestTreeNode[], filePath: string, status: ModuleStatus): void {
  const node = findFileNode(tree, filePath);
  if (node) {
    node.status = status;
    if (status === 'running') {
      node.children = [];
      node.duration = undefined;
      node.error = undefined;
    }
    propagateStatus(tree);
  }
}

/** Recursively propagate aggregate status up from leaves. */
function propagateStatus(nodes: TestTreeNode[]): void {
  for (const node of nodes) {
    if (node.children.length > 0) {
      propagateStatus(node.children);
      node.status = deriveGroupStatus(node.children);
      node.duration = node.children.reduce((sum, c) => sum + (c.duration ?? 0), 0);
    }
  }
}

function deriveGroupStatus(children: TestTreeNode[]): ModuleStatus {
  if (children.some(c => c.status === 'fail')) return 'fail';
  if (children.some(c => c.status === 'running')) return 'running';
  if (children.every(c => c.status === 'pass')) return 'pass';
  if (children.every(c => c.status === 'idle')) return 'idle';
  return 'pending';
}

/** Filter tree by status, returning a pruned copy. */
export function filterByStatus(nodes: TestTreeNode[], filter: StatusFilter): TestTreeNode[] {
  if (filter === 'all') return nodes;

  const statusMap: Record<StatusFilter, ModuleStatus[]> = {
    all: [],
    failed: ['fail'],
    passed: ['pass'],
    skipped: ['idle'],
  };
  const allowed = statusMap[filter];

  return nodes.map(node => filterNode(node, allowed)).filter((n): n is TestTreeNode => n !== null);
}

function filterNode(node: TestTreeNode, allowed: ModuleStatus[]): TestTreeNode | null {
  if (node.type === 'test') {
    return allowed.includes(node.status) ? node : null;
  }
  const filteredChildren = node.children.map(c => filterNode(c, allowed)).filter((c): c is TestTreeNode => c !== null);
  if (filteredChildren.length === 0) return null;
  return { ...node, children: filteredChildren };
}

/** Filter tree by search query (case-insensitive name match). */
export function filterBySearch(nodes: TestTreeNode[], query: string): TestTreeNode[] {
  if (!query) return nodes;
  const lower = query.toLowerCase();

  return nodes.map(node => searchFilterNode(node, lower)).filter((n): n is TestTreeNode => n !== null);
}

function searchFilterNode(node: TestTreeNode, query: string): TestTreeNode | null {
  if (node.label.toLowerCase().includes(query)) return node;
  if (node.type === 'test') return null;

  const filteredChildren = node.children
    .map(c => searchFilterNode(c, query))
    .filter((c): c is TestTreeNode => c !== null);
  if (filteredChildren.length === 0) return null;
  return { ...node, children: filteredChildren };
}

/** Collect all file paths under a tree node. */
export function collectFilePaths(node: TestTreeNode): string[] {
  if (node.filePath && (node.type === 'file' || node.type === 'test')) {
    return [node.filePath];
  }
  const paths = new Set<string>();
  for (const child of node.children) {
    for (const p of collectFilePaths(child)) {
      paths.add(p);
    }
  }
  return Array.from(paths);
}

/** Collect all test names under a node (for testNamePattern). */
export function collectTestNames(node: TestTreeNode): string[] {
  if (node.type === 'test' && node.testName) return [node.testName];
  return node.children.flatMap(c => collectTestNames(c));
}

/** Get the breadcrumb path for a node (labels of its ancestors). */
export function getBreadcrumb(tree: TestTreeNode[], targetId: string): string[] {
  const path: string[] = [];
  function walk(nodes: TestTreeNode[]): boolean {
    for (const node of nodes) {
      if (node.id === targetId) return true;
      path.push(node.label);
      if (walk(node.children)) return true;
      path.pop();
    }
    return false;
  }
  walk(tree);
  return path;
}

/** Count tests by status within a subtree. */
export function countByStatus(node: TestTreeNode): { passed: number; failed: number; pending: number; total: number } {
  if (node.type === 'test') {
    return {
      passed: node.status === 'pass' ? 1 : 0,
      failed: node.status === 'fail' ? 1 : 0,
      pending: node.status === 'pending' || node.status === 'running' || node.status === 'idle' ? 1 : 0,
      total: 1,
    };
  }
  const counts = { passed: 0, failed: 0, pending: 0, total: 0 };
  for (const child of node.children) {
    const c = countByStatus(child);
    counts.passed += c.passed;
    counts.failed += c.failed;
    counts.pending += c.pending;
    counts.total += c.total;
  }
  return counts;
}

/** Collect all console logs from a subtree. */
export function collectConsoleLogs(node: TestTreeNode): Array<{ testName: string; logs: ConsoleLogEntry[] }> {
  if (node.type === 'test' && node.consoleLogs?.length) {
    return [{ testName: node.label, logs: node.consoleLogs }];
  }
  return node.children.flatMap(c => collectConsoleLogs(c));
}

/** Find a node by id in the tree. */
export function findNodeById(nodes: TestTreeNode[], id: string): TestTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const found = findNodeById(node.children, id);
    if (found) return found;
  }
  return null;
}
