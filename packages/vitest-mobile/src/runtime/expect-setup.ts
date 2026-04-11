/**
 * Sets up @vitest/expect with chai in the Hermes runtime.
 *
 * Idempotent — safe to call at module load time or from the runner.
 */

import { Locator } from './locator';
import { g, getErrorMessage } from './global-types';
import { poll } from './retry';
import { ensureRuntimePolyfills } from './polyfills';
import * as chaiModule from 'chai';
import * as vitestExpectModule from '@vitest/expect';

type ChaiPlugin = (chai: unknown, utils: unknown) => void;

interface ChaiCompat {
  config: { useProxy: boolean };
  use: (plugin: ChaiPlugin) => void;
  expect: ((value: unknown, message?: string) => unknown) & {
    extend: (expect: unknown, matchers: Record<string, unknown>) => void;
    [key: string]: unknown;
  };
}

interface VitestExpectCompat {
  JestChaiExpect: ChaiPlugin;
  JestAsymmetricMatchers: ChaiPlugin;
  JestExtend: ChaiPlugin;
  GLOBAL_EXPECT: symbol;
  JEST_MATCHERS_OBJECT: symbol;
  ASYMMETRIC_MATCHERS_OBJECT: symbol;
  getState: (expect: unknown) => Record<string, unknown>;
  setState: (state: Record<string, unknown>, expect: unknown) => void;
}

const chai = chaiModule as unknown as ChaiCompat;
const vitestExpect = vitestExpectModule as unknown as VitestExpectCompat;

let initialized = false;

interface ExpectFunction {
  (value: unknown, message?: string): unknown;
  getState: () => Record<string, unknown>;
  setState: (state: Record<string, unknown>) => void;
  extend: (matchers: Record<string, unknown>) => void;
  element: (locator: Locator, options?: { timeout?: number; interval?: number }) => ElementAssertion;
  [key: string]: unknown;
}

let _expect: ExpectFunction | null = null;

export function getExpect(): ExpectFunction | undefined {
  return _expect ?? (g.expect as ExpectFunction | undefined);
}

export function setupExpect() {
  if (initialized) return;
  initialized = true;

  try {
    ensureRuntimePolyfills();

    const gRecord = globalThis as unknown as Record<symbol, unknown>;

    if (!gRecord[vitestExpect.JEST_MATCHERS_OBJECT as symbol]) {
      gRecord[vitestExpect.JEST_MATCHERS_OBJECT as symbol] = { matchers: {}, state: new WeakMap() };
    }
    if (!gRecord[vitestExpect.ASYMMETRIC_MATCHERS_OBJECT as symbol]) {
      gRecord[vitestExpect.ASYMMETRIC_MATCHERS_OBJECT as symbol] = {};
    }

    // Disable chai's Proxy — can cause this-binding issues in Hermes
    chai.config.useProxy = false;

    try {
      chai.use(vitestExpect.JestChaiExpect);
    } catch (e: unknown) {
      console.error('[expect-setup] JestChaiExpect FAILED:', getErrorMessage(e));
      throw e;
    }

    try {
      chai.use(vitestExpect.JestAsymmetricMatchers);
    } catch (e: unknown) {
      console.error('[expect-setup] JestAsymmetricMatchers FAILED:', getErrorMessage(e));
      throw e;
    }

    try {
      chai.use(vitestExpect.JestExtend);
    } catch (e: unknown) {
      console.error('[expect-setup] JestExtend FAILED:', getErrorMessage(e));
      throw e;
    }

    // Must be a separate function, NOT chai.expect itself, to avoid recursion
    // when JestExtendPlugin defines properties on the expect object.
    const expect: ExpectFunction = ((value: unknown, message?: string) => {
      const { assertionCalls } = vitestExpect.getState(expect);
      vitestExpect.setState({ assertionCalls: (assertionCalls as number) + 1 }, expect);
      return chai.expect(value, message);
    }) as ExpectFunction;
    Object.assign(expect, chai.expect);
    Object.assign(expect, gRecord[vitestExpect.ASYMMETRIC_MATCHERS_OBJECT as symbol] as object);
    expect.getState = () => vitestExpect.getState(expect);
    expect.setState = (state: Record<string, unknown>) => vitestExpect.setState(state, expect);
    vitestExpect.setState(
      {
        assertionCalls: 0,
        isExpectingAssertions: false,
        isExpectingAssertionsError: null,
        expectedAssertionsNumber: null,
        expectedAssertionsNumberErrorGen: null,
      },
      expect,
    );
    gRecord[vitestExpect.GLOBAL_EXPECT as symbol] = expect;

    // Wire extend() — call as method on chai.expect to preserve `this` binding
    expect.extend = (matchers: Record<string, unknown>) => {
      chai.expect.extend(expect, matchers);
    };

    try {
      (expect(1) as { toBe(v: unknown): void }).toBe(1);
    } catch (e: unknown) {
      console.error('[expect-setup] Self-test failed:', getErrorMessage(e));
    }

    // expect.element(locator) — retrying assertion API matching Vitest Browser Mode.
    // Returns an object with matcher methods that poll until the assertion passes.
    expect.element = (locator: Locator, options?: { timeout?: number; interval?: number }) => {
      return createElementAssertion(locator, false, options);
    };

    // Make expect available via import and globally
    _expect = expect;
    g.expect = expect;
  } catch (err: unknown) {
    console.error('[expect-setup] Failed to initialize @vitest/expect:', getErrorMessage(err));
    console.error('[expect-setup] Falling back to minimal expect');
  }
}

// ── expect.element() — retrying assertions for Locators ──────────

const DEFAULT_POLL_TIMEOUT = 3000;
const DEFAULT_POLL_INTERVAL = 50;

interface ElementAssertion {
  toHaveText(expected: string): Promise<void>;
  toContainText(expected: string): Promise<void>;
  toBeVisible(): Promise<void>;
  not: ElementAssertion;
}

function createElementAssertion(
  locator: Locator,
  negated: boolean,
  options?: { timeout?: number; interval?: number },
): ElementAssertion {
  const timeout = options?.timeout ?? DEFAULT_POLL_TIMEOUT;
  const interval = options?.interval ?? DEFAULT_POLL_INTERVAL;

  return {
    async toHaveText(expected: string) {
      await poll(
        async () => {
          const actual = locator.text;
          if (!negated && actual !== expected) {
            throw new Error(`Expected element to have text "${expected}" but got "${actual}"`);
          }
          if (negated && actual === expected) {
            throw new Error(`Expected element NOT to have text "${expected}"`);
          }
        },
        { timeout, interval },
      );
    },

    async toContainText(expected: string) {
      await poll(
        async () => {
          const actual = locator.text;
          if (!negated && !actual.includes(expected)) {
            throw new Error(`Expected element to contain text "${expected}" but got "${actual}"`);
          }
          if (negated && actual.includes(expected)) {
            throw new Error(`Expected element NOT to contain text "${expected}"`);
          }
        },
        { timeout, interval },
      );
    },

    async toBeVisible() {
      await poll(
        async () => {
          const visible = locator.exists;
          if (!negated && !visible) {
            throw new Error('Expected element to be visible but it does not exist');
          }
          if (negated && visible) {
            throw new Error('Expected element NOT to be visible');
          }
        },
        { timeout, interval },
      );
    },

    get not() {
      return createElementAssertion(locator, !negated, options);
    },
  };
}
