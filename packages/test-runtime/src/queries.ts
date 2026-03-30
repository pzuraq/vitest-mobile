/**
 * Queries — traverse the React fiber tree to find elements by testID and text.
 */

import { waitFor, type RetryOptions } from './retry';
import type { NativeElement } from './interactions';
import { createNativeElement } from './interactions';

/**
 * Get the fiber node from a React ref's underlying host instance.
 */
function getFiberFromRef(ref: React.RefObject<any>): any | null {
  const current = ref.current;
  if (!current) return null;

  // React Native internals — the fiber is attached to the native instance
  let fiber =
    (current as any)._internalFiberInstanceHandleDEV ??
    (current as any)._internalInstanceHandle ??
    (current as any).__internalInstanceHandle;

  // React double-buffers fibers. The ref may hold a stale fiber.
  // If there's an alternate that is more recent, use it.
  if (fiber?.alternate?.child && !fiber.child) {
    fiber = fiber.alternate;
  }

  return fiber ?? null;
}

// Debug: dump fiber tree structure
function dumpFiberTree(fiber: any, depth: number = 0): void {
  if (!fiber || depth > 6) return;
  const indent = '  '.repeat(depth);
  const tag = fiber.tag;
  const testID = fiber.pendingProps?.testID ?? fiber.memoizedProps?.testID ?? '';
  const type = typeof fiber.type === 'string' ? fiber.type : fiber.type?.name ?? `tag:${tag}`;
  const text = tag === 6 ? ` "${fiber.pendingProps ?? fiber.memoizedProps}"` : '';
  console.log(`${indent}[${type}]${testID ? ` testID=${testID}` : ''}${text}`);
  let child = fiber.child;
  while (child) {
    dumpFiberTree(child, depth + 1);
    child = child.sibling;
  }
}

/**
 * Walk the fiber subtree (children only, NOT siblings of the root).
 * For each child, we do walk its siblings since they are children of the same parent.
 */
function walkFiberSubtree(fiber: any, visitor: (fiber: any) => void): void {
  if (!fiber) return;
  visitor(fiber);
  // Walk into children
  let child = fiber.child;
  while (child) {
    walkFiberSubtree(child, visitor);
    child = child.sibling;
  }
}

/**
 * Find all fiber nodes matching a predicate, starting from a container ref.
 */
function findAll(containerRef: React.RefObject<any>, predicate: (fiber: any) => boolean): any[] {
  const rootFiber = getFiberFromRef(containerRef);
  if (!rootFiber) return [];

  const matches: any[] = [];
  walkFiberSubtree(rootFiber, (fiber) => {
    if (predicate(fiber)) {
      matches.push(fiber);
    }
  });
  return matches;
}

function getTestID(fiber: any): string | undefined {
  return fiber?.pendingProps?.testID ?? fiber?.memoizedProps?.testID;
}

/**
 * Collect text content from a fiber's subtree only (not siblings).
 * Raw text fibers have tag === 6 in React — we only collect from those
 * to avoid double-counting (host Text component + raw text child).
 */
function collectSubtreeText(fiber: any): string {
  const parts: string[] = [];
  walkFiberSubtree(fiber, (f) => {
    // Tag 6 = HostText (raw text node in React's fiber tags)
    if (f.tag === 6) {
      const text = f.pendingProps ?? f.memoizedProps;
      if (typeof text === 'string') parts.push(text);
      if (typeof text === 'number') parts.push(String(text));
    }
  });
  return parts.join('');
}

export interface QueryAPI {
  getByTestId(testId: string): NativeElement;
  queryByTestId(testId: string): NativeElement | null;
  getAllByTestId(testId: string): NativeElement[];
  getByText(text: string): NativeElement;
  queryByText(text: string): NativeElement | null;
  findByTestId(testId: string, options?: RetryOptions): Promise<NativeElement>;
  findByText(text: string, options?: RetryOptions): Promise<NativeElement>;
}

export function createQueryAPI(containerRef: React.RefObject<any>): QueryAPI {
  function getByTestId(testId: string): NativeElement {
    const matches = findAll(containerRef, (fiber) => getTestID(fiber) === testId);
    if (matches.length === 0) {
      throw new Error(`Unable to find element with testID: ${testId}`);
    }
    return createNativeElement(matches[0]);
  }

  function queryByTestId(testId: string): NativeElement | null {
    const matches = findAll(containerRef, (fiber) => getTestID(fiber) === testId);
    return matches.length > 0 ? createNativeElement(matches[0]) : null;
  }

  function getAllByTestId(testId: string): NativeElement[] {
    const matches = findAll(containerRef, (fiber) => getTestID(fiber) === testId);
    if (matches.length === 0) {
      throw new Error(`Unable to find any elements with testID: ${testId}`);
    }
    return matches.map(createNativeElement);
  }

  function getByText(text: string): NativeElement {
    const matches = findAll(containerRef, (fiber) => {
      const content = collectSubtreeText(fiber);
      return content.includes(text);
    });
    if (matches.length === 0) {
      throw new Error(`Unable to find element with text: ${text}`);
    }
    // Return the deepest match (most specific)
    return createNativeElement(matches[matches.length - 1]);
  }

  function queryByText(text: string): NativeElement | null {
    try {
      return getByText(text);
    } catch {
      return null;
    }
  }

  async function findByTestId(testId: string, options?: RetryOptions): Promise<NativeElement> {
    return waitFor(() => getByTestId(testId), options);
  }

  async function findByText(text: string, options?: RetryOptions): Promise<NativeElement> {
    return waitFor(() => getByText(text), options);
  }

  return {
    getByTestId,
    queryByTestId,
    getAllByTestId,
    getByText,
    queryByText,
    findByTestId,
    findByText,
  };
}
