/**
 * Locator — a lazy, re-evaluating reference to an element in the view tree.
 *
 * Modeled after Vitest browser mode / Playwright locators. A locator doesn't
 * hold a reference to a specific element instance — it holds a *query* that
 * is re-executed every time you interact with it or make an assertion.
 *
 * This means locators never go stale after state updates or re-renders.
 */

import { waitFor, type RetryOptions } from './retry';
import { resolveByTestId, resolveByText, resolveAllByTestId, readText, readProps, findHandler, NativeHarness } from './tree';

export class Locator {
  private _resolve: () => ResolvedElement | null;
  private _description: string;

  constructor(resolve: () => ResolvedElement | null, description: string) {
    this._resolve = resolve;
    this._description = description;
  }

  /** Re-resolve and return the underlying element, or throw */
  private _get(): ResolvedElement {
    const el = this._resolve();
    if (!el) {
      throw new Error(`Locator could not find element: ${this._description}`);
    }
    return el;
  }

  /** Current text content of the element subtree */
  get text(): string {
    return readText(this._get());
  }

  /** Current props of the element */
  get props(): Record<string, any> {
    return readProps(this._get());
  }

  /** Whether the element currently exists in the tree */
  get exists(): boolean {
    return this._resolve() !== null;
  }

  /** Simulate a press/tap */
  async tap(): Promise<void> {
    const el = this._get();
    if (NativeHarness && (el as any)._type === 'native') {
      await NativeHarness.tap((el as any).tag);
      return;
    }
    // Fiber fallback
    const handler = findHandler(el, 'onPress') ?? findHandler(el, 'onPressIn');
    if (!handler) {
      throw new Error(`No onPress handler found for: ${this._description}`);
    }
    handler();
    await new Promise((r) => setTimeout(r, 50));
  }

  /** Simulate a long press */
  async longPress(): Promise<void> {
    const el = this._get();
    if (NativeHarness && (el as any)._type === 'native') {
      await NativeHarness.longPress((el as any).tag, 500);
      return;
    }
    const handler = findHandler(el, 'onLongPress');
    if (!handler) {
      throw new Error(`No onLongPress handler found for: ${this._description}`);
    }
    await handler();
    await new Promise((r) => setTimeout(r, 50));
  }

  /** Simulate typing into a TextInput */
  async type(text: string): Promise<void> {
    if (NativeHarness) {
      await NativeHarness.typeText(text);
      return;
    }
    const el = this._get();
    const handler = findHandler(el, 'onChangeText');
    if (!handler) {
      throw new Error(`No onChangeText handler found for: ${this._description}`);
    }
    await handler(text);
    await new Promise((r) => setTimeout(r, 50));
  }

  /** Simulate a scroll */
  async scroll(options: { x?: number; y?: number }): Promise<void> {
    const el = this._get();
    // TODO: native scroll via Hammer
    const handler = findHandler(el, 'onScroll');
    if (!handler) {
      throw new Error(`No onScroll handler found for: ${this._description}`);
    }
    await handler({
      nativeEvent: {
        contentOffset: { x: options.x ?? 0, y: options.y ?? 0 },
        contentSize: { height: 1000, width: 400 },
        layoutMeasurement: { height: 800, width: 400 },
      },
    });
    await new Promise((r) => setTimeout(r, 50));
  }

  toString(): string {
    return `Locator(${this._description})`;
  }
}

/**
 * Opaque handle to a resolved element in the view tree.
 * The tree module knows how to read from these.
 */
export type ResolvedElement = unknown;

/**
 * Query API that returns locators instead of element snapshots.
 */
export interface LocatorAPI {
  getByTestId(testId: string): Locator;
  getByText(text: string): Locator;
  getAllByTestId(testId: string): Locator[];
  queryByTestId(testId: string): Locator | null;
  findByTestId(testId: string, options?: RetryOptions): Promise<Locator>;
  findByText(text: string, options?: RetryOptions): Promise<Locator>;
}

export function createLocatorAPI(containerRef: React.RefObject<any>): LocatorAPI {
  function getByTestId(testId: string): Locator {
    // Locator re-resolves on every access
    return new Locator(
      () => resolveByTestId(containerRef, testId),
      `testID="${testId}"`
    );
  }

  function getByText(text: string): Locator {
    return new Locator(
      () => resolveByText(containerRef, text),
      `text="${text}"`
    );
  }

  function getAllByTestId(testId: string): Locator[] {
    const elements = resolveAllByTestId(containerRef, testId);
    return elements.map((_, i) =>
      new Locator(
        () => {
          const all = resolveAllByTestId(containerRef, testId);
          return all[i] ?? null;
        },
        `testID="${testId}"[${i}]`
      )
    );
  }

  function queryByTestId(testId: string): Locator | null {
    const locator = getByTestId(testId);
    return locator.exists ? locator : null;
  }

  async function findByTestId(testId: string, options?: RetryOptions): Promise<Locator> {
    const locator = getByTestId(testId);
    await waitFor(() => {
      if (!locator.exists) {
        throw new Error(`Unable to find element with testID: ${testId}`);
      }
    }, options);
    return locator;
  }

  async function findByText(text: string, options?: RetryOptions): Promise<Locator> {
    const locator = getByText(text);
    await waitFor(() => {
      if (!locator.exists) {
        throw new Error(`Unable to find element with text: ${text}`);
      }
    }, options);
    return locator;
  }

  return {
    getByTestId,
    getByText,
    getAllByTestId,
    queryByTestId,
    findByTestId,
    findByText,
  };
}
