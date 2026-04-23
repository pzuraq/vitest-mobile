import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { symbolicate, symbolicateErrors } from '../../src/runtime/symbolicate';

interface MetroResponse {
  stack?: Array<{ file: string; lineNumber: number; column: number; methodName: string }>;
  codeFrame?: { content?: string; fileName?: string } | null;
}

function jsonResponse(body: MetroResponse): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockFetch(body: MetroResponse): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => jsonResponse(body));
  vi.stubGlobal('fetch', fn);
  return fn;
}

const BUNDLE_STACK = 'Error: boom\n    at test (http://localhost:8081/index.bundle:5:8)';

describe('symbolicate', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the rewritten stack and Metro-provided codeFrame content', async () => {
    const fetchMock = mockFetch({
      stack: [{ file: '/src/user.ts', lineNumber: 5, column: 8, methodName: 'test' }],
      codeFrame: { content: '  3 | a\n  4 | b\n> 5 |   throw new Error("boom")\n    |   ^' },
    });

    const result = await symbolicate(BUNDLE_STACK);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.codeFrame).toContain('throw new Error("boom")');
    expect(result.stack).toContain('/src/user.ts');
    expect(result.stack).toContain('5:8');
  });

  it('omits codeFrame when Metro returns null for it', async () => {
    const fetchMock = mockFetch({
      stack: [{ file: '/src/user.ts', lineNumber: 5, column: 8, methodName: 'test' }],
      codeFrame: null,
    });

    const result = await symbolicate(BUNDLE_STACK);

    // First pass: no codeFrame; second pass asks Metro to frame the first relevant on-disk file.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.codeFrame).toBeUndefined();
    expect(result.stack).toContain('/src/user.ts');
  });

  it('omits codeFrame when Metro omits the field entirely', async () => {
    const fetchMock = mockFetch({
      stack: [{ file: '/src/user.ts', lineNumber: 5, column: 8, methodName: 'test' }],
    });

    const result = await symbolicate(BUNDLE_STACK);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.codeFrame).toBeUndefined();
  });

  it('returns the original stack when Metro fetch rejects', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );

    const result = await symbolicate(BUNDLE_STACK);

    expect(result.codeFrame).toBeUndefined();
    expect(result.stack).toBe(BUNDLE_STACK);
  });

  it('returns the original stack when Metro responds non-ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 })),
    );

    const result = await symbolicate(BUNDLE_STACK);

    expect(result.codeFrame).toBeUndefined();
    expect(result.stack).toBe(BUNDLE_STACK);
  });

  it('skips the round-trip when no frame references the bundle', async () => {
    const fetchMock = mockFetch({
      codeFrame: { content: 'should not be used' },
    });

    const result = await symbolicate('Error: x\n    at fn (/user/file.ts:1:1)');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.codeFrame).toBeUndefined();
  });

  it('drops codeFrame when Metro resolved it to a vitest-mobile runtime internal', async () => {
    mockFetch({
      stack: [
        {
          file: 'packages/vitest-mobile/src/runtime/expect-setup.ts',
          lineNumber: 171,
          column: 28,
          methodName: 'poll$argument_0',
        },
        {
          file: 'test-packages/counter/tests/counter.test.tsx',
          lineNumber: 25,
          column: 10,
          methodName: 'test',
        },
      ],
      codeFrame: {
        content: 'snippet from expect-setup.ts',
        fileName: 'packages/vitest-mobile/src/runtime/expect-setup.ts',
      },
    });

    const result = await symbolicate(BUNDLE_STACK);

    expect(result.codeFrame).toBeUndefined();
  });

  it('rebuilds from Metro using merged frames; vitest-mobile runtime paths are treated as not relevant', async () => {
    // BUNDLE_STACK yields one bundle frame for POST; Metro must return 1:1. If Metro
    // had returned expect-setup, isRelevantFrame would skip it; here we return the test.
    const fetchMock = mockFetch({
      stack: [
        {
          file: 'test-packages/counter/tests/counter.test.tsx',
          lineNumber: 25,
          column: 10,
          methodName: 'test',
        },
      ],
      codeFrame: null,
    });

    const result = await symbolicate(BUNDLE_STACK);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.stack).not.toContain('expect-setup.ts');
    expect(result.stack).toContain('counter.test.tsx');
  });

  it('keeps the Metro codeFrame when it resolved to a user file', async () => {
    mockFetch({
      stack: [
        {
          file: 'test-packages/counter/tests/counter.test.tsx',
          lineNumber: 25,
          column: 10,
          methodName: 'test',
        },
      ],
      codeFrame: {
        content: '> 25 | expect(el).toHaveText("2")',
        fileName: 'test-packages/counter/tests/counter.test.tsx',
      },
    });

    const result = await symbolicate(BUNDLE_STACK);

    expect(result.codeFrame).toBe('> 25 | expect(el).toHaveText("2")');
  });

  it('merges Metro output into bundle positions only, preserving user path frames from the error string', async () => {
    const mixed =
      'Error: fail\n    at it (/Users/x/test-packages/counter/counter.test.tsx:30:5)\n    at x (http://127.0.0.1:18081/index.bundle:100:1)';
    const fetchMock = mockFetch({
      stack: [{ file: '/Users/x/symbolicated-from-bundle.ts', lineNumber: 1, column: 1, methodName: 'x' }],
      codeFrame: null,
    });

    const result = await symbolicate(mixed);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.stack).toContain('counter.test.tsx');
    expect(result.stack).toContain('symbolicated-from-bundle.ts');
  });

  it('requests a user-file codeFrame in a second round-trip when the first has no usable snippet', async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(async () =>
        jsonResponse({
          stack: [
            {
              file: 'test-packages/counter/tests/counter.test.tsx',
              lineNumber: 25,
              column: 10,
              methodName: 'it$argument_1',
            },
          ],
          codeFrame: null,
        }),
      )
      .mockImplementationOnce(async (_url, init) => {
        const body = JSON.parse(String((init as RequestInit).body)) as {
          stack: Array<{ file: string; lineNumber: number; column: number; methodName: string }>;
        };
        expect(body.stack).toHaveLength(1);
        expect(body.stack[0].file).toContain('counter.test.tsx');
        return jsonResponse({
          stack: body.stack,
          codeFrame: {
            content: '> 25 | expect(element).toHaveText("2")',
            fileName: 'test-packages/counter/tests/counter.test.tsx',
          },
        });
      });
    vi.stubGlobal('fetch', fetchImpl);

    const result = await symbolicate(BUNDLE_STACK);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.codeFrame).toBe('> 25 | expect(element).toHaveText("2")');
  });
});

