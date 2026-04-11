import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the tree module so locator tests stay unit-level
vi.mock('../../src/runtime/tree', () => ({
  resolveByTestId: vi.fn(),
  resolveByText: vi.fn(),
  resolveAllByTestId: vi.fn(),
  resolveAllByText: vi.fn(),
  readText: vi.fn(),
  readProps: vi.fn(),
  findHandler: vi.fn(),
  Harness: null,
}));

import {
  resolveByTestId,
  resolveByText,
  resolveAllByTestId,
  resolveAllByText,
  readText,
  readProps,
  findHandler,
} from '../../src/runtime/tree';
import { Locator, createLocatorAPI, type ResolvedElement } from '../../src/runtime/locator';

const FAKE_INFO = { nativeId: 'fake-1', x: 0, y: 0, width: 100, height: 50 };
const FAKE_EL: ResolvedElement = { _type: 'native', nativeId: 'fake-1', info: FAKE_INFO, label: 'testID="x"' };

beforeEach(() => {
  vi.resetAllMocks();
});

// ── Locator class ─────────────────────────────────────────────────────────────

describe('Locator', () => {
  it('text getter returns readText result', () => {
    vi.mocked(readText).mockReturnValue('Hello');
    const loc = new Locator(() => FAKE_EL, 'testID="x"');
    expect(loc.text).toBe('Hello');
    expect(readText).toHaveBeenCalledWith(FAKE_EL);
  });

  it('props getter returns readProps result', () => {
    vi.mocked(readProps).mockReturnValue({ testID: 'x' });
    const loc = new Locator(() => FAKE_EL, 'testID="x"');
    expect(loc.props).toEqual({ testID: 'x' });
  });

  it('exists returns true when element is found', () => {
    const loc = new Locator(() => FAKE_EL, 'testID="x"');
    expect(loc.exists).toBe(true);
  });

  it('exists returns false when element is not found', () => {
    const loc = new Locator(() => null, 'testID="missing"');
    expect(loc.exists).toBe(false);
  });

  it('accessing text on a missing element throws a descriptive error', () => {
    vi.mocked(readText).mockReturnValue('');
    const loc = new Locator(() => null, 'testID="missing"');
    expect(() => loc.text).toThrow('testID="missing"');
  });

  it('tap() calls onPress handler from findHandler', async () => {
    const handler = vi.fn();
    vi.mocked(findHandler).mockReturnValue(handler);
    const loc = new Locator(() => FAKE_EL, 'testID="btn"');
    await loc.tap();
    expect(handler).toHaveBeenCalled();
  });

  it('tap() throws if no onPress handler is found', async () => {
    vi.mocked(findHandler).mockReturnValue(undefined);
    const loc = new Locator(() => FAKE_EL, 'testID="btn"');
    await expect(loc.tap()).rejects.toThrow('No onPress handler');
  });

  it('longPress() calls onLongPress handler', async () => {
    const handler = vi.fn();
    vi.mocked(findHandler).mockReturnValue(handler);
    const loc = new Locator(() => FAKE_EL, 'testID="btn"');
    await loc.longPress();
    expect(handler).toHaveBeenCalled();
  });

  it('longPress() throws if no onLongPress handler is found', async () => {
    vi.mocked(findHandler).mockReturnValue(undefined);
    const loc = new Locator(() => FAKE_EL, 'testID="btn"');
    await expect(loc.longPress()).rejects.toThrow('No onLongPress handler');
  });

  it('type() calls onChangeText handler with the text', async () => {
    const handler = vi.fn();
    vi.mocked(findHandler).mockReturnValue(handler);
    const loc = new Locator(() => FAKE_EL, 'testID="input"');
    await loc.type('hello');
    expect(handler).toHaveBeenCalledWith('hello');
  });

  it('type() throws if no onChangeText handler is found', async () => {
    vi.mocked(findHandler).mockReturnValue(undefined);
    const loc = new Locator(() => FAKE_EL, 'testID="input"');
    await expect(loc.type('hello')).rejects.toThrow('No onChangeText handler');
  });

  it('toString() returns a readable description', () => {
    const loc = new Locator(() => FAKE_EL, 'testID="x"');
    expect(loc.toString()).toBe('Locator(testID="x")');
  });

  it('re-resolves on every access (never stale)', () => {
    let callCount = 0;
    const resolve = vi.fn(() => {
      callCount++;
      return FAKE_EL;
    });
    vi.mocked(readText).mockReturnValue('text');
    vi.mocked(readProps).mockReturnValue({});
    const loc = new Locator(resolve, 'testID="x"');
    void loc.text;
    void loc.props;
    void loc.exists;
    expect(resolve).toHaveBeenCalledTimes(3);
  });
});

// ── createLocatorAPI ──────────────────────────────────────────────────────────

