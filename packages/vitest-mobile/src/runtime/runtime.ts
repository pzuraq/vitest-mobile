/**
 * HarnessRuntime — the device-side root.
 *
 * One instance per harness mount, constructed in `harness.tsx` and provided
 * to the React tree via Signalium's `<ContextProvider contexts={[[HarnessCtx, runtime]]}>`.
 *
 * Owns:
 *   - `connection`        — WebSocket transport to the Vitest pool.
 *   - `collectedFiles`    — canonical reactive `File[]` mirroring what Vitest collected.
 *   - `taskState`         — side-table of per-task signals (status / duration / error)
 *                           keyed by `task.id`. The view derives counts/aggregates
 *                           from this; entries persist for the lifetime of the
 *                           runtime so previously-seen tests stay visible
 *                           (the test-tree shape is likely to grow into a richer
 *                           abstraction; this keeps the data co-located in one place).
 *   - registry diff       — debounced `created` / `deleted` / `updated` notifications
 *                           sent to the pool whenever the babel HMR cycle re-runs a
 *                           file or a re-evaluation of `test-context.ts` changes the
 *                           require.context key set.
 */

import { context, signal, type Signal } from 'signalium';
import { Platform } from 'react-native';
import {
  collectTests as runnerCollectTests,
  startTests,
  type File,
  type TaskResultPack,
  type TaskEventPack,
} from '@vitest/runner';
import type { WorkerGlobalState } from 'vitest';
import { DevicePoolConnection } from './connection';
import { ReactNativeRunner } from './runner';
import { createVitestWorker } from './worker';
import { setHarnessStatus } from './store';
import { configurePause, resume as resumePause } from './pause';
import { isPoolMessage, type PoolMessage } from '../shared/pool-messages';
import { getPaths, getTestRun } from './test-context';
import type { ReactiveTaskFields } from './tasks';
import { applyCollected, applyTaskUpdate } from './tasks';

export const HarnessCtx = context<HarnessRuntime | null>(null);

/** The root service. */
export class HarnessRuntime {
  readonly connection: DevicePoolConnection;

  /** Canonical `File[]` mirroring Vitest's collected tree. */
  readonly collectedFiles: Signal<File[]> = signal<File[]>([]);

  /** Per-task reactive fields, keyed by `task.id`. Populated by `applyCollected`. */
  readonly taskState = new Map<string, ReactiveTaskFields>();

  private _started = false;

  /**
   * Set during `runTests` / `runCollectTests` so `onCollected` /
   * `onTaskUpdate` can forward to `state.rpc.*`. Cleared in `finally`.
   */
  private _currentState: WorkerGlobalState | null = null;

  /**
   * Aborts the in-flight run when set. Used to release `pause()` calls when
   * a file edit triggers an HMR rerun, or when the explorer's Stop button
   * fires `cancel()`.
   */
  private _runAbort: AbortController | null = null;

  // ── registry diff plumbing ────────────────────────────────────────
  private _prevContextKeys: Set<string> = new Set();
  private _pendingUpdates: Set<string> = new Set();
  private _flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.connection = new DevicePoolConnection();

    this.connection.on((data: unknown) => {
      if (!isPoolMessage(data)) return;
      this.handlePoolMessage(data);
    });

    this.connection.onOpen(() => {
      this.sendHello();
    });

