/**
 * Shared signal store — small global UI / transport flags.
 *
 * Stateful runtime services (Connection, Bridge, Registry, TestRunner) live in
 * `runtime.ts` and are injected via `HarnessCtx`. The big test-tree state
 * (file/suite/test tree + per-task status / duration / error) lives next to
 * the runner in `task-state.ts`. This module only owns the cross-cutting
 * "what's happening" signals that the explorer UI reads via `useReactive`.
 */

import { signal } from 'signalium';

// ── Harness status (transport + lifecycle) ───────────────────────

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
}

export const harnessStatus = signal<HarnessStatus>({
  state: 'connecting',
  message: 'Connecting to Vitest...',
});

/** Patch the harness status. */
export function setHarnessStatus(patch: Partial<HarnessStatus>): void {
  harnessStatus.value = { ...harnessStatus.value, ...patch };
}

// ── Connection / pause flags ──────────────────────────────────────

export const isConnected = signal(false);
export const isPaused = signal(false);

// ── UI filters (read/written from the explorer components) ────────

export type StatusFilter = 'all' | 'failed' | 'passed' | 'skipped';

export const statusFilter = signal<StatusFilter>('all');
export const searchQuery = signal('');
export const detailTaskId = signal<string | null>(null);