describe('createLocatorAPI', () => {
  describe('getByTestId', () => {
    it('returns a Locator that resolves by testID', () => {
      vi.mocked(resolveByTestId).mockReturnValue(FAKE_EL);
      vi.mocked(readText).mockReturnValue('');
      const api = createLocatorAPI();
      const loc = api.getByTestId('btn');
      expect(loc).toBeInstanceOf(Locator);
      expect(loc.exists).toBe(true);
      expect(resolveByTestId).toHaveBeenCalledWith('btn');
    });
  });

  describe('getByText', () => {
    it('returns a Locator that resolves by text', () => {
      vi.mocked(resolveByText).mockReturnValue(FAKE_EL);
      const api = createLocatorAPI();
      const loc = api.getByText('Submit');
      expect(loc).toBeInstanceOf(Locator);
      expect(loc.exists).toBe(true);
      expect(resolveByText).toHaveBeenCalledWith('Submit');
    });
  });

  describe('getAllByTestId', () => {
    it('returns one Locator per matched element', () => {
      const els = [FAKE_EL, { ...FAKE_EL, tag: 2 }];
      vi.mocked(resolveAllByTestId).mockReturnValue(els);
      const api = createLocatorAPI();
      const locs = api.getAllByTestId('item');
      expect(locs).toHaveLength(2);
      expect(locs[0]).toBeInstanceOf(Locator);
    });

    it('returns empty array when no elements match', () => {
      vi.mocked(resolveAllByTestId).mockReturnValue([]);
      const api = createLocatorAPI();
      expect(api.getAllByTestId('ghost')).toEqual([]);
    });

    it('each returned Locator re-resolves by index on access', () => {
      const el0: ResolvedElement = {
        _type: 'native',
        nativeId: 'fake-10',
        info: { nativeId: 'fake-10', x: 0, y: 0, width: 100, height: 50 },
        label: 'item[0]',
      };
      const el1: ResolvedElement = {
        _type: 'native',
        nativeId: 'fake-11',
        info: { nativeId: 'fake-11', x: 0, y: 0, width: 100, height: 50 },
        label: 'item[1]',
      };
      vi.mocked(resolveAllByTestId).mockReturnValue([el0, el1]);
      vi.mocked(readText).mockReturnValue('');
      const api = createLocatorAPI();
      const locs = api.getAllByTestId('item');
      void locs[0].exists; // triggers a re-resolve
      void locs[1].exists;
      // resolveAllByTestId called once during getAllByTestId + once per .exists
      expect(resolveAllByTestId).toHaveBeenCalledTimes(3);
    });
  });

  describe('getAllByText', () => {
    it('returns one Locator per matched element', () => {
      vi.mocked(resolveAllByText).mockReturnValue([FAKE_EL]);
      const api = createLocatorAPI();
      const locs = api.getAllByText('Item');
      expect(locs).toHaveLength(1);
    });
  });

  describe('queryByTestId', () => {
    it('returns a Locator when element exists', () => {
      vi.mocked(resolveByTestId).mockReturnValue(FAKE_EL);
      const api = createLocatorAPI();
      const result = api.queryByTestId('btn');
      expect(result).toBeInstanceOf(Locator);
    });

    it('returns null when element does not exist', () => {
      vi.mocked(resolveByTestId).mockReturnValue(null);
      const api = createLocatorAPI();
      const result = api.queryByTestId('ghost');
      expect(result).toBeNull();
    });
  });

  describe('queryByText', () => {
    it('returns a Locator when element exists', () => {
      vi.mocked(resolveByText).mockReturnValue(FAKE_EL);
      const api = createLocatorAPI();
      expect(api.queryByText('Hello')).toBeInstanceOf(Locator);
    });

    it('returns null when element does not exist', () => {
      vi.mocked(resolveByText).mockReturnValue(null);
      const api = createLocatorAPI();
      expect(api.queryByText('Ghost')).toBeNull();
    });
  });

  describe('findByTestId', () => {
    it('resolves when element appears within the timeout', async () => {
      vi.mocked(resolveByTestId).mockReturnValueOnce(null).mockReturnValue(FAKE_EL);
      const api = createLocatorAPI();
      const loc = await api.findByTestId('btn', { timeout: 200, interval: 10 });
      expect(loc).toBeInstanceOf(Locator);
    });

    it('rejects if element never appears', async () => {
      vi.mocked(resolveByTestId).mockReturnValue(null);
      const api = createLocatorAPI();
      await expect(api.findByTestId('ghost', { timeout: 60, interval: 10 })).rejects.toThrow('ghost');
    });
  });

  describe('findByText', () => {
    it('resolves when element appears within the timeout', async () => {
      vi.mocked(resolveByText).mockReturnValueOnce(null).mockReturnValue(FAKE_EL);
      const api = createLocatorAPI();
      const loc = await api.findByText('Hello', { timeout: 200, interval: 10 });
      expect(loc).toBeInstanceOf(Locator);
    });

    it('rejects if element never appears', async () => {
      vi.mocked(resolveByText).mockReturnValue(null);
      const api = createLocatorAPI();
      await expect(api.findByText('Ghost', { timeout: 60, interval: 10 })).rejects.toThrow('Ghost');
    });
  });
});
