import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// pool is a heavy module with side effects — mock it so nativePlugin tests
// stay unit-level and don't spin up WS servers.
vi.mock('../../src/node/pool', () => ({
  createNativePoolWorker: vi.fn(() => ({ name: 'native' })),
}));

import { nativePlugin } from '../../src/node/index';
import { createNativePoolWorker } from '../../src/node/pool';

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

  it('defaults headless to false in dev mode (no CI, no run arg)', () => {
    const plugin = nativePlugin({});
    const config: Record<string, unknown> = {};
    (plugin as any).config(config);
    ((config as any).test as any).pool.createPoolWorker();
    expect(vi.mocked(createNativePoolWorker)).toHaveBeenCalledWith(
      expect.objectContaining({ headless: false, mode: 'dev' }),
    );
  });

  it('defaults headless to true when CI env var is set', () => {
    process.env.CI = '1';
    const plugin = nativePlugin({});
    const config: Record<string, unknown> = {};
    (plugin as any).config(config);
    ((config as any).test as any).pool.createPoolWorker();
    expect(vi.mocked(createNativePoolWorker)).toHaveBeenCalledWith(
      expect.objectContaining({ headless: true, mode: 'run' }),
    );
  });

  it('defaults headless to true when argv contains "run"', () => {
    process.argv = [...origArgv, 'run'];
    const plugin = nativePlugin({});
    const config: Record<string, unknown> = {};
    (plugin as any).config(config);
    ((config as any).test as any).pool.createPoolWorker();
    expect(vi.mocked(createNativePoolWorker)).toHaveBeenCalledWith(
      expect.objectContaining({ headless: true, mode: 'run' }),
    );
  });
});

// ── nativePlugin ──────────────────────────────────────────────────────────────

describe('nativePlugin', () => {
  beforeEach(() => {
    vi.mocked(createNativePoolWorker).mockClear();
    delete process.env.CI;
  });

  it('returns a Vite plugin named vitest-react-native-runtime', () => {
    const plugin = nativePlugin();
    expect((plugin as any).name).toBe('vitest-react-native-runtime');
  });

  it('sets test.pool on the config', () => {
    const plugin = nativePlugin();
    const config: Record<string, unknown> = {};
    (plugin as any).config(config);
    expect(((config as any).test as any).pool).toBeDefined();
    expect(typeof ((config as any).test as any).pool.createPoolWorker).toBe('function');
  });

  it('sets default test.include when none is present', () => {
    const plugin = nativePlugin();
    const config: Record<string, unknown> = {};
    (plugin as any).config(config);
    const include = ((config as any).test as any).include as string[];
    expect(include).toContain('**/native-tests/**/*.test.tsx');
    expect(include).toContain('**/native-tests/**/*.test.ts');
  });

  it('does not override test.include when already set', () => {
    const plugin = nativePlugin();
    const config = { test: { include: ['my-tests/**/*.test.ts'] } } as Record<string, unknown>;
    (plugin as any).config(config);
    const include = ((config as any).test as any).include as string[];
    expect(include).toEqual(['my-tests/**/*.test.ts']);
  });

  it('applies default options (port 7878, platform android, metroPort 8081)', () => {
    const plugin = nativePlugin();
    const config: Record<string, unknown> = {};
    (plugin as any).config(config);
    ((config as any).test as any).pool.createPoolWorker();
    expect(vi.mocked(createNativePoolWorker)).toHaveBeenCalledWith(
      expect.objectContaining({ port: 7878, platform: 'android', metroPort: 8081 }),
    );
  });

  it('applies custom options (port, platform, metroPort)', () => {
    const plugin = nativePlugin({ port: 9999, platform: 'ios', metroPort: 9090 });
    const config: Record<string, unknown> = {};
    (plugin as any).config(config);
    ((config as any).test as any).pool.createPoolWorker();
    expect(vi.mocked(createNativePoolWorker)).toHaveBeenCalledWith(
      expect.objectContaining({ port: 9999, platform: 'ios', metroPort: 9090 }),
    );
  });

  it('defaults skipIfUnavailable to false', () => {
    const plugin = nativePlugin();
    const config: Record<string, unknown> = {};
    (plugin as any).config(config);
    ((config as any).test as any).pool.createPoolWorker();
    expect(vi.mocked(createNativePoolWorker)).toHaveBeenCalledWith(
      expect.objectContaining({ skipIfUnavailable: false }),
    );
  });

  it('defaults bundleId to com.vitest.nativetest', () => {
    const plugin = nativePlugin();
    const config: Record<string, unknown> = {};
    (plugin as any).config(config);
    ((config as any).test as any).pool.createPoolWorker();
    expect(vi.mocked(createNativePoolWorker)).toHaveBeenCalledWith(
      expect.objectContaining({ bundleId: 'com.vitest.nativetest' }),
    );
  });

  it('passes testInclude from config.test.include to pool options', () => {
    const plugin = nativePlugin();
    const config = { test: { include: ['custom/**/*.test.ts'] } } as Record<string, unknown>;
    (plugin as any).config(config);
    ((config as any).test as any).pool.createPoolWorker();
    expect(vi.mocked(createNativePoolWorker)).toHaveBeenCalledWith(
      expect.objectContaining({ testInclude: ['custom/**/*.test.ts'] }),
    );
  });
});
