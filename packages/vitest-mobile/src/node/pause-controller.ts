/**
 * Handles pause/resume of test execution from the device side.
 *
 * When the device sends a `{ type: 'pause' }` message (usually from a test
 * calling `pause()`), we surface it in the Node-side terminal with a
 * screenshot and two resume paths: pressing Enter in the TTY, or writing a
 * sentinel file to `<outputDir>/resume-signal`. Either path tells the
 * device to unblock via `{ type: 'resume' }`.
 */

import { existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { stringify as flatStringify } from 'flatted';
import { createColors } from 'picocolors';
import { type WebSocket } from 'ws';
import { log } from './logger';
import { captureScreenshot } from './screenshot';
import type { Platform } from './types';

const isColorEnabled = !process.env.CI && !!process.stdout.isTTY;
const pc = createColors(isColorEnabled);

/** Per-pause context — values that may have shifted since the controller was constructed. */
export interface PauseStartContext {
  deviceId: string | undefined;
  outputDir: string;
}

export class PauseController {
  private isPaused = false;
  private stdinHandler: ((data: Buffer) => void) | null = null;
  private fileWatcher: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly platform: Platform,
    // Socket is read asynchronously when the user resumes (Enter or signal
    // file), so it must be a live reference — passing a WebSocket at start()
    // time would capture a stale handle by resume() time.
    private readonly getSocket: () => WebSocket | null,
  ) {}

  start(msg: { label?: string; screenshot?: boolean }, ctx: PauseStartContext): void {
    this.isPaused = true;

    const label = msg.label ? `: ${msg.label}` : '';
    log.info('');
    log.info(pc.bold(pc.yellow(`⏸  PAUSED${label}`)));
    log.info('Component is rendered on device. Edit files — HMR will update live.');
    log.info(`Resume: Press ${pc.cyan('Enter')} or use the resume button in the UI`);

    if (msg.screenshot !== false) {
      try {
        const result = captureScreenshot({
          platform: this.platform,
          name: 'paused',
          deviceId: ctx.deviceId,
        });
        log.info(`Screenshot: ${pc.cyan(result.filePath)}`);
      } catch (err) {
        log.warn(`Auto-screenshot failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    log.info('');

    if (process.stdin.isTTY) {
      this.stdinHandler = () => {
        if (this.isPaused) this.resume();
      };
      process.stdin.setRawMode(false);
      process.stdin.resume();
      process.stdin.once('data', this.stdinHandler);
    }

    const signalPath = resolve(ctx.outputDir, 'resume-signal');
    this.fileWatcher = setInterval(() => {
      if (existsSync(signalPath)) {
        try {
          unlinkSync(signalPath);
        } catch {
          /* ignore */
        }
        if (this.isPaused) this.resume();
      }
    }, 500);
  }

  /** Called when the device reports it has resumed on its own. */
  end(): void {
    this.cleanup();
    if (this.isPaused) {
      this.isPaused = false;
      log.info(pc.green('Resumed'));
    }
  }

  /** Called from the Node side (Enter key / signal file) to unblock the device. */
  private resume(): void {
    this.cleanup();
    this.isPaused = false;
    this.getSocket()?.send(flatStringify({ type: 'resume' }));
    log.info(pc.green('Resumed'));
  }

  cleanup(): void {
    if (this.stdinHandler) {
      process.stdin.removeListener('data', this.stdinHandler);
      this.stdinHandler = null;
      if (process.stdin.isTTY) {
        process.stdin.pause();
      }
    }
    if (this.fileWatcher) {
      clearInterval(this.fileWatcher);
      this.fileWatcher = null;
    }
  }
}
