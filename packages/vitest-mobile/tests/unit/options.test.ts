import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { withDefaults, DEFAULT_BUNDLE_ID } from '../../src/node/options';
import type { InternalPoolOptions } from '../../src/node/types';

function internal(overrides: Partial<InternalPoolOptions> = {}): InternalPoolOptions {
  const appDir = overrides.appDir ?? process.cwd();
  return {
    appDir,
    mode: 'run',
    testPatterns: ['**/*.test.ts'],
    outputDir: resolve(appDir, '.vitest-mobile'),
    ...overrides,
  };
}

describe('withDefaults', () => {
  it('fills in platform default', () => {
    const { options } = withDefaults({}, internal());
    expect(options.platform).toBe('android');
  });

  it('passes the plugin-computed internal bucket through untouched', () => {
    const supplied = internal({ appDir: '/tmp/demo' });
    const { internal: out } = withDefaults({}, supplied);
    expect(out.appDir).toBe('/tmp/demo');
    expect(out.mode).toBe('run');
    expect(out.outputDir).toBe(resolve('/tmp/demo', '.vitest-mobile'));
  });

  it('derives headless from internal.mode when not explicitly set', () => {
    expect(withDefaults({}, internal({ mode: 'run' })).options.device.headless).toBe(true);
    expect(withDefaults({}, internal({ mode: 'dev' })).options.device.headless).toBe(false);
  });

  it('respects an explicit device.headless override', () => {
    expect(withDefaults({ device: { headless: false } }, internal({ mode: 'run' })).options.device.headless).toBe(
      false,
    );
    expect(withDefaults({ device: { headless: true } }, internal({ mode: 'dev' })).options.device.headless).toBe(true);
  });

  it('defaults appConnectTimeout to 180 000', () => {
    expect(withDefaults({}, internal()).options.appConnectTimeout).toBe(180_000);
  });

  it('defaults harness.nativeModules to []', () => {
    expect(withDefaults({}, internal()).options.harness.nativeModules).toEqual([]);
  });

  it('seeds runtime.bundleId from detectBundleId — DEFAULT_BUNDLE_ID with no app.json', () => {
    const { runtime } = withDefaults({}, internal({ appDir: '/tmp/__vitest_mobile_missing__' }));
    expect(runtime.bundleId).toBe(DEFAULT_BUNDLE_ID);
  });

  it('honors an explicitly supplied harness.bundleIdOverride', () => {
    const { runtime } = withDefaults({ harness: { bundleIdOverride: 'com.example.custom' } }, internal());
    expect(runtime.bundleId).toBe('com.example.custom');
  });

  it('mirrors runtime.appDir from internal.appDir', () => {
    const { runtime } = withDefaults({}, internal({ appDir: '/tmp/demo' }));
    expect(runtime.appDir).toBe('/tmp/demo');
  });

  it('leaves runtime-resolved fields null/undefined before doStart', () => {
    const { runtime } = withDefaults({}, internal());
    expect(runtime.instanceId).toBeNull();
    expect(runtime.port).toBeUndefined();
    expect(runtime.metroPort).toBeUndefined();
    expect(runtime.instanceDir).toBeNull();
    expect(runtime.deviceId).toBeUndefined();
    expect(runtime.harnessProjectDir).toBeUndefined();
  });

  it('leaves genuinely-optional user options undefined', () => {
    const { options } = withDefaults({}, internal());
    expect(options.port).toBeUndefined();
    expect(options.metroPort).toBeUndefined();
    expect(options.device.preferredDeviceId).toBeUndefined();
    expect(options.harness.reactNativeVersion).toBeUndefined();
    expect(options.harness.app).toBeUndefined();
  });
});
