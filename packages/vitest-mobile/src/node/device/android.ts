/**
 * Android device driver — emulator lifecycle, app management, auto-provisioning.
 */

import { execSync, spawn, type ExecSyncOptions } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { log } from '../logger';
import { run, getAndroidHome, getAdbPath } from '../exec-utils';
import { getCacheDir } from '../paths';
import type { DeviceOptions } from '../types';
import type { DeviceDriver } from './index';
import { DEFAULT_BUNDLE_ID, isPortListening, isPidAlive, promptConfirm, errorMessage } from './shared';

let _adb: string | undefined;
function adb(): string {
  if (!_adb) _adb = getAdbPath();
  return _adb;
}

// ── Liveness detection ───────────────────────────────────────────

function getAndroidMetroPort(serial: string, bundleId: string): number | null {
  try {
    const raw = run(`${adb()} -s ${serial} shell "run-as ${bundleId} cat shared_prefs/.vitest-metro-port 2>/dev/null"`);
    if (!raw) return null;
    const port = Number(raw.trim());
    return Number.isFinite(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}

// ── Device claims ────────────────────────────────────────────────

function androidClaimPath(serial: string): string {
  return resolve(getCacheDir(), `android-device-${serial}.json`);
}

function claimAndroidDevice(serial: string, instanceId: string, metroPort: number): void {
  mkdirSync(getCacheDir(), { recursive: true });
  writeFileSync(androidClaimPath(serial), JSON.stringify({ pid: process.pid, instanceId, metroPort, ts: Date.now() }));
}

async function isAndroidDeviceActivelyInUse(
  serial: string,
  bundleId: string,
  currentInstanceId?: string,
): Promise<boolean> {
  let claimData: { instanceId?: string; metroPort?: number; pid?: number } | null = null;
  try {
    claimData = JSON.parse(readFileSync(androidClaimPath(serial), 'utf8'));
    if (currentInstanceId && claimData!.instanceId === currentInstanceId) return false;

    const claimPidAlive = claimData!.pid ? isPidAlive(claimData!.pid) : false;
    const metroListening = claimData!.metroPort ? await isPortListening(claimData!.metroPort) : false;

    if (metroListening) return true;
    if (claimPidAlive) return true;
    return false;
  } catch {
    /* no claim file or unreadable */
  }

  const port = getAndroidMetroPort(serial, bundleId);
  if (port && (await isPortListening(port))) return true;

  try {
    const pid = run(`${adb()} -s ${serial} shell pidof ${bundleId}`);
    return !!pid && pid.trim() !== '';
  } catch {
    return false;
  }
}

// ── Device listing ───────────────────────────────────────────────

export function isAndroidDeviceOnline(): boolean {
  return getAndroidOnlineSerials().length > 0;
}

export function getAndroidOnlineSerials(): string[] {
  const output = run(`${adb()} devices`);
  if (!output) return [];
  const lines = output.split('\n').slice(1);
  return lines
    .map(l => l.trim())
    .filter(Boolean)
    .filter(l => l.endsWith('\tdevice'))
    .map(l => l.split('\t')[0] ?? '')
    .filter(Boolean);
}

function androidEnv(): Record<string, string | undefined> {
  return { ...process.env, ANDROID_AVD_HOME: avdHome() };
}

function getAllAVDs(): string[] {
  const home = getAndroidHome();
  const emulatorBin = run('which emulator') || resolve(home, 'emulator/emulator');
  try {
    const avds = (
      execSync(`"${emulatorBin}" -list-avds`, {
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 15_000,
        env: androidEnv(),
      }) as string
    ).trim();
    if (avds) return avds.split('\n').filter(Boolean);
  } catch {
    /* emulator binary may not exist or may timeout */
  }

  const avdDir = avdHome();
  if (!existsSync(avdDir)) return [];
  try {
    const entries = execSync(`ls "${avdDir}"`, { encoding: 'utf8', stdio: 'pipe' }).trim();
    return entries
      .split('\n')
      .filter(e => e.endsWith('.ini') && !e.includes('.avd'))
      .map(e => e.replace(/\.ini$/, ''));
  } catch {
    return [];
  }
}

function getRunningEmulatorAVD(serial: string): string | null {
  try {
    const name = run(`${adb()} -s ${serial} emu avd name 2>/dev/null`);
    if (name) {
      const first = name.split('\n')[0]?.trim();
      if (first && first !== 'KO:') return first;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function pickEmulatorConsolePort(excludeSerials: string[]): number {
  const takenPorts = new Set(
    excludeSerials
      .map(s => s.match(/^emulator-(\d+)$/)?.[1])
      .filter(Boolean)
      .map(Number),
  );
  for (let port = 5554; port <= 5680; port += 2) {
    if (!takenPorts.has(port)) return port;
  }
  return 5554;
}

// ── Auto-provisioning ────────────────────────────────────────────

const DEFAULT_API_LEVEL = 35;
const DEFAULT_ARCH = 'x86_64';
const DEFAULT_TARGET = 'default';
const AUTO_AVD_NAME = 'vitest-mobile';

function findBin(name: string, subdirs: string[]): string {
  const home = getAndroidHome();
  for (const sub of subdirs) {
    const candidate = resolve(home, sub, name);
    if (existsSync(candidate)) return candidate;
  }
  return name;
}

function sdkManagerBin(): string {
  return findBin('sdkmanager', ['cmdline-tools/latest/bin', 'tools/bin']);
}

function avdManagerBin(): string {
  return findBin('avdmanager', ['cmdline-tools/latest/bin', 'tools/bin']);
}

function runLong(cmd: string, opts: ExecSyncOptions = {}): string {
  log.verbose(`$ ${cmd}`);
  return (execSync(cmd, { encoding: 'utf8', stdio: 'pipe', timeout: 300_000, ...opts }) as string).trim();
}

function systemImagePackage(apiLevel: number, target = DEFAULT_TARGET, arch = DEFAULT_ARCH): string {
  return `system-images;android-${apiLevel};${target};${arch}`;
}

function isSystemImageInstalled(apiLevel: number, target = DEFAULT_TARGET, arch = DEFAULT_ARCH): boolean {
  const home = getAndroidHome();
  return existsSync(resolve(home, 'system-images', `android-${apiLevel}`, target, arch));
}

function installSystemImage(apiLevel: number, target = DEFAULT_TARGET, arch = DEFAULT_ARCH): void {
  const pkg = systemImagePackage(apiLevel, target, arch);
  log.info(`Installing Android system image: ${pkg}`);
  const start = Date.now();
  try {
    runLong(`yes | ${sdkManagerBin()} --licenses`, { timeout: 60_000 });
  } catch {
    /* Non-fatal */
  }
  runLong(`${sdkManagerBin()} --install '${pkg}'`);
  log.info(`  System image installed (${((Date.now() - start) / 1000).toFixed(1)}s)`);
}

function avdHome(): string {
  if (process.env.ANDROID_AVD_HOME) return process.env.ANDROID_AVD_HOME;
  return resolve(getCacheDir(), 'avd');
}

function ensureAvd(apiLevel: number, target = DEFAULT_TARGET, arch = DEFAULT_ARCH): string {
  const existing = getAllAVDs();
  if (existing.includes(AUTO_AVD_NAME)) return AUTO_AVD_NAME;

  const pkg = systemImagePackage(apiLevel, target, arch);
  const avdBin = avdManagerBin();
  const avdDir = avdHome();

  log.info(`Creating AVD: ${AUTO_AVD_NAME} (API ${apiLevel}, ${arch})`);
  log.info(`  avdmanager: ${avdBin}`);
  log.info(`  AVD home: ${avdDir}`);

  mkdirSync(avdDir, { recursive: true });

  try {
    const output = runLong(`echo no | ${avdBin} create avd --force -n ${AUTO_AVD_NAME} --package '${pkg}'`, {
      env: androidEnv(),
    });
    if (output) log.verbose(`avdmanager: ${output}`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to create AVD:\n${msg}`);
  }

  const avdIni = resolve(avdDir, `${AUTO_AVD_NAME}.ini`);
  if (!existsSync(avdIni)) {
    let contents = '(directory does not exist)';
    if (existsSync(avdDir)) {
      try {
        contents = execSync(`ls -la "${avdDir}"`, { encoding: 'utf8', stdio: 'pipe' }).trim();
      } catch {
        contents = '(could not list)';
      }
    }
    throw new Error(
      `avdmanager reported success but AVD was not created.\n` +
        `  Expected: ${avdIni}\n` +
        `  AVD home (${avdDir}) contents:\n${contents}`,
    );
  }

  log.info(`  AVD created at ${avdDir}`);
  return AUTO_AVD_NAME;
}

function ensureAndroidEmulatorReady(apiLevel: number): string {
  if (!isSystemImageInstalled(apiLevel)) {
    installSystemImage(apiLevel);
  } else {
    log.verbose(`System image already installed for API ${apiLevel}`);
  }
  return ensureAvd(apiLevel);
}

function disableAndroidAnimations(serial: string): void {
  const target = `-s ${serial}`;
  try {
    run(`${adb()} ${target} shell settings put global window_animation_scale 0.0`);
    run(`${adb()} ${target} shell settings put global transition_animation_scale 0.0`);
    run(`${adb()} ${target} shell settings put global animator_duration_scale 0.0`);
    log.verbose('Disabled animations');
  } catch {
    log.verbose('Could not disable animations (non-fatal)');
  }
}

// ── Emulator boot ────────────────────────────────────────────────

function snapshotMarkerPath(avdName: string): string {
  return resolve(avdHome(), `${avdName}.avd`, '.vitest-snapshot-ready');
}

function hasAvdSnapshot(avdName: string): boolean {
  return existsSync(snapshotMarkerPath(avdName));
}

async function spawnAndWaitForBoot(
  emulatorBin: string,
  args: string[],
  expectedSerial: string,
  timeoutIterations = 90,
): Promise<import('node:child_process').ChildProcess> {
  if (!existsSync(emulatorBin)) {
    throw new Error(`Emulator binary not found: ${emulatorBin}`);
  }

  run(`${adb()} start-server`);

  let emulatorOutput = '';
  let spawnError: Error | null = null;
  const emuProc = spawn(emulatorBin, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    env: androidEnv(),
  });
  emuProc.on('error', (err: Error) => {
    spawnError = err;
  });
  emuProc.stdout?.on('data', (chunk: Buffer) => {
    emulatorOutput += chunk.toString();
  });
  emuProc.stderr?.on('data', (chunk: Buffer) => {
    emulatorOutput += chunk.toString();
  });
  emuProc.unref();
  (emuProc.stdout as NodeJS.ReadableStream & { unref?: () => void })?.unref?.();
  (emuProc.stderr as NodeJS.ReadableStream & { unref?: () => void })?.unref?.();

  log.verbose(`Waiting for ${expectedSerial} to boot (timeout: ${timeoutIterations * 2}s)...`);

  for (let i = 0; i < timeoutIterations; i++) {
    const online = getAndroidOnlineSerials();

    if (online.includes(expectedSerial)) {
      try {
        const prop = run(`${adb()} -s ${expectedSerial} shell getprop sys.boot_completed`);
        if (prop === '1') return emuProc;
      } catch {
        /* device not ready yet */
      }
    }

    if (spawnError) {
      throw new Error(`Failed to spawn emulator: ${(spawnError as Error).message}`);
    }
    if (emuProc.exitCode !== null) {
      throw new Error(
        `Emulator process exited with code ${emuProc.exitCode} before ${expectedSerial} came online.\n${emulatorOutput.slice(-500)}`,
      );
    }

    await new Promise<void>(r => setTimeout(r, 2000));
  }
  try {
    emuProc.kill();
  } catch {
    /* ignore */
  }
  throw new Error(`Emulator ${expectedSerial} did not finish booting in time.\n${emulatorOutput.slice(-1000)}`);
}

async function killEmulatorCleanly(serial: string): Promise<void> {
  run(`${adb()} -s ${serial} emu kill`);
  for (let i = 0; i < 15; i++) {
    const online = getAndroidOnlineSerials();
    if (!online.includes(serial)) return;
    await new Promise<void>(r => setTimeout(r, 1000));
  }
}

async function bootAndroidEmulator({
  headless = true,
  bundleId = DEFAULT_BUNDLE_ID,
  promptForNewDevice = true,
  excludeSerials = [],
  apiLevel,
}: {
  headless?: boolean;
  bundleId?: string;
  promptForNewDevice?: boolean;
  excludeSerials?: string[];
  apiLevel?: number;
} = {}): Promise<string> {
  let allAvds = getAllAVDs();

  if (apiLevel || (headless && allAvds.length === 0)) {
    ensureAndroidEmulatorReady(apiLevel ?? DEFAULT_API_LEVEL);
    allAvds = getAllAVDs();
  }

  if (allAvds.length === 0) {
    if (promptForNewDevice) {
      await promptConfirm(
        'No Android AVDs are available. Create an AVD in Android Studio, then rerun. Continue without creating now?',
      );
    }
    throw new Error('No Android AVDs available. Create one first.');
  }

  const runningAvdNames = new Set<string>();
  for (const serial of excludeSerials) {
    const name = getRunningEmulatorAVD(serial);
    if (name) runningAvdNames.add(name);
  }

  const preferredAvd = allAvds.find(a => !runningAvdNames.has(a)) ?? allAvds[0]!;

  const home = getAndroidHome();
  let emulatorBin = run('which emulator') || resolve(home, 'emulator/emulator');

  if (!existsSync(emulatorBin)) {
    log.info('Emulator binary not found, installing via sdkmanager...');
    runLong(`${sdkManagerBin()} --install emulator`);
    emulatorBin = resolve(home, 'emulator/emulator');
  }

  const consolePort = pickEmulatorConsolePort(excludeSerials);
  const expectedSerial = `emulator-${consolePort}`;

  const needsReadOnly = runningAvdNames.has(preferredAvd);
  const baseArgs = ['-avd', preferredAvd, '-no-audio', '-port', String(consolePort)];
  if (needsReadOnly) baseArgs.push('-read-only');

  if (headless) {
    baseArgs.push('-no-window', '-gpu', 'swiftshader_indirect', '-no-boot-anim');

    const snapshot = hasAvdSnapshot(preferredAvd);

    if (!snapshot) {
      log.info(`No snapshot found for ${preferredAvd} — performing warm-up boot...`);
      const warmupArgs = [...baseArgs, '-no-snapshot-load'];
      await spawnAndWaitForBoot(emulatorBin, warmupArgs, expectedSerial, 150);
      log.info('Warm-up boot complete, saving snapshot...');
      await killEmulatorCleanly(expectedSerial);
      writeFileSync(snapshotMarkerPath(preferredAvd), new Date().toISOString());
      log.info('Snapshot saved. Rebooting from snapshot...');
    } else {
      log.info(`Snapshot found for ${preferredAvd} — fast boot.`);
    }

    const prodArgs = [...baseArgs, '-no-snapshot-save'];
    log.info(`Booting emulator (headless): ${preferredAvd} on port ${consolePort}...`);
    await spawnAndWaitForBoot(emulatorBin, prodArgs, expectedSerial, 150);
  } else {
    log.info(`Booting emulator: ${preferredAvd} on port ${consolePort}...`);
    await spawnAndWaitForBoot(emulatorBin, baseArgs, expectedSerial);
  }

  log.info(`Emulator is ready (${expectedSerial})`);
  if (headless) disableAndroidAnimations(expectedSerial);
  return expectedSerial;
}

// ── Port setup ───────────────────────────────────────────────────

function setupAndroidPorts(wsPort: number, metroPort: number, deviceSerial?: string): void {
  const target = deviceSerial ? `-s ${deviceSerial} ` : '';
  try {
    run(`${adb()} ${target}reverse tcp:${wsPort} tcp:${wsPort}`);
    run(`${adb()} ${target}reverse tcp:${metroPort} tcp:${metroPort}`);
    log.verbose('ADB port reverse set up');
  } catch (e: unknown) {
    log.error('ADB reverse failed:', errorMessage(e));
  }
}

function writeAndroidDebugHost(bundleId: string, metroPort: number, deviceSerial?: string): void {
  const target = deviceSerial ? `-s ${deviceSerial} ` : '';
  try {
    const prefsXml = [
      '<?xml version="1.0" encoding="utf-8" standalone="yes" ?>',
      '<map>',
      `    <string name="debug_http_host">localhost:${metroPort}</string>`,
      '</map>',
    ].join('\n');
    execSync(
      `${adb()} ${target}shell "run-as ${bundleId} sh -c 'mkdir -p shared_prefs && cat > shared_prefs/${bundleId}_preferences.xml'"`,
      { input: prefsXml, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    // Sidecar file for vitest-mobile's own liveness detection (avoids parsing XML)
    execSync(
      `${adb()} ${target}shell "run-as ${bundleId} sh -c 'echo ${metroPort} > shared_prefs/.vitest-metro-port'"`,
      { encoding: 'utf8', stdio: 'pipe' },
    );
    log.verbose(`Set debug_http_host to localhost:${metroPort}`);
  } catch (e: unknown) {
    log.verbose(`Could not write debug_http_host (non-fatal): ${errorMessage(e)}`);
  }
}

// ── App lifecycle ────────────────────────────────────────────────

async function launchAndroidApp(bundleId: string, metroPort: number, deviceSerial?: string): Promise<void> {
  const target = deviceSerial ? `-s ${deviceSerial} ` : '';
  log.verbose(`Launching ${bundleId}...`);
  run(`${adb()} ${target}shell am force-stop ${bundleId}`);
  await new Promise<void>(r => setTimeout(r, 1000));
  writeAndroidDebugHost(bundleId, metroPort, deviceSerial);
  execSync(`${adb()} ${target}shell monkey -p ${bundleId} -c android.intent.category.LAUNCHER 1`, {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  log.verbose('App launched');
}

function stopAndroidApp(bundleId: string, deviceSerial?: string): void {
  const target = deviceSerial ? `-s ${deviceSerial} ` : '';
  try {
    run(`${adb()} ${target}shell am force-stop ${bundleId}`);
  } catch {
    /* ignore */
  }
}

function getAndroidInstalledCacheKey(bundleId: string, deviceId?: string): string | null {
  try {
    const target = deviceId ? `-s ${deviceId} ` : '';
    const dump = run(`${adb()} ${target}shell dumpsys package ${bundleId}`);
    if (!dump) return null;
    const match = dump.match(/vitest-mobile-cache-key.*?value=([^\s]+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

// ── DeviceDriver implementation ──────────────────────────────────

export const androidDriver: DeviceDriver = {
  async ensureDevice(opts: DeviceOptions): Promise<string | undefined> {
    const bundleId = opts.bundleId ?? DEFAULT_BUNDLE_ID;
    const wsPort = opts.wsPort ?? 7878;
    const metroPort = opts.metroPort ?? 18081;

    const online = getAndroidOnlineSerials();
    let selected = opts.deviceId ? online.find(s => s === opts.deviceId) : undefined;
    if (!selected) {
      for (const s of online) {
        if (!(await isAndroidDeviceActivelyInUse(s, bundleId, opts.instanceId))) {
          selected = s;
          break;
        }
      }
    }

    if (!selected) {
      selected = await bootAndroidEmulator({
        headless: opts.headless,
        bundleId,
        promptForNewDevice: opts.promptForNewDevice,
        excludeSerials: online,
        apiLevel: opts.apiLevel,
      });
    } else {
      log.verbose(`Android device already running (${selected})`);
    }

    claimAndroidDevice(selected!, opts.instanceId ?? 'unknown', metroPort);
    setupAndroidPorts(wsPort, metroPort, selected);
    writeAndroidDebugHost(bundleId, metroPort, selected);
    return selected;
  },

  async launchApp(bundleId: string, opts: { metroPort?: number; deviceId?: string } = {}): Promise<void> {
    await launchAndroidApp(bundleId, opts.metroPort ?? 18081, opts.deviceId);
  },

  stopApp(bundleId: string, deviceId?: string): void {
    stopAndroidApp(bundleId, deviceId);
  },

  getInstalledCacheKey(bundleId: string, deviceId?: string): string | null {
    return getAndroidInstalledCacheKey(bundleId, deviceId);
  },

  isDeviceOnline(): boolean {
    return getAndroidOnlineSerials().length > 0;
  },

  getBootedDeviceId(): string | null {
    const serials = getAndroidOnlineSerials();
    return serials[0] ?? null;
  },
};
