/**
 * Pause API — freeze test execution indefinitely for interactive development.
 *
 * When pause() is called in a test:
 *   - dev mode: blocks until resumed (via Enter key, UI resume button, or file edit)
 *   - run mode: throws an error (forces cleanup before CI)
 *
 * Component HMR updates render live while paused.
 * Test file edits trigger a rerun (abort → fresh start → pause again).
 */

import { isPaused, setHarnessStatus } from './store';
import { enableFastRefresh, disableFastRefresh } from './global-types';

export interface PauseOptions {
  /** Descriptive label shown in terminal (e.g., "after login flow") */
  label?: string;
  /** Auto-screenshot on pause. Default: true */
  screenshot?: boolean;
}

// ── Module-level state ──────────────────────────────────────────
//
// `isPaused` is the single reactive flag shared with the explorer UI
// (`store.ts`). The other refs (resume resolver, abort signal, notify pool)
// stay non-reactive — they're imperative plumbing, not UI state.

let _abortSignal: AbortSignal | null = null;
let _notifyPool: ((msg: Record<string, unknown>) => void) | null = null;
let _resumeResolver: (() => void) | null = null;
let _mode: 'dev' | 'run' = 'dev';

/**
 * Called by `HarnessRuntime.runTests` at the start of each run. Provides
 * the abort signal (released on HMR file edit / explorer Stop) and pool
 * notification channel for this run.
 */
export function configurePause(opts: {
  notifyPool: (msg: Record<string, unknown>) => void;
  abortSignal: AbortSignal;
  mode: 'dev' | 'run';
}): void {
  _notifyPool = opts.notifyPool;
  _abortSignal = opts.abortSignal;
  _mode = opts.mode;
  isPaused.value = false;
  _resumeResolver = null;
}

/**
 * Called when the pool sends a __resume message.
 */
export function resume(): void {
  if (_resumeResolver) {
    _resumeResolver();
    _resumeResolver = null;
  }
}

/**
 * Pause test execution indefinitely.
 *
 * In dev mode: blocks until resumed or aborted.
 * In run mode: throws immediately.
 *
 * @example
 * ```tsx
 * it('develops a component', async () => {
 *   const screen = render(<MyComponent />);
 *   await screen.findByTestId('loaded');
 *   await pause(); // Stops here — edit component, take screenshots
 *   expect(screen.getByTestId('result')).toHaveText('Done');
 * });
 * ```
 */
export async function pause(options?: PauseOptions): Promise<void> {
  if (_mode === 'run') {
    throw new Error('pause() is not allowed in run mode. Remove it before running in CI.');
  }

  // When running from the explorer UI without the pool, there's no abort signal.
  // We still pause — the explorer UI shows a "Continue" button that calls resume().
  const isExplorerOnly = !_abortSignal;

  const signal = _abortSignal;
  if (signal?.aborted) {
    throw signal.reason;
  }

  isPaused.value = true;
  enableFastRefresh();

  const label = options?.label;
  setHarnessStatus({
    state: 'paused',
    message: label ? `Paused: ${label}` : 'Paused',
    label,
  });

  // Notify pool — triggers terminal status, auto-screenshot, stdin listener
  if (!isExplorerOnly) {
    _notifyPool?.({
      type: 'pause',
      data: { label, screenshot: options?.screenshot },
    });
  }

  try {
    await new Promise<void>((resolve, reject) => {
      _resumeResolver = resolve;

      if (signal) {
        const onAbort = () => {
          _resumeResolver = null;
          reject(signal.reason ?? new DOMException('Test run aborted while paused', 'AbortError'));
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }
    });
  } finally {
    isPaused.value = false;
    _resumeResolver = null;
    disableFastRefresh();
    if (!isExplorerOnly) {
      _notifyPool?.({ type: 'pauseEnded' });
    }
    setHarnessStatus({ state: 'running', message: 'Resumed' });
  }
}
