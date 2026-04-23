/**
 * Custom Vitest pool worker — bridges to a React Native app over WebSocket.
 *
 * Two modes:
 *   dev  (vitest --watch) — visible emulator, reuse app/Metro, leave running
 *   run  (vitest run)     — headless, clean start, shut down after
 *
 * The plugin sets `test.isolate = false` and `maxWorkers = 1`, which makes
 * Vitest's scheduler bundle every file in a run into a single task with
 * `context.files = [all]`. So `worker.start()`/`worker.stop()` fire once per
 * user-initiated run (initial run or HMR-driven rerun), not once per file.
 * Per-file granularity happens inside the device-side handleRun loop.
 *
 * The singleton worker persists across reruns, so cross-rerun idempotency
 * (_startPromise, _startConfigSent) is still required to avoid re-booting
 * the device on every HMR cycle.
 *
 * Metro is started programmatically via metro-runner.ts. The harness binary
 * is auto-built and cached by harness-builder.ts. Test files on device are
 * listed via `require.context` in `test-context`.
 *
 * Multiple pool workers (one per platform) share a single WebSocket server
 * via the connection manager (connections.ts). Each app identifies itself
 * with a platform hello, and the server routes it to the right worker.
 *
 * The pool's configuration lives on three atomic fields:
 *
 *   this.options  — user-facing static config (harness/device/metro groups).
 *                   Readonly, frozen after the constructor runs.
 *   this.internal — plugin-computed static values (appDir, mode, testPatterns,
 *                   outputDir). Readonly.
 *   this.runtime  — mutable runtime-resolved values (instanceId, port,
 *                   metroPort, instanceDir, deviceId, bundleId,
 *                   harnessProjectDir). Mutated by doStart.
 */

import { resolve } from 'node:path';
import { stringify as flatStringify, parse as flatParse } from 'flatted';
import { type WebSocket } from 'ws';
import type { PoolWorker } from 'vitest/node';
import { checkAndReportEnvironment } from './environment';
import { ensureDevice, launchApp, stopApp, installHarness } from './device';
import { resolveHarness } from './harness-builder';
import { startMetroServer, type MetroServer } from './metro-runner';
import { registerPlatform, unregisterPlatform, closeServer } from './connections';
import {
  registerInstanceRecord,
  releaseInstanceRecord,
  resolveInstanceResources,
  updateInstanceRecord,
} from './instance-manager';
import { log, setVerbose } from './logger';
import { captureScreenshot } from './screenshot';
import { detectPrebuiltBundle, startStaticBundleServer } from './bundle-server';
import { PauseController } from './pause-controller';
import { withDefaults } from './options';
import type { InternalPoolOptions, NativePluginOptions, ResolvedNativePluginOptions, RuntimeState } from './types';
import {
  isDeviceMessage,
  isVitestWorkerRequest,
  type DeviceMessage,
  type DeviceUpdatePayload,
  type VitestWorkerRequest,
} from '../shared/pool-messages';

type EventCallback = (data: unknown) => void;

// TypeScript's DOM lib declares setTimeout as returning `number`; Node.js returns
// a Timeout object with .unref(). Read `.unref` through an unknown cast so the
// call type-checks under whichever lib is active.
function unrefTimer(t: ReturnType<typeof setTimeout>): ReturnType<typeof setTimeout> {
  (t as unknown as { unref?: () => void }).unref?.();
  return t;
}

export class NativePoolWorker implements PoolWorker {
  readonly name = 'native' as const;
  readonly reportMemory = false;

  /** User-configurable options, frozen after the constructor. */
  private readonly options: ResolvedNativePluginOptions;
  /** Plugin-computed values (appDir, mode, testPatterns, outputDir), frozen. */
  private readonly internal: InternalPoolOptions;
  /** Runtime-resolved state (ports, instanceId, deviceId, …), mutated by doStart. */
  private readonly runtime: RuntimeState;

