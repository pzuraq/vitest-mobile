/**
 * NativeHarness — JS bridge to the native view query + touch synthesis module.
 *
 * Works on both iOS (UIKit/Hammer) and Android (View hierarchy/MotionEvent).
 * Returns null if the native module is not available (e.g., Expo Go).
 */

interface NativeHarnessModule {
  findByTestId(testId: string): number | null;
  getText(reactTag: number): string | null;
  getFrame(reactTag: number): { x: number; y: number; width: number; height: number } | null;
  isVisible(reactTag: number): boolean;
  getViewInfo(reactTag: number): {
    testId: string | null;
    text: string | null;
    isVisible: boolean;
    isEnabled: boolean;
    frame: { x: number; y: number; width: number; height: number };
  } | null;
  tap(reactTag: number): Promise<void>;
  longPress(reactTag: number, durationMs: number): Promise<void>;
  typeText(text: string): Promise<void>;
}

let module: NativeHarnessModule | null = null;
try {
  const { requireNativeModule } = require('expo-modules-core');
  module = requireNativeModule('NativeHarness');
} catch {
  // Native module not available — will fall back to fiber traversal
}

export default module;
