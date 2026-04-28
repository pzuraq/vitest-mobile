/**
 * Task-tree reactive layer + tree helpers.
 *
 * The canonical `File[]` and the per-task signal Map both live on
 * `HarnessRuntime` (see `runtime.ts`); this file owns the *transforms* over
 * them: apply functions called by the runner, lookup/label/filter helpers
 * used by the explorer, and reactive aggregates (`aggregateStatus`,
 * `aggregateDuration`, `countByStatus`).
 *
 * Reactive helpers resolve the active runtime via `getContext(HarnessCtx)`.
 * They're called from inside `component()` / `reactive` scopes (the React
 * explorer), which carry the Signalium owner chain set up by the harness's
 * `<ContextProvider>`. For non-reactive callers (the runner) the runtime is
 * passed in explicitly.
 *
 * Note: previously-seen task ids persist for the lifetime of the runtime —
 * we don't reap entries on re-collection. This matches the design intent of
 * holding onto every test we've ever observed so the explorer can keep
 * showing it; the test-tree shape itself is expected to grow into a richer
 * abstraction layered on top of this side-table.
 */

import type { File, Suite, Task, TaskResultPack } from '@vitest/runner';
import { getContext, reactive, type Signal, signal } from 'signalium';
import { HarnessCtx, type HarnessRuntime } from './runtime';
import { detailTaskId, type StatusFilter } from './store';

/** UI-facing task status. Translation of Vitest's `TaskState` plus a `'pending'` slot. */
export type UiTaskStatus = 'pending' | 'running' | 'pass' | 'fail' | 'skip';

export interface ReactiveTaskFields {
  status: Signal<UiTaskStatus>;
  duration: Signal<number | undefined>;
  error: Signal<string | undefined>;
}

// ── translation ───────────────────────────────────────────────────

function deriveStatus(task: Task): UiTaskStatus {
  const r = task.result;
  if (!r) {
    // No result yet — `mode` tells us whether this leaf will run, was skipped, etc.
    if (task.mode === 'skip' || task.mode === 'todo') return 'skip';
    return 'pending';
  }
  return uiFromTaskState(r.state);
}

function uiFromTaskState(state: string | undefined): UiTaskStatus {
  switch (state) {
    case 'pass':
      return 'pass';
    case 'fail':
      return 'fail';
    case 'skip':
    case 'todo':
      return 'skip';
    case 'run':
    case 'queued':
      return 'running';
    default:
      return 'pending';
  }
}

// ── apply hooks (called by the runner) ────────────────────────────

function ensureNode(runtime: HarnessRuntime, task: Task): ReactiveTaskFields {
  let node = runtime.taskState.get(task.id);
  if (!node) {
    node = {
      status: signal<UiTaskStatus>(deriveStatus(task)),
      duration: signal<number | undefined>(task.result?.duration),
      error: signal<string | undefined>(task.result?.errors?.[0]?.message),
    };
    runtime.taskState.set(task.id, node);
  } else {
    // Already-known task may have been re-collected with a fresh result; reset
    // its signals to match the new task object so reruns clear stale state.
    const nextStatus = deriveStatus(task);
    if (node.status.value !== nextStatus) node.status.value = nextStatus;
    const nextDuration = task.result?.duration;
    if (node.duration.value !== nextDuration) node.duration.value = nextDuration;
    const nextError = task.result?.errors?.[0]?.message;
    if (node.error.value !== nextError) node.error.value = nextError;
  }
  return node;
}

function walkAndEnsure(runtime: HarnessRuntime, task: Task): void {
  ensureNode(runtime, task);
  if ('tasks' in task && Array.isArray(task.tasks)) {
    for (const child of task.tasks as Task[]) walkAndEnsure(runtime, child);
  }
}

/**
 * Merge `incoming` into `prev`, replacing entries with the same `filepath`
 * and appending new ones. Returns a fresh array reference so reactive
 * consumers subscribed to `collectedFiles` re-run.
 */
function mergeFileLists(prev: File[], incoming: File[]): File[] {
  if (incoming.length === 0) return prev;
  const next = prev.slice();
  for (const file of incoming) {
    const idx = next.findIndex(f => f.filepath === file.filepath);
    if (idx >= 0) next[idx] = file;
    else next.push(file);
  }
  return next;
}

/**
 * Called from `ReactNativeRunner.onCollected` via `runtime.onCollected`.
 * Populates the side-table for every task in each file's tree and replaces
 * `collectedFiles` so reactives re-run.
 */
export function applyCollected(runtime: HarnessRuntime, files: File[]): void {
  if (files.length === 0) return;
  for (const file of files) walkAndEnsure(runtime, file);
  runtime.collectedFiles.value = mergeFileLists(runtime.collectedFiles.value, files);
}

