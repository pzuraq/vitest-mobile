/**
 * iOS half of the harness builder: customize the scaffolded RN project,
 * preflight the toolchain, and run xcodebuild.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { log } from '../logger';
import { applyTemplateTree, fillFilePlaceholders } from '../templates';
import { HARNESS_APP_NAME, HARNESS_BUNDLE_ID, run, runLive } from './_shared';

export function getIOSBinaryPath(buildDir: string): string {
  return resolve(
    buildDir,
    'project',
    'ios',
    'DerivedData',
    'Build',
    'Products',
    'Debug-iphonesimulator',
    `${HARNESS_APP_NAME}.app`,
  );
}

/** A valid .app must have an Info.plist (otherwise it's a partial/failed build). */
export function isIOSBinaryValid(binaryPath: string): boolean {
  return existsSync(resolve(binaryPath, 'Info.plist'));
}

export function customizeIOS(projectDir: string, cacheKey: string): void {
  const iosDir = resolve(projectDir, 'ios');

  // Extract Xcode-version-specific attributes from the scaffolded storyboard
  // before overwriting it with our template.
  const storyboardPath = resolve(iosDir, HARNESS_APP_NAME, 'LaunchScreen.storyboard');
  const storyboardReplacements = extractStoryboardReplacements(storyboardPath);

  applyTemplateTree('ios', projectDir);

  if (storyboardReplacements) {
    fillFilePlaceholders(storyboardPath, storyboardReplacements);
  }

  const podfilePath = resolve(iosDir, 'Podfile');
  if (existsSync(podfilePath)) {
    let podfile = readFileSync(podfilePath, 'utf8');
    podfile = podfile.replace(/platform\s+:ios,\s*.+/, "platform :ios, '16.0'");
    podfile = injectFmtCxx17Fix(podfile);
    writeFileSync(podfilePath, podfile);
  }

  updateIOSBundleId(projectDir);

  // PlistBuddy is macOS-only; skip on Linux (Android-only CI runners still
  // customize both platforms for the shared project, but only build one).
  if (process.platform === 'darwin') {
    const infoPlistPath = resolve(iosDir, HARNESS_APP_NAME, 'Info.plist');
    if (existsSync(infoPlistPath)) {
      const pb = '/usr/libexec/PlistBuddy';
      run(`${pb} -c 'Set :CFBundleDisplayName Vitest' "${infoPlistPath}"`);
      run(`${pb} -c 'Add :VitestMobileCacheKey string ${cacheKey}' "${infoPlistPath}"`);
    }
  }
}

export async function buildIOS(projectDir: string): Promise<void> {
  preflightIOSToolchain();

  const iosDir = resolve(projectDir, 'ios');

  // Install gems + pods (bundle exec ensures compatible CocoaPods version)
  log.info('Installing Ruby gems...');
  let stepStart = Date.now();
  await runLive('bundle install', { cwd: projectDir });
  log.info(`  Gems installed (${((Date.now() - stepStart) / 1000).toFixed(1)}s)`);

  log.info('Running pod install... (this may take a minute)');
  stepStart = Date.now();
  await runLive('bundle exec pod install', { cwd: iosDir });
  log.info(`  Pods installed (${((Date.now() - stepStart) / 1000).toFixed(1)}s)`);

  log.info('Building for iOS simulator (this may take a few minutes)...');
  stepStart = Date.now();

  const buildCmd = [
    'xcodebuild build',
    `-workspace ${HARNESS_APP_NAME}.xcworkspace`,
    `-scheme ${HARNESS_APP_NAME}`,
    '-sdk iphonesimulator',
    '-configuration Debug',
    `-derivedDataPath "${resolve(iosDir, 'DerivedData')}"`,
  ].join(' ');

  await runLive(buildCmd, { cwd: iosDir });
  log.info(`  Xcode build complete (${((Date.now() - stepStart) / 1000).toFixed(1)}s)`);

  const appPath = resolve(
    iosDir,
    'DerivedData',
    'Build',
    'Products',
    'Debug-iphonesimulator',
    `${HARNESS_APP_NAME}.app`,
  );
  if (!existsSync(appPath)) {
    throw new Error(`Build succeeded but .app not found at: ${appPath}`);
  }
  log.info(`Binary built: ${appPath}`);
}

/**
 * Remove iOS intermediates from a build cache entry, keeping the .app.
 * Drastically reduces cache size for CI save/restore.
 */
