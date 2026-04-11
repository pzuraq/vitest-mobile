/**
 * harness-builder — scaffolds, customizes, builds, and caches the native
 * harness binary that runs tests on device.
 *
 * The harness binary is a minimal React Native app with VitestMobileHarness baked in.
 * It loads JS from Metro at runtime — all test harness UI/logic comes from
 * the user's project via the Metro bundle.
 *
 * Build artifacts are cached in ~/.cache/vitest-mobile/builds/<hash>/ so
 * subsequent runs skip the build entirely.
 */

import { createHash } from 'node:crypto';
import { execSync, type ExecSyncOptions } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { log } from './logger';
import type { Platform } from './types';

// ── Types ──────────────────────────────────────────────────────────

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
  /** Override cache directory. */
  cacheDir?: string;
}

export interface HarnessBuildResult {
  /** Path to the built .app (iOS) or .apk (Android). */
  binaryPath: string;
  /** Bundle ID of the harness app. */
  bundleId: string;
  /** Whether this was a cache hit (no build needed). */
  cached: boolean;
}

const HARNESS_BUNDLE_ID = 'com.vitest.mobile.harness';
const HARNESS_APP_NAME = 'VitestMobileApp';

// ── Public API ─────────────────────────────────────────────────────

/**
 * Ensure a harness binary exists for the given configuration.
 * Returns the path to the .app/.apk, building if necessary.
 * Uses a file-based lock to prevent parallel builds from concurrent pool workers.
 */
