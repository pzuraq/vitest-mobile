import { describe, it, expect, vi, beforeEach } from 'vitest';
import { symbolicateMessage } from '../../src/node/symbolicate';
import type { BiRpcMessage } from '../../src/node/code-frame';

function onTaskUpdateMessage(errors: Array<{ stack?: string; stackStr?: string }>): BiRpcMessage {
  return {
    m: 'onTaskUpdate',
    a: [[['task-id', { errors }, undefined]]],
  };
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('symbolicateMessage', () => {
  it('rewrites Hermes stack frames via Metro /symbolicate', async () => {
    const hermesStack = 'Error: boom\nanonymous@http://127.0.0.1:8081/index.bundle:12345:67';
    const mappedFrames = [{ methodName: 'anonymous', file: 'counter.test.tsx', lineNumber: 42, column: 5 }];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ stack: mappedFrames }),
    });

    const errors = [{ stack: hermesStack }];
    const msg = onTaskUpdateMessage(errors);

    await symbolicateMessage(msg, 8081);

    expect(errors[0].stack).toContain('counter.test.tsx:42:5');
    expect(errors[0].stack).not.toContain('12345');
    globalThis.fetch = originalFetch;
  });

  it('rewrites V8-format stacks', async () => {
    const v8Stack = 'Error: fail\n    at myFunc (/bundle.js:999:10)';
    const mappedFrames = [{ methodName: 'myFunc', file: 'src/app.ts', lineNumber: 7, column: 3 }];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ stack: mappedFrames }),
    });

    const errors = [{ stack: v8Stack }];
    await symbolicateMessage(onTaskUpdateMessage(errors), 8081);

    expect(errors[0].stack).toContain('src/app.ts:7:3');
    globalThis.fetch = originalFetch;
  });

  it('rewrites stackStr in addition to stack', async () => {
    const mappedFrames = [{ methodName: 'fn', file: 'test.ts', lineNumber: 1, column: 1 }];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ stack: mappedFrames }),
    });

    const errors = [{ stack: 'E\n    at fn (/b.js:1:1)', stackStr: 'E\n    at fn (/b.js:1:1)' }];
    await symbolicateMessage(onTaskUpdateMessage(errors), 8081);

    expect(errors[0].stack).toContain('test.ts:1:1');
    expect(errors[0].stackStr).toContain('test.ts:1:1');
    globalThis.fetch = originalFetch;
  });

  it('preserves original stack when Metro returns non-ok', async () => {
    const original = 'Error: boom\nanonymous@/bundle.js:1:1';

    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false });

    const errors = [{ stack: original }];
    await symbolicateMessage(onTaskUpdateMessage(errors), 8081);

    expect(errors[0].stack).toBe(original);
    globalThis.fetch = originalFetch;
  });

  it('preserves original stack when fetch throws', async () => {
    const original = 'Error: boom\nanonymous@/bundle.js:1:1';

    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network error'));

    const errors = [{ stack: original }];
    await symbolicateMessage(onTaskUpdateMessage(errors), 8081);

    expect(errors[0].stack).toBe(original);
    globalThis.fetch = originalFetch;
  });

  it('does nothing for non-onTaskUpdate messages', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    const msg: BiRpcMessage = { m: 'onCollected', a: [] };
    await symbolicateMessage(msg, 8081);

    expect(fetchSpy).not.toHaveBeenCalled();
    globalThis.fetch = originalFetch;
  });

  it('does nothing when there are no errors', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;

    await symbolicateMessage(onTaskUpdateMessage([]), 8081);

    expect(fetchSpy).not.toHaveBeenCalled();
    globalThis.fetch = originalFetch;
  });

  it('filters out node_modules frames from the rebuilt stack', async () => {
    const stack = 'Error\n    at dep (/node_modules/lib/index.js:1:1)\n    at test (src/test.ts:5:3)';
    const mappedFrames = [
      { methodName: 'dep', file: '/node_modules/lib/index.js', lineNumber: 1, column: 1 },
      { methodName: 'test', file: 'src/test.ts', lineNumber: 5, column: 3 },
    ];

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ stack: mappedFrames }),
    });

    const errors = [{ stack }];
    await symbolicateMessage(onTaskUpdateMessage(errors), 8081);

    expect(errors[0].stack).toContain('src/test.ts:5:3');
    expect(errors[0].stack).not.toContain('node_modules');
    globalThis.fetch = originalFetch;
  });
});