  private readonly _listeners = new Map<string, Set<EventCallback>>();

  private _connectedSocket: WebSocket | null = null;
  private _resolveConnection: (() => void) | null = null;
  private _startPromise: Promise<void> | null = null;
  private _runTeardownDone = false;

  private _metroRunner: MetroServer | null = null;

  private _onUpdate: ((d: DeviceUpdatePayload) => void) | null = null;
  // True once Vitest has driven its first `run`. Device `update` messages
  // (except `reconnect`) are ignored until then; on reconnect the device
  // sends `reconnect: true` and the pool uses `acceptReconnectReplay` only.
  private _initialRunStarted = false;

  private readonly pause: PauseController;

  constructor(
    userOptions: NativePluginOptions,
    pluginInternal: InternalPoolOptions,
    onUpdate?: (d: DeviceUpdatePayload) => void,
  ) {
    const { options, internal, runtime } = withDefaults(userOptions, pluginInternal);
    this.options = options;
    this.internal = internal;
    this.runtime = runtime;
    this._onUpdate = onUpdate ?? null;

    if (this.options.verbose) setVerbose(true);

    this.pause = new PauseController(this.options.platform, () => this._connectedSocket);

    log.verbose(
      `Mode: ${this.internal.mode} | Headless: ${this.options.device.headless} | Platform: ${this.options.platform}`,
    );
  }

  private waitForApp(timeoutMs = this.options.appConnectTimeout): Promise<void> {
    return new Promise((resolvePromise, reject) => {
      if (this._connectedSocket) {
        resolvePromise();
        return;
      }
      const original = this._resolveConnection;
      const t = unrefTimer(
        setTimeout(() => {
          if (!this._connectedSocket) reject(new Error(`App did not connect within ${timeoutMs / 1000}s`));
        }, timeoutMs),
      );
      this._resolveConnection = () => {
        clearTimeout(t);
        original?.();
        resolvePromise();
      };
    });
  }

  // ── Cleanup ─────────────────────────────────────────────────────

  private async cleanup(): Promise<void> {
    this.pause.cleanup();
    await this.closeMetro();
    if (this._connectedSocket) {
      try {
        this._connectedSocket.terminate();
      } catch {
        /* ignore */
      }
      this._connectedSocket = null;
    }
    unregisterPlatform(this.options.platform);
    if (this.runtime.instanceId) {
      releaseInstanceRecord(this.internal.appDir, this.runtime.instanceId);
      this.runtime.instanceId = null;
    }
    // App and emulator stay running — Metro is in-process and dies
    // with Vitest naturally. Next run reconnects to the live app.
  }

  private emit(event: string, data: unknown): void {
    this._listeners.get(event)?.forEach(cb => cb(data));
  }

  /** Forwards a flatted frame to the RN app if connected. */
  private relayToDevice(message: unknown): void {
    const socket = this._connectedSocket;
    if (!socket) return;
    try {
      socket.send(flatStringify(message));
    } catch (e) {
      log.error('Failed to relay to device:', e);
    }
  }

  private async closeMetro(): Promise<void> {
    if (this._metroRunner) {
      const runner = this._metroRunner;
      this._metroRunner = null;
      try {
        await runner.close();
      } catch {
        /* ignore */
      }
      log.verbose('Metro runner closed');
    }
  }

  // ── Connection handler (called by shared connection manager) ───

