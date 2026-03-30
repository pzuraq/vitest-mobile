/**
 * E2E smoke tests — runs vitest against the repo's own app/ + modules/
 * to verify the full pool lifecycle end-to-end.
 *
 * Requires VITEST_E2E=1 and an Android emulator (or device).
 * Skips gracefully otherwise.
 */

import { describe, it, expect } from 'vitest';
import { execSync, type ExecSyncOptions } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dir, '../../../..');

const platform = (process.env.VITEST_E2E_PLATFORM ?? 'android') as 'android' | 'ios';
const vitestConfig = resolve(repoRoot, `vitest.config.${platform}.ts`);

const hasDevice = !!process.env.VITEST_E2E;
const maybeIt = hasDevice ? it : it.skip;

function runVitest(extraEnv: Record<string, string> = {}): { output: string; exitCode: number } {
  const opts: ExecSyncOptions = {
    cwd: repoRoot,
    encoding: 'utf-8',
    timeout: 120_000,
    env: { ...process.env, ...extraEnv },
  };
  // Merge stderr into stdout so we capture everything in one stream
  try {
    const output = execSync(`npx vitest run --config ${vitestConfig} 2>&1`, {
      ...opts,
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as string;
    return { output, exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { output: (e.stdout ?? '') + (e.stderr ?? ''), exitCode: e.status ?? 1 };
  }
}

describe('prerequisites', () => {
  it(`repo has a built ${platform} app`, () => {
    expect(existsSync(resolve(repoRoot, `app/${platform}`))).toBe(true);
  });

  it(`vitest ${platform} config exists`, () => {
    expect(existsSync(vitestConfig)).toBe(true);
  });

  it('test module exists', () => {
    expect(existsSync(resolve(repoRoot, 'modules/counter/tests/counter.test.tsx'))).toBe(true);
  });
});

describe('smoke: default run (requires VITEST_E2E=1 + emulator)', () => {
  maybeIt(
    'tests run, output is clean, and test info is present',
    () => {
      const { output } = runVitest();

      // Tests ran
      expect(output).toMatch(/\d+ passed/);

      // No internal debug noise
      expect(output).not.toContain('[expect-setup]');
      expect(output).not.toContain('[start] Context keys');
      expect(output).not.toContain('[runner] Importing');

      // Test file and suite show up
      expect(output).toContain('counter.test.tsx');
      expect(output).toContain('CounterModule');
    },
    120_000,
  );
});

describe('smoke: verbose mode (requires VITEST_E2E=1 + emulator)', () => {
  maybeIt(
    'verbose output includes pool debug info',
    () => {
      const { output } = runVitest({ VITEST_POOL_NATIVE_VERBOSE: '1' });

      expect(output).toContain('[vitest-react-native-runtime]');
      expect(output).toMatch(/Mode: run/);
    },
    120_000,
  );
});
