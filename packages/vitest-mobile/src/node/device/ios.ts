/**
 * iOS device driver — simulator lifecycle, app management, snapshots.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { log } from '../logger';
import { run } from '../exec-utils';
import { getCacheDir } from '../paths';
import type { DeviceOptions } from '../types';
import type { DeviceDriver } from './index';
import { DEFAULT_BUNDLE_ID, isPortListening, promptConfirm, errorMessage } from './shared';

// ── Types ────────────────────────────────────────────────────────

interface SimctlDeviceEntry {
  state?: string;
  isAvailable?: boolean;
  udid?: string;
  name?: string;
}

export interface SimulatorInfo {
  udid: string;
  name: string;
  runtime: string;
}

interface SimctlDevicesJson {
  devices: Record<string, SimctlDeviceEntry[]>;
}

interface SimctlDeviceTypeEntry {
  name?: string;
  identifier?: string;
}

interface SimctlRuntimeEntry {
  identifier?: string;
  isAvailable?: boolean;
}

// ── Simctl helpers ───────────────────────────────────────────────

function parseSimctlDevicesJson(json: string): SimctlDevicesJson | null {
  try {
    const data: unknown = JSON.parse(json);
    if (typeof data !== 'object' || data === null || !('devices' in data)) return null;
    const { devices } = data as { devices: unknown };
    if (typeof devices !== 'object' || devices === null) return null;
    const map = devices as Record<string, unknown>;
    const normalized: Record<string, SimctlDeviceEntry[]> = {};
    for (const [key, value] of Object.entries(map)) {
      if (!Array.isArray(value)) continue;
      normalized[key] = value as SimctlDeviceEntry[];
    }
    return { devices: normalized };
  } catch {
    return null;
  }
}

// ── Liveness detection ───────────────────────────────────────────

function getSimulatorMetroPort(udid: string, bundleId: string): number | null {
  try {
    const loc = run(`xcrun simctl spawn ${udid} defaults read ${bundleId} RCT_jsLocation`);
    if (!loc) return null;
    const match = loc.match(/:(\d+)$/);
    return match ? Number(match[1]) : null;
  } catch {
    return null;
  }
}

async function isSimulatorActivelyInUse(udid: string, bundleId: string): Promise<boolean> {
  const port = getSimulatorMetroPort(udid, bundleId);
  if (!port) return false;
  return isPortListening(port);
}

// ── Simulator listing / selection ────────────────────────────────

export function getBootedSimulator(): string | null {
  const info = getBootedSimulatorInfo();
  return info?.udid ?? null;
}

function getBootedSimulators(excludeIds: string[] = []): SimulatorInfo[] {
  const json = run('xcrun simctl list devices booted -j');
  if (!json) return [];
  const devices = parseSimctlDevicesJson(json);
  if (!devices) return [];
  const sims: SimulatorInfo[] = [];
  for (const [runtime, deviceList] of Object.entries(devices.devices)) {
    for (const device of deviceList) {
      if (device.state !== 'Booted' || !device.udid) continue;
      if (excludeIds.includes(device.udid)) continue;
      sims.push({
        udid: device.udid,
        name: device.name ?? 'Unknown',
        runtime: runtime.replace('com.apple.CoreSimulator.SimRuntime.', '').replace(/-/g, '.'),
      });
    }
  }
  return sims;
}

function getBootedSimulatorInfo(): SimulatorInfo | null {
  const json = run('xcrun simctl list devices booted -j');
  if (!json) return null;
  const devices = parseSimctlDevicesJson(json);
  if (!devices) return null;
  for (const [runtime, deviceList] of Object.entries(devices.devices)) {
    for (const device of deviceList) {
      if (device.state === 'Booted' && device.udid) {
        return {
          udid: device.udid,
          name: device.name ?? 'Unknown',
          runtime: runtime.replace('com.apple.CoreSimulator.SimRuntime.', '').replace(/-/g, '.'),
        };
      }
    }
  }
  return null;
}

function getFirstAvailableSimulator(excludeIds: string[] = []): string | null {
  const json = run('xcrun simctl list devices available -j');
  if (!json) return null;
  const devices = parseSimctlDevicesJson(json);
  if (!devices) return null;
  for (const runtime of Object.values(devices.devices)) {
    for (const device of runtime) {
      if (device.isAvailable && device.udid && !excludeIds.includes(device.udid)) return device.udid;
    }
  }
  return null;
}

function chooseIOSDeviceTypeIdentifier(): string | null {
  const json = run('xcrun simctl list devicetypes -j');
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as { devicetypes?: SimctlDeviceTypeEntry[] };
    const list = parsed.devicetypes ?? [];
    const iphone = list.find(d => d.identifier?.includes('iPhone'));
    return iphone?.identifier ?? null;
  } catch {
    return null;
  }
}

function chooseIOSRuntimeIdentifier(): string | null {
  const json = run('xcrun simctl list runtimes -j');
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as { runtimes?: SimctlRuntimeEntry[] };
    const list = (parsed.runtimes ?? []).filter(r => r.isAvailable && r.identifier?.includes('iOS'));
    return list[0]?.identifier ?? null;
  } catch {
    return null;
  }
}

// ── Simulator creation ───────────────────────────────────────────

function createIOSSimulator(instanceId?: string): string {
  const deviceType = chooseIOSDeviceTypeIdentifier();
  const runtime = chooseIOSRuntimeIdentifier();
  if (!deviceType || !runtime) {
    throw new Error('Unable to find a compatible iOS device type/runtime for simulator creation.');
  }

  const nameSuffix = (instanceId ?? Date.now().toString(36)).slice(-6);
  const name = `VitestMobile-${nameSuffix}`;
  log.info(`Creating iOS simulator: ${name} (${deviceType}, ${runtime})`);
  const created = run(`xcrun simctl create "${name}" "${deviceType}" "${runtime}"`);
  if (!created) {
    throw new Error('Failed to create a new iOS simulator definition.');
  }
  return created.trim();
}

async function maybeCreatePersistentIOSSimulator(instanceId?: string): Promise<string | null> {
  const confirmed = await promptConfirm(
    'No reusable iOS simulator is available. Create a new persistent simulator definition?',
  );
  if (!confirmed) return null;
  return createIOSSimulator(instanceId);
}

function listIOSSimulatorsByPrefix(prefix: string): string[] {
  const json = run('xcrun simctl list devices -j');
  if (!json) return [];
  const devices = parseSimctlDevicesJson(json);
  if (!devices) return [];
  const ids: string[] = [];
  for (const runtime of Object.values(devices.devices)) {
    for (const device of runtime) {
      if (!device.udid || !device.name) continue;
      if (device.name.startsWith(prefix)) ids.push(device.udid);
    }
  }
  return ids;
}

// ── Boot ─────────────────────────────────────────────────────────

async function bootIOSSimulator(opts: {
  deviceId?: string;
  bundleId?: string;
  headless?: boolean;
  promptForNewDevice?: boolean;
  instanceId?: string;
}): Promise<string> {
  if (opts.deviceId) return opts.deviceId;
  const bid = opts.bundleId ?? DEFAULT_BUNDLE_ID;

  const booted = getBootedSimulators();
  for (const sim of booted) {
    if (!(await isSimulatorActivelyInUse(sim.udid, bid))) {
      log.verbose(`Reusing free simulator: ${sim.name} (${sim.udid})`);
      if (!opts.headless) openSimulatorApp();
      return sim.udid;
    }
  }

  const bootedUdids = booted.map(s => s.udid);
  let simId = getFirstAvailableSimulator(bootedUdids) ?? undefined;
  if (!simId) {
    if (opts.promptForNewDevice === false) {
      throw new Error('No available iOS simulators found and creating a new one is disabled.');
    }
    if (opts.headless) {
      simId = createIOSSimulator(opts.instanceId);
    } else {
      simId = (await maybeCreatePersistentIOSSimulator(opts.instanceId)) ?? undefined;
    }
  }
  if (!simId) {
    throw new Error('No available iOS simulators found and simulator creation was declined.');
  }

  log.info(`Booting iOS simulator ${simId}...`);
  run(`xcrun simctl boot ${simId}`);

  for (let i = 0; i < 30; i++) {
    const bootedNow = getBootedSimulators();
    if (bootedNow.some(s => s.udid === simId)) {
      log.info('Simulator is ready');
      if (!opts.headless) openSimulatorApp();
      return simId;
    }
    await new Promise<void>(r => setTimeout(r, 2000));
  }
  throw new Error('iOS simulator did not boot in time');
}

function openSimulatorApp(): void {
  try {
    execSync('open -a Simulator', { stdio: 'pipe' });
  } catch {
    /* non-fatal */
  }
}

