import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, waitFor } from 'vitest-mobile/runtime';
import { ToggleModule } from '../ToggleModule';

afterEach(async () => {
  await cleanup();
});

describe('ToggleModule', () => {
  it('renders in off state by default', async () => {
    const screen = await render(<ToggleModule label="Dark Mode" />);
    await expect.element(screen.getByTestId('toggle-label')).toHaveText('OFF');
  });

  it('toggles to on state when tapped', async () => {
    const screen = await render(<ToggleModule label="Dark Mode" />);
    await screen.getByTestId('toggle-btn').tap();
    await expect.element(screen.getByTestId('toggle-label')).toHaveText('ON');
  });

  it('shows details panel when on', async () => {
    const screen = await render(<ToggleModule label="Dark Mode" />);
    await screen.getByTestId('toggle-btn').tap();
    await expect.element(screen.getByTestId('details-text')).toHaveText('Details visible');
  });

  it('hides details panel when toggled back off', async () => {
    const screen = await render(<ToggleModule label="Dark Mode" />);
    await screen.getByTestId('toggle-btn').tap();
    await screen.getByTestId('toggle-btn').tap();
    await expect.element(screen.getByTestId('toggle-label')).toHaveText('OFF');
  });

  it('calls onToggle callback with new value', async () => {
    const values: boolean[] = [];
    const screen = await render(<ToggleModule label="Notifications" onToggle={v => values.push(v)} />);
    await screen.getByTestId('toggle-btn').tap();
    await screen.getByTestId('toggle-btn').tap();
    await waitFor(() => {
      expect(values).toEqual([true, false]);
    });
  });
});
