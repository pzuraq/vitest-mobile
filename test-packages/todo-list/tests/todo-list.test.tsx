import React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from 'vitest-mobile/runtime';
import { TodoListModule } from '../TodoListModule';

afterEach(async () => {
  await cleanup();
});

describe('TodoListModule', () => {
  it('shows empty message when no items', async () => {
    const screen = await render(<TodoListModule />);
    await expect.element(screen.getByTestId('empty-message')).toHaveText('No items yet');
  });

  it('renders initial items', async () => {
    const screen = await render(<TodoListModule initialItems={['Buy milk', 'Walk dog']} />);
    await expect.element(screen.getByTestId('item-count')).toHaveText('2 items');
  });

  it('adds a new item', async () => {
    const screen = await render(<TodoListModule />);
    await screen.getByTestId('todo-input').type('New task');
    await screen.getByTestId('add-btn').tap();
    await expect.element(screen.getByTestId('item-count')).toHaveText('1 items');
  });

  it('does not add empty items', async () => {
    const screen = await render(<TodoListModule />);
    await screen.getByTestId('add-btn').tap();
    await expect.element(screen.getByTestId('empty-message')).toHaveText('No items yet');
  });

  it('deletes an item', async () => {
    const screen = await render(<TodoListModule initialItems={['Task A', 'Task B', 'Task C']} />);
    await screen.getByTestId('delete-btn-1').tap();
    await expect.element(screen.getByTestId('item-count')).toHaveText('2 items');
  });
});