export function trimIOSBuildArtifacts(projectDir: string): void {
  const dirsToRemove = [
    resolve(projectDir, 'ios', 'Pods'),
    resolve(projectDir, 'ios', 'DerivedData', 'Build', 'Intermediates.noindex'),
    resolve(projectDir, 'ios', 'DerivedData', 'Logs'),
    resolve(projectDir, 'ios', 'DerivedData', 'ModuleCache.noindex'),
    resolve(projectDir, 'ios', 'DerivedData', 'info.plist'),
    resolve(projectDir, 'vendor'), // bundler gems
    resolve(projectDir, 'android'),
  ];
  for (const dir of dirsToRemove) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

// ── Internals ───────────────────────────────────────────────────────

/**
 * Xcode 26.4+ ships a stricter Apple Clang that rejects the consteval pattern
 * in fmt 11.0.2 (bundled via RCT-Folly on React Native 0.81.x). Inject a
 * post_install hook that downgrades just the `fmt` pod to C++17, which skips
 * the consteval path and falls back to runtime format-string validation. The
 * rest of the project keeps C++20, which RN itself requires.
 *
 * Upstream fix: facebook/react-native#56099. Once that lands in a 0.81.x
 * patch and we adopt it, this shim can be removed.
 */
function injectFmtCxx17Fix(podfile: string): string {
  if (podfile.includes("target.name == 'fmt'")) {
    return podfile;
  }
  const marker = 'react_native_post_install(';
  const markerIdx = podfile.indexOf(marker);
  if (markerIdx === -1) {
    return podfile;
  }
  // Find the end of the react_native_post_install(...) call, then insert
  // our target tweak after its closing paren + newline.
  let depth = 0;
  let i = podfile.indexOf('(', markerIdx);
  for (; i < podfile.length; i++) {
    const c = podfile[i];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  while (i < podfile.length && podfile[i] !== '\n') i++;
  const insertAt = i;
  const patch = `

    # Workaround for Xcode 26.4+: Apple Clang 21 rejects the consteval usage
    # in fmt 11.0.2 (bundled via RCT-Folly). Downgrade just the fmt pod to
    # C++17 so the consteval path is skipped; runtime format-string checking
    # still works. Remove once React Native pulls in a fmt release that
    # compiles under the new Clang (see facebook/react-native#56099).
    installer.pods_project.targets.each do |target|
      if target.name == 'fmt'
        target.build_configurations.each do |cfg|
          cfg.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++17'
        end
      end
    end`;
  return podfile.slice(0, insertAt) + patch + podfile.slice(insertAt);
}

/**
 * Extract the <document> tag and view controller ID from the scaffolded storyboard.
 * These carry Xcode-version-specific attributes we need to preserve.
 */
function extractStoryboardReplacements(storyboardPath: string): Record<string, string> | null {
  if (!existsSync(storyboardPath)) {
    log.verbose('LaunchScreen.storyboard not found, skipping splash modification');
    return null;
  }
  const existing = readFileSync(storyboardPath, 'utf8');
  const docMatch = existing.match(/<document[^>]+>/);
  if (!docMatch) {
    log.verbose('Could not parse LaunchScreen.storyboard, skipping splash modification');
    return null;
  }
  const docTag = docMatch[0];
  const vcId = docTag.match(/initialViewController="([^"]+)"/)?.[1] ?? '01J-lp-oVM';
  return { DOCUMENT_TAG: docTag, VC_ID: vcId };
}

function updateIOSBundleId(projectDir: string): void {
  const pbxprojPath = resolve(projectDir, 'ios', `${HARNESS_APP_NAME}.xcodeproj`, 'project.pbxproj');
  if (existsSync(pbxprojPath)) {
    let content = readFileSync(pbxprojPath, 'utf8');
    content = content.replace(
      /PRODUCT_BUNDLE_IDENTIFIER\s*=\s*"[^"]+"/g,
      `PRODUCT_BUNDLE_IDENTIFIER = "${HARNESS_BUNDLE_ID}"`,
    );
    writeFileSync(pbxprojPath, content);
  }
}

/**
 * Preflight check before invoking xcodebuild. xcodebuild fails with a terse
 * `Found no destinations for the scheme` when the active Xcode SDK's iOS
 * version doesn't have a matching installed simulator runtime — a very
 * common condition after upgrading Xcode, since SDKs and runtimes are
 * separately installable. Surface an actionable error here, before paying
 * for the pod install + build warmup.
 */
function preflightIOSToolchain(): void {
  let sdkVersion: string | null = null;
  try {
    sdkVersion = execSync('xcrun --show-sdk-version --sdk iphonesimulator', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    // No iphonesimulator SDK at all — xcodebuild will surface its own
    // error and there's nothing useful we can add here.
    return;
  }
  if (!sdkVersion) return;
  const sdkMajor = sdkVersion.split('.')[0];

  let runtimesJson = '';
  try {
    runtimesJson = execSync('xcrun simctl list runtimes --json', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    return;
  }

  let runtimes: Array<{ version?: string; platform?: string; isAvailable?: boolean }> = [];
  try {
    const parsed = JSON.parse(runtimesJson) as {
      runtimes?: Array<{ version?: string; platform?: string; isAvailable?: boolean }>;
    };
    runtimes = parsed.runtimes ?? [];
  } catch {
    return;
  }

  const iosRuntimes = runtimes.filter(r => r.platform === 'iOS' && r.isAvailable !== false && r.version);
  const hasMatching = iosRuntimes.some(r => r.version?.split('.')[0] === sdkMajor);
  if (hasMatching) return;

  const installed =
    iosRuntimes
      .map(r => r.version)
      .filter(Boolean)
      .join(', ') || 'none';
  throw new Error(
    `Xcode's active iOS Simulator SDK is ${sdkVersion}, but no iOS ${sdkMajor}.x ` +
      `simulator runtime is installed (installed: ${installed}).\n\n` +
      `Install the matching runtime with either:\n` +
      `  xcodebuild -downloadPlatform iOS\n` +
      `  # or via Xcode: Settings → Components → iOS ${sdkMajor} → Get\n\n` +
      `This is an Xcode setup issue, not a vitest-mobile bug — xcodebuild would ` +
      `fail next with "Found no destinations for the scheme" without this message.`,
  );
}
