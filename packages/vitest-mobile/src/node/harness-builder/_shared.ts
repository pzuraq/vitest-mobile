/**
 * Internals shared by the iOS and Android halves of the harness builder.
 * Constants, types, command runners, and small filesystem helpers.
 *
 * Kept separate so `ios.ts` and `android.ts` don't have to import each
 * other (or `index.ts`, which would be a cycle).
 */

import { execSync, spawn, type ExecSyncOptions } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { log, getLogSink } from '../logger';
import type { Platform } from '../types';

export const HARNESS_BUNDLE_ID = 'com.vitest.mobile.harness';
export const HARNESS_APP_NAME = 'VitestMobileApp';
export const DEFAULT_BUILD_TIMEOUT = 30 * 60 * 1000; // 30 minutes

export interface HarnessBuildOptions {
  platform: Platform;
  /** React Native version (e.g. '0.81.5'). Auto-detected if not specified. */
  reactNativeVersion: string;
  /** Additional native modules to include (e.g. ['react-native-reanimated']). */
  nativeModules: string[];
  /** Path to vitest-mobile package root (for VitestMobileHarness pod). */
  packageRoot: string;
  /** User's project root (for reading node_modules). */
  projectRoot: string;
}

export interface HarnessBuildResult {
  /** Path to the built .app (iOS) or .apk (Android). */
  binaryPath: string;
  /** Bundle ID of the harness app. */
  bundleId: string;
  /** Whether this was a cache hit (no build needed). */
  cached: boolean;
  /** Deterministic cache key derived from platform, RN version, native modules, and harness version. */
  cacheKey: string;
  /**
   * Absolute path to the scaffolded harness project directory
   * (`<cache>/builds/<key>/project`). Used as the anchor for resolving
   * `@react-native/metro-config` (and other RN-template-provided packages)
   * when Metro boots.
   */
  projectDir: string;
}

/** Run a command synchronously and return trimmed stdout. */
export function run(cmd: string, opts: ExecSyncOptions = {}): string {
  log.verbose(`$ ${cmd}`);
  const start = Date.now();
  const result = (
    execSync(cmd, {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: DEFAULT_BUILD_TIMEOUT,
      env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
      ...opts,
    }) as string
  ).trim();
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  log.verbose(`  ✓ ${elapsed}s`);
  const sink = getLogSink();
  if (sink && result) {
    sink.write(`$ ${cmd}\n${result}\n`);
  }
  return result;
}

/**
 * Like {@link run}, but streams output. When a log sink is active (the CLI
 * wrapped this invocation in a spinner), child output is streamed live to
 * the log file via async spawn — this keeps the Node event loop free so
 * the spinner can animate and SIGINT reaches this process. Without this
 * the terminal would appear frozen for the full xcodebuild / gradle
 * runtime and Ctrl+C wouldn't interrupt.
 */
export async function runLive(cmd: string, opts: ExecSyncOptions = {}): Promise<void> {
  log.verbose(`$ ${cmd}`);
  const sink = getLogSink();
  const baseOpts = {
    timeout: DEFAULT_BUILD_TIMEOUT,
    env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
    ...opts,
  };

  if (!sink) {
    execSync(cmd, { encoding: 'utf8', stdio: 'inherit', ...baseOpts });
    return;
  }

  sink.write(`$ ${cmd}\n`);
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn('sh', ['-c', cmd], {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...baseOpts,
    });
    child.stdout?.on('data', chunk => sink.write(chunk));
    child.stderr?.on('data', chunk => sink.write(chunk));
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolvePromise();
      else reject(new Error(`Command failed with exit code ${code ?? 'null'}: ${cmd}`));
    });
  });
}

/** Walk up from startDir looking for `node_modules/<modulePath>`. */
export function resolveNodeModule(startDir: string, modulePath: string): string | null {
  let dir = startDir;
  for (;;) {
    const candidate = resolve(dir, 'node_modules', modulePath);
    if (existsSync(candidate)) return candidate;
    const parent = resolve(dir, '..');
    if (parent === dir) return null;
    dir = parent;
  }
}

export function readInstalledVersion(projectRoot: string, pkg: string): string | null {
  const pkgPath = resolveNodeModule(projectRoot, `${pkg}/package.json`);
  if (!pkgPath) return null;
  try {
    const pkgJson = JSON.parse(readFileSync(pkgPath, 'utf8'));
    return pkgJson.version;
  } catch {
    return null;
  }
}

export function getDirSizeSync(dir: string): number {
  let size = 0;
  try {
    const output = execSync(`du -sk "${dir}" 2>/dev/null || echo "0"`, {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 30_000,
    }).trim();
    size = parseInt(output.split('\t')[0] ?? '0', 10) * 1024;
  } catch {
    size = 0;
  }
  return size;
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