  private handleAppConnection = (socket: WebSocket): void => {
    // If we already have a live connection, reject the new one
    if (this._connectedSocket && this._connectedSocket.readyState <= 1) {
      try {
        socket.send(
          flatStringify({
            type: 'error',
            data: {
              message: `A ${this.options.platform} app is already connected. Only one connection per platform is allowed.`,
            },
          }),
        );
      } catch {
        /* ignore */
      }
      socket.close();
      return;
    }

    // The reconnect-replay handshake is owned by the device: the control
    // bridge posts an `update` with `reconnect: true` and all paths in
    // `updated`. On the first connection we ignore it (Vitest's own initial
    // run is about to arrive); on subsequent connections (post-reload) the
    // host replays. See `handleUpdate`.
    //
    // Captured at connect-time, scoped to this socket. We can't read
    // `_initialRunStarted` live in `handleUpdate` because Vitest's first
    // `run` can flip the flag before the device message arrives.
    const acceptReconnectReplay = this._initialRunStarted;
    log.info(`${this.options.platform} app ${acceptReconnectReplay ? 'reconnected' : 'connected'}`);
    this._connectedSocket = socket;

    socket.on('message', (data: Buffer) => this.handleDeviceMessage(data, acceptReconnectReplay));
    socket.on('close', () => {
      if (this._connectedSocket === socket) {
        this._connectedSocket = null;
        log.verbose(`${this.options.platform} app disconnected`);
      }
    });

    this._resolveConnection?.();
  };

  private handleDeviceMessage(raw: Buffer, acceptReconnectReplay: boolean): void {
    let msg: unknown;
    try {
      const text = raw.toString();
      msg = flatParse(text);
    } catch (e) {
      log.error('Parse error:', e);
      return;
    }

    if (isDeviceMessage(msg)) {
      this.dispatchDeviceMessage(msg, acceptReconnectReplay);
      return;
    }
    this.emit('message', msg);
  }

  private dispatchDeviceMessage(msg: DeviceMessage, acceptReconnectReplay: boolean): void {
    switch (msg.type) {
      case 'pause':
        this.pause.start(msg.data ?? {}, {
          deviceId: this.runtime.deviceId,
          outputDir: this.internal.outputDir,
        });
        return;
      case 'pauseEnded':
        this.pause.end();
        return;
      case 'screenshotRequest':
        this.handleScreenshotRequest(msg.data);
        return;
      case 'update':
        this.handleUpdate(msg.data, acceptReconnectReplay);
        return;
    }
  }

  private handleUpdate(data: DeviceUpdatePayload, acceptReconnectReplay: boolean): void {
    if (!this._onUpdate) return;
    const { created, deleted, updated, reconnect } = data;
    const isEmpty = created.length + deleted.length + updated.length === 0;
    if (isEmpty) return;

    if (reconnect) {
      if (!acceptReconnectReplay) return;
    } else if (!this._initialRunStarted) {
      return;
    }
    this._onUpdate(data);
  }

