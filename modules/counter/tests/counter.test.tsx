/**
 * Counter module tests — demonstrates the test harness capabilities.
 *
 * Locators re-resolve on every access (like Vitest browser mode),
 * so there's no stale reference problem after state updates.
 */

import React from 'react';
import {
  describe,
  it,
  expect,
  render,
  waitFor,
} from 'test-runtime';
import { CounterModule } from '../CounterModule';

describe('CounterModule', () => {
  it('renders initial count of zero', async () => {
    const screen = render(<CounterModule userId="123" />);
    const count = await screen.findByTestId('count-display');
    expect(count).toHaveText('0');
  });

  it('increments on press', async () => {
    const screen = render(<CounterModule userId="123" />);
    const btn = await screen.findByTestId('increment-btn');
    await btn.tap();
    // count re-resolves automatically — reads fresh from the tree
    const count = screen.getByTestId('count-display');
    await waitFor(() => {
      expect(count).toHaveText('1');
    });
  });

  it('renders compact variant', async () => {
    const screen = render(<CounterModule userId="123" variant="compact" />);
    const layout = await screen.findByTestId('compact-layout');
    expect(layout).toBeVisible();
  });

  it('calls onCountChange callback', async () => {
    const spy = { calls: [] as number[] };
    const screen = render(
      <CounterModule
        userId="123"
        onCountChange={(n: number) => spy.calls.push(n)}
      />
    );
    const btn = await screen.findByTestId('increment-btn');
    await btn.tap();
    await btn.tap();
    await waitFor(() => {
      expect(spy.calls).toEqual([1, 2]);
    });
  });
});
