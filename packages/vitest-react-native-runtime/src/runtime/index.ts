/**
 * vitest-react-native-runtime/runtime — Public API.
 *
 * Harness: createTestHarness
 * Tests: render, cleanup, waitFor, Locator
 */

// Harness app
export { createTestHarness } from './harness';
export { connectToVitest, onStatusChange } from './setup';
export type { HarnessStatus, ConnectOptions } from './setup';
export { TestContainerProvider, waitForContainerReady } from './context';

// Test API
export { render, cleanup, setDefaultWrapper } from './render';
export type { RenderOptions, Screen } from './render';
export { waitFor } from './retry';
export { Locator } from './locator';
export type { LocatorAPI } from './locator';
