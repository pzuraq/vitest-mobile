/**
 * Stub for `vite/module-runner` — Vitest's VitestEvaluatedModules extends
 * EvaluatedModules, and `new ModuleRunner()` is used by setupEnvironment
 * (which we replace with our own no-op). The classes must be constructible
 * so the static import graph resolves.
 */

export class EvaluatedModules {
  constructor() {
    this.idToModuleMap = new Map();
    this.fileToModulesMap = new Map();
  }
  invalidateModule() {}
  getModuleSourceMapById() {
    return null;
  }
  getModuleById() {
    return null;
  }
}

export class ModuleRunner {
  constructor() {}
  async import(id) {
    throw new Error(`[vitest-mobile] ModuleRunner.import('${id}') not supported on device`);
  }
  async close() {}
  isClosed() {
    return false;
  }
}

export class ESModulesEvaluator {}

export default { EvaluatedModules, ModuleRunner, ESModulesEvaluator };
