import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
    const result = await resolveInstanceResources(
      { platform: 'ios', port: undefined, metroPort: undefined },
      { appDir },
    );
    expect(result.metroPort).not.toBe(8081);
    expect(result.port).toBeGreaterThan(0);
    expect(result.instanceDir).toContain('.vitest-mobile/instances/');
  });

  it('respects explicit ports when available', async () => {
    const appDir = mkdtempSync(join(tmpdir(), 'vm-instance-'));
    const result = await resolveInstanceResources({ platform: 'android', port: 21901, metroPort: 21902 }, { appDir });
    expect(result.port).toBe(21901);
    expect(result.metroPort).toBe(21902);
  });

  it('blocks explicit ports already used by active instance', async () => {
    const appDir = mkdtempSync(join(tmpdir(), 'vm-instance-'));
    registerInstanceRecord(
      { platform: 'ios' },
      { appDir },
      {
        instanceId: 'test-active',
        port: 22901,
        metroPort: 22902,
        instanceDir: join(appDir, '.vitest-mobile', 'instances', 'test-active'),
      },
    );

    await expect(
      resolveInstanceResources({ platform: 'ios', port: 22901, metroPort: undefined }, { appDir }),
    ).rejects.toThrow(/WebSocket port 22901 is already in use/);

    await expect(
      resolveInstanceResources({ platform: 'ios', port: undefined, metroPort: 22902 }, { appDir }),
    ).rejects.toThrow(/Metro port 22902 is already in use/);

    releaseInstanceRecord(appDir, 'test-active');
  });

  it('prunes dead pid records', () => {
    const appDir = mkdtempSync(join(tmpdir(), 'vm-instance-'));
    // `registerInstanceRecord` always uses `process.pid`, so to simulate a
    // dead record we write the `instances.json` file directly with a pid
    // that's guaranteed not to resolve to a live process.
    const stateFile = join(appDir, '.vitest-mobile', 'instances.json');
    mkdirSync(dirname(stateFile), { recursive: true });
    writeFileSync(
      stateFile,
      JSON.stringify({
        instances: [
          {
            instanceId: 'dead',
            pid: 999999,
            platform: 'android',
            wsPort: 23901,
            metroPort: 23902,
            outputDir: join(appDir, '.vitest-mobile', 'instances', 'dead'),
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ],
      }),
    );
    const active = pruneAndGetActiveInstances(appDir);
    expect(active.find(i => i.instanceId === 'dead')).toBeUndefined();
  });
});
