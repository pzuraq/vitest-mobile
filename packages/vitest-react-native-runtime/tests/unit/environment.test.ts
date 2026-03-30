import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
  };
});

import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  checkNode,
  checkJava,
  checkAndroidSDK,
  checkAndroidDevice,
  checkSimulator,
  checkEnvironment,
} from '../../src/node/environment';

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(existsSync).mockReturnValue(false);
  delete process.env.ANDROID_HOME;
  delete process.env.ANDROID_SDK_ROOT;
});

describe('checkNode', () => {
  it('returns ok for the current Node when major is >= 18 (version-dependent)', () => {
    const major = Number.parseInt(process.version.slice(1), 10);
    const result = checkNode();
    if (major >= 18) {
      expect(result).toEqual({
        ok: true,
        message: `Node ${process.version}`,
      });
    } else {
      expect(result.ok).toBe(false);
      expect(result.message).toContain('18+ is required');
    }
  });
});

describe('checkJava', () => {
  it('returns ok with Java 17 message when version output is 17+', () => {
    vi.mocked(execSync).mockReturnValue('openjdk version "17.0.1" 2021-10-19\n');
    expect(checkJava()).toEqual({ ok: true, message: 'Java 17' });
  });

  it('returns not ok when major version is below 17', () => {
    vi.mocked(execSync).mockReturnValue('openjdk version "11.0.1" 2021-04-20\n');
    const result = checkJava();
    expect(result.ok).toBe(false);
    expect(result.message).toBe('Java 11 found, but 17+ is required');
    expect(result.fix).toBeDefined();
  });

  it('returns not found when execSync throws', () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });
    const result = checkJava();
    expect(result.ok).toBe(false);
    expect(result.message).toBe('Java not found (required for Android builds)');
    expect(result.fix).toBeDefined();
  });
});

describe('checkAndroidSDK', () => {
  it('returns ok when which adb and adb version succeed', () => {
    vi.mocked(execSync).mockImplementation((cmd: string | Uint8Array | URL) => {
      const c = String(cmd);
      if (c === 'which adb') return '/opt/android/platform-tools/adb\n';
      if (c === '/opt/android/platform-tools/adb version') {
        return 'Android Debug Bridge version 1.0.41\n';
      }
      throw new Error('unexpected');
    });
    const result = checkAndroidSDK();
    expect(result.ok).toBe(true);
    expect(result.message).toBe('Android SDK found');
    expect(result.detail).toBe('Android Debug Bridge version 1.0.41');
  });

  it('returns not ok when adb cannot be resolved and SDK home is missing', () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('not found');
    });
    vi.mocked(existsSync).mockReturnValue(false);
    const result = checkAndroidSDK();
    expect(result.ok).toBe(false);
    expect(result.message).toBe('Android SDK not found');
  });
});

describe('checkAndroidDevice', () => {
  it('returns ok when adb devices lists an online device', () => {
    vi.mocked(execSync).mockReturnValue('List of devices attached\nemulator-5554\tdevice\n');
    expect(checkAndroidDevice()).toEqual({
      ok: true,
      message: 'Android device connected',
    });
  });

  it('returns autoFixable when no device rows are online', () => {
    vi.mocked(execSync).mockReturnValue('List of devices attached\n');
    const result = checkAndroidDevice();
    expect(result.ok).toBe(false);
    expect(result.autoFixable).toBe(true);
    expect(result.message).toBe('No Android device/emulator running');
    expect(result.fix).toBeDefined();
  });
});

describe('checkSimulator', () => {
  it('returns ok when simctl JSON includes a Booted device', () => {
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    const bootedJson = JSON.stringify({
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-18-0': [{ state: 'Booted', name: 'iPhone 16' }],
      },
    });
    vi.mocked(execSync).mockReturnValue(bootedJson);
    expect(checkSimulator()).toEqual({
      ok: true,
      message: 'iOS simulator running',
    });
    platformSpy.mockRestore();
  });

  it('returns autoFixable when JSON parses but nothing is Booted', () => {
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    const json = JSON.stringify({
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-18-0': [{ state: 'Shutdown', name: 'iPhone 16' }],
      },
    });
    vi.mocked(execSync).mockReturnValue(json);
    const result = checkSimulator();
    expect(result.ok).toBe(false);
    expect(result.autoFixable).toBe(true);
    expect(result.message).toBe('No iOS simulator running');
    platformSpy.mockRestore();
  });

  it('on non-darwin returns macOS-only message without calling simctl', () => {
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    const result = checkSimulator();
    expect(result).toEqual({
      ok: false,
      message: 'iOS simulators require macOS',
    });
    expect(execSync).not.toHaveBeenCalled();
    platformSpy.mockRestore();
  });
});

describe('checkEnvironment', () => {
  it('returns ok when android checks pass (non-blocking)', () => {
    vi.mocked(execSync).mockImplementation((cmd: string | Uint8Array | URL) => {
      const c = String(cmd);
      if (c === 'which adb') return '/fake/adb\n';
      if (c === '/fake/adb version') return 'Android Debug Bridge version 1.0.41\n';
      if (c === 'java -version 2>&1') return 'openjdk version "17.0.1"\n';
      if (c === 'which emulator') return '/fake/emulator\n';
      if (c === '"/fake/emulator" -list-avds') return 'Pixel_API_35\n';
      if (c === 'adb devices') {
        return 'List of devices attached\nemulator-5554\tdevice\n';
      }
      throw new Error(`unexpected: ${c}`);
    });

    const result = checkEnvironment('android');
    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.checks.map(x => x.name)).toEqual(['Node.js', 'Android SDK', 'Java', 'Emulator', 'AVD', 'Device']);
    const deviceCheck = result.checks.find(x => x.name === 'Device');
    expect(deviceCheck?.ok).toBe(true);
  });

  it('returns not ok with blocking issues when Java is too old', () => {
    vi.mocked(execSync).mockImplementation((cmd: string | Uint8Array | URL) => {
      const c = String(cmd);
      if (c === 'which adb') return '/fake/adb\n';
      if (c === '/fake/adb version') return 'Android Debug Bridge version 1.0.41\n';
      if (c === 'java -version 2>&1') return 'openjdk version "11.0.1"\n';
      if (c === 'which emulator') return '/fake/emulator\n';
      if (c === '"/fake/emulator" -list-avds') return 'Pixel_API_35\n';
      if (c === 'adb devices') {
        return 'List of devices attached\nemulator-5554\tdevice\n';
      }
      throw new Error(`unexpected: ${c}`);
    });

    const result = checkEnvironment('android');
    expect(result.ok).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toEqual(expect.objectContaining({ name: 'Java', ok: false }));
  });
});
