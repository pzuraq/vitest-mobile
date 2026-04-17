import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}));

vi.mock('../../src/node/logger', () => ({
  log: { info: vi.fn(), verbose: vi.fn(), warn: vi.fn(), error: vi.fn() },
  setVerbose: vi.fn(),
  isVerbose: vi.fn(() => false),
}));

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    readFileSync: vi.fn((...args: unknown[]) => {
      const path = String(args[0]);
      if (path.includes('android-device-')) throw new Error('ENOENT');
      return actual.readFileSync(...(args as Parameters<typeof actual.readFileSync>));
    }),
    writeFileSync: vi.fn(),
    existsSync: vi.fn((p: string) => {
      if (String(p).includes('device.lock')) return false;
      return actual.existsSync(p);
    }),
    unlinkSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

// Ports that should appear "in use" (a server is listening)
let portsInUse = new Set<number>();

vi.mock('node:net', async importOriginal => {
  const actual = await importOriginal<typeof import('node:net')>();
  return {
    ...actual,
    connect: vi.fn((port: number, _host: string) => {
      const emitter = new EventEmitter() as EventEmitter & { destroy: ReturnType<typeof vi.fn> };
      setTimeout(() => {
        if (portsInUse.has(port)) {
          emitter.emit('connect');
        } else {
          emitter.emit('error', new Error('ECONNREFUSED'));
        }
      }, 0);
      emitter.destroy = vi.fn();
      return emitter;
    }),
  };
});

import { execSync } from 'node:child_process';
import { launchApp, stopApp, ensureDevice } from '../../src/node/device';

const mockExec = vi.mocked(execSync);

function execReturns(value: string): void {
  mockExec.mockImplementation(() => value);
}

beforeEach(() => {
  vi.resetAllMocks();
  portsInUse = new Set();
  delete process.env.ANDROID_HOME;
  delete process.env.ANDROID_SDK_ROOT;
});

// ── launchApp ────────────────────────────────────────────────────────────────

describe('launchApp', () => {
  it('android: launches via monkey with bundle ID', async () => {
    execReturns('');
    await launchApp('android', 'com.example.app', { metroPort: 8081 });
    const calls = mockExec.mock.calls.map(c => String(c[0]));
    const monkey = calls.find(c => c.includes('monkey'));
    expect(monkey).toBeDefined();
    expect(monkey).toContain('com.example.app');
  });

  it('android: uses serial when provided', async () => {
    execReturns('');
    await launchApp('android', 'com.vitest.app', { deviceId: 'emulator-5556' });
    const calls = mockExec.mock.calls.map(c => String(c[0]));
    const monkey = calls.find(c => c.includes('monkey'));
    expect(monkey).toContain('-s emulator-5556');
  });

  it('android: force-stops the app before launching', async () => {
    execReturns('');
    await launchApp('android', 'com.example.app');
    const calls = mockExec.mock.calls.map(c => String(c[0]));
    const forceStop = calls.find(c => c.includes('force-stop'));
    expect(forceStop).toContain('com.example.app');
  });

  it('ios: sends xcrun simctl launch with bundle ID and metro port', () => {
    const simctlJson = JSON.stringify({
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-17-0': [{ udid: 'TEST-UDID-1234', state: 'Booted', isAvailable: true }],
      },
    });
    mockExec.mockImplementation(() => simctlJson);

    launchApp('ios', 'com.example.app', { metroPort: 8081 });

    const calls = mockExec.mock.calls.map(c => String(c[0]));
    const launch = calls.find(c => c.includes('simctl launch'));
    expect(launch).toBeDefined();
    expect(launch).toContain('com.example.app');
    expect(calls.some(c => c.includes('RCT_jsLocation') && c.includes('127.0.0.1:8081'))).toBe(true);
  });

  it('ios: sets RCT_jsLocation with non-default metro port', () => {
    const simctlJson = JSON.stringify({
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-17-0': [{ udid: 'TEST-UDID-1234', state: 'Booted', isAvailable: true }],
      },
    });
    mockExec.mockImplementation(() => simctlJson);

    launchApp('ios', 'com.example.app', { metroPort: 18081 });

    const calls = mockExec.mock.calls.map(c => String(c[0]));
    expect(calls.some(c => c.includes('RCT_jsLocation') && c.includes('127.0.0.1:18081'))).toBe(true);
  });

  it('ios: terminates running instance before re-launching', () => {
    const simctlJson = JSON.stringify({
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-17-0': [{ udid: 'TEST-UDID-1234', state: 'Booted', isAvailable: true }],
      },
    });
    mockExec.mockImplementation(() => simctlJson);

    launchApp('ios', 'com.example.app');

    const calls = mockExec.mock.calls.map(c => String(c[0]));
    const terminate = calls.find(c => c.includes('simctl terminate'));
    expect(terminate).toBeDefined();
    expect(terminate).toContain('com.example.app');
  });
});

