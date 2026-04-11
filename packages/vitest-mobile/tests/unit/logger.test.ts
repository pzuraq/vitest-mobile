import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setVerbose, isVerbose, log } from '../../src/node/logger';

describe('logger', () => {
  let savedVerbose: string | undefined;

  beforeEach(() => {
    savedVerbose = process.env.VITEST_POOL_NATIVE_VERBOSE;
  });

  afterEach(() => {
    if (savedVerbose === undefined) {
      delete process.env.VITEST_POOL_NATIVE_VERBOSE;
    } else {
      process.env.VITEST_POOL_NATIVE_VERBOSE = savedVerbose;
    }
    vi.restoreAllMocks();
  });

  it('setVerbose(true) makes isVerbose() true', () => {
    setVerbose(true);
    expect(isVerbose()).toBe(true);
  });

  it('setVerbose(false) makes isVerbose() false', () => {
    setVerbose(false);
    expect(isVerbose()).toBe(false);
  });

  it("treats env var '1' as verbose", () => {
    process.env.VITEST_POOL_NATIVE_VERBOSE = '1';
    expect(isVerbose()).toBe(true);
  });

  it("treats env var 'true' as verbose", () => {
    process.env.VITEST_POOL_NATIVE_VERBOSE = 'true';
    expect(isVerbose()).toBe(true);
  });

  it('log.info calls console.log with prefix and message', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    log.info('hello');
    expect(spy).toHaveBeenCalledWith('[vitest-mobile]', 'hello');
  });

  it('log.verbose does not call console.log when verbose is off', () => {
    setVerbose(false);
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    log.verbose('debug');
    expect(spy).not.toHaveBeenCalled();
  });

  it('log.verbose calls console.log when verbose is on', () => {
    setVerbose(true);
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    log.verbose('debug');
    expect(spy).toHaveBeenCalledWith('[vitest-mobile]', 'debug');
  });

  it('log.warn calls console.warn with prefix', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    log.warn('warning');
    expect(spy).toHaveBeenCalledWith('[vitest-mobile]', 'warning');
  });

  it('log.error calls console.error with prefix', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    log.error('err');
    expect(spy).toHaveBeenCalledWith('[vitest-mobile]', 'err');
  });
});