/**
 * Called from `ReactNativeRunner.onTaskUpdate` via `runtime.onTaskUpdate`.
 * Pokes the per-task signals so subscribed UI rows re-render. Sibling rows
 * are unaffected.
 */
export function applyTaskUpdate(runtime: HarnessRuntime, packs: TaskResultPack[]): void {
  for (const [id, result] of packs) {
    const node = runtime.taskState.get(id);
    if (!node) continue;
    if (!result) {
      // Result cleared (e.g. start of rerun) — go back to pending.
      if (node.status.value !== 'pending') node.status.value = 'pending';
      if (node.duration.value !== undefined) node.duration.value = undefined;
      if (node.error.value !== undefined) node.error.value = undefined;
      continue;
    }
    const next = uiFromTaskState(result.state);
    if (node.status.value !== next) node.status.value = next;
    if (node.duration.value !== result.duration) node.duration.value = result.duration;
    const nextErr = result.errors?.[0]?.message;
    if (node.error.value !== nextErr) node.error.value = nextErr;
  }
}

// ── tree shape ────────────────────────────────────────────────────

export type TaskKind = 'file' | 'suite' | 'test';

/** Vitest task type → UI tree kind. `File` tasks have `type: 'suite'` but a `filepath`. */
export function taskKind(task: Task): TaskKind {
  if (task.type === 'test') return 'test';
  if ('filepath' in task && typeof (task as File).filepath === 'string') return 'file';
  return 'suite';
}

export function isFile(task: Task): task is File {
  return taskKind(task) === 'file';
}

export function getChildren(task: Task): Task[] {
  if ('tasks' in task && Array.isArray((task as Suite).tasks)) {
    return (task as Suite).tasks as Task[];
  }
  return [];
}

/** Project-relative label for a file. Falls back to the basename. */
export function fileLabel(file: File): string {
  const filepath = file.filepath;
  for (const marker of ['test-packages/', 'packages/', 'src/']) {
    const idx = filepath.indexOf(marker);
    if (idx >= 0) return filepath.slice(idx);
  }
  return filepath.split('/').slice(-3).join('/');
}

/** Display label for a task (file → project-relative path; otherwise `task.name`). */
export function taskLabel(task: Task): string {
  if (isFile(task)) return fileLabel(task);
  return task.name;
}

// ── lookup ────────────────────────────────────────────────────────

export function findTaskById(files: readonly File[], id: string): Task | null {
  for (const file of files) {
    const found = walkFind(file, id);
    if (found) return found;
  }
  return null;
}

function walkFind(task: Task, id: string): Task | null {
  if (task.id === id) return task;
  for (const child of getChildren(task)) {
    const found = walkFind(child, id);
    if (found) return found;
  }
  return null;
}

/** Walk parents from `task` upward, returning labels outermost → innermost. */
export function getBreadcrumb(task: Task): string[] {
  const labels: string[] = [];
  // Use `.suite` to walk ancestors. Files have `suite === undefined`.
  let cur: Task | undefined = task.suite as Task | undefined;
  while (cur) {
    labels.unshift(taskLabel(cur));
    cur = (cur as Task).suite as Task | undefined;
  }
  return labels;
}

// ── runtime accessors (reactive) ──────────────────────────────────

/** Resolve the active runtime via Signalium's owner chain. */
function currentRuntime(): HarnessRuntime | null {
  return getContext(HarnessCtx);
}

/**
 * Reactive view of `collectedFiles` on the active runtime. Returns `[]` when
 * called outside an `HarnessCtx` scope.
 */
export const collectedFiles = reactive(function collectedFiles(): readonly File[] {
  const runtime = currentRuntime();
  return runtime?.collectedFiles.value ?? [];
});

/**
 * Read the reactive fields for a task id from the active runtime. Returns
 * `null` if the id isn't in the side-table yet (e.g. a stub File rendered
 * before collection — but in default browser-mode flow we don't render those).
 */
export function getTaskFields(taskId: string): ReactiveTaskFields | null {
  const runtime = currentRuntime();
  return runtime?.taskState.get(taskId) ?? null;
}

// ── reactive aggregates ──────────────────────────────────────────

/**
 * Reactive aggregate over a task subtree. Returns the "rolled up" status the
 * UI should display for a file/suite (`fail` if any leaf failed, otherwise
 * `running` if any leaf is running, otherwise `pass` if all leaves passed,
 * otherwise `pending`).
 */
