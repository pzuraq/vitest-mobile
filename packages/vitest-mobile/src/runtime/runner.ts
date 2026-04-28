/**
 * ReactNativeRunner — VitestRunner implementation for Hermes/RN.
 *
 * Constructed per-spec inside `HarnessRuntime.runTests`, with the runtime
 * itself injected. Leaf consumer; no DI scope of its own.
 *
 * `onCollected` / `onTaskUpdate` delegate to the runtime, which both updates
 * the device-side reactive layer (`task-state.ts`) and forwards to the
 * pool's `state.rpc` so the reporter pipeline sees the same RuntimeRPC
 * surface that Vitest's own Node workers emit.
 */

import type { VitestRunner, VitestRunnerConfig, File, Test, TaskResultPack, TaskEventPack } from '@vitest/runner';
import { cleanup } from './render';
import { setupExpect } from './expect-setup';
import { g } from './global-types';
import { symbolicateErrors } from './symbolicate';
import { waitForContainerReady } from './context';
import type { HarnessRuntime } from './runtime';

export class ReactNativeRunner implements VitestRunner {
  constructor(
    public config: VitestRunnerConfig,
    private runtime: HarnessRuntime,
  ) {}

  async onBeforeRunFiles(_files: File[]): Promise<void> {
    // On slow devices (Android CI), the React tree may not have committed
    // TestContainerProvider by the time the pool dispatches `runTests`.
    // Wait for the provider's first render to register the module-level
    // globals before yielding through Fabric's commit pipeline.
    await waitForContainerReady();
    await new Promise<void>(r => g.setImmediate?.(r) ?? setTimeout(r, 0));
    await new Promise<void>(r => g.setImmediate?.(r) ?? setTimeout(r, 0));
    setupExpect();
  }

  // Module freshness between reruns is owned entirely by Metro's HMR — when a
  // test file (or a transitive dep) changes, Metro's dispose/accept cycle
  // re-evaluates the module, and the next `runtime.runTest(filepath)` here
  // returns the new exports. For runs where nothing changed, we intentionally
  // re-invoke `__run()` on the cached exports; the babel test-wrapper plugin
  // keeps all describe/it/hook registration inside `__run`, so re-invoking
  // it re-registers the suite from scratch without re-evaluating the file body.
  importFile(filepath: string, _source: 'collect' | 'setup'): void {
    this.runtime.runTest(filepath);
  }

  async onCollected(files: File[]): Promise<void> {
    await this.runtime.onCollected(files);
  }

  async onTaskUpdate(packs: TaskResultPack[], events: TaskEventPack[]): Promise<void> {
    // Symbolicate any errors before they leave the device so the reporter
    // renders resolved stacks and code frames.
    for (const pack of packs) {
      const result = pack?.[1];
      if (result?.errors?.length) {
        await symbolicateErrors(result);
      }
    }
    await this.runtime.onTaskUpdate(packs, events);
  }

  async onAfterRunTask(test: Test): Promise<void> {
    if (test.result?.state === 'fail') {
      await symbolicateErrors(test.result);
    }
    await cleanup();
  }
}
