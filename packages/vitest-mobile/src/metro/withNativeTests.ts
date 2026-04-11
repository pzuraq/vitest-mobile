/**
 * Metro config helper — makes the Expo app test-aware.
 *
 * Usage in metro.config.js:
 *   const { withNativeTests } = require('vitest-mobile/metro');
 *   module.exports = withNativeTests(getDefaultConfig(__dirname));
 */

import { resolve } from 'node:path';
import { watch } from 'node:fs';
import { generateTestRegistry } from './generateTestRegistry';
import type { MetroConfig } from 'metro';
import type { CustomResolutionContext, CustomResolver } from 'metro-resolver';

export interface NativeTestsOptions {
  /** Glob patterns for test files, relative to the project root. */
  testPatterns?: string[];
}

const DEFAULT_PATTERNS = ['packages/**/tests/**/*.test.{tsx,ts}'];

/**
 * Apply native test configuration to a Metro config.
 *
 * - Discovers test files and generates a virtual registry module
 * - Watches for new/deleted test files and regenerates
 * - Enables package exports with react-native condition
 * - Sets up virtual module resolution (vitest → vitest-shim, test-registry → generated file)
 */
export function withNativeTests(config: MetroConfig, options: NativeTestsOptions = {}): MetroConfig {
  const testPatterns = options.testPatterns ?? DEFAULT_PATTERNS;
  const projectRoot: string = config.projectRoot ?? process.cwd();
  const outputDir = resolve(projectRoot, '.vitest-mobile');

  // ── Generate test registry ─────────────────────────────────────
  const { filePath: registryPath, testFiles } = generateTestRegistry({
    projectRoot,
    testPatterns,
    outputDir,
  });

  console.log(`[withNativeTests] Generated test registry: ${testFiles.length} file(s)`);

  // ── File watcher for new/deleted tests ─────────────────────────
  // Only watch in development (not during production builds)
  if (process.env.NODE_ENV !== 'production') {
    let knownFiles = new Set(testFiles);
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    try {
      watch(resolve(projectRoot, 'packages'), { recursive: true }, (_eventType, filename) => {
        if (!filename || !filename.match(/\.test\.tsx?$/)) return;

        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          const result = generateTestRegistry({ projectRoot, testPatterns, outputDir });
          const newFiles = new Set(result.testFiles);

          // Only log if the file set actually changed
          if (newFiles.size !== knownFiles.size || [...newFiles].some(f => !knownFiles.has(f))) {
            console.log(`[withNativeTests] Test files changed: ${result.testFiles.length} file(s)`);
            knownFiles = newFiles;
          }
        }, 300);
      });
    } catch {
      // Watcher setup failed — non-fatal (packages/ dir may not exist yet)
    }
  }

  // ── Package exports ────────────────────────────────────────────
  const resolver = config.resolver ?? {};
  const existingConditions: string[] = [...(resolver.unstable_conditionNames ?? [])];
  const needed = ['react-native', 'import', 'require', 'default'];
  for (const c of needed) {
    if (!existingConditions.includes(c)) existingConditions.push(c);
  }

  // ── Module resolution ──────────────────────────────────────────
  const originalResolver = resolver.resolveRequest;
  const resolveRequest: CustomResolver = (
    context: CustomResolutionContext,
    moduleName: string,
    platform: string | null,
  ) => {
    // Redirect vitest-mobile/test-registry to the generated file
    if (moduleName === 'vitest-mobile/test-registry') {
      return { type: 'sourceFile', filePath: registryPath };
    }

    // Redirect `import from 'vitest'` to the vitest shim for React Native
    if (moduleName === 'vitest') {
      return context.resolveRequest(context, 'vitest-mobile/vitest-shim', platform);
    }

    if (originalResolver) {
      return originalResolver(context, moduleName, platform);
    }
    return context.resolveRequest(context, moduleName, platform);
  };

  return {
    ...config,
    resolver: {
      ...resolver,
      unstable_enablePackageExports: true,
      unstable_conditionNames: existingConditions,
      resolveRequest,
    },
  };
}
