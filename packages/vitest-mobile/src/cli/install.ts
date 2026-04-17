import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDevice } from '../node/device';
import { getAdbPath } from '../node/exec-utils';
import { ensureHarnessBinary, detectReactNativeVersion } from '../node/harness-builder';
import type { HarnessBuildResult } from '../node/harness-builder';

const packageRoot = resolve(fileURLToPath(import.meta.url), '..', '..', '..');

export interface InstallOptions {
  appDir: string;
  /** Pre-built result from build command (skips rebuild). */
  buildResult?: HarnessBuildResult;
}

export async function install(platform: string, options: InstallOptions): Promise<void> {
  const appDir = resolve(process.cwd(), options.appDir);

  let binaryPath: string;
  let bundleId: string;

  if (options.buildResult) {
    binaryPath = options.buildResult.binaryPath;
    bundleId = options.buildResult.bundleId;
  } else {
    const rnVersion = detectReactNativeVersion(appDir);
    if (!rnVersion) {
      throw new Error(
        'Could not auto-detect React Native version (react-native not found in node_modules).\n' +
          'Install react-native first:\n  npm install react-native\n\n' +
          'Or set reactNativeVersion explicitly in your Vitest config:\n' +
          "  nativePlugin({ reactNativeVersion: '0.81.5' })",
      );
    }
    const result = await ensureHarnessBinary({
      platform: platform as 'ios' | 'android',
      reactNativeVersion: rnVersion,
      nativeModules: [],
      packageRoot,
      projectRoot: appDir,
    });
    binaryPath = result.binaryPath;
    bundleId = result.bundleId;
  }

  await ensureDevice(platform as 'ios' | 'android', { headless: false });

  console.log(`\nInstalling ${binaryPath}...\n`);

  if (platform === 'ios') {
    execSync(`xcrun simctl install booted "${binaryPath}"`, { stdio: 'inherit' });
  } else {
    execSync(`${getAdbPath()} install -r "${binaryPath}"`, { stdio: 'inherit' });
  }

  console.log(`\n${platform} harness app installed (${bundleId}).\n`);
}
