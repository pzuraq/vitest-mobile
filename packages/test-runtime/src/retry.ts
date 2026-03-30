/**
 * Retry — polling/retry logic for async UI assertions.
 */

export interface RetryOptions {
  timeout?: number;
  interval?: number;
}

const DEFAULT_TIMEOUT = 3000;
const DEFAULT_INTERVAL = 50;

export async function waitFor<T>(
  fn: () => T | Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { timeout = DEFAULT_TIMEOUT, interval = DEFAULT_INTERVAL } = options;
  const deadline = Date.now() + timeout;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const result = await fn();
      return result;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw lastError;
}
