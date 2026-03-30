/**
 * test-runtime — Public API
 *
 * Provides a Vitest/Jest-like API for running component tests
 * inside a real React Native app.
 */

// Re-export test structure functions
export { describe, it, beforeAll, afterAll, beforeEach, afterEach } from './collector';
export { getRootSuite, resetCollector } from './collector';
export type { SuiteNode, TestNode } from './collector';

// Re-export runner
export { run } from './runner';
export type { TestResult, RunResult, RunnerCallbacks } from './runner';

// Re-export render API
export { render, cleanup } from './render';
export type { RenderOptions, Screen } from './render';

// Re-export context provider
export { TestContainerProvider } from './context';

// Re-export reporter
export { connectReporter, disconnectReporter, createReporterCallbacks } from './reporter';

// Re-export retry
export { waitFor } from './retry';

// Re-export locator
export { Locator } from './locator';
export type { LocatorAPI } from './locator';

// Minimal expect() that works in Hermes.
// TODO: swap back to @vitest/expect once chai Hermes compat is resolved.
export { expect } from './expect';

console.log('[test-runtime] Setup complete');
