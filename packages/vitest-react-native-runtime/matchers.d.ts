interface NativeMatchers<R = void> {
  /** Assert the element is visible (not display:none or opacity:0). */
  toBeVisible(): R;
  /** Assert the element's text content equals the expected string. */
  toHaveText(expected: string): R;
  /** Assert the element's text content contains the expected string. */
  toContainText(expected: string): R;
}

// Augment vitest's expect (used in Node-side test configs / mixed setups)
declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Assertion<T = any> extends NativeMatchers<void> {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface AsymmetricMatchersContaining extends NativeMatchers<void> {}
}

// Augment @vitest/expect directly (used by tests running inside the RN harness
// via vitest-react-native-runtime/vitest-shim, which re-exports expect from @vitest/expect)
declare module '@vitest/expect' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Assertion<T = any> extends NativeMatchers<void> {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface AsymmetricMatchersContaining extends NativeMatchers<void> {}
}

export {};
