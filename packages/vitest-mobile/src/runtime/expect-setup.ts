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
      return new ElementAssertion(locator, false, options);
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

/**
 * Stack lines for async matcher helpers (expect-setup, retry) in this package
 * that sit between the test and the poll callback — we skip these so
 * the synchronous capture maps to the test (or immediate caller) instead.
 */
function isInternalMatcherFrameLine(line: string): boolean {
  if (line.includes('captureAssertionCallSite')) return true;
  if (!line.includes('vitest-mobile') || !/[/\\]runtime[/\\]/.test(line)) return false;
  return /expect-setup\.\w+/.test(line) || /[/\\]retry\.\w+/.test(line);
}

/** Call synchronously at matcher entry; stack lines to prepend to thrown errors. */
function captureAssertionCallSite(): string {
  const err = new Error();
  const Er = Error as unknown as { captureStackTrace?: (e: Error, fn: () => void) => void };
  if (typeof Er.captureStackTrace === 'function') {
    Er.captureStackTrace(err, captureAssertionCallSite);
  }
  const lines = (err.stack ?? '').split('\n');
  const out: string[] = [];
  for (const line of lines.slice(1)) {
    if (isInternalMatcherFrameLine(line)) continue;
    out.push(line);
  }
  return out.slice(0, 12).join('\n');
}

const hasCaptureStackTrace =
  typeof (Error as unknown as { captureStackTrace?: (e: Error, fn: Function) => void }).captureStackTrace ===
  'function';

/**
 * One Error per matcher call, created at the test callsite. The poll layer only
 * updates the message and rethrows — we do not keep async/retry stack frames.
 */
function createAtCallSiteError(boundary: Function): { err: Error; syncSite: string } {
  const syncSite = captureAssertionCallSite();
  const err = new Error();
  if (hasCaptureStackTrace) {
    const Er = Error as unknown as { captureStackTrace: (e: Error, fn: Function) => void };
    Er.captureStackTrace(err, boundary);
  } else {
    err.stack = `${err.name}: ${err.message || ''}\n${syncSite}`;
  }
  return { err, syncSite };
}

function setAtCallSiteErrorMessage(err: Error, syncSite: string, message: string): void {
  err.message = message;
  if (!hasCaptureStackTrace) {
    err.stack = `${err.name}: ${message}\n${syncSite}`;
  }
}

class ElementAssertion {
  private readonly _timeout: number;
  private readonly _interval: number;

  constructor(
    private readonly locator: Locator,
    private readonly negated: boolean,
    private readonly options?: { timeout?: number; interval?: number },
  ) {
    this._timeout = options?.timeout ?? DEFAULT_POLL_TIMEOUT;
    this._interval = options?.interval ?? DEFAULT_POLL_INTERVAL;
  }

  toHaveText(expected: string): Promise<void> {
    const { locator, negated } = this;
    const timeout = this._timeout;
    const interval = this._interval;
    async function toHaveTextForElement(exp: string) {
      const { err, syncSite } = createAtCallSiteError(toHaveTextForElement);
      await poll(
        async () => {
          const actual = locator.text;
          if (!negated && actual !== exp) {
            setAtCallSiteErrorMessage(err, syncSite, `Expected element to have text "${exp}" but got "${actual}"`);
            throw err;
          }
          if (negated && actual === exp) {
            setAtCallSiteErrorMessage(err, syncSite, `Expected element NOT to have text "${exp}"`);
            throw err;
          }
        },
        { timeout, interval },
      );
    }
    return toHaveTextForElement(expected);
  }

  toContainText(expected: string): Promise<void> {
    const { locator, negated } = this;
    const timeout = this._timeout;
    const interval = this._interval;
    async function toContainTextForElement(exp: string) {
      const { err, syncSite } = createAtCallSiteError(toContainTextForElement);
      await poll(
        async () => {
          const actual = locator.text;
          if (!negated && !actual.includes(exp)) {
            setAtCallSiteErrorMessage(err, syncSite, `Expected element to contain text "${exp}" but got "${actual}"`);
            throw err;
          }
          if (negated && actual.includes(exp)) {
            setAtCallSiteErrorMessage(err, syncSite, `Expected element NOT to contain text "${exp}"`);
            throw err;
          }
        },
        { timeout, interval },
      );
    }
    return toContainTextForElement(expected);
  }

  toBeVisible(): Promise<void> {
    const { locator, negated } = this;
    const timeout = this._timeout;
    const interval = this._interval;
    async function toBeVisibleForElement() {
      const { err, syncSite } = createAtCallSiteError(toBeVisibleForElement);
      await poll(
        async () => {
          const visible = locator.exists;
          if (!negated && !visible) {
            setAtCallSiteErrorMessage(err, syncSite, 'Expected element to be visible but it does not exist');
            throw err;
          }
          if (negated && visible) {
            setAtCallSiteErrorMessage(err, syncSite, 'Expected element NOT to be visible');
            throw err;
          }
        },
        { timeout, interval },
      );
    }
    return toBeVisibleForElement();
  }

  get not(): ElementAssertion {
    return new ElementAssertion(this.locator, !this.negated, this.options);
  }
}
