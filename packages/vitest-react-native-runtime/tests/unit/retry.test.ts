import { describe, it, expect, vi } from 'vitest';
import { waitFor } from '../../src/runtime/retry';

describe('waitFor', () => {
  it('resolves immediately when fn succeeds on first call', async () => {
    const fn = vi.fn().mockReturnValue('ok');
    await expect(waitFor(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('resolves with the return value of fn', async () => {
    const result = await waitFor(() => 42);
    expect(result).toBe(42);
  });

  it('resolves with a promise return value', async () => {
    const result = await waitFor(() => Promise.resolve('async-value'));
    expect(result).toBe('async-value');
  });

  it('retries when fn throws and resolves on eventual success', async () => {
    let calls = 0;
    const result = await waitFor(
      () => {
        calls++;
        if (calls < 3) throw new Error('not yet');
        return 'done';
      },
      { interval: 10 },
    );
    expect(result).toBe('done');
    expect(calls).toBe(3);
  });

  it('throws the last error after timeout', async () => {
    const err = new Error('always fails');
    await expect(
      waitFor(
        () => {
          throw err;
        },
        { timeout: 60, interval: 10 },
      ),
    ).rejects.toThrow('always fails');
  });

  it('does not call fn again after it has succeeded', async () => {
    const fn = vi.fn().mockResolvedValue('value');
    await waitFor(fn, { timeout: 500, interval: 10 });
    // Allow a bit of time and ensure it wasn't called again
    await new Promise(r => setTimeout(r, 30));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('respects a custom timeout', async () => {
    const start = Date.now();
    await expect(
      waitFor(
        () => {
          throw new Error('fail');
        },
        { timeout: 100, interval: 20 },
      ),
    ).rejects.toThrow();
    const elapsed = Date.now() - start;
    // Should be close to 100ms, definitely not 3000ms (the default)
    expect(elapsed).toBeLessThan(500);
  });

  it('respects a custom interval between retries', async () => {
    let calls = 0;
    const start = Date.now();
    await expect(
      waitFor(
        () => {
          calls++;
          throw new Error('fail');
        },
        { timeout: 120, interval: 50 },
      ),
    ).rejects.toThrow();
    // With 120ms timeout and 50ms interval we expect ~3 calls (0ms, 50ms, 100ms)
    expect(calls).toBeGreaterThanOrEqual(2);
    expect(calls).toBeLessThanOrEqual(5);
  });

  it('passes through the fn return value even when it is falsy', async () => {
    await expect(waitFor(() => 0)).resolves.toBe(0);
    await expect(waitFor(() => false)).resolves.toBe(false);
    await expect(waitFor(() => null)).resolves.toBe(null);
    await expect(waitFor(() => '')).resolves.toBe('');
  });
});
