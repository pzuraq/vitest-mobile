/**
 * Interactions — tap(), type(), scroll(), longPress() on native elements.
 * For the POC, these invoke callback props directly from the fiber tree.
 */

import { waitForNextFrame } from './flush';

export interface NativeElement {
  /** The underlying React fiber node */
  fiber: any;

  /** Simulate a press/tap on this element */
  tap(): Promise<void>;

  /** Simulate a long press on this element */
  longPress(): Promise<void>;

  /** Simulate typing text into a TextInput */
  type(text: string): Promise<void>;

  /** Simulate a scroll event */
  scroll(options: { x?: number; y?: number }): Promise<void>;

  /** Get the current props of the element */
  props: Record<string, any>;

  /** Get text content from the element subtree */
  text: string;
}

function getProps(fiber: any): Record<string, any> {
  return fiber?.pendingProps ?? fiber?.memoizedProps ?? {};
}

function collectText(fiber: any): string {
  const parts: string[] = [];
  function walk(f: any) {
    if (!f) return;
    // Tag 6 = HostText (raw text node)
    if (f.tag === 6) {
      const text = f.pendingProps ?? f.memoizedProps;
      if (typeof text === 'string') parts.push(text);
      if (typeof text === 'number') parts.push(String(text));
    }
    let child = f.child;
    while (child) {
      walk(child);
      child = child.sibling;
    }
  }
  walk(fiber);
  return parts.join('');
}

function findPropUp(fiber: any, propName: string): ((...args: any[]) => any) | undefined {
  let current = fiber;
  while (current) {
    const props = current.pendingProps ?? current.memoizedProps;
    if (props && typeof props[propName] === 'function') {
      return props[propName];
    }
    current = current.return;
  }
  return undefined;
}

export function createNativeElement(fiber: any): NativeElement {
  return {
    fiber,

    get props() {
      return getProps(fiber);
    },

    get text() {
      return collectText(fiber);
    },

    async tap() {
      const onPress = findPropUp(fiber, 'onPress') ?? findPropUp(fiber, 'onPressIn');
      if (onPress) {
        await onPress();
        await waitForNextFrame();
      } else {
        throw new Error('No onPress or onPressIn handler found on element or ancestors');
      }
    },

    async longPress() {
      const onLongPress = findPropUp(fiber, 'onLongPress');
      if (onLongPress) {
        await onLongPress();
        await waitForNextFrame();
      } else {
        throw new Error('No onLongPress handler found on element or ancestors');
      }
    },

    async type(text: string) {
      const onChangeText = findPropUp(fiber, 'onChangeText');
      if (onChangeText) {
        await onChangeText(text);
        await waitForNextFrame();
      } else {
        throw new Error('No onChangeText handler found on element or ancestors');
      }
    },

    async scroll(options: { x?: number; y?: number }) {
      const onScroll = findPropUp(fiber, 'onScroll');
      if (onScroll) {
        await onScroll({
          nativeEvent: {
            contentOffset: { x: options.x ?? 0, y: options.y ?? 0 },
            contentSize: { height: 1000, width: 400 },
            layoutMeasurement: { height: 800, width: 400 },
          },
        });
        await waitForNextFrame();
      } else {
        throw new Error('No onScroll handler found on element or ancestors');
      }
    },
  };
}