    // Prime the registry's notify callback. The constructor's snapshot
    // is the baseline against which the first HMR diff is computed.
    this._prevContextKeys = getPaths(this._onRegistryChange);
  }

  // ── lifecycle ─────────────────────────────────────────────────────

  /**
   * Set up the vitest worker handlers and open the WebSocket. Called from the
   * harness's `useEffect` so the React tree is mounted (and the test container
   * `<View>` exists) before any pool message can arrive.
   */
  start(): void {
    if (this._started) return;
    this._started = true;
    createVitestWorker(
      this.connection,
      state => this.runTests(state),
      state => this.runCollectTests(state),
    );
    this.connection.connect();
  }

  stop(): void {
    if (!this._started) return;
    this._started = false;
  }

  // ── pool I/O ──────────────────────────────────────────────────────

  /** Send an arbitrary message to the pool. */
  send(message: Record<string, unknown>): void {
    this.connection.post(message);
  }

  /** Whether the underlying transport is currently open. */
  isConnected(): boolean {
    return this.connection.isOpen();
  }

  // ── vitest worker handlers ────────────────────────────────────────

  async runTests(state: WorkerGlobalState): Promise<void> {
    const fileCount = state.ctx.files.length;
    setHarnessStatus({
      state: 'running',
      message: `Running ${fileCount} test file(s)...`,
      fileCount,
    });
    this._currentState = state;

    // Mode is set on `ctx.config.__poolMode` by `node/pool.ts::handleStartRequest`
    // before the run is dispatched. Default to `'run'` (fail-closed) so a missing
    // value still rejects `pause()` rather than blocking forever.
    const mode = (state.config as { __poolMode?: 'dev' | 'run' }).__poolMode ?? 'run';
    const ac = new AbortController();
    this._runAbort = ac;
    configurePause({
      notifyPool: msg => this.connection.post(msg),
      abortSignal: ac.signal,
      mode,
    });

    try {
      // Per-spec runner — vitest's collector context globals
      // (`currentTestFilepath`, `runner`) get clobbered when one runner is
      // reused across multiple specs, so a per-spec instance is the simplest
      // way to keep collection isolated.
      for (const spec of state.ctx.files) {
        if (ac.signal.aborted) break;
        const runner = new ReactNativeRunner(state.config, this);
        try {
          await startTests([spec], runner);
        } catch (err) {
          // Aborts (HMR rerun, explorer Stop) unwind cleanly so the next run
          // can start; only treat unexpected errors as a harness failure.
          if (ac.signal.aborted && isAbortError(err)) break;
          throw err;
        }
      }
      setHarnessStatus({ state: 'done', message: 'Done' });
    } catch (err) {
      setHarnessStatus({
        state: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      this._currentState = null;
      this._runAbort = null;
    }
  }

  async runCollectTests(state: WorkerGlobalState): Promise<void> {
    setHarnessStatus({
      state: 'running',
      message: `Collecting ${state.ctx.files.length} file(s)...`,
    });
    this._currentState = state;
    try {
      for (const spec of state.ctx.files) {
        const runner = new ReactNativeRunner(state.config, this);
        await runnerCollectTests([spec], runner);
      }
    } finally {
      this._currentState = null;
    }
  }

  // ── runner ↔ runtime bridge ───────────────────────────────────────

  /**
   * Called from `ReactNativeRunner.importFile`. Resolves the file in the
   * test-context registry and invokes its `__run` wrapper, registering our
   * `notifyTest` as the babel HMR rerun callback.
   */
  runTest(fileAbsPath: string): void {
    getTestRun(fileAbsPath, () => this.notifyTest(fileAbsPath));
  }

  /** Mark a single file as needing a rerun. Called from babel HMR dispose. */
  notifyTest(fileAbsPath: string): void {
    this._pendingUpdates.add(fileAbsPath);
    // Release any paused `pause()` call so the file edit can take effect.
    // The next run will pick up the updated module.
    this.cancel('Test file updated');
    this.scheduleUpdate();
  }

  /**
   * Update the device-side reactive layer with a freshly collected tree, then
   * forward to the pool. The local update is what makes the explorer reflect
   * results without waiting for a pool round-trip.
   */
  async onCollected(files: File[]): Promise<void> {
    applyCollected(this, files);
    await this._currentState?.rpc.onCollected(files);
  }

  /** Same shape as {@link onCollected} but for per-task result/event updates. */
  async onTaskUpdate(packs: TaskResultPack[], events: TaskEventPack[]): Promise<void> {
    applyTaskUpdate(this, packs);
    await this._currentState?.rpc.onTaskUpdate(packs, events);
  }

  // ── registry diff (test-context HMR) ──────────────────────────────

  /**
   * Bound once and reused — `getPaths` only stores one notify callback, so
   * passing a fresh `bind(this)` every flush would leak older closures.
   */
  private _onRegistryChange = (): void => {
    this.scheduleUpdate();
  };

  private scheduleUpdate(): void {
    if (!this.connection.isOpen()) return;
    if (this._flushTimer) clearTimeout(this._flushTimer);
    this._flushTimer = setTimeout(() => {
      this._flushTimer = null;
      this.flushUpdate();
    }, 80) as ReturnType<typeof setTimeout> & { unref?: () => void };
  }

  private flushUpdate(): void {
    if (!this.connection.isOpen()) return;

    const prevKeys = this._prevContextKeys;
    // `getPaths` both returns the current key set AND re-installs the notify
    // callback for the next HMR cycle, so this single call refreshes both.
    const updatedKeys = getPaths(this._onRegistryChange);

    const created: string[] = [];
    const deleted: string[] = [];
    for (const key of updatedKeys) {
      if (!prevKeys.has(key)) created.push(key);
    }
    for (const key of prevKeys) {
      if (!updatedKeys.has(key)) deleted.push(key);
    }

    const updated = [...this._pendingUpdates].filter(key => !created.includes(key) && !deleted.includes(key));
    this._pendingUpdates.clear();
    this._prevContextKeys = updatedKeys;

    if (created.length === 0 && deleted.length === 0 && updated.length === 0) return;

    this.connection.post({
      type: 'update',
      data: { created, deleted, updated },
    });
  }

  // ── pool message handling ─────────────────────────────────────────

  private sendHello(): void {
    const myPlatform = Platform.OS ?? 'unknown';
    try {
      this.connection.post({ __hello: true, platform: myPlatform } as unknown as Record<string, unknown>);
    } catch {
      /* ignore */
    }
    console.log(`[vitest-mobile] Connected to Vitest (${myPlatform})`);
  }

  private handlePoolMessage(msg: PoolMessage): void {
    switch (msg.type) {
      case 'error':
        return this.handleError(msg);
      case 'resume':
        return resumePause();
    }
  }

  private handleError(msg: Extract<PoolMessage, { type: 'error' }>): void {
    const message = msg.data?.message ?? 'Unknown error';
    console.warn(`[vitest-mobile] ${message}`);
    setHarnessStatus({ state: 'error', message });
    this.connection.haltReconnection();
  }

  // ── cancellation ──────────────────────────────────────────────────

  /**
   * Abort the in-flight run, if any. Releases a `pause()` call (its
   * abort-signal listener rejects) and lets `runTests` return so the next
   * `run` from the pool can dispatch cleanly. No-op if nothing is running.
   * Called locally from explorer Stop and from `notifyTest` (HMR file edits).
   */
  cancel(reason = 'Run cancelled'): void {
    this._runAbort?.abort(new DOMException(reason, 'AbortError'));
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}
