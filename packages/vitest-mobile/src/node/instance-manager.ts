import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import type { InternalPoolOptions, Platform, ResolvedNativePluginOptions, RuntimeState } from './types';

const INSTANCES_FILE = 'instances.json';
const DEFAULT_WS_BASE_PORT = 17878;
const DEFAULT_METRO_BASE_PORT = 18081;
const MAX_PORT_SCAN = 200;

export interface InstanceRecord {
  instanceId: string;
  pid: number;
  platform: Platform;
  /** Persisted name — kept as `wsPort` on disk for backward-compat with existing instances.json. */
  wsPort: number;
  metroPort: number;
  /** Per-instance directory. Persisted name — keeps backward-compat with existing instances.json. */
  outputDir: string;
  deviceId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ResolvedInstanceResources {
  instanceId: string;
  port: number;
  metroPort: number;
  instanceDir: string;
  activeInstances: InstanceRecord[];
}

interface InstancesFileShape {
  instances: InstanceRecord[];
}

function stateDir(appDir: string): string {
  return resolve(appDir, '.vitest-mobile');
}

function instancesFile(appDir: string): string {
  return join(stateDir(appDir), INSTANCES_FILE);
}

function ensureStateDir(appDir: string): void {
  mkdirSync(stateDir(appDir), { recursive: true });
}

function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function loadInstances(appDir: string): InstanceRecord[] {
  const filePath = instancesFile(appDir);
  if (!existsSync(filePath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as InstancesFileShape;
    if (!Array.isArray(parsed.instances)) return [];
    return parsed.instances.filter(i => !!i && typeof i.instanceId === 'string');
  } catch {
    return [];
  }
}

function saveInstances(appDir: string, instances: InstanceRecord[]): void {
  ensureStateDir(appDir);
  writeFileSync(instancesFile(appDir), JSON.stringify({ instances }, null, 2));
}

export function pruneAndGetActiveInstances(appDir: string): InstanceRecord[] {
  const all = loadInstances(appDir);
  const active = all.filter(i => isPidAlive(i.pid));
  if (active.length !== all.length) {
    saveInstances(appDir, active);
  }
  return active;
}

export function updateInstanceRecord(
  appDir: string,
  patch: Partial<InstanceRecord> & Pick<InstanceRecord, 'instanceId'>,
): void {
  const instances = pruneAndGetActiveInstances(appDir);
  const idx = instances.findIndex(i => i.instanceId === patch.instanceId);
  if (idx === -1) return;
  instances[idx] = {
    ...instances[idx],
    ...patch,
    updatedAt: Date.now(),
  };
  saveInstances(appDir, instances);
}

export function releaseInstanceRecord(appDir: string, instanceId: string): void {
  const instances = pruneAndGetActiveInstances(appDir);
  const next = instances.filter(i => i.instanceId !== instanceId);
  saveInstances(appDir, next);
}

async function isPortFree(port: number): Promise<boolean> {
  // Check both the IPv6 wildcard (::) and IPv4 localhost (127.0.0.1).
  // WebSocketServer binds on :: while Metro binds on 127.0.0.1, and on
  // macOS these are separate socket domains — a port can appear free on
  // one while taken on the other.
  const check = (host?: string) =>
    new Promise<boolean>(r => {
      const s = createServer();
      s.once('error', () => r(false));
      const cb = () => s.close(() => r(true));
      if (host) {
        s.listen(port, host, cb);
      } else {
        s.listen(port, cb);
      }
    });
  if (!(await check())) return false;
  if (!(await check('127.0.0.1'))) return false;
  return true;
}

async function ensureExplicitPortAvailable(
  port: number,
  label: 'WebSocket' | 'Metro',
  usedByActive: Set<number>,
): Promise<void> {
  if (usedByActive.has(port)) {
    throw new Error(`${label} port ${port} is already in use by another vitest-mobile instance.`);
  }
  const free = await isPortFree(port);
  if (!free) {
    throw new Error(`${label} port ${port} is not available on localhost.`);
  }
}

async function pickFreePort(
  preferredStart: number,
  usedByActive: Set<number>,
  skipPort: number | null,
  label: 'WebSocket' | 'Metro',
): Promise<number> {
  for (let i = 0; i < MAX_PORT_SCAN; i++) {
    const candidate = preferredStart + i;
    if (skipPort !== null && candidate === skipPort) continue;
    if (usedByActive.has(candidate)) continue;
    if (await isPortFree(candidate)) return candidate;
  }
  throw new Error(`Could not find a free ${label} port starting at ${preferredStart}.`);
}

function createInstanceId(platform: Platform): string {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 7);
  return `${platform}-${stamp}-${rand}`;
}

/**
 * Pick free WS/Metro ports, mint an instanceId, and make the per-instance
 * output directory. The caller should copy the return values onto the
 * pool's {@link RuntimeState}.
 */
export async function resolveInstanceResources(
  options: Pick<ResolvedNativePluginOptions, 'platform' | 'port' | 'metroPort'>,
  internal: Pick<InternalPoolOptions, 'appDir'>,
): Promise<ResolvedInstanceResources> {
  const { appDir } = internal;
  ensureStateDir(appDir);
  const activeInstances = pruneAndGetActiveInstances(appDir);

  const usedWs = new Set(activeInstances.map(i => i.wsPort));
  const usedMetro = new Set(activeInstances.map(i => i.metroPort));

  let wsPort = options.port;
  let metroPort = options.metroPort;

  if (wsPort !== undefined) {
    await ensureExplicitPortAvailable(wsPort, 'WebSocket', usedWs);
  } else {
    wsPort = await pickFreePort(DEFAULT_WS_BASE_PORT, usedWs, null, 'WebSocket');
  }

  if (metroPort !== undefined) {
    await ensureExplicitPortAvailable(metroPort, 'Metro', usedMetro);
  } else {
    metroPort = await pickFreePort(DEFAULT_METRO_BASE_PORT, usedMetro, 8081, 'Metro');
  }

  const instanceId = createInstanceId(options.platform);
  const instanceDir = resolve(appDir, '.vitest-mobile', 'instances', instanceId);
  mkdirSync(instanceDir, { recursive: true });

  return { instanceId, port: wsPort, metroPort, instanceDir, activeInstances };
}

/**
 * Write this instance's record to `instances.json`. Reads identity from
 * the resolved {@link RuntimeState} and project root from {@link InternalPoolOptions}.
 * Fills in `pid: process.pid` internally.
 */
export function registerInstanceRecord(
  options: Pick<ResolvedNativePluginOptions, 'platform'>,
  internal: Pick<InternalPoolOptions, 'appDir'>,
  runtime: Pick<RuntimeState, 'instanceId' | 'port' | 'metroPort' | 'instanceDir' | 'deviceId'>,
): void {
  if (!runtime.instanceId || runtime.port === undefined || runtime.metroPort === undefined || !runtime.instanceDir) {
    throw new Error('registerInstanceRecord called before resolveInstanceResources populated runtime state');
  }
  const instances = pruneAndGetActiveInstances(internal.appDir);
  const now = Date.now();
  instances.push({
    instanceId: runtime.instanceId,
    pid: process.pid,
    platform: options.platform,
    wsPort: runtime.port,
    metroPort: runtime.metroPort,
    outputDir: runtime.instanceDir,
    deviceId: runtime.deviceId,
    createdAt: now,
    updatedAt: now,
  });
  saveInstances(internal.appDir, instances);
}
