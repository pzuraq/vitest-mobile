/**
 * Runner — walks the suite tree depth-first, executing tests sequentially.
 */

import type { SuiteNode, TestNode } from './collector';

export interface TestResult {
  name: string;
  suitePath: string[];
  status: 'pass' | 'fail' | 'skip';
  duration: number;
  error?: { message: string; stack?: string };
}

export interface RunResult {
  results: TestResult[];
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  duration: number;
}

export interface RunnerCallbacks {
  onSuiteStart?: (name: string, path: string[]) => void;
  onSuiteEnd?: (name: string, path: string[]) => void;
  onTestStart?: (name: string, path: string[]) => void;
  onTestPass?: (name: string, path: string[], duration: number) => void;
  onTestFail?: (name: string, path: string[], duration: number, error: { message: string; stack?: string }) => void;
  onTestSkip?: (name: string, path: string[]) => void;
  onRunComplete?: (result: RunResult) => void;
}

function hasOnly(suite: SuiteNode): boolean {
  for (const child of suite.children) {
    if (child.type === 'test' && child.only) return true;
    if (child.type === 'suite' && hasOnly(child)) return true;
  }
  return false;
}

export async function run(
  rootSuite: SuiteNode,
  callbacks: RunnerCallbacks = {}
): Promise<RunResult> {
  const results: TestResult[] = [];
  const runStart = Date.now();
  const onlyMode = hasOnly(rootSuite);

  async function runSuite(
    suite: SuiteNode,
    path: string[],
    inheritedBeforeEach: Array<() => void | Promise<void>>,
    inheritedAfterEach: Array<() => void | Promise<void>>
  ): Promise<void> {
    const suitePath = suite.name === 'root' ? path : [...path, suite.name];

    if (suite.name !== 'root') {
      callbacks.onSuiteStart?.(suite.name, suitePath);
    }

    // Run beforeAll hooks
    for (const hook of suite.beforeAll) {
      await hook();
    }

    const allBeforeEach = [...inheritedBeforeEach, ...suite.beforeEach];
    const allAfterEach = [...suite.afterEach, ...inheritedAfterEach];

    for (const child of suite.children) {
      if (child.type === 'suite') {
        await runSuite(child, suitePath, allBeforeEach, allAfterEach);
      } else {
        await runTest(child, suitePath, allBeforeEach, allAfterEach, onlyMode);
      }
    }

    // Run afterAll hooks
    for (const hook of suite.afterAll) {
      await hook();
    }

    if (suite.name !== 'root') {
      callbacks.onSuiteEnd?.(suite.name, suitePath);
    }
  }

  async function runTest(
    test: TestNode,
    suitePath: string[],
    beforeEachHooks: Array<() => void | Promise<void>>,
    afterEachHooks: Array<() => void | Promise<void>>,
    onlyMode: boolean
  ): Promise<void> {
    const fullPath = [...suitePath, test.name];

    // Skip logic
    if (test.skip || (onlyMode && !test.only)) {
      callbacks.onTestSkip?.(test.name, fullPath);
      results.push({
        name: test.name,
        suitePath,
        status: 'skip',
        duration: 0,
      });
      return;
    }

    callbacks.onTestStart?.(test.name, fullPath);
    const start = Date.now();

    try {
      for (const hook of beforeEachHooks) {
        await hook();
      }

      await test.fn();

      const duration = Date.now() - start;
      callbacks.onTestPass?.(test.name, fullPath, duration);
      results.push({ name: test.name, suitePath, status: 'pass', duration });
    } catch (err: any) {
      const duration = Date.now() - start;
      const error = {
        message: err?.message ?? String(err),
        stack: err?.stack,
      };
      callbacks.onTestFail?.(test.name, fullPath, duration, error);
      results.push({ name: test.name, suitePath, status: 'fail', duration, error });
    } finally {
      for (const hook of afterEachHooks) {
        try {
          await hook();
        } catch (hookErr) {
          console.warn('afterEach hook error:', hookErr);
        }
      }
    }
  }

  await runSuite(rootSuite, [], [], []);

  const runResult: RunResult = {
    results,
    passed: results.filter((r) => r.status === 'pass').length,
    failed: results.filter((r) => r.status === 'fail').length,
    skipped: results.filter((r) => r.status === 'skip').length,
    total: results.length,
    duration: Date.now() - runStart,
  };

  callbacks.onRunComplete?.(runResult);
  return runResult;
}
