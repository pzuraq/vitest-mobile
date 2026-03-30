/**
 * Render API — mount a React component into the harness app's test container.
 */

import React from 'react';
import { getGlobalSetTestContent, getGlobalContainerRef } from './context';
import { createLocatorAPI, type LocatorAPI } from './locator';

export interface RenderOptions {
  wrapper?: React.ComponentType<{ children: React.ReactNode }>;
}

export interface Screen extends LocatorAPI {
  unmount(): void;
}

let defaultWrapper: React.ComponentType<{ children: React.ReactNode }> | null = null;

/**
 * Set a default wrapper that applies to all render() calls.
 * Used by the harness app to apply the setup.tsx AppWrapper automatically.
 */
export function setDefaultWrapper(wrapper: React.ComponentType<{ children: React.ReactNode }> | null) {
  defaultWrapper = wrapper;
}

export function render(element: React.ReactElement, options: RenderOptions = {}): Screen {
  const setTestContent = getGlobalSetTestContent();
  const containerRef = getGlobalContainerRef();

  const wrapper = options.wrapper ?? defaultWrapper;
  const content = wrapper ? React.createElement(wrapper, null, element) : element;

  setTestContent(content);

  const locators = createLocatorAPI(containerRef);

  return {
    ...locators,
    unmount() {
      setTestContent(null);
    },
  };
}

export async function cleanup(): Promise<void> {
  try {
    const setTestContent = getGlobalSetTestContent();
    setTestContent(null);
    await new Promise(r => setTimeout(r, 100));
  } catch {
    // If provider not mounted yet, nothing to clean up
  }
}
