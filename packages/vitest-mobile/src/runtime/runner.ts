/**
 * ReactNativeRunner — VitestRunner implementation for Hermes/RN.
 */

import type { VitestRunner, VitestRunnerConfig, File, Test, TaskResultPack, TaskEventPack } from '@vitest/runner';
import { importTestFile, testFileKeys } from 'vitest-mobile/test-registry';
import { cleanup } from './render';
import { waitForContainerReady } from './context';
import { setupExpect } from './expect-setup';
import { g, type MetroModule } from './global-types';
import { symbolicateErrors } from './symbolicate';
import { resolveRegistryKey } from './registry-utils';

export interface RuntimeRpcBridge {
  onCollected(files: File[]): void;
  onTaskUpdate(packs: TaskResultPack[], events?: TaskEventPack[]): void;
  onUnhandledError(err: unknown, type: string): void;
}

type TestCallback = (test: Test) => void;

/**
 * Get Metro's EMPTY sentinel used for uninitialized importedAll/importedDefault.
 * We need the exact reference since require.importAll checks `!== EMPTY`.
 */
let _emptySentinel: unknown = null;
function getEmptySentinel(): unknown {
  if (_emptySentinel) return _emptySentinel;
  const getModules = g.__r?.getModules;
  if (!getModules) return {};
  for (const [, mod] of getModules()) {
    if (!mod.isInitialized && mod.importedAll !== undefined) {
      _emptySentinel = mod.importedAll;
      return _emptySentinel;
    }
  }
  return {};
}

/**
 * Force Metro to re-evaluate a test module on next require() by clearing
 * its initialized state in the module table. This ensures we always run
 * the latest factory (whether updated by HMR or still the original).
 */
function invalidateTestModule(registryKey: string) {
  const getModules = g.__r?.getModules;
  if (!getModules) return;
  const empty = getEmptySentinel();
  const modules = getModules();
  for (const [, mod] of modules) {
    const name: string | undefined = mod?.verboseName ?? mod?.path;
    if (name && name.includes(registryKey.replace(/\.[^.]+$/, ''))) {
      mod.isInitialized = false;
      mod.importedAll = empty;
      mod.importedDefault = empty;
      break;
    }
  }
}

export class ReactNativeRunner implements VitestRunner {
  config: VitestRunnerConfig;
  private rpc: RuntimeRpcBridge;
  private onTestDone?: TestCallback;

  constructor(config: VitestRunnerConfig, rpc: RuntimeRpcBridge, onTestDone?: TestCallback) {
    this.config = config;
    this.rpc = rpc;
    this.onTestDone = onTestDone;
  }

  async onBeforeRunFiles(_files: File[]): Promise<void> {
    await waitForContainerReady();
    // Wait for Fabric to commit the initial view tree
    await new Promise<void>(r => g.setImmediate?.(r) ?? setTimeout(r, 0));
    await new Promise<void>(r => g.setImmediate?.(r) ?? setTimeout(r, 0));
    setupExpect();
  }

  async importFile(filepath: string, source: 'collect' | 'setup'): Promise<void> {
    // Resolve the registry key from the filepath
    const key = this.resolveKey(filepath);

    if (key) {
      invalidateTestModule(key);
      const mod = await importTestFile(key);
      if (mod && typeof mod.__run === 'function') {
        mod.__run();
      }
    } else {
      console.warn(`[runner] File not found in registry: ${filepath}`);
    }
  }

  /** Try to match a filepath to a test-registry key. */
  private resolveKey(filepath: string): string | null {
    return resolveRegistryKey(filepath, testFileKeys);
  }

  onCollected(files: File[]): void {
    this.rpc.onCollected(files);
  }

  async onTaskUpdate(packs: TaskResultPack[], events: TaskEventPack[]): Promise<void> {
    for (const pack of packs) {
      const result = pack?.[1];
      if (result?.errors?.length) {
        await symbolicateErrors(result);
      }
    }
    this.rpc.onTaskUpdate(packs, events);
  }

  async onAfterRunTask(test: Test): Promise<void> {
    if (test.result?.state === 'fail') {
      await symbolicateErrors(test.result);
    }
    this.onTestDone?.(test);
    await cleanup();
  }
}
