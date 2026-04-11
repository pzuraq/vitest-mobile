import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from 'vitest-mobile/runtime';
import { GreetingModule } from '../GreetingModule';

afterEach(async () => {
  await cleanup();
});

describe('GreetingModule', () => {
  it('shows placeholder when no name is entered', async () => {
    const screen = await render(<GreetingModule />);
    await expect.element(screen.getByTestId('greeting-text')).toHaveText('Enter your name');
  });

  it('renders with default name', async () => {
    const screen = await render(<GreetingModule defaultName="Alice" />);
    await expect.element(screen.getByTestId('greeting-text')).toHaveText('Hello, Alice!');
  });

  it('updates greeting when name is typed', async () => {
    const screen = await render(<GreetingModule />);
    await screen.getByTestId('name-input').type('Bob');
    await expect.element(screen.getByTestId('greeting-text')).toHaveText('Hello, Bob!');
  });

  it('shows character count', async () => {
    const screen = await render(<GreetingModule defaultName="Eve" />);
    await expect.element(screen.getByTestId('char-count')).toHaveText('3 characters');
  });

  it('clears name when clear button is tapped', async () => {
    const screen = await render(<GreetingModule defaultName="Alice" />);
    await screen.getByTestId('clear-btn').tap();
    await expect.element(screen.getByTestId('greeting-text')).toHaveText('Enter your name');
  });
});