describe('symbolicateErrors', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('populates err.codeFrame from Metro for each error', async () => {
    mockFetch({
      stack: [{ file: '/src/a.ts', lineNumber: 1, column: 1, methodName: 'a' }],
      codeFrame: { content: '> 1 | boom' },
    });

    const errors: Array<{ stack: string; codeFrame?: string }> = [{ stack: BUNDLE_STACK }, { stack: BUNDLE_STACK }];
    await symbolicateErrors({ errors });

    expect(errors[0].codeFrame).toBe('> 1 | boom');
    expect(errors[1].codeFrame).toBe('> 1 | boom');
  });

  it('leaves err.codeFrame undefined when Metro returns null', async () => {
    const fetchMock = mockFetch({
      stack: [{ file: '/src/a.ts', lineNumber: 1, column: 1, methodName: 'a' }],
      codeFrame: null,
    });

    const err: { stack: string; codeFrame?: string } = { stack: BUNDLE_STACK };
    await symbolicateErrors({ errors: [err] });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(err.codeFrame).toBeUndefined();
    expect(err.stack).toContain('/src/a.ts');
  });

  it('does not overwrite an existing codeFrame', async () => {
    mockFetch({
      stack: [{ file: '/src/a.ts', lineNumber: 1, column: 1, methodName: 'a' }],
      codeFrame: { content: 'from metro' },
    });

    const err = { stack: BUNDLE_STACK, codeFrame: 'pre-existing' };
    await symbolicateErrors({ errors: [err] });

    expect(err.codeFrame).toBe('pre-existing');
  });

  it('symbolicates stackStr when stack is absent', async () => {
    mockFetch({
      stack: [{ file: '/src/a.ts', lineNumber: 1, column: 1, methodName: 'a' }],
      codeFrame: { content: '> 1 | boom' },
    });

    const err: { stackStr: string; codeFrame?: string } = { stackStr: BUNDLE_STACK };
    await symbolicateErrors({ errors: [err] });

    expect(err.stackStr).toContain('/src/a.ts');
    expect(err.codeFrame).toBe('> 1 | boom');
  });

  it('swallows fetch failures and leaves stacks intact', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );

    const err: { stack: string; codeFrame?: string } = { stack: BUNDLE_STACK };
    await symbolicateErrors({ errors: [err] });

    expect(err.stack).toBe(BUNDLE_STACK);
    expect(err.codeFrame).toBeUndefined();
  });

  it('is a no-op when result is undefined or has no errors', async () => {
    const fetchMock = mockFetch({});
    await symbolicateErrors(undefined);
    await symbolicateErrors({ errors: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