// ── App lifecycle ────────────────────────────────────────────────

function launchIOSApp(bundleId: string, metroPort: number, deviceId?: string): void {
  const simId = deviceId || getBootedSimulator();
  if (!simId) {
    throw new Error('No booted iOS simulator — cannot launch app');
  }
  log.verbose(`Launching ${bundleId} on ${simId}...`);
  run(`xcrun simctl terminate ${simId} ${bundleId}`);
  run(`xcrun simctl spawn ${simId} defaults write ${bundleId} RCT_jsLocation "127.0.0.1:${metroPort}"`);

  try {
    execSync(`xcrun simctl launch ${simId} ${bundleId}`, { encoding: 'utf8', stdio: 'pipe' });
    log.verbose('App launched');
  } catch (e: unknown) {
    log.error('Failed to launch iOS app:', errorMessage(e));
  }
}

function stopIOSApp(bundleId: string, deviceId?: string): void {
  const simId = deviceId || getBootedSimulator();
  if (simId) {
    try {
      run(`xcrun simctl terminate ${simId} ${bundleId}`);
    } catch {
      /* ignore */
    }
  }
}

function getIOSInstalledCacheKey(bundleId: string, deviceId?: string): string | null {
  try {
    const target = deviceId ?? 'booted';
    const containerPath = run(`xcrun simctl get_app_container ${target} ${bundleId}`);
    if (!containerPath) return null;
    const value = run(`plutil -extract VitestMobileCacheKey raw "${resolve(containerPath, 'Info.plist')}"`);
    return value || null;
  } catch {
    return null;
  }
}

