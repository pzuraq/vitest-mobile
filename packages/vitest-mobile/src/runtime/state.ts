/**
 * Shared harness state — status events and log accumulator.
 *
 * Extracted from setup.ts to break the setup <-> pause circular dependency.
 * Both setup.ts and pause.ts import from here without creating a cycle.
 */

// ── Status event system for UI ────────────────────────────────────

type StatusListener = (status: HarnessStatus) => void;
const statusListeners: Set<StatusListener> = new Set();

export interface HarnessStatus {
  state: 'connecting' | 'connected' | 'running' | 'paused' | 'done' | 'error';
  message: string;
  label?: string;
  currentFile?: string;
  fileIndex?: number;
  fileCount?: number;
  passed?: number;
  failed?: number;
  total?: number;
  logs?: string[];
}

let currentStatus: HarnessStatus = { state: 'connecting', message: 'Connecting to Vitest...' };
const logs: string[] = [];

export function setStatus(status: Partial<HarnessStatus>) {
  currentStatus = { ...currentStatus, ...status };
  statusListeners.forEach(fn => fn(currentStatus));
}

export function addLog(line: string) {
  logs.push(line);
  setStatus({ logs: [...logs] });
}

export function resetLogs() {
  logs.length = 0;
}

export function onStatusChange(listener: StatusListener): () => void {
  statusListeners.add(listener);
  listener(currentStatus);
  return () => statusListeners.delete(listener);
}

// ── Per-test event bus for RunnerView ─────────────────────────────

export interface TestEvent {
  type: 'run-start' | 'file-start' | 'test-done' | 'file-done' | 'run-done';
  /** Registry key (e.g. "counter/counter.test.tsx") */
  file?: string;
  /** Project-relative file path (e.g. "test-packages/counter/tests/counter.test.tsx") */
  displayPath?: string;
  testId?: string;
  testName?: string;
  /** Describe block names from outermost to innermost (e.g. ["CounterModule"]) */
  suitePath?: string[];
  state?: 'pass' | 'fail' | 'skip';
  duration?: number;
  error?: string;
  passed?: number;
  failed?: number;
  fileCount?: number;
  testCount?: number;
  reason?: string;
}

type TestEventListener = (event: TestEvent) => void;
const testEventListeners: Set<TestEventListener> = new Set();

export function emitTestEvent(event: TestEvent): void {
  testEventListeners.forEach(fn => fn(event));
}

export function onTestEvent(listener: TestEventListener): () => void {
  testEventListeners.add(listener);
  return () => testEventListeners.delete(listener);
}
