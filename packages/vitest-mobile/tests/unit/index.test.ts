import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Plugin } from 'vite';
import type { VitestPluginContext } from 'vitest/node';

// pool is a heavy module with side effects — mock it so nativePlugin tests
// stay unit-level and don't spin up WS servers.
vi.mock('../../src/node/pool', () => ({
  createNativePoolWorker: vi.fn(() => ({ name: 'native' })),
}));

import { nativePlugin } from '../../src/node/index';
import { createNativePoolWorker } from '../../src/node/pool';

/** Simulates `configureVitest` after Vitest has merged `test` into `project.config`. */
function runConfigure(
  plugin: Plugin,
  initial: Record<string, unknown> = {},
): { projectConfig: Record<string, unknown> } {
  const projectConfig: Record<string, unknown> = { ...initial };
  const vitest = {
    watcher: { unregisterWatcher: vi.fn() },
    rerunFiles: vi.fn(),
  };
  const p = plugin as Plugin & { configureVitest: (c: VitestPluginContext) => void };
  p.configureVitest({
    vitest,
    project: { config: projectConfig },
  } as unknown as VitestPluginContext);
  return { projectConfig };
}

/** Inspect the (options, internal) pair the plugin handed to the pool factory. */
function lastCall(): { options: Record<string, unknown>; internal: Record<string, unknown> } {
  const calls = vi.mocked(createNativePoolWorker).mock.calls;
  const [options, internal] = calls[calls.length - 1] as unknown as [Record<string, unknown>, Record<string, unknown>];
  return { options, internal };
}

// ── detectMode (private, tested via nativePlugin behaviour) ───────────────────

describe('detectMode', () => {
  const origArgv = process.argv;
  const origCI = process.env.CI;

  beforeEach(() => {
    process.argv = [...origArgv];
    delete process.env.CI;
    vi.mocked(createNativePoolWorker).mockClear();
  });

  afterEach(() => {
    process.argv = origArgv;
    if (origCI !== undefined) process.env.CI = origCI;
    else delete process.env.CI;
  });

  it('reports dev mode when CI is unset and argv lacks "run"', () => {
    const plugin = nativePlugin({});
    const { projectConfig: cfg } = runConfigure(plugin);
    (cfg.poolRunner as { createPoolWorker: () => void }).createPoolWorker();
    expect(lastCall().internal.mode).toBe('dev');
  });

  it('reports run mode when CI env var is set', () => {
    process.env.CI = '1';
    const plugin = nativePlugin({});
    const { projectConfig: cfg } = runConfigure(plugin);
    (cfg.poolRunner as { createPoolWorker: () => void }).createPoolWorker();
    expect(lastCall().internal.mode).toBe('run');
  });

  it('reports run mode when argv contains "run"', () => {
    process.argv = [...origArgv, 'run'];
    const plugin = nativePlugin({});
    const { projectConfig: cfg } = runConfigure(plugin);
    (cfg.poolRunner as { createPoolWorker: () => void }).createPoolWorker();
    expect(lastCall().internal.mode).toBe('run');
  });
});

// ── nativePlugin ──────────────────────────────────────────────────────────────

describe('nativePlugin', () => {
  beforeEach(() => {
    vi.mocked(createNativePoolWorker).mockClear();
    delete process.env.CI;
  });

  it('returns a Vite plugin named vitest-mobile', () => {
    const plugin = nativePlugin();
    expect(plugin.name).toBe('vitest-mobile');
  });

  it('registers a custom pool on project.config', () => {
    const plugin = nativePlugin();
    const { projectConfig: cfg } = runConfigure(plugin);
    expect(cfg.pool).toBe('native');
    expect(cfg.poolRunner).toBeDefined();
    expect(typeof (cfg.poolRunner as { createPoolWorker: () => void }).createPoolWorker).toBe('function');
  });

  it('sets isolate: false and maxWorkers to 1 so the whole run is one task', () => {
    const plugin = nativePlugin();
    const { projectConfig: cfg } = runConfigure(plugin);
    expect(cfg.isolate).toBe(false);
    expect(cfg.maxWorkers).toBe(1);
  });

  it('does not override test.isolate when the user has already set it', () => {
    const plugin = nativePlugin();
    const { projectConfig: cfg } = runConfigure(plugin, { isolate: true });
    expect(cfg.isolate).toBe(true);
  });

  it('sets default test.include when none is present', () => {
    const plugin = nativePlugin();
    const { projectConfig: cfg } = runConfigure(plugin);
    const include = cfg.include as string[];
    expect(include).toContain('**/native-tests/**/*.test.tsx');
    expect(include).toContain('**/native-tests/**/*.test.ts');
  });

  it('does not override test.include when already set', () => {
    const plugin = nativePlugin();
    const { projectConfig: cfg } = runConfigure(plugin, { include: ['my-tests/**/*.test.ts'] });
    const include = cfg.include as string[];
    expect(include).toEqual(['my-tests/**/*.test.ts']);
  });

  it('passes through undefined port/platform/metroPort when the user does not set them', () => {
    // Defaulting lives in withDefaults() inside the pool; the plugin just
    // forwards what the user supplied (see options.test.ts for defaults).
    const plugin = nativePlugin();
    const { projectConfig: cfg } = runConfigure(plugin);
    (cfg.poolRunner as { createPoolWorker: () => void }).createPoolWorker();
    const { options } = lastCall();
    expect(options.port).toBeUndefined();
    expect(options.metroPort).toBeUndefined();
    expect(options.platform).toBeUndefined();
  });

  it('applies custom options (port, platform, metroPort)', () => {
    const plugin = nativePlugin({ port: 9999, platform: 'ios', metroPort: 9090 });
    const { projectConfig: cfg } = runConfigure(plugin);
    (cfg.poolRunner as { createPoolWorker: () => void }).createPoolWorker();
    const { options } = lastCall();
    expect(options.port).toBe(9999);
    expect(options.platform).toBe('ios');
    expect(options.metroPort).toBe(9090);
  });

  it('passes nested device/harness/metro groups through to the pool', () => {
    const plugin = nativePlugin({
      device: { preferredDeviceId: 'iPhone 15', headless: true },
      harness: { reactNativeVersion: '0.81.5', nativeModules: ['react-native-reanimated'] },
      metro: { bundle: true },
    });
    const { projectConfig: cfg } = runConfigure(plugin);
    (cfg.poolRunner as { createPoolWorker: () => void }).createPoolWorker();
    const { options } = lastCall();
    expect(options.device).toMatchObject({ preferredDeviceId: 'iPhone 15', headless: true });
    expect(options.harness).toMatchObject({
      reactNativeVersion: '0.81.5',
      nativeModules: ['react-native-reanimated'],
    });
    expect(options.metro).toMatchObject({ bundle: true });
  });

  it('mirrors project.config.include into internal.testPatterns', () => {
    const plugin = nativePlugin();
    const { projectConfig: cfg } = runConfigure(plugin, { include: ['custom/**/*.test.ts'] });
    (cfg.poolRunner as { createPoolWorker: () => void }).createPoolWorker();
    expect(lastCall().internal.testPatterns).toEqual(['custom/**/*.test.ts']);
  });

  it('sets internal.appDir from process.cwd()', () => {
    const plugin = nativePlugin();
    const { projectConfig: cfg } = runConfigure(plugin);
    (cfg.poolRunner as { createPoolWorker: () => void }).createPoolWorker();
    expect(lastCall().internal.appDir).toBe(process.cwd());
  });
});
