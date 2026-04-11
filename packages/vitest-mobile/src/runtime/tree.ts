/**
 * Tree — view tree queries backed by the VitestMobileHarness TurboModule.
 *
 * All query functions are synchronous because the native TurboModule methods
 * use dispatch_sync (iOS) / CountDownLatch (Android) to block the JS thread
 * while executing on the UI thread.
 */

import type { ResolvedElement } from './locator';
import VitestMobileHarnessModule from './native-harness';
import type { ViewInfo } from './native-harness';

if (!VitestMobileHarnessModule) {
  console.warn(
    '[vitest-mobile] VitestMobileHarness module not available. ' +
      'View queries will not work. Make sure the app is built with native modules.',
  );
}

const Harness: NonNullable<typeof VitestMobileHarnessModule> = VitestMobileHarnessModule!;

function makeNativeElement(info: ViewInfo, label: string): ResolvedElement {
  return { _type: 'native', nativeId: info.nativeId, info, label };
}

export function resolveByTestId(testId: string): ResolvedElement | null {
  const info = Harness.queryByTestId(testId) as ViewInfo | null;
  if (!info) return null;
  return makeNativeElement(info, `testID="${testId}"`);
}

export function resolveAllByTestId(testId: string): ResolvedElement[] {
  const infos = Harness.queryAllByTestId(testId) as ViewInfo[];
  return infos.map((info, i) => makeNativeElement(info, `testID="${testId}"[${i}]`));
}

export function resolveByText(text: string): ResolvedElement | null {
  const info = Harness.queryByText(text) as ViewInfo | null;
  if (!info) return null;
  return makeNativeElement(info, `text="${text}"`);
}

export function resolveAllByText(text: string): ResolvedElement[] {
  const infos = Harness.queryAllByText(text) as ViewInfo[];
  return infos.map((info, i) => makeNativeElement(info, `text="${text}"[${i}]`));
}

export function readText(element: ResolvedElement): string {
  return Harness.getText(element.nativeId) ?? '';
}

export function readProps(element: ResolvedElement): Record<string, unknown> {
  const { info } = element;
  return {
    testID: null,
    style: {},
    frame: info ? { x: info.x, y: info.y, width: info.width, height: info.height } : {},
  };
}

export function findHandler(
  _element: ResolvedElement,
  _propName: string,
): ((...args: unknown[]) => unknown) | undefined {
  return undefined;
}

export type { ViewTreeNode } from './native-harness';

export function getViewTree(): import('./native-harness').ViewTreeNode | null {
  return Harness.dumpViewTree();
}

export function getViewTreeString(options?: { maxDepth?: number }): string {
  const tree = Harness.dumpViewTree();
  if (!tree) return '(empty)';
  return formatTreeNode(tree as import('./native-harness').ViewTreeNode, 0, options?.maxDepth ?? 20);
}

function formatTreeNode(node: import('./native-harness').ViewTreeNode, depth: number, maxDepth: number): string {
  if (depth > maxDepth) return '';
  const indent = '  '.repeat(depth);
  let line = `${indent}${node.type}`;
  if (node.testID) line += ` (testID="${node.testID}")`;
  if (node.text) {
    const displayText = node.text.length > 60 ? node.text.slice(0, 57) + '...' : node.text;
    line += ` "${displayText}"`;
  }
  if (!node.visible) line += ' [hidden]';
  const lines = [line];
  for (const child of node.children) {
    const childStr = formatTreeNode(child, depth + 1, maxDepth);
    if (childStr) lines.push(childStr);
  }
  return lines.join('\n');
}

export { Harness };
