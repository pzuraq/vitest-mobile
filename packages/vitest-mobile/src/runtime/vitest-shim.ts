/**
 * Vitest shim for React Native — resolved by Metro in place of `vitest`.
 *
 * Lets test files use the standard vitest import:
 *   import { describe, it, expect } from 'vitest'
 */

/// <reference path="../../matchers.d.ts" />

export { describe, it, test, suite, beforeAll, beforeEach, afterAll, afterEach } from '@vitest/runner';

import { setupExpect, getExpect } from './expect-setup';

setupExpect();
export const expect = getExpect();