// ── stopApp ──────────────────────────────────────────────────────────────────

describe('stopApp', () => {
  it('android: sends adb force-stop', () => {
    execReturns('');
    stopApp('android', 'com.example.app');
    const calls = mockExec.mock.calls.map(c => String(c[0]));
    expect(calls.some(c => c.includes('force-stop') && c.includes('com.example.app'))).toBe(true);
  });

  it('android: does not throw if adb command fails', () => {
    mockExec.mockImplementation(() => {
      throw new Error('adb not found');
    });
    expect(() => stopApp('android', 'com.example.app')).not.toThrow();
  });

  it('ios: sends xcrun simctl terminate when a simulator is booted', () => {
    const simctlJson = JSON.stringify({
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-17-0': [{ udid: 'SIM-UDID', state: 'Booted', isAvailable: true }],
      },
    });
    mockExec.mockImplementation(() => simctlJson);
    stopApp('ios', 'com.example.app');
    const calls = mockExec.mock.calls.map(c => String(c[0]));
    expect(calls.some(c => c.includes('simctl terminate') && c.includes('com.example.app'))).toBe(true);
  });

  it('ios: does nothing if no simulator is booted', () => {
    const simctlJson = JSON.stringify({ devices: {} });
    mockExec.mockImplementation(() => simctlJson);
    expect(() => stopApp('ios', 'com.example.app')).not.toThrow();
  });
});

// ── ensureDevice ─────────────────────────────────────────────────────────────

describe('ensureDevice', () => {
  it('android: sets up ADB port reverse when device is already online', async () => {
    mockExec.mockImplementation((cmd: string) => {
      if (String(cmd).includes('adb devices')) {
        return 'List of devices attached\nemulator-5554\tdevice\n';
      }
      return '';
    });

    await ensureDevice('android', { wsPort: 7878, metroPort: 8081 });

    const calls = mockExec.mock.calls.map(c => String(c[0]));
    expect(calls.some(c => c.includes('reverse tcp:7878'))).toBe(true);
    expect(calls.some(c => c.includes('reverse tcp:8081'))).toBe(true);
  });

  it('android: does not boot emulator if device is already online', async () => {
    mockExec.mockImplementation((cmd: string) => {
      if (String(cmd).includes('adb devices')) {
        return 'List of devices attached\nemulator-5554\tdevice\n';
      }
      return '';
    });

    await ensureDevice('android', { wsPort: 7878, metroPort: 8081 });

    const calls = mockExec.mock.calls.map(c => String(c[0]));
    expect(calls.some(c => c.includes('wait-for-device'))).toBe(false);
  });

  it('ios: uses an already-booted simulator when it is free', async () => {
    const simctlJson = JSON.stringify({
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-17-0': [{ udid: 'BOOTED-SIM', state: 'Booted', isAvailable: true }],
      },
    });
    mockExec.mockImplementation(() => simctlJson);

    const selected = await ensureDevice('ios');
    expect(selected).toBe('BOOTED-SIM');

    const calls = mockExec.mock.calls.map(c => String(c[0]));
    expect(calls.some(c => c.includes('simctl boot'))).toBe(false);
  });

  it('ios: skips booted simulator when its Metro port is listening', async () => {
    const simctlJson = JSON.stringify({
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-17-0': [
          { udid: 'IN-USE-SIM', state: 'Booted', isAvailable: true },
          { udid: 'FREE-SIM', state: 'Booted', isAvailable: true },
        ],
      },
    });
    // defaults read returns a port for IN-USE-SIM, nothing for FREE-SIM
    mockExec.mockImplementation((cmd: string) => {
      const s = String(cmd);
      if (s.includes('defaults read') && s.includes('IN-USE-SIM')) return '127.0.0.1:18081';
      if (s.includes('defaults read') && s.includes('FREE-SIM')) {
        throw new Error('not set');
      }
      return simctlJson;
    });
    // Port 18081 is actively listening — IN-USE-SIM's Metro is alive
    portsInUse.add(18081);

    const selected = await ensureDevice('ios', { bundleId: 'com.vitest.mobile.harness' });
    expect(selected).toBe('FREE-SIM');
  });
});
