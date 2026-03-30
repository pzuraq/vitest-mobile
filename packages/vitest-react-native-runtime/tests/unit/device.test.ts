import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}));

vi.mock('../../src/node/logger', () => ({
  log: { info: vi.fn(), verbose: vi.fn(), warn: vi.fn(), error: vi.fn() },
  setVerbose: vi.fn(),
  isVerbose: vi.fn(() => false),
}));

import { execSync } from 'node:child_process';
import { launchApp, stopApp, shutdownDevice, ensureDevice, didPoolBootDevice } from '../../src/node/device';

const mockExec = vi.mocked(execSync);

// Convenience: make execSync return a string (simulating a successful command)
function execReturns(value: string): void {
  mockExec.mockReturnValue(value as any);
}

beforeEach(() => {
  vi.resetAllMocks();
  delete process.env.ANDROID_HOME;
  delete process.env.ANDROID_SDK_ROOT;
});

// ── launchApp ────────────────────────────────────────────────────────────────

describe('launchApp', () => {
  it('android: sends am start with bundle ID and metro port', () => {
    execReturns('');
    launchApp('android', 'com.example.app', { metroPort: 8081 });
    const calls = mockExec.mock.calls.map(c => String(c[0]));
    const amStart = calls.find(c => c.includes('am start'));
    expect(amStart).toBeDefined();
    expect(amStart).toContain('com.example.app');
    expect(amStart).toContain('8081');
  });

  it('android: uses default metroPort 8081 when not specified', () => {
    execReturns('');
    launchApp('android', 'com.vitest.app');
    const calls = mockExec.mock.calls.map(c => String(c[0]));
    const amStart = calls.find(c => c.includes('am start'));
    expect(amStart).toContain('8081');
  });

  it('android: force-stops the app before launching', () => {
    execReturns('');
    launchApp('android', 'com.example.app');
    const calls = mockExec.mock.calls.map(c => String(c[0]));
    const forceStop = calls.find(c => c.includes('force-stop'));
    expect(forceStop).toContain('com.example.app');
  });

  it('ios: sends xcrun simctl launch with bundle ID and metro port', () => {
    // Make getBootedSimulator return a UDID
    const simctlJson = JSON.stringify({
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-17-0': [{ udid: 'TEST-UDID-1234', state: 'Booted', isAvailable: true }],
      },
    });
    mockExec.mockReturnValue(simctlJson as any);

    launchApp('ios', 'com.example.app', { metroPort: 8081 });

    const calls = mockExec.mock.calls.map(c => String(c[0]));
    const launch = calls.find(c => c.includes('simctl launch'));
    expect(launch).toBeDefined();
    expect(launch).toContain('com.example.app');
    expect(launch).toContain('8081');
  });

  it('ios: terminates running instance before re-launching', () => {
    const simctlJson = JSON.stringify({
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-17-0': [{ udid: 'TEST-UDID-1234', state: 'Booted', isAvailable: true }],
      },
    });
    mockExec.mockReturnValue(simctlJson as any);

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
    mockExec.mockReturnValue(simctlJson as any);
    stopApp('ios', 'com.example.app');
    const calls = mockExec.mock.calls.map(c => String(c[0]));
    expect(calls.some(c => c.includes('simctl terminate') && c.includes('com.example.app'))).toBe(true);
  });

  it('ios: does nothing if no simulator is booted', () => {
    // xcrun returns empty devices
    const simctlJson = JSON.stringify({ devices: {} });
    mockExec.mockReturnValue(simctlJson as any);
    expect(() => stopApp('ios', 'com.example.app')).not.toThrow();
  });
});

// ── shutdownDevice ───────────────────────────────────────────────────────────

describe('shutdownDevice', () => {
  it('android: does NOT call adb emu kill if pool did not boot the emulator', () => {
    // didPoolBootDevice() is false at module init (and after any previous shutdown)
    expect(didPoolBootDevice()).toBe(false);
    execReturns('');
    shutdownDevice('android');
    const calls = mockExec.mock.calls.map(c => String(c[0]));
    expect(calls.some(c => c.includes('emu kill'))).toBe(false);
  });

  it('ios: does NOT call simctl shutdown if pool did not boot the simulator', () => {
    expect(didPoolBootDevice()).toBe(false);
    execReturns('');
    shutdownDevice('ios');
    const calls = mockExec.mock.calls.map(c => String(c[0]));
    expect(calls.some(c => c.includes('simctl shutdown'))).toBe(false);
  });
});

// ── ensureDevice ─────────────────────────────────────────────────────────────

describe('ensureDevice', () => {
  it('android: sets up ADB port reverse when device is already online', async () => {
    // Make "adb devices" return an online device
    mockExec.mockImplementation((cmd: string) => {
      if (String(cmd).includes('adb devices')) {
        return 'List of devices attached\nemulator-5554\tdevice\n';
      }
      return '';
    });

    await ensureDevice('android', { wsPort: 7878, metroPort: 8081 });

    const calls = mockExec.mock.calls.map(c => String(c[0]));
    expect(calls.some(c => c.includes('adb reverse') && c.includes('7878'))).toBe(true);
    expect(calls.some(c => c.includes('adb reverse') && c.includes('8081'))).toBe(true);
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

  it('ios: uses an already-booted simulator', async () => {
    const simctlJson = JSON.stringify({
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-17-0': [{ udid: 'BOOTED-SIM', state: 'Booted', isAvailable: true }],
      },
    });
    mockExec.mockReturnValue(simctlJson as any);

    await ensureDevice('ios');

    const calls = mockExec.mock.calls.map(c => String(c[0]));
    // Should NOT have tried to boot a new simulator
    expect(calls.some(c => c.includes('simctl boot'))).toBe(false);
  });
});

// ── didPoolBootDevice ─────────────────────────────────────────────────────────

describe('didPoolBootDevice', () => {
  it('returns false initially (pool has not booted any device)', () => {
    expect(didPoolBootDevice()).toBe(false);
  });
});