export async function ensureHarnessBinary(options: HarnessBuildOptions): Promise<HarnessBuildResult> {
  const cacheDir = options.cacheDir ?? getDefaultCacheDir();
  const cacheKey = computeCacheKey(options);
  const buildDir = resolve(cacheDir, 'builds', cacheKey);
  mkdirSync(buildDir, { recursive: true });

  // Check cache — validate the binary is complete, not just the directory
  const binaryPath = getBinaryPath(buildDir, options.platform);
  if (existsSync(binaryPath) && isBinaryValid(binaryPath, options.platform)) {
    log.info(`Using cached harness binary: ${cacheKey.slice(0, 12)}...`);
    return { binaryPath, bundleId: HARNESS_BUNDLE_ID, cached: true };
  }

  // File-based lock to prevent concurrent builds from parallel pool workers.
  // First worker creates the lock, others poll until the binary appears.
  const lockPath = resolve(buildDir, '.build-lock');
  try {
    writeFileSync(lockPath, String(process.pid), { flag: 'wx' }); // fails if exists
  } catch {
    // Another worker is building — wait for it
    log.info('Another worker is building the harness binary, waiting...');
    for (let i = 0; i < 600; i++) {
      // up to 10 minutes
      await new Promise<void>(r => setTimeout(r, 1000));
      if (existsSync(binaryPath)) {
        log.info('Harness binary ready (built by another worker).');
        return { binaryPath, bundleId: HARNESS_BUNDLE_ID, cached: true };
      }
      if (!existsSync(lockPath)) break; // lock removed = build failed
    }
    throw new Error('Timed out waiting for harness binary build');
  }

  try {
    const buildStart = Date.now();
    log.info('');
    log.info('Building the test harness app for the first time.');
    log.info('This compiles a native iOS/Android binary and will be cached for future runs.');
    log.info(`  React Native ${options.reactNativeVersion} · ${options.platform}`);
    if (options.nativeModules.length > 0) {
      log.info(`  Native modules: ${options.nativeModules.join(', ')}`);
    }
    log.info('');

    const projectDir = await scaffoldProject(buildDir, options);
    customizeProject(projectDir, options);
    await buildProject(projectDir, options.platform);

    if (!existsSync(binaryPath)) {
      throw new Error(`Build completed but binary not found at: ${binaryPath}`);
    }

    const totalElapsed = ((Date.now() - buildStart) / 1000).toFixed(1);
    log.info(`Harness binary built and cached successfully (${totalElapsed}s total).`);
    return { binaryPath, bundleId: HARNESS_BUNDLE_ID, cached: false };
  } finally {
    // Remove lock so other workers (or future runs) don't hang
    try {
      rmSync(lockPath);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Auto-detect the React Native version from the user's node_modules.
 * Walks up from projectRoot to handle monorepo hoisting.
 */
export function detectReactNativeVersion(projectRoot: string): string {
  const pkgPath = resolveNodeModule(projectRoot, 'react-native/package.json');
  if (!pkgPath) {
    throw new Error('react-native not found in node_modules. Install it first:\n  npm install react-native');
  }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  return pkg.version;
}

/**
 * Get the default cache directory.
 */
export function getDefaultCacheDir(): string {
  // Follow XDG on macOS/Linux, LOCALAPPDATA on Windows
  const envOverride = process.env.VITEST_NATIVE_CACHE_DIR;
  if (envOverride) return envOverride;

  if (process.platform === 'win32') {
    return resolve(process.env.LOCALAPPDATA || resolve(homedir(), 'AppData', 'Local'), 'vitest-mobile');
  }
  return resolve(process.env.XDG_CACHE_HOME || resolve(homedir(), '.cache'), 'vitest-mobile');
}

// ── Internals ──────────────────────────────────────────────────────

const BUILTIN_NATIVE_DEPS = ['react-native-safe-area-context'];

function computeCacheKey(options: HarnessBuildOptions): string {
  const parts = [
    options.platform,
    options.reactNativeVersion,
    ...BUILTIN_NATIVE_DEPS,
    ...options.nativeModules.sort(),
    getHarnessVersion(options.packageRoot),
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 24);
}

function getHarnessVersion(packageRoot: string): string {
  try {
    const pkg = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'));
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Check that the cached binary is complete (not a partial/failed build). */
function isBinaryValid(binaryPath: string, platform: Platform): boolean {
  if (platform === 'ios') {
    // A valid .app must have an Info.plist
    return existsSync(resolve(binaryPath, 'Info.plist'));
  }
  // APK is a single file — existence is sufficient
  return true;
}

function getBinaryPath(buildDir: string, platform: Platform): string {
  if (platform === 'ios') {
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
  return resolve(buildDir, 'build', `${HARNESS_APP_NAME}.apk`);
}

function run(cmd: string, opts: ExecSyncOptions = {}): string {
  log.verbose(`$ ${cmd}`);
  const start = Date.now();
  const result = (
    execSync(cmd, {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 600000,
      env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
      ...opts,
    }) as string
  ).trim();
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  log.verbose(`  ✓ ${elapsed}s`);
  return result;
}

/** Like run(), but streams output to the terminal so long commands show progress. */
function runLive(cmd: string, opts: ExecSyncOptions = {}): void {
  log.verbose(`$ ${cmd}`);
  execSync(cmd, {
    encoding: 'utf8',
    stdio: 'inherit',
    timeout: 600000,
    env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
    ...opts,
  });
}

// ── Scaffold ───────────────────────────────────────────────────────

async function scaffoldProject(buildDir: string, options: HarnessBuildOptions): Promise<string> {
  const projectDir = resolve(buildDir, 'project');

  if (existsSync(projectDir)) {
    rmSync(projectDir, { recursive: true, force: true });
  }

  log.info('Scaffolding React Native project...');

  // Use @react-native-community/cli to init a project matching the user's RN version.
  // This ensures the Xcode project template matches the RN version exactly.
  run(
    `npx @react-native-community/cli init ${HARNESS_APP_NAME} --version ${options.reactNativeVersion} --skip-install --skip-git-init`,
    { cwd: buildDir },
  );

  // The CLI creates a directory named after the app
  const scaffoldDir = resolve(buildDir, HARNESS_APP_NAME);

  // Move it to our standard location
  if (existsSync(scaffoldDir) && scaffoldDir !== projectDir) {
    cpSync(scaffoldDir, projectDir, { recursive: true });
    rmSync(scaffoldDir, { recursive: true, force: true });
  }

  return projectDir;
}

// ── Customize ──────────────────────────────────────────────────────

function customizeProject(projectDir: string, options: HarnessBuildOptions): void {
  log.info('Customizing harness project...');

  // 1. Write our AppDelegate
  if (options.platform === 'ios') {
    customizeIOS(projectDir);
  } else {
    customizeAndroid(projectDir);
  }

  // 2. Write a minimal package.json (for npm install)
  // Include vitest-mobile as a file: dep so autolinking
  // picks up the VitestMobileHarness TurboModule via react-native.config.cjs.
  const deps: Record<string, string> = {
    react: readPeerVersion(options.projectRoot, 'react') ?? '19.1.0',
    'react-native': options.reactNativeVersion,
    'react-native-safe-area-context':
      readInstalledVersion(options.projectRoot, 'react-native-safe-area-context') ?? '^5.0.0',
    'vitest-mobile': `file:${options.packageRoot}`,
  };
  const devDeps: Record<string, string> = {
    '@react-native-community/cli': 'latest',
    '@react-native-community/cli-platform-ios': 'latest',
    '@react-native-community/cli-platform-android': 'latest',
  };
  for (const mod of options.nativeModules) {
    deps[mod] = readInstalledVersion(options.projectRoot, mod) ?? '*';
  }

  const packageJson = {
    name: HARNESS_APP_NAME.toLowerCase(),
    version: '0.0.0',
    private: true,
    dependencies: deps,
    devDependencies: devDeps,
  };
  writeFileSync(resolve(projectDir, 'package.json'), JSON.stringify(packageJson, null, 2));

  // 3. Install dependencies
  log.info('Installing dependencies... (this may take a minute)');
  const depsStart = Date.now();
  runLive('npm install', { cwd: projectDir });
  log.info(`  Dependencies installed (${((Date.now() - depsStart) / 1000).toFixed(1)}s)`);
}

function customizeIOS(projectDir: string): void {
  const iosDir = resolve(projectDir, 'ios');

  // VitestMobileHarness TurboModule is autolinked via react-native.config.cjs
  // (included because vitest-mobile is in package.json deps).
  // We only need to bump the iOS deployment target.

  const podfilePath = resolve(iosDir, 'Podfile');
  if (existsSync(podfilePath)) {
    let podfile = readFileSync(podfilePath, 'utf8');
    podfile = podfile.replace(/platform\s+:ios,\s*.+/, "platform :ios, '16.0'");
    writeFileSync(podfilePath, podfile);
  }

  updateIOSBundleId(projectDir);

  // Set a short display name for the home screen
  const infoPlistPath = resolve(iosDir, HARNESS_APP_NAME, 'Info.plist');
  if (existsSync(infoPlistPath)) {
    let plist = readFileSync(infoPlistPath, 'utf8');
    plist = plist.replace(
      /<key>CFBundleDisplayName<\/key>\s*<string>[^<]*<\/string>/,
      '<key>CFBundleDisplayName</key>\n\t<string>Vitest</string>',
    );
    writeFileSync(infoPlistPath, plist);
  }
}

function customizeAndroid(projectDir: string): void {
  const androidDir = resolve(projectDir, 'android');

  // Update the applicationId in build.gradle
  const appBuildGradle = resolve(androidDir, 'app', 'build.gradle');
  if (existsSync(appBuildGradle)) {
    let content = readFileSync(appBuildGradle, 'utf8');
    content = content.replace(/applicationId\s+"[^"]+"/, `applicationId "${HARNESS_BUNDLE_ID}"`);
    content = content.replace(/minSdk\s*=\s*\d+/, 'minSdk = 24');
    // Override React Native's default dev server port (8081) so the app
    // connects to our Metro instance on 18081 out of the box.  The resource
    // is read by AndroidInfoHelpers.getDevServerPort().
    content = content.replace(
      /(defaultConfig\s*\{[^}]*versionName\s+"[^"]*")/,
      '$1\n        resValue "integer", "react_native_dev_server_port", "18081"',
    );
    writeFileSync(appBuildGradle, content);
  }

  // Set display name to "Vitest"
  const stringsPath = resolve(androidDir, 'app', 'src', 'main', 'res', 'values', 'strings.xml');
  if (existsSync(stringsPath)) {
    let strings = readFileSync(stringsPath, 'utf8');
    strings = strings.replace(/<string name="app_name">[^<]*<\/string>/, '<string name="app_name">Vitest</string>');
    writeFileSync(stringsPath, strings);
  }
}

function updateIOSBundleId(projectDir: string): void {
  // Update the bundle ID in the pbxproj
  const pbxprojPath = resolve(projectDir, 'ios', `${HARNESS_APP_NAME}.xcodeproj`, 'project.pbxproj');
  if (existsSync(pbxprojPath)) {
    let content = readFileSync(pbxprojPath, 'utf8');
    // Replace the default bundle ID with ours
    content = content.replace(
      /PRODUCT_BUNDLE_IDENTIFIER\s*=\s*"[^"]+"/g,
      `PRODUCT_BUNDLE_IDENTIFIER = "${HARNESS_BUNDLE_ID}"`,
    );
    writeFileSync(pbxprojPath, content);
  }
}

// ── Build ──────────────────────────────────────────────────────────

async function buildProject(projectDir: string, platform: Platform): Promise<void> {
  if (platform === 'ios') {
    await buildIOS(projectDir);
  } else {
    await buildAndroid(projectDir);
  }
}

async function buildIOS(projectDir: string): Promise<void> {
  const iosDir = resolve(projectDir, 'ios');

  // Install gems + pods (bundle exec ensures compatible CocoaPods version)
  log.info('Installing Ruby gems...');
  let stepStart = Date.now();
  runLive('bundle install', { cwd: projectDir });
  log.info(`  Gems installed (${((Date.now() - stepStart) / 1000).toFixed(1)}s)`);

  log.info('Running pod install... (this may take a minute)');
  stepStart = Date.now();
  runLive('bundle exec pod install', { cwd: iosDir });
  log.info(`  Pods installed (${((Date.now() - stepStart) / 1000).toFixed(1)}s)`);

  // Build for simulator — need a concrete simulator destination to produce
  // a runnable executable (generic/platform builds don't include the binary)
  log.info('Building for iOS simulator (this may take a few minutes)...');
  stepStart = Date.now();

  // Find a booted simulator UUID for the destination
  let simUdid = '';
  try {
    const bootedJson = run('xcrun simctl list devices booted -j');
    const parsed = JSON.parse(bootedJson);
    for (const devices of Object.values(parsed.devices) as { state?: string; udid?: string }[][]) {
      for (const d of devices) {
        if (d.state === 'Booted' && d.udid) {
          simUdid = d.udid;
          break;
        }
      }
      if (simUdid) break;
    }
  } catch {
    /* fall through */
  }

  const destination = simUdid ? `'platform=iOS Simulator,id=${simUdid}'` : "'platform=iOS Simulator,name=iPhone 16'"; // fallback

  const buildCmd = [
    'xcodebuild build',
    `-workspace ${HARNESS_APP_NAME}.xcworkspace`,
    `-scheme ${HARNESS_APP_NAME}`,
    '-sdk iphonesimulator',
    '-configuration Debug',
    `-derivedDataPath "${resolve(iosDir, 'DerivedData')}"`,
    `-destination ${destination}`,
  ].join(' ');

  runLive(buildCmd, { cwd: iosDir });
  log.info(`  Xcode build complete (${((Date.now() - stepStart) / 1000).toFixed(1)}s)`);

  // Verify the .app exists (getBinaryPath points directly at DerivedData)
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

async function buildAndroid(projectDir: string): Promise<void> {
  const androidDir = resolve(projectDir, 'android');

  log.info('Building Android debug APK (this may take a few minutes)...');
  const gradleStart = Date.now();

  // Use the gradle wrapper from the scaffolded project
  const gradlew = resolve(androidDir, 'gradlew');
  if (!existsSync(gradlew)) {
    throw new Error('gradlew not found in Android project');
  }

  run(`chmod +x "${gradlew}"`, { cwd: androidDir });
  run(`"${gradlew}" assembleDebug -x lint --no-daemon`, {
    cwd: androidDir,
    timeout: 600000,
  });
  log.info(`  Gradle build complete (${((Date.now() - gradleStart) / 1000).toFixed(1)}s)`);

  // Find the APK
  const apkPath = resolve(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
  if (!existsSync(apkPath)) {
    throw new Error(`Build succeeded but APK not found at: ${apkPath}`);
  }

  // Copy to our expected location
  const targetPath = getBinaryPath(resolve(projectDir, '..'), 'android');
  mkdirSync(resolve(targetPath, '..'), { recursive: true });
  cpSync(apkPath, targetPath);
  log.info(`APK built: ${targetPath}`);
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Walk up from startDir looking for node_modules/<modulePath>. */
function resolveNodeModule(startDir: string, modulePath: string): string | null {
  let dir = startDir;
  for (;;) {
    const candidate = resolve(dir, 'node_modules', modulePath);
    if (existsSync(candidate)) return candidate;
    const parent = resolve(dir, '..');
    if (parent === dir) return null;
    dir = parent;
  }
}

function readPeerVersion(projectRoot: string, pkg: string): string | null {
  const pkgPath = resolveNodeModule(projectRoot, `${pkg}/package.json`);
  if (!pkgPath) return null;
  try {
    const pkgJson = JSON.parse(readFileSync(pkgPath, 'utf8'));
    return pkgJson.version;
  } catch {
    return null;
  }
}

function readInstalledVersion(projectRoot: string, pkg: string): string | null {
  return readPeerVersion(projectRoot, pkg);
}
