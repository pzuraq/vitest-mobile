/**
 * vitest-mobile — Node-side entry point.
 *
 * Add the plugin to your vitest config:
 *   import { nativePlugin } from 'vitest-mobile'
 *   export default defineConfig({
 *     plugins: [nativePlugin({ platform: 'ios' })],
 *     test: { include: ['native-tests/**\/*.test.tsx'] },
 *   })
 */

import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { createNativePoolWorker } from './pool';
import type { InternalPoolOptions, NativePluginOptions, PoolMode } from './types';
import type { VitestPluginContext } from 'vitest/node';

const DEFAULT_INCLUDE = ['**/native-tests/**/*.test.tsx', '**/native-tests/**/*.test.ts'];

/**
 * Key under which nativePlugin stashes the original user-supplied options on
 * the returned Plugin object. Not part of the public API — intended for the
 * vitest-mobile CLI to read back options (currently `harness.nativeModules`) from
 * a statically-loaded vitest config.
 */
export const VITEST_MOBILE_PLUGIN_OPTIONS_KEY = '__vitestMobileOptions';

function detectMode(): PoolMode {
  if (process.env.CI) return 'run';
  if (process.argv.includes('run')) return 'run';
  return 'dev';
}

/** Vite plugin that wires up the native pool worker. */
export function nativePlugin(options: NativePluginOptions = {}): Plugin {
  const appDir = process.cwd();
  // InternalPoolOptions starts with default test patterns; `configureVitest`
  // mirrors `include` into testPatterns so downstream consumers (Metro +
  // registry generation) see the same list Vitest uses.
  const internal: InternalPoolOptions = {
    appDir,
    mode: detectMode(),
    testPatterns: DEFAULT_INCLUDE,
    outputDir: resolve(appDir, '.vitest-mobile'),
  };

  // `configureVitest` is a Vitest-specific plugin hook, not in Vite's `Plugin` type.
  const plugin: Plugin & Record<string, unknown> = {
    name: 'vitest-mobile',
    // Expose the original user-supplied options so the CLI can read them
    // back from a loaded vitest config (bootstrap/build/install/bundle use
    // this to default `harness.nativeModules` without requiring users to repeat
    // themselves with --native-modules on the command line).
    [VITEST_MOBILE_PLUGIN_OPTIONS_KEY]: options,
  };

  plugin.configureVitest = (ctx: VitestPluginContext) => {
    const { vitest, project } = ctx;
    const cfg = project.config;

    let _singletonWorker: ReturnType<typeof createNativePoolWorker> | null = null;

    const poolRunner = {
      name: 'native' as const,
      createPoolWorker() {
        if (!_singletonWorker) {
          _singletonWorker = createNativePoolWorker(options, internal, d => {
            for (const f of d.created) {
              void vitest.watcher.onFileCreate(f);
            }
            for (const f of d.deleted) {
              void vitest.watcher.onFileDelete(f);
            }
            if (d.updated.length) {
              const specifications = d.updated.flatMap(f => vitest.getModuleSpecifications(f));
              void vitest.rerunTestSpecifications(specifications, true);
            }
          });
        }
        return _singletonWorker;
      },
    };

    cfg.pool = poolRunner.name;
    cfg.poolRunner = poolRunner;
    cfg.maxWorkers = 1;
    // isolate: false — worker can share runtime across files. With maxWorkers=1
    // this groups specs so the worker runs once per user-initiated run, matching
    // the single RN JS VM. Respect an explicit user override.
    if (cfg.isolate === undefined) {
      cfg.isolate = false;
    }
    if (!cfg.include) {
      cfg.include = DEFAULT_INCLUDE;
    }
    internal.testPatterns = cfg.include;

    // Reruns in dev mode are driven exclusively by Metro's on-device HMR
    // (device `update` → `rerunTestSpecifications`). Vitest's
    // built-in FilesWatcher
    // (hooked into `vite.watcher`) would otherwise ALSO fire on test-file
    // saves, producing a duplicate run — and the first run would race
    // Metro's bundle delivery, potentially executing stale code.
    //
    // `configureVitest` runs AFTER `FilesWatcher.registerWatcher()`, so
    // calling `unregisterWatcher()` here surgically removes ONLY vitest's
    // own `change`/`unlink`/`add` listeners from the shared vite watcher;
    // vite's HMR-internal and config-file-restart listeners are left
    // untouched. See vitest:dist/chunks/cli-api.* FilesWatcher class.
    if (internal.mode === 'dev') {
      try {
        vitest.watcher.unregisterWatcher();
      } catch {
        /* ignore — method may not exist in older/newer vitest */
      }
    }
  };

  return plugin;
}

export type { NativePluginOptions, Platform, MetroConfigContext, MetroConfigCustomizer } from './types';
