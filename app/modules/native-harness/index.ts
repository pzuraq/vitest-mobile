/**
 * NativeHarness — JS interface to the native view query + touch synthesis module.
 *
 * This is the bridge between the test runtime (JS) and the native iOS
 * view hierarchy. Queries and interactions go through real UIKit APIs,
 * not React fiber internals.
 */

import { requireNativeModule } from 'expo-modules-core';

interface NativeHarnessModule {
  /**
   * Find a view by its accessibilityIdentifier (React Native testID).
   * Returns the view's reactTag (number) or null if not found.
   */
  findByTestId(testId: string): number | null;

  /**
   * Read text content from the view and its subviews.
   * Falls back to accessibilityLabel if no UILabel found.
   */
  getText(reactTag: number): string | null;

  /**
   * Get the screen-space frame of a view: { x, y, width, height }.
   */
  getFrame(reactTag: number): { x: number; y: number; width: number; height: number } | null;

  /**
   * Check if a view is visible (not hidden, alpha > 0, on screen).
   */
  isVisible(reactTag: number): boolean;

  /**
   * Get all props-like info: accessibilityIdentifier, accessibilityLabel, isEnabled.
   */
  getViewInfo(reactTag: number): {
    testId: string | null;
    text: string | null;
    isVisible: boolean;
    isEnabled: boolean;
    frame: { x: number; y: number; width: number; height: number };
  } | null;

  /**
   * Dispatch a real tap at the center of the view identified by reactTag.
   */
  tap(reactTag: number): Promise<void>;

  /**
   * Dispatch a real long press at the center of the view.
   */
  longPress(reactTag: number, durationMs: number): Promise<void>;

  /**
   * Type text by dispatching key events.
   */
  typeText(text: string): Promise<void>;
}

export default requireNativeModule<NativeHarnessModule>('NativeHarness');
