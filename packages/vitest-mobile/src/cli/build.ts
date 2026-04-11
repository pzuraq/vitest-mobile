import { resolve } from 'node:path';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ensureHarnessBinary, detectReactNativeVersion, getDefaultCacheDir } from '../node/harness-builder';
import type { HarnessBuildResult } from '../node/harness-builder';

const packageRoot = resolve(fileURLToPath(import.meta.url), '..', '..', '..');

export async function build(
  platform: string,
  options: { appDir: string; force: boolean },
): Promise<HarnessBuildResult> {
  const appDir = resolve(process.cwd(), options.appDir);

  const rnVersion = detectReactNativeVersion(appDir);

  console.log(`\nBuilding ${platform} harness binary...`);
  console.log(`  React Native: ${rnVersion}`);
  console.log(`  App dir: ${appDir}\n`);

  if (options.force) {
    const cacheDir = getDefaultCacheDir();
    console.log('  --force: clearing build cache...');
    try {
      rmSync(resolve(cacheDir, 'builds'), { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  const result = await ensureHarnessBinary({
    platform: platform as 'ios' | 'android',
    reactNativeVersion: rnVersion,
    nativeModules: [],
    packageRoot,
    projectRoot: appDir,
  });

  if (result.cached) {
    console.log(`Using cached binary (${result.binaryPath})`);
  } else {
    console.log(`Binary built: ${result.binaryPath}`);
  }

  console.log(`\n${platform} build complete.\n`);
  return result;
}
