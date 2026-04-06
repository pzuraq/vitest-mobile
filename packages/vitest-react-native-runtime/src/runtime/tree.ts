/**
 * Tree — abstraction over the native view tree.
 *
 * Uses the NativeHarness Expo module when available (real native queries).
 * Falls back to fiber traversal for development without native builds.
 */

import type { ResolvedElement } from './locator';
import NativeHarnessModule from './native-harness';

const NativeHarness: any = NativeHarnessModule;

// ── Native implementation ──────────────────────────────────────────

function nativeResolveByTestId(_containerRef: React.RefObject<any>, testId: string): ResolvedElement | null {
  const tag = NativeHarness.findByTestId(testId);
  if (tag == null) return null;
  return { _type: 'native', tag, testId } as any;
}

function nativeResolveByText(_containerRef: React.RefObject<any>, text: string): ResolvedElement | null {
  // No native text-search API — use fiber fallback
  return fiberResolveByText(_containerRef, text);
}

function nativeResolveAllByText(containerRef: React.RefObject<any>, text: string): ResolvedElement[] {
  // No native findAll-by-text API — use fiber fallback
  return fiberResolveAllByText(containerRef, text);
}

function nativeResolveAllByTestId(containerRef: React.RefObject<any>, testId: string): ResolvedElement[] {
  // Native findByTestId only returns first match; use fiber to find all
  return fiberResolveAllByTestId(containerRef, testId);
}

function nativeReadText(element: ResolvedElement): string {
  const el = element as any;
  if (el._type === 'native') {
    return NativeHarness.getText(el.tag) ?? '';
  }
  return fiberReadText(element);
}

function nativeReadProps(element: ResolvedElement): Record<string, any> {
  const el = element as any;
  if (el._type === 'native') {
    const info = NativeHarness.getViewInfo(el.tag);
    return info
      ? {
          testID: info.testId,
          style: {},
          accessibilityLabel: info.text,
        }
      : {};
  }
  return fiberReadProps(element);
}

function nativeFindHandler(_element: ResolvedElement, _propName: string): ((...args: any[]) => any) | undefined {
  // Native touch dispatch doesn't need handlers — it dispatches real events.
  // Return a sentinel so the locator knows to use native tap.
  return undefined;
}

// ── Fiber fallback implementation ──────────────────────────────────

function getFiber(ref: React.RefObject<any>): any | null {
  const current = ref.current;
  if (!current) return null;
  return (
    current._internalFiberInstanceHandleDEV ??
    current._internalInstanceHandle ??
    current.__internalInstanceHandle ??
    null
  );
}

function walk(fiber: any, visitor: (f: any) => void): void {
  if (!fiber) return;
  visitor(fiber);
  let child = fiber.child;
  while (child) {
    walk(child, visitor);
    child = child.sibling;
  }
}

function fiberProps(fiber: any): Record<string, any> {
  return fiber?.memoizedProps ?? fiber?.pendingProps ?? {};
}

function fiberTextOf(fiber: any): string {
  const parts: string[] = [];
  walk(fiber, f => {
    if (f.tag === 6) {
      const content = f.memoizedProps ?? f.pendingProps;
      if (typeof content === 'string') parts.push(content);
      if (typeof content === 'number') parts.push(String(content));
    }
  });
  return parts.join('');
}

function fiberHandlerUp(fiber: any, propName: string): ((...args: any[]) => any) | undefined {
  let current = fiber;
  while (current) {
    const p = current.memoizedProps ?? current.pendingProps;
    if (p && typeof p[propName] === 'function') return p[propName];
    current = current.return;
  }
  return undefined;
}

function fiberResolveByTestId(containerRef: React.RefObject<any>, testId: string): ResolvedElement | null {
  const root = getFiber(containerRef);
  if (!root) return null;
  let found: any = null;
  walk(root, f => {
    if (!found && fiberProps(f).testID === testId) found = f;
  });
  return found;
}

function fiberResolveByText(containerRef: React.RefObject<any>, text: string): ResolvedElement | null {
  const root = getFiber(containerRef);
  if (!root) return null;
  let found: any = null;
  walk(root, f => {
    if (fiberTextOf(f).includes(text)) found = f;
  });
  return found;
}

function fiberResolveAllByText(containerRef: React.RefObject<any>, text: string): ResolvedElement[] {
  const root = getFiber(containerRef);
  if (!root) return [];
  const matches: any[] = [];
  walk(root, f => {
    if (fiberTextOf(f).includes(text)) matches.push(f);
  });
  return matches;
}

function fiberResolveAllByTestId(containerRef: React.RefObject<any>, testId: string): ResolvedElement[] {
  const root = getFiber(containerRef);
  if (!root) return [];
  const matches: any[] = [];
  walk(root, f => {
    if (fiberProps(f).testID === testId) matches.push(f);
  });
  return matches;
}

function fiberReadText(element: ResolvedElement): string {
  return fiberTextOf(element as any);
}

function fiberReadProps(element: ResolvedElement): Record<string, any> {
  return fiberProps(element as any);
}

function fiberFindHandler(element: ResolvedElement, propName: string): ((...args: any[]) => any) | undefined {
  return fiberHandlerUp(element as any, propName);
}

// ── Public API (dispatches to native or fiber) ─────────────────────

export const resolveByTestId = NativeHarness ? nativeResolveByTestId : fiberResolveByTestId;
export const resolveByText = NativeHarness ? nativeResolveByText : fiberResolveByText;
export const resolveAllByTestId = NativeHarness ? nativeResolveAllByTestId : fiberResolveAllByTestId;
export const resolveAllByText = NativeHarness ? nativeResolveAllByText : fiberResolveAllByText;
export const readText = NativeHarness ? nativeReadText : fiberReadText;
export const readProps = NativeHarness ? nativeReadProps : fiberReadProps;
export const findHandler = NativeHarness ? nativeFindHandler : fiberFindHandler;

// Expose for the locator's tap() to use native dispatch
export { NativeHarness };
