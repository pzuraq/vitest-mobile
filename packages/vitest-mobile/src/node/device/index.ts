/**
 * Device management — platform-abstracted interface with iOS/Android drivers.
 */

import { execSync } from 'node:child_process';
import type { DeviceOptions, Platform, RuntimeState } from '../types';
import { withDeviceLock } from './shared';
import { getAdbPath } from '../exec-utils';
import { log } from '../logger';
import {
  iosDriver,
  saveDeviceSnapshot as iosSaveDeviceSnapshot,
  restoreDeviceSnapshot as iosRestoreDeviceSnapshot,
  listAutoCreatedDeviceIds as iosListAutoCreatedDeviceIds,
  cleanupAutoCreatedDevices as iosCleanupAutoCreatedDevices,
  listProjectDeviceIds as iosListProjectDeviceIds,
  cleanupProjectDevices as iosCleanupProjectDevices,
} from './ios';
import {
  androidDriver,
  listAutoCreatedAvds,
  cleanupAutoCreatedAvds,
  listProjectAvds,
  cleanupProjectAvds,
} from './android';

// ── DeviceDriver interface ───────────────────────────────────────

export interface DeviceDriver {
  /**
   * Resolve a device for this run. Reads the user's device preferences
   * from `device` (headless, preferredDeviceId, apiLevel) and pool runtime
   * state from `runtime` (appDir, instanceId, port, metroPort, bundleId).
   * Returns the selected device id.
   */
  ensureDevice(runtime: RuntimeState, device: DeviceOptions): Promise<string | undefined>;
  /** Launch the harness app on `runtime.deviceId` against `runtime.metroPort`. */
  launchApp(runtime: RuntimeState): void | Promise<void>;
  /** Stop the harness app identified by `runtime.bundleId` on `runtime.deviceId`. */
  stopApp(runtime: RuntimeState): void;
  /** Read the cache-key baked into the currently-installed app on `runtime.deviceId`. */
  getInstalledCacheKey(runtime: RuntimeState): string | null;
}

export function getDriver(platform: Platform): DeviceDriver {
  return platform === 'ios' ? iosDriver : androidDriver;
}

// ── Public API ───────────────────────────────────────────────────

export async function ensureDevice(
  platform: Platform,
  runtime: RuntimeState,
  device: DeviceOptions = {},
): Promise<string | undefined> {
  return withDeviceLock(() => getDriver(platform).ensureDevice(runtime, device));
}

export async function launchApp(platform: Platform, runtime: RuntimeState): Promise<void> {
  await getDriver(platform).launchApp(runtime);
}

export function stopApp(platform: Platform, runtime: RuntimeState): void {
  getDriver(platform).stopApp(runtime);
}

export function getInstalledCacheKey(platform: Platform, runtime: RuntimeState): string | null {
  return getDriver(platform).getInstalledCacheKey(runtime);
}

/**
 * Install the harness binary onto the selected device. No-ops if the path is
 * empty (useful for test harnesses with no binary) or if the target device
 * already has a matching cached build. Errors are logged and swallowed — a
 * later launch will fail with a clearer message if the install really broke.
 */
export function installHarness(
  platform: Platform,
  runtime: RuntimeState,
  harness: { binaryPath: string; cacheKey?: string | null },
): void {
  if (!harness.binaryPath) return;

  if (harness.cacheKey) {
    const installed = getInstalledCacheKey(platform, runtime);
    if (installed === harness.cacheKey) {
      log.info('Harness binary already installed — skipping install');
      return;
    }
  }

  try {
    if (platform === 'ios') {
      const target = runtime.deviceId ?? 'booted';
      execSync(`xcrun simctl install ${target} "${harness.binaryPath}"`, { stdio: 'pipe' });
    } else if (platform === 'android') {
      const target = runtime.deviceId ? `-s ${runtime.deviceId} ` : '';
      execSync(`${getAdbPath()} ${target}install -r "${harness.binaryPath}"`, { stdio: 'pipe' });
    }
  } catch (e) {
    log.verbose(`Install may have failed (non-fatal if already installed): ${e}`);
  }
}

export async function saveDeviceSnapshot(
  platform: Platform,
  cacheKey: string,
  deviceId?: string,
): Promise<string | null> {
  if (platform !== 'ios') return null;
  return iosSaveDeviceSnapshot(cacheKey, deviceId);
}

export async function restoreDeviceSnapshot(
  platform: Platform,
  cacheKey: string,
  opts: { headless?: boolean; appDir?: string } = {},
): Promise<string | null> {
  if (platform !== 'ios') return null;
  return iosRestoreDeviceSnapshot(cacheKey, opts);
}

export function listAutoCreatedDeviceIds(platform: Platform): string[] {
  return platform === 'ios' ? iosListAutoCreatedDeviceIds() : listAutoCreatedAvds();
}

/**
 * Shutdown and delete every auto-created device for the platform.
 * Android cleanup is async (needs to kill running emulators cleanly first);
 * iOS is sync but wrapped here for a uniform async API.
 */
export async function cleanupAutoCreatedDevices(platform: Platform): Promise<string[]> {
  return platform === 'ios' ? iosCleanupAutoCreatedDevices() : cleanupAutoCreatedAvds();
}

/** List devices belonging to the given project. */
export function listProjectDeviceIds(platform: Platform, appDir: string): string[] {
  return platform === 'ios' ? iosListProjectDeviceIds(appDir) : listProjectAvds(appDir);
}

/** Shutdown and delete the given project's device(s). */
export async function cleanupProjectDevices(platform: Platform, appDir: string): Promise<string[]> {
  return platform === 'ios' ? iosCleanupProjectDevices(appDir) : cleanupProjectAvds(appDir);
}

// Re-export shared utilities used by other modules
export { isPortListening } from './shared';

// Re-export platform-specific helpers used by screenshot.ts
export { getBootedSimulator } from './ios';
export type { SimulatorInfo } from './ios';
export { isAndroidDeviceOnline } from './android';
