import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  registerInstanceRecord,
  releaseInstanceRecord,
  resolveInstanceResources,
  pruneAndGetActiveInstances,
} from '../../src/node/instance-manager';

describe('instance-manager', () => {
  it('allocates non-8081 metro port by default', async () => {
    const appDir = mkdtempSync(join(tmpdir(), 'vm-instance-'));
    const result = await resolveInstanceResources({
      appDir,
      platform: 'ios',
    });
    expect(result.metroPort).not.toBe(8081);
    expect(result.wsPort).toBeGreaterThan(0);
    expect(result.outputDir).toContain('.vitest-mobile/instances/');
  });

  it('respects explicit ports when available', async () => {
    const appDir = mkdtempSync(join(tmpdir(), 'vm-instance-'));
    const result = await resolveInstanceResources({
      appDir,
      platform: 'android',
      wsPort: 21901,
      metroPort: 21902,
    });
    expect(result.wsPort).toBe(21901);
    expect(result.metroPort).toBe(21902);
  });

  it('blocks explicit ports already used by active instance', async () => {
    const appDir = mkdtempSync(join(tmpdir(), 'vm-instance-'));
    registerInstanceRecord(appDir, {
      instanceId: 'test-active',
      pid: process.pid,
      platform: 'ios',
      wsPort: 22901,
      metroPort: 22902,
      outputDir: join(appDir, '.vitest-mobile', 'instances', 'test-active'),
    });

    await expect(
      resolveInstanceResources({
        appDir,
        platform: 'ios',
        wsPort: 22901,
      }),
    ).rejects.toThrow(/WebSocket port 22901 is already in use/);

    await expect(
      resolveInstanceResources({
        appDir,
        platform: 'ios',
        metroPort: 22902,
      }),
    ).rejects.toThrow(/Metro port 22902 is already in use/);

    releaseInstanceRecord(appDir, 'test-active');
  });

  it('prunes dead pid records', () => {
    const appDir = mkdtempSync(join(tmpdir(), 'vm-instance-'));
    registerInstanceRecord(appDir, {
      instanceId: 'dead',
      pid: 999999,
      platform: 'android',
      wsPort: 23901,
      metroPort: 23902,
      outputDir: join(appDir, '.vitest-mobile', 'instances', 'dead'),
    });
    const active = pruneAndGetActiveInstances(appDir);
    expect(active.find(i => i.instanceId === 'dead')).toBeUndefined();
  });
});
