/**
 * Android half of the harness builder: customize the scaffolded RN project
 * and run the Gradle build.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { log } from '../logger';
import { applyTemplateTree, fillFilePlaceholders } from '../templates';
import { HARNESS_APP_NAME, HARNESS_BUNDLE_ID, run, runLive } from './_shared';

export function getAndroidBinaryPath(buildDir: string): string {
  return resolve(buildDir, 'build', `${HARNESS_APP_NAME}.apk`);
}

/** APK is a single file — existence (checked by the caller) is sufficient. */
export function isAndroidBinaryValid(): boolean {
  return true;
}

export function customizeAndroid(projectDir: string, cacheKey: string): void {
  const androidDir = resolve(projectDir, 'android');

  applyTemplateTree('android', projectDir);

  fillFilePlaceholders(resolve(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml'), {
    CACHE_KEY: cacheKey,
  });

  const appBuildGradle = resolve(androidDir, 'app', 'build.gradle');
  if (existsSync(appBuildGradle)) {
    let content = readFileSync(appBuildGradle, 'utf8');
    content = content.replace(/applicationId\s+"[^"]+"/, `applicationId "${HARNESS_BUNDLE_ID}"`);
    content = content.replace(/minSdk\s*=\s*\d+/, 'minSdk = 24');
    content = content.replace(
      /(defaultConfig\s*\{[^}]*versionName\s+"[^"]*")/,
      '$1\n        resValue "integer", "react_native_dev_server_port", "18081"',
    );
    writeFileSync(appBuildGradle, content);
  }
}

export async function buildAndroid(projectDir: string, buildDir: string): Promise<void> {
  const androidDir = resolve(projectDir, 'android');

  log.info('Building Android debug APK (this may take a few minutes)...');
  const gradleStart = Date.now();

  // Use the gradle wrapper from the scaffolded project
  const gradlew = resolve(androidDir, 'gradlew');
  if (!existsSync(gradlew)) {
    throw new Error('gradlew not found in Android project');
  }

  run(`chmod +x "${gradlew}"`, { cwd: androidDir });
  // runLive keeps the spinner animating + lets SIGINT reach this process.
  // run() would block the event loop for the entire multi-minute gradle run.
  await runLive(`"${gradlew}" assembleDebug -x lint --no-daemon`, { cwd: androidDir });
  log.info(`  Gradle build complete (${((Date.now() - gradleStart) / 1000).toFixed(1)}s)`);

  const apkPath = resolve(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
  if (!existsSync(apkPath)) {
    throw new Error(`Build succeeded but APK not found at: ${apkPath}`);
  }

  // Copy to our expected location
  const targetPath = getAndroidBinaryPath(buildDir);
  mkdirSync(resolve(targetPath, '..'), { recursive: true });
  cpSync(apkPath, targetPath);
  log.info(`APK built: ${targetPath}`);
}

/**
 * Remove Android intermediates from a build cache entry, keeping the .apk.
 */
export function trimAndroidBuildArtifacts(projectDir: string): void {
  const dirsToRemove = [
    resolve(projectDir, 'android', '.gradle'),
    resolve(projectDir, 'android', 'app', 'build', 'intermediates'),
    resolve(projectDir, 'android', 'app', 'build', 'tmp'),
    resolve(projectDir, 'ios'),
    resolve(projectDir, 'vendor'),
  ];
  for (const dir of dirsToRemove) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
