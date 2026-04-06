/**
 * vitest-react-native-runtime build — build the test harness app for a platform.
 *
 * Usage:
 *   npx vitest-react-native-runtime build android [--app-dir ./test-app]
 *   npx vitest-react-native-runtime build ios     [--app-dir ./test-app]
 */

import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import type { Platform } from '../node/types';

const args = process.argv.slice(2);
const platform = args[0] as Platform | undefined;

if (platform !== 'android' && platform !== 'ios') {
  console.error('Usage: npx vitest-react-native-runtime build <android|ios> [--app-dir <path>]');
  process.exit(1);
}

const appDirFlagIdx = args.indexOf('--app-dir');
const appDir = resolve(
  process.cwd(),
  appDirFlagIdx !== -1 ? (args[appDirFlagIdx + 1] ?? './test-app') : './test-app',
);

function run(cmd: string): void {
  console.log(`> ${cmd}\n`);
  execSync(cmd, { cwd: appDir, stdio: 'inherit' });
}

if (platform === 'android') {
  console.log(`\nBuilding Android app in ${appDir}...\n`);
  run('npx expo prebuild --platform android --clean');
  run('cd android && ./gradlew assembleDebug');
} else {
  console.log(`\nBuilding iOS app in ${appDir}...\n`);
  run('npx expo prebuild --platform ios --clean');
  run('cd ios && pod install');
  run(
    'xcodebuild -workspace ios/vitestnative.xcworkspace -scheme vitestnative -sdk iphonesimulator -configuration Debug ONLY_ACTIVE_ARCH=NO CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO -derivedDataPath build',
  );
}

console.log(`\n${platform} build complete.\n`);
