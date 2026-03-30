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

export function render(
  element: React.ReactElement,
  options: RenderOptions = {}
): Screen {
  const setTestContent = getGlobalSetTestContent();
  const containerRef = getGlobalContainerRef();

  const content = options.wrapper
    ? React.createElement(options.wrapper, null, element)
    : element;

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
    // Wait for React to commit the unmount before the next test renders
    await new Promise((r) => setTimeout(r, 100));
  } catch {
    // If provider not mounted yet, nothing to clean up
  }
}
