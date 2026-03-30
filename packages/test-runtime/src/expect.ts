/**
 * Minimal expect() implementation for Hermes runtime.
 *
 * This is a temporary stand-in while we resolve chai/Hermes compatibility.
 * It supports the core matchers + custom RN matchers (toHaveText, toBeVisible).
 * The API matches vitest/jest so tests won't need to change when we swap back.
 */

import { Locator } from './locator';

class ExpectError extends Error {
  actual: any;
  expected: any;

  constructor(message: string, actual?: any, expected?: any) {
    super(message);
    this.name = 'ExpectError';
    this.actual = actual;
    this.expected = expected;
  }
}

function stringify(val: any): string {
  if (typeof val === 'string') return `"${val}"`;
  try {
    return JSON.stringify(val);
  } catch {
    return String(val);
  }
}

function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v: any, i: number) => deepEqual(v, b[i]));
  }
  if (typeof a === 'object') {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

function createMatchers(actual: any, isNot: boolean) {
  function assert(pass: boolean, message: string) {
    const shouldFail = isNot ? pass : !pass;
    if (shouldFail) throw new ExpectError(message);
  }

  return {
    toBe(expected: any) {
      assert(actual === expected,
        `expected ${stringify(actual)} ${isNot ? 'not ' : ''}to be ${stringify(expected)}`);
    },

    toEqual(expected: any) {
      assert(deepEqual(actual, expected),
        `expected ${stringify(actual)} ${isNot ? 'not ' : ''}to deeply equal ${stringify(expected)}`);
    },

    toBeTruthy() {
      assert(!!actual, `expected ${stringify(actual)} ${isNot ? 'not ' : ''}to be truthy`);
    },

    toBeFalsy() {
      assert(!actual, `expected ${stringify(actual)} ${isNot ? 'not ' : ''}to be falsy`);
    },

    toBeNull() {
      assert(actual === null, `expected ${stringify(actual)} ${isNot ? 'not ' : ''}to be null`);
    },

    toBeUndefined() {
      assert(actual === undefined, `expected ${stringify(actual)} ${isNot ? 'not ' : ''}to be undefined`);
    },

    toBeDefined() {
      assert(actual !== undefined, `expected value ${isNot ? 'not ' : ''}to be defined`);
    },

    toBeGreaterThan(expected: number) {
      assert(actual > expected,
        `expected ${actual} ${isNot ? 'not ' : ''}to be greater than ${expected}`);
    },

    toBeLessThan(expected: number) {
      assert(actual < expected,
        `expected ${actual} ${isNot ? 'not ' : ''}to be less than ${expected}`);
    },

    toContain(expected: any) {
      const has = Array.isArray(actual)
        ? actual.includes(expected)
        : String(actual).includes(String(expected));
      assert(has, `expected ${stringify(actual)} ${isNot ? 'not ' : ''}to contain ${stringify(expected)}`);
    },

    toHaveLength(expected: number) {
      assert(actual?.length === expected,
        `expected length ${actual?.length} ${isNot ? 'not ' : ''}to be ${expected}`);
    },

    toThrow(expected?: string | RegExp) {
      let threw = false;
      let error: any;
      try { actual(); } catch (e) { threw = true; error = e; }
      if (expected) {
        const msg = error?.message ?? String(error);
        const matches = expected instanceof RegExp ? expected.test(msg) : msg.includes(expected);
        assert(threw && matches,
          `expected function ${isNot ? 'not ' : ''}to throw matching ${stringify(expected)}`);
      } else {
        assert(threw, `expected function ${isNot ? 'not ' : ''}to throw`);
      }
    },

    // ── RN-specific matchers (work with Locator) ──

    toBeVisible() {
      if (actual instanceof Locator) {
        const exists = actual.exists;
        if (!exists) {
          assert(false, `expected element to be visible but it does not exist`);
          return;
        }
        const style = actual.props.style ?? {};
        const flat = Array.isArray(style) ? Object.assign({}, ...style) : style;
        const visible = flat.display !== 'none' && flat.opacity !== 0;
        assert(visible, `expected element ${isNot ? 'not ' : ''}to be visible`);
      } else {
        assert(!!actual, `expected value ${isNot ? 'not ' : ''}to be visible`);
      }
    },

    toHaveText(expected: string) {
      if (actual instanceof Locator) {
        const text = actual.text;
        assert(text === expected,
          `Expected element to have text ${stringify(expected)} but got ${stringify(text)}`);
      } else {
        assert(String(actual) === expected,
          `expected ${stringify(actual)} to have text ${stringify(expected)}`);
      }
    },

    toContainText(expected: string) {
      if (actual instanceof Locator) {
        const text = actual.text;
        assert(text.includes(expected),
          `expected element to contain text ${stringify(expected)} but got ${stringify(text)}`);
      } else {
        assert(String(actual).includes(expected),
          `expected ${stringify(actual)} to contain text ${stringify(expected)}`);
      }
    },
  };
}

type MatcherMethods = ReturnType<typeof createMatchers>;
type ExpectResult = MatcherMethods & { not: MatcherMethods };

export function expect(actual: any): ExpectResult {
  const matchers = createMatchers(actual, false);
  const negated = createMatchers(actual, true);
  return { ...matchers, not: negated };
}

// Support expect.extend() as a no-op for forward compatibility
expect.extend = (_matchers: Record<string, any>) => {};
