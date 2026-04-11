import type { Locator } from './src/runtime/locator';

interface NativeElementAssertion {
  toHaveText(expected: string): Promise<void>;
  toContainText(expected: string): Promise<void>;
  toBeVisible(): Promise<void>;
  not: NativeElementAssertion;
}

interface NativeExpectExtension {
  element(locator: Locator, options?: { timeout?: number; interval?: number }): NativeElementAssertion;
}

declare module 'vitest' {
  interface ExpectStatic extends NativeExpectExtension {}
}

declare module '@vitest/expect' {
  interface ExpectStatic extends NativeExpectExtension {}
}

export {};