  private handleScreenshotRequest(data: { requestId: string; name?: string }): void {
    try {
      const result = captureScreenshot({
        platform: this.options.platform,
        name: data.name,
        deviceId: this.runtime.deviceId,
      });
      this.relayToDevice({
        type: 'screenshotResponse',
        data: { requestId: data.requestId, filePath: result.filePath },
      });
      log.info(`Screenshot saved: ${result.filePath}`);
    } catch (err) {
      this.relayToDevice({
        type: 'screenshotResponse',
        data: { requestId: data.requestId, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  // ── Startup phases ────────────────────────────────────────────

  private async resolveInstance(): Promise<void> {
    const { instanceId, port, metroPort, instanceDir } = await resolveInstanceResources(this.options, this.internal);
    this.runtime.instanceId = instanceId;
    this.runtime.port = port;
    this.runtime.metroPort = metroPort;
    this.runtime.instanceDir = instanceDir;
    registerInstanceRecord(this.options, this.internal, this.runtime);
    log.info(`[instance:${instanceId}] ws=${port} metro=${metroPort} instanceDir=${instanceDir}`);
  }

  private async resolveDevice(): Promise<void> {
    const selected = await ensureDevice(this.options.platform, this.runtime, this.options.device);
    if (selected) {
      this.runtime.deviceId = selected;
      if (this.runtime.instanceId) {
        updateInstanceRecord(this.internal.appDir, { instanceId: this.runtime.instanceId, deviceId: selected });
      }
    }
  }

  private async setupBundleServer(): Promise<void> {
    const prebuilt = detectPrebuiltBundle(this.options, this.internal);

    if (prebuilt) {
      log.info(`Using pre-built bundle for ${this.options.platform}`);
      this.runtime.metroPort = prebuilt.metroPort;
      this._metroRunner = await startStaticBundleServer(prebuilt, this.options.platform);
      return;
    }
    if (this.options.metro.bundle) {
      log.warn(`Pre-built bundle requested but not found for ${this.options.platform} — falling back to Metro`);
    } else if (this._metroRunner) {
      log.verbose('Metro already running, reusing');
      return;
    }
    log.info('Starting Metro...');
    this._metroRunner = await startMetroServer(this.options, this.internal, this.runtime);
  }

  private async launchWithRetry(): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await launchApp(this.options.platform, this.runtime);
        return;
      } catch (err) {
        if (attempt === 0) {
          log.warn('Launch failed, re-checking device...');
          await this.resolveDevice();
        } else {
          throw new Error(`Failed to launch app after retry: ${(err as Error).message}`, { cause: err });
        }
      }
    }
  }

  private async launchAndWaitForApp(): Promise<void> {
    if (this._connectedSocket) {
      log.verbose('Reusing existing app connection');
      return;
    }
    log.info('Waiting for app to connect...');
    try {
      await this.waitForApp(3000);
      log.info('App connected');
      return;
    } catch {
      /* fall through to launch */
    }

    log.info('App not connected, launching...');
    try {
      await launchApp(this.options.platform, this.runtime);
    } catch {
      stopApp(this.options.platform, this.runtime);
      await new Promise<void>(r => unrefTimer(setTimeout(r, 500)));
      await this.launchWithRetry();
    }
    await this.waitForApp(this.options.appConnectTimeout);
  }

  private async doStart(): Promise<void> {
    await this.resolveInstance();
    checkAndReportEnvironment(this.options.platform);

    const packageRoot = resolve(__dirname, '..', '..');
    const harness = resolveHarness(this.options, this.internal, packageRoot);
    if (harness.bundleId) this.runtime.bundleId = harness.bundleId;
    if (harness.projectDir) this.runtime.harnessProjectDir = harness.projectDir;

    // ensureDevice uses port-based liveness checks to determine which devices
    // are in use; a global lock in ~/.cache/vitest-mobile/ serializes concurrent
    // selections across pool workers.
    await this.resolveDevice();
    installHarness(this.options.platform, this.runtime, harness);

    // Register with shared WS server before Metro/app so an early-connecting
    // device can route to us. `port` is concrete here — resolveInstance
    // assigned it above.
    registerPlatform(this.options.platform, this.runtime.port!, {
      onConnection: this.handleAppConnection,
    });

    await this.setupBundleServer();
    await this.launchAndWaitForApp();
  }

  // ── PoolWorker interface ───────────────────────────────────────

  // The native runtime can run any task that made it through isolate:false
  // pre-checks (same project, same env). Returning true short-circuits the
  // default isEnvironmentEqual() check — harmless in the maxWorkers=1 world
  // today, useful if we ever want parallel devices sharing one pool.
  canReuse(): boolean {
    return true;
  }

  on(event: string, callback: EventCallback): void {
    let set = this._listeners.get(event);
    if (!set) this._listeners.set(event, (set = new Set()));
    set.add(callback);
  }

  off(event: string, callback: EventCallback): void {
    this._listeners.get(event)?.delete(callback);
  }

  deserialize(data: unknown): unknown {
    return data;
  }

  async start(): Promise<void> {
    // doStart() can outlast Vitest's WORKER_START_TIMEOUT (90s) on a cold
    // simulator, so we resolve start() immediately and queue run/collect
    // behind _startPromise instead. A ref'd keepAlive keeps the event
    // loop open while device bring-up runs (everything else we create is
    // .unref()'d so process shutdown stays clean).
    if (!this._startPromise) {
      const keepAlive = setInterval(() => {}, 30_000);
      this._startPromise = this.doStart().finally(() => clearInterval(keepAlive));
      this._startPromise.catch(e => log.error('Startup failed:', e));
    }
  }

  // Phase 2 of runner.stop(): the imperative teardown. Called once per
  // runner.stop() via `await this.worker.stop()` after the handshake.
  // Runs inside pool.exitPromises → awaited by Vitest.close(), so any
  // async work here gates process exit and the hanging-process warning.
  async stop(): Promise<void> {
    if (this.internal.mode === 'run') {
      if (this._runTeardownDone) return;
      this._runTeardownDone = true;
      await this.cleanup();
      await closeServer();
    }
  }

  send(message: unknown): void {
    if (!isVitestWorkerRequest(message)) {
      this.relayToDevice(message);
      return;
    }
    switch (message.type) {
      case 'start':
        this.handleStartRequest(message);
        return;
      case 'run':
      case 'collect':
        void this.handleRunOrCollectRequest(message);
        return;
      case 'stop':
        // Phase 1 of runner.stop(): the cooperative handshake. Reply
        // synchronously so Vitest's 60s STOP_TIMEOUT never bites. The
        // real teardown happens later in worker.stop() when the runner
        // calls it directly (awaited via pool.exitPromises).
        this.emit('message', { __vitest_worker_response__: true, type: 'stopped' });
        return;
    }
  }

  private handleStartRequest(message: VitestWorkerRequest): void {
    const ctx = message.context;
    if (ctx?.config) {
      ctx.config.__poolMode = this.internal.mode;
      // Force config.root to appDir. On the RN runtime, Vitest's serialized
      // root sometimes arrives as '/' (the RN VM's notion of cwd), which
      // would make createFileTask emit absolute-minus-slash paths like
      // "Users/.../test.tsx" via relative('/', abs). appDir is always the
      // Node-side project root, which is what the reporter expects for its
      // relative-path display.
      ctx.config.root = this.internal.appDir;
      if (this.internal.mode === 'dev') {
        ctx.config.testTimeout = 0;
        ctx.config.hookTimeout = 0;
      }
    }
    // Answer the 60s START_TIMEOUT handshake without waiting on the
    // device — run/collect handlers defer until _startPromise settles.
    // The device's init() will also reply `started` via birpc once Metro
    // finishes; Vitest's PoolRunner is tolerant of a second reply (it only
    // listens until the first resolution).
    this.emit('message', { __vitest_worker_response__: true, type: 'started' });
    void this.forwardStartOnceConnected(message);
  }

  private async forwardStartOnceConnected(message: VitestWorkerRequest): Promise<void> {
    if (!this._connectedSocket) await this._startPromise;
    this.relayToDevice(message);
  }

  private async handleRunOrCollectRequest(message: VitestWorkerRequest): Promise<void> {
    await this._startPromise;
    const ctx = message.context;
    if (ctx?.config) ctx.config.__poolMode = this.internal.mode;

    if (message.type === 'run') {
      // First `run` from Vitest unblocks device-initiated `update` messages. After
      // this, a post-reload reconnect's `update` (reconnect) will replay.
      this._initialRunStarted = true;
      log.verbose(ctx?.files?.map(f => f.filepath?.split('/').pop() ?? '').join(', ') ?? '');
    }

    if (this._connectedSocket) {
      this.relayToDevice(message);
    } else if (message.type === 'run') {
      this.emit('message', {
        __vitest_worker_response__: true,
        type: 'testfileFinished',
        error: new Error('RN app not connected'),
      });
    }
  }
}

export function createNativePoolWorker(
  options: NativePluginOptions,
  internal: InternalPoolOptions,
  onUpdate?: (d: DeviceUpdatePayload) => void,
): NativePoolWorker {
  return new NativePoolWorker(options, internal, onUpdate);
}
