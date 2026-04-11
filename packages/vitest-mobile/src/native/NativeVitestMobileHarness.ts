/**
 * TurboModule codegen spec for VitestMobileHarness.
 *
 * This file is read by React Native's codegen to generate the native
 * protocol (NativeVitestMobileHarnessSpec) that VitestMobileHarness.mm
 * conforms to.
 */

import { TurboModule, TurboModuleRegistry } from 'react-native';
import type { Double } from 'react-native/Libraries/Types/CodegenTypes';

interface ViewInfo {
  nativeId: string;
  x: Double;
  y: Double;
  width: Double;
  height: Double;
}

interface ViewTreeNode {
  type: string;
  testID?: string;
  text?: string;
  children: ViewTreeNode[];
  visible: boolean;
  frame: { x: Double; y: Double; width: Double; height: Double };
}

export interface Spec extends TurboModule {
  queryByTestId(testId: string): ViewInfo | null;
  queryAllByTestId(testId: string): ViewInfo[];
  queryByText(text: string): ViewInfo | null;
  queryAllByText(text: string): ViewInfo[];
  getText(nativeId: string): string | null;
  isVisible(nativeId: string): boolean;
  dumpViewTree(): ViewTreeNode | null;
  simulatePress(nativeId: string, x: Double, y: Double): Promise<void>;
  typeChar(character: string): Promise<void>;
  typeIntoView(nativeId: string, text: string): Promise<void>;
  flushUIQueue(): Promise<void>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('VitestMobileHarness');
