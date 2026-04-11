/**
 * Render API — mount a React component into the harness app's test container.
 */

import React from 'react';
import { getGlobalSetTestContent, getGlobalContainerRef, nextRenderKey } from './context';
import { createLocatorAPI, type LocatorAPI } from './locator';
import { getViewTree, getViewTreeString, Harness } from './tree';
import type { ViewTreeNode } from './native-harness';

export interface RenderOptions {
  wrapper?: React.ComponentType<{ children: React.ReactNode }>;
}

export interface Screen extends LocatorAPI {
  unmount(): void;
  dumpTree(): string;
  getTree(): ViewTreeNode | null;
}

let defaultWrapper: React.ComponentType<{ children: React.ReactNode }> | null = null;

function yield_(): Promise<void> {
  const si = (globalThis as unknown as { setImmediate?: (fn: () => void) => void }).setImmediate;
  return new Promise(r => si?.(r) ?? setTimeout(r, 0));
}

export async function render(element: React.ReactElement, options: RenderOptions = {}): Promise<Screen> {
  const setTestContent = getGlobalSetTestContent();
  const containerRef = getGlobalContainerRef();

  const wrapper = options.wrapper ?? defaultWrapper;
  const content = wrapper ? React.createElement(wrapper, null, element) : element;

  // Increment key to force React to destroy previous tree and create fresh state
  nextRenderKey();
  setTestContent(content);

  // Wait for React to process the state update and Fabric to commit the views.
  // Fabric's commit pipeline is multi-stage: React reconcile → shadow tree mount
  // → native view mutations → layout. Each stage may dispatch to the main queue
  // separately, so we yield multiple times and flush twice to drain the pipeline.
  await yield_();
  await yield_();
  await Harness.flushUIQueue();
  await yield_();
  await Harness.flushUIQueue();

  const locators = createLocatorAPI();

  return {
    ...locators,
    unmount() {
      setTestContent(null);
    },
    dumpTree() {
      return getViewTreeString();
    },
    getTree() {
      return getViewTree();
    },
  };
}

export async function cleanup(): Promise<void> {
  try {
    const setTestContent = getGlobalSetTestContent();
    setTestContent(null);
    // Yield to let React schedule the unmount commit, then flush
    // multiple times to ensure Fabric has fully removed old native views.
    // Without this, findByTestId can match stale views from the
    // previous test on slow devices.
    await yield_();
    await yield_();
    await Harness.flushUIQueue();
    await yield_();
    await Harness.flushUIQueue();
  } catch {
    // If provider not mounted yet, nothing to clean up
  }
}
