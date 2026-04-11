/**
 * Centralized logger for vitest-mobile.
 *
 * In normal mode only warnings, errors, and explicit info() calls are printed.
 * In verbose mode every verbose() call is also printed.
 *
 * Enable verbose via the `verbose` pool option or VITEST_POOL_NATIVE_VERBOSE=1.
 */

const PREFIX = '[vitest-mobile]';

export function setVerbose(v: boolean): void {
  process.env.VITEST_POOL_NATIVE_VERBOSE = v ? '1' : '';
}

export function isVerbose(): boolean {
  const v = process.env.VITEST_POOL_NATIVE_VERBOSE;
  return v === '1' || v === 'true';
}

export const log = {
  /** Always printed — important status the user should see. */
  info(...args: unknown[]): void {
    console.log(PREFIX, ...args);
  },

  /** Only printed when verbose mode is on. */
  verbose(...args: unknown[]): void {
    if (isVerbose()) console.log(PREFIX, ...args);
  },

  warn(...args: unknown[]): void {
    console.warn(PREFIX, ...args);
  },

  error(...args: unknown[]): void {
    console.error(PREFIX, ...args);
  },
};
