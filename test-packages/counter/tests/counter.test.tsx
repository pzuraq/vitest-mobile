import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, waitFor } from 'vitest-mobile/runtime';
import { CounterModule } from '../CounterModule';

afterEach(async () => {
  await cleanup();
});

describe('CounterModule', () => {
  it('renders initial count of zero', async () => {
    const screen = await render(<CounterModule userId="123" />);
    await expect.element(screen.getByTestId('count-display')).toHaveText('0');
  });

  it('increments on press', async () => {
    const screen = await render(<CounterModule userId="123" />);
    await screen.getByTestId('increment-btn').tap();
    await expect.element(screen.getByTestId('count-display')).toHaveText('1');
  });

  it('renders compact variant', async () => {
    const screen = await render(<CounterModule userId="123" variant="compact" />);
    await expect.element(screen.getByTestId('compact-layout')).toBeVisible();
  });

  it('calls onCountChange callback', async () => {
    const spy = { calls: [] as number[] };
    const screen = await render(<CounterModule userId="123" onCountChange={(n: number) => spy.calls.push(n)} />);
    await screen.getByTestId('increment-btn').tap();
    await screen.getByTestId('increment-btn').tap();
    await waitFor(() => {
      expect(spy.calls).toEqual([1, 2]);
    });
  });
});
