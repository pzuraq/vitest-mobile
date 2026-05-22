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
    podfile = injectNewArchEnvOverride(podfile);
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

  log.info('Building for iOS simulator (this may take a few minutes)...');
  const stepStart = Date.now();

  // --force-pods is required: without it, the CLI only runs `pod install`
  // when `react-native.config.js` sets `automaticPodsInstallation: true`
  // (the bare RN init template does not). Skipping pod install causes
  // xcodebuild to fail with "Unable to load contents of file list" against
  // the Pods xcfilelists.
  //
  // For why `customizeIOS` injects an `RCT_NEW_ARCH_ENABLED` override at
  // the top of the Podfile, see `injectNewArchEnvOverride`.
  const buildCmd = [
    'npx --yes react-native build-ios',
    `--scheme ${HARNESS_APP_NAME}`,
    '--mode Debug',
    '--force-pods',
    `--buildFolder "${resolve(iosDir, 'DerivedData')}"`,
  ].join(' ');

  await runLive(buildCmd, { cwd: projectDir });
  log.info(`  iOS build complete (${((Date.now() - stepStart) / 1000).toFixed(1)}s)`);

  const appPath = resolve(
    iosDir,
    'DerivedData',
    'Build',
    'Products',
    'Debug-iphonesimulator',
    `${HARNESS_APP_NAME}.app`,
  );
  if (!existsSync(appPath) || !isIOSBinaryValid(appPath)) {
    throw new Error(
      `Build completed but produced an invalid .app at: ${appPath}\n` +
        'Try running with --force to clear the cache and rebuild from scratch.',
    );
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
 * Prepend `ENV['RCT_NEW_ARCH_ENABLED'] = '1'` to the Podfile so the New
 * Architecture is on regardless of what the React Native community CLI
 * tells `pod install` via the child-process env.
 *
 * Why we need this: in the `--force-pods` / `--only-pods` path the CLI's
 * `resolvePods` calls `install()`, which calls `installPods()` *without*
 * passing `newArchEnabled` — so the env always gets `RCT_NEW_ARCH_ENABLED
 * ='0'`, regardless of what the architecture sniffer found. Reanimated 4
 * .x's podspec asserts on the env var (`ENV['RCT_NEW_ARCH_ENABLED'] !=
 * '0'`) and aborts the install. Setting the env in Ruby at the top of the
 * Podfile happens *inside* the same pod-install process the CLI just
 * spawned with `'0'`, but *before* `use_native_modules!` triggers
 * `RNReanimated.podspec`, so the override sticks for the rest of the
 * install — including the `NewArchitectureHelper.new_arch_enabled` read
 * later that drives `use_react_native!`'s codegen and Info.plist write-
 * back.
 *
 * Upstream fix that would remove the env injection entirely:
 * https://github.com/react-native-community/cli/pull/2773 — approved by
 * the maintainer but unmerged as of CLI 20.1.3. Once it ships and we
 * adopt it, this override becomes a redundant reassignment of an env var
 * that's already `'1'` (or unset, which Reanimated treats as on).
 */
function injectNewArchEnvOverride(podfile: string): string {
  const line = "ENV['RCT_NEW_ARCH_ENABLED'] = '1'\n";
  if (podfile.includes(line)) return podfile;
  return line + podfile;
}

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
