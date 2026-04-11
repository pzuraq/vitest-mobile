/**
 * VitestMobileHarness — JS bridge to the native view query + touch synthesis TurboModule.
 *
 * Query methods are synchronous (direct JSI return). They block the JS thread
 * while dispatching to the UI thread via dispatch_sync (iOS) / CountDownLatch
 * (Android). This is safe because JS runs on its own thread in New Architecture.
 *
 * Interaction methods remain async (Promise-based) because they involve timing
 * and side effects.
 */

import { TurboModuleRegistry, NativeModules, type TurboModule } from 'react-native';

export interface ViewInfo {
  nativeId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ViewTreeNode {
  type: string;
  testID?: string;
  text?: string;
  children: ViewTreeNode[];
  visible: boolean;
  frame: { x: number; y: number; width: number; height: number };
}

export interface VitestMobileHarnessModule extends TurboModule {
  queryByTestId(testId: string): ViewInfo | null;
  queryAllByTestId(testId: string): ViewInfo[];
  queryByText(text: string): ViewInfo | null;
  queryAllByText(text: string): ViewInfo[];
  getText(nativeId: string): string | null;
  isVisible(nativeId: string): boolean;
  dumpViewTree(): ViewTreeNode | null;
  simulatePress(nativeId: string, x: number, y: number): Promise<void>;
  typeChar(character: string): Promise<void>;
  typeIntoView(nativeId: string, text: string): Promise<void>;
  flushUIQueue(): Promise<void>;
}

let module: VitestMobileHarnessModule | null = null;
try {
  module = TurboModuleRegistry.getEnforcing<VitestMobileHarnessModule>('VitestMobileHarness');
} catch {
  module = NativeModules.VitestMobileHarness ?? null;
}

export default module;
