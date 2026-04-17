/**
 * Device management — platform-abstracted interface with iOS/Android drivers.
 */

import type { DeviceOptions, Platform } from '../types';
import { withDeviceLock } from './shared';
import {
  iosDriver,
  saveDeviceSnapshot as iosSaveDeviceSnapshot,
  restoreDeviceSnapshot as iosRestoreDeviceSnapshot,
  listAutoCreatedDeviceIds as iosListAutoCreatedDeviceIds,
  cleanupAutoCreatedDevices as iosCleanupAutoCreatedDevices,
} from './ios';
import { androidDriver } from './android';

// ── DeviceDriver interface ───────────────────────────────────────

export interface DeviceDriver {
  ensureDevice(opts: DeviceOptions): Promise<string | undefined>;
  launchApp(bundleId: string, opts?: { metroPort?: number; deviceId?: string }): void | Promise<void>;
  stopApp(bundleId: string, deviceId?: string): void;
  getInstalledCacheKey(bundleId: string, deviceId?: string): string | null;
  isDeviceOnline(): boolean;
  getBootedDeviceId(): string | null;
}

export function getDriver(platform: Platform): DeviceDriver {
  return platform === 'ios' ? iosDriver : androidDriver;
}

// ── Backward-compatible public API ───────────────────────────────
// These re-exports maintain the same function signatures as the old
// monolithic device.ts so existing callers don't need to change.

export async function ensureDevice(platform: Platform, opts: DeviceOptions = {}): Promise<string | undefined> {
  return withDeviceLock(() => getDriver(platform).ensureDevice(opts));
}

export async function launchApp(
  platform: Platform,
  bundleId: string,
  opts: { metroPort?: number; deviceId?: string } = {},
): Promise<void> {
  await getDriver(platform).launchApp(bundleId, opts);
}

export function stopApp(platform: Platform, bundleId: string, deviceId?: string): void {
  getDriver(platform).stopApp(bundleId, deviceId);
}

export function getInstalledCacheKey(platform: Platform, bundleId: string, deviceId?: string): string | null {
  return getDriver(platform).getInstalledCacheKey(bundleId, deviceId);
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
  opts: { headless?: boolean } = {},
): Promise<string | null> {
  if (platform !== 'ios') return null;
  return iosRestoreDeviceSnapshot(cacheKey, opts);
}

export function listAutoCreatedDeviceIds(platform: Platform): string[] {
  if (platform !== 'ios') return [];
  return iosListAutoCreatedDeviceIds();
}

export function cleanupAutoCreatedDevices(platform: Platform): string[] {
  if (platform !== 'ios') return [];
  return iosCleanupAutoCreatedDevices();
}

// Re-export shared utilities used by other modules
export { isPortListening } from './shared';

// Re-export platform-specific helpers used by screenshot.ts
export { getBootedSimulator } from './ios';
export type { SimulatorInfo } from './ios';
export { isAndroidDeviceOnline } from './android';
