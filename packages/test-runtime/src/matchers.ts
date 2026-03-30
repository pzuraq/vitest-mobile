/**
 * Custom matchers for Locators — toBeVisible(), toHaveText(), etc.
 * These work with the Locator class, which re-resolves on every access.
 */

import { Locator } from './locator';

function isLocator(value: unknown): value is Locator {
  return value instanceof Locator;
}

export const rnMatchers = {
  toBeVisible(received: unknown) {
    if (!isLocator(received)) {
      return {
        pass: false,
        message: () => `Expected a Locator but received ${typeof received}`,
      };
    }

    // A locator is "visible" if it exists and doesn't have display:none or opacity:0
    const exists = received.exists;
    if (!exists) {
      return {
        pass: false,
        message: () => `Expected element to be visible but it does not exist in the tree`,
      };
    }

    const style = received.props.style ?? {};
    const flatStyle = Array.isArray(style) ? Object.assign({}, ...style) : style;
    const isVisible = flatStyle.display !== 'none' && flatStyle.opacity !== 0;

    return {
      pass: isVisible,
      message: () =>
        isVisible
          ? `Expected element NOT to be visible`
          : `Expected element to be visible but it has display:${flatStyle.display} opacity:${flatStyle.opacity}`,
    };
  },

  toHaveText(received: unknown, expected: string) {
    if (!isLocator(received)) {
      return {
        pass: false,
        message: () => `Expected a Locator but received ${typeof received}`,
      };
    }

    const actual = received.text;
    const pass = actual === expected;

    return {
      pass,
      message: () =>
        pass
          ? `Expected element NOT to have text "${expected}"`
          : `Expected element to have text "${expected}" but got "${actual}"`,
    };
  },

  toContainText(received: unknown, expected: string) {
    if (!isLocator(received)) {
      return {
        pass: false,
        message: () => `Expected a Locator but received ${typeof received}`,
      };
    }

    const actual = received.text;
    const pass = actual.includes(expected);

    return {
      pass,
      message: () =>
        pass
          ? `Expected element NOT to contain text "${expected}"`
          : `Expected element to contain text "${expected}" but got "${actual}"`,
    };
  },

  toHaveTestId(received: unknown, expected: string) {
    if (!isLocator(received)) {
      return {
        pass: false,
        message: () => `Expected a Locator but received ${typeof received}`,
      };
    }

    const testID = received.props.testID;
    const pass = testID === expected;

    return {
      pass,
      message: () =>
        pass
          ? `Expected element NOT to have testID "${expected}"`
          : `Expected element to have testID "${expected}" but got "${testID}"`,
    };
  },
};