export const aggregateStatus = reactive(function aggregateStatus(task: Task): UiTaskStatus {
  if (!('tasks' in task) || !Array.isArray(task.tasks) || task.tasks.length === 0) {
    return getTaskFields(task.id)?.status.value ?? 'pending';
  }
  let allPass = true;
  let anyRunning = false;
  let anyPending = false;
  for (const child of task.tasks as Task[]) {
    const childStatus = aggregateStatus(child);
    if (childStatus === 'fail') return 'fail';
    if (childStatus === 'running') anyRunning = true;
    if (childStatus === 'pending') anyPending = true;
    if (childStatus !== 'pass' && childStatus !== 'skip') allPass = false;
  }
  if (anyRunning) return 'running';
  if (allPass) return 'pass';
  if (anyPending) return 'pending';
  return 'skip';
});

/** Reactive sum of leaf durations under a task (suite/file). */
export const aggregateDuration = reactive(function aggregateDuration(task: Task): number {
  if (!('tasks' in task) || !Array.isArray(task.tasks) || task.tasks.length === 0) {
    return getTaskFields(task.id)?.duration.value ?? 0;
  }
  let total = 0;
  for (const child of task.tasks as Task[]) {
    total += aggregateDuration(child);
  }
  return total;
});

/** Reactive count by status for a task subtree. */
export const countByStatus = reactive(function countByStatus(task: Task): {
  passed: number;
  failed: number;
  pending: number;
  total: number;
} {
  if (!('tasks' in task) || !Array.isArray(task.tasks) || task.tasks.length === 0) {
    const status = getTaskFields(task.id)?.status.value ?? 'pending';
    return {
      passed: status === 'pass' ? 1 : 0,
      failed: status === 'fail' ? 1 : 0,
      pending: status === 'pending' || status === 'running' ? 1 : 0,
      total: 1,
    };
  }
  const out = { passed: 0, failed: 0, pending: 0, total: 0 };
  for (const child of task.tasks as Task[]) {
    const c = countByStatus(child);
    out.passed += c.passed;
    out.failed += c.failed;
    out.pending += c.pending;
    out.total += c.total;
  }
  return out;
});

// ── filtering ─────────────────────────────────────────────────────

const STATUS_ALLOWED: Record<StatusFilter, UiTaskStatus[]> = {
  all: ['pending', 'running', 'pass', 'fail', 'skip'],
  failed: ['fail'],
  passed: ['pass'],
  skipped: ['skip'],
};

/**
 * Reactive prune of `files` keeping only leaf tests whose status matches
 * `filter`, plus the suites/files required to host them.
 */
export const filterByStatus = reactive(function filterByStatus(files: readonly File[], filter: StatusFilter): File[] {
  if (filter === 'all') return files.slice();
  const allowed = STATUS_ALLOWED[filter];
  const out: File[] = [];
  for (const file of files) {
    const next = pruneByStatus(file, allowed);
    if (next) out.push(next as File);
  }
  return out;
});

function pruneByStatus(task: Task, allowed: UiTaskStatus[]): Task | null {
  if (task.type === 'test') {
    const status = getTaskFields(task.id)?.status.value ?? 'pending';
    return allowed.includes(status) ? task : null;
  }
  const children = getChildren(task);
  const kept: Task[] = [];
  for (const child of children) {
    const next = pruneByStatus(child, allowed);
    if (next) kept.push(next);
  }
  if (kept.length === 0) return null;
  // Return a shallow copy with the pruned children; preserves all task metadata
  // but lets the renderer iterate the filtered list.
  return { ...(task as Suite), tasks: kept } as Task;
}

/** Case-insensitive name match. Suites match by their own name; tests match by their own name. */
export const filterBySearch = reactive(function filterBySearch(files: readonly File[], query: string): File[] {
  if (!query) return files.slice();
  const q = query.toLowerCase();
  const out: File[] = [];
  for (const file of files) {
    const next = pruneBySearch(file, q);
    if (next) out.push(next as File);
  }
  return out;
});

function pruneBySearch(task: Task, query: string): Task | null {
  if (taskLabel(task).toLowerCase().includes(query)) return task;
  if (task.type === 'test') return null;
  const children = getChildren(task);
  const kept: Task[] = [];
  for (const child of children) {
    const next = pruneBySearch(child, query);
    if (next) kept.push(next);
  }
  if (kept.length === 0) return null;
  return { ...(task as Suite), tasks: kept } as Task;
}

// ── currently-selected detail node (derived) ─────────────────────

/**
 * The Vitest task currently shown in the detail panel, looked up from
 * `detailTaskId`. `null` when nothing is selected or when the id no longer
 * resolves (e.g. file was removed via HMR).
 */
export const detailNode = reactive(function detailNode(): Task | null {
  const id = detailTaskId.value;
  if (!id) return null;
  return findTaskById(collectedFiles(), id);
});

/** Breadcrumb (outer → inner) for the currently-selected detail node. */
export const detailBreadcrumb = reactive(function detailBreadcrumb(): string[] {
  const node = detailNode();
  return node ? getBreadcrumb(node) : [];
});