// ── Device Snapshots ─────────────────────────────────────────────

function simulatorDeviceDir(udid: string): string {
  return join(homedir(), 'Library', 'Developer', 'CoreSimulator', 'Devices', udid);
}

function deviceSnapshotDir(cacheKey: string): string {
  return resolve(getCacheDir(), 'device-snapshots', cacheKey);
}

export async function saveDeviceSnapshot(cacheKey: string, deviceId?: string): Promise<string | null> {
  const udid = deviceId ?? getBootedSimulator();
  if (!udid) {
    log.warn('No booted iOS simulator — skipping snapshot save');
    return null;
  }

  const snapDir = deviceSnapshotDir(cacheKey);
  mkdirSync(snapDir, { recursive: true });

  log.info(`Saving device snapshot (${cacheKey.slice(0, 12)}...)...`);

  const wasBooted = getBootedSimulators().some(s => s.udid === udid);
  if (wasBooted) {
    run(`xcrun simctl shutdown ${udid}`);
    for (let i = 0; i < 15; i++) {
      if (!getBootedSimulators().some(s => s.udid === udid)) break;
      await new Promise<void>(r => setTimeout(r, 1000));
    }
  }

  const dataDir = join(simulatorDeviceDir(udid), 'data');
  const snapshotFile = join(snapDir, 'snapshot.tar');

  if (!existsSync(dataDir)) {
    log.warn(`Simulator data directory not found: ${dataDir}`);
    return null;
  }

  execSync(`tar cf "${snapshotFile}" -C "${dataDir}" .`, { stdio: 'pipe', timeout: 120_000 });

  const runtimeInfo = chooseIOSRuntimeIdentifier();
  writeFileSync(
    join(snapDir, 'metadata.json'),
    JSON.stringify({ udid, runtime: runtimeInfo, savedAt: new Date().toISOString() }),
  );

  if (wasBooted) {
    run(`xcrun simctl boot ${udid}`);
    for (let i = 0; i < 30; i++) {
      if (getBootedSimulators().some(s => s.udid === udid)) break;
      await new Promise<void>(r => setTimeout(r, 2000));
    }
  }

  cleanStaleSnapshots(cacheKey);
  log.info('Device snapshot saved');
  return snapshotFile;
}

export async function restoreDeviceSnapshot(
  cacheKey: string,
  opts: { headless?: boolean } = {},
): Promise<string | null> {
  const snapDir = deviceSnapshotDir(cacheKey);
  const snapshotFile = join(snapDir, 'snapshot.tar');
  const metadataFile = join(snapDir, 'metadata.json');

  if (!existsSync(snapshotFile) || !existsSync(metadataFile)) {
    log.verbose('No device snapshot for this cache key');
    return null;
  }

  log.info(`Restoring device from snapshot (${cacheKey.slice(0, 12)}...)...`);

  const runtime = chooseIOSRuntimeIdentifier();
  let metadata: { runtime?: string };
  try {
    metadata = JSON.parse(readFileSync(metadataFile, 'utf8'));
  } catch {
    log.warn('Corrupt snapshot metadata — discarding');
    rmSync(snapDir, { recursive: true, force: true });
    return null;
  }

  if (runtime && metadata.runtime && metadata.runtime !== runtime) {
    log.warn(`Runtime changed (${metadata.runtime} → ${runtime}) — discarding snapshot`);
    rmSync(snapDir, { recursive: true, force: true });
    return null;
  }

  let udid = getFirstAvailableSimulator(getBootedSimulators().map(s => s.udid));
  let createdNewSim = false;

  if (udid) {
    log.verbose(`Reusing existing simulator ${udid} for snapshot restore`);
    run(`xcrun simctl shutdown ${udid}`);
  } else {
    const deviceType = chooseIOSDeviceTypeIdentifier();
    if (!deviceType || !runtime) {
      log.warn('Could not find compatible device type/runtime for snapshot restore');
      return null;
    }
    log.verbose(`Creating snapshot simulator: deviceType=${deviceType} runtime=${runtime}`);
    try {
      udid =
        execSync(`xcrun simctl create "VitestMobile-snapshot" "${deviceType}" "${runtime}"`, {
          encoding: 'utf8',
          stdio: 'pipe',
          timeout: 60_000,
        })?.trim() ?? null;
    } catch (e: unknown) {
      log.warn(`Failed to create simulator for snapshot restore: ${errorMessage(e)}`);
      return null;
    }
    if (!udid) {
      log.warn('simctl create returned empty UDID');
      return null;
    }
    createdNewSim = true;
  }

  const dataDir = join(simulatorDeviceDir(udid), 'data');
  try {
    execSync(`tar xf "${snapshotFile}" -C "${dataDir}"`, { stdio: 'pipe', timeout: 120_000 });
  } catch (e: unknown) {
    log.warn(`Failed to restore snapshot data: ${errorMessage(e)}`);
    if (createdNewSim) {
      try {
        run(`xcrun simctl delete ${udid}`);
      } catch {
        /* ignore */
      }
    }
    return null;
  }

  log.info(`Booting simulator from snapshot (${udid})...`);
  run(`xcrun simctl boot ${udid}`);

  for (let i = 0; i < 30; i++) {
    if (getBootedSimulators().some(s => s.udid === udid)) {
      if (!opts.headless) openSimulatorApp();
      log.info('Simulator restored from snapshot (app pre-installed)');
      return udid;
    }
    await new Promise<void>(r => setTimeout(r, 2000));
  }

  log.warn('Snapshot-restored simulator did not boot in time');
  if (createdNewSim) {
    try {
      run(`xcrun simctl delete ${udid}`);
    } catch {
      /* ignore */
    }
  }
  return null;
}

function cleanStaleSnapshots(currentKey: string): void {
  const parentDir = resolve(getCacheDir(), 'device-snapshots');
  if (!existsSync(parentDir)) return;
  try {
    const entries = execSync(`ls "${parentDir}"`, { encoding: 'utf8', stdio: 'pipe' }).trim().split('\n');
    for (const entry of entries) {
      if (entry && entry !== currentKey) {
        rmSync(resolve(parentDir, entry), { recursive: true, force: true });
      }
    }
  } catch {
    /* best-effort cleanup */
  }
}

// ── Auto-created device management ───────────────────────────────

export function listAutoCreatedDeviceIds(): string[] {
  return listIOSSimulatorsByPrefix('VitestMobile-');
}

export function cleanupAutoCreatedDevices(): string[] {
  const ids = listAutoCreatedDeviceIds();
  const removed: string[] = [];
  for (const id of ids) {
    const deleted = run(`xcrun simctl delete ${id}`);
    if (deleted !== null) removed.push(id);
  }
  return removed;
}

// ── DeviceDriver implementation ──────────────────────────────────

export const iosDriver: DeviceDriver = {
  async ensureDevice(opts: DeviceOptions): Promise<string | undefined> {
    return bootIOSSimulator({
      deviceId: opts.deviceId,
      bundleId: opts.bundleId,
      headless: opts.headless,
      promptForNewDevice: opts.promptForNewDevice,
      instanceId: opts.instanceId,
    });
  },

  launchApp(bundleId: string, opts: { metroPort?: number; deviceId?: string } = {}): void {
    launchIOSApp(bundleId, opts.metroPort ?? 18081, opts.deviceId);
  },

  stopApp(bundleId: string, deviceId?: string): void {
    stopIOSApp(bundleId, deviceId);
  },

  getInstalledCacheKey(bundleId: string, deviceId?: string): string | null {
    return getIOSInstalledCacheKey(bundleId, deviceId);
  },

  isDeviceOnline(): boolean {
    return getBootedSimulator() !== null;
  },

  getBootedDeviceId(): string | null {
    return getBootedSimulator();
  },
};
