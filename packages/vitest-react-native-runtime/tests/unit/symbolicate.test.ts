import { describe, it, expect } from 'vitest';
import { parseStack, isRelevantFrame, rebuildStack, type StackFrame } from '../../src/runtime/symbolicate';

describe('parseStack', () => {
  it('parses Hermes functionName@file:line:col frames', () => {
    const line = 'anonymous@/path/to/bundle.js:123:45';
    const { frames, message } = parseStack(line);
    // First line is a frame: messageEnd stays 0, so message falls back to lines[0].
    expect(message).toBe(line);
    expect(frames).toEqual<StackFrame[]>([
      {
        methodName: 'anonymous',
        file: '/path/to/bundle.js',
        lineNumber: 123,
        column: 45,
      },
    ]);
  });

  it('parses V8 at functionName (file:line:col) frames with leading whitespace', () => {
    const line = '    at myFunc (/path/to/file.ts:10:5)';
    const { frames, message } = parseStack(line);
    expect(message).toBe(line);
    expect(frames).toEqual<StackFrame[]>([
      {
        methodName: 'myFunc',
        file: '/path/to/file.ts',
        lineNumber: 10,
        column: 5,
      },
    ]);
  });

  it('parses V8 anonymous at file:line:col as <anonymous>', () => {
    const line = '    at /path/to/file.ts:10:5';
    const { frames, message } = parseStack(line);
    expect(message).toBe(line);
    expect(frames).toEqual<StackFrame[]>([
      {
        methodName: '<anonymous>',
        file: '/path/to/file.ts',
        lineNumber: 10,
        column: 5,
      },
    ]);
  });

  it('parses Hermes internal tryCallOne address at InternalBytecode.js:line:col', () => {
    const line = 'tryCallOne address at InternalBytecode.js:1:1180';
    const { frames, message } = parseStack(line);
    expect(message).toBe(line);
    expect(frames).toEqual<StackFrame[]>([
      {
        methodName: 'tryCallOne',
        file: 'InternalBytecode.js',
        lineNumber: 1,
        column: 1180,
      },
    ]);
  });

  it('extracts message lines that precede the first parsed frame in a mixed stack', () => {
    const stack = ['Error: expected true to be false', '    at assert (/app/node_modules/chai/index.js:1:1)'].join(
      '\n',
    );

    const { frames, message } = parseStack(stack);

    expect(message).toBe('Error: expected true to be false');
    expect(frames).toHaveLength(1);
    expect(frames[0]?.methodName).toBe('assert');
    expect(frames[0]?.file).toBe('/app/node_modules/chai/index.js');
  });

  it('includes blank lines before the first frame in the extracted message', () => {
    const stack = ['TypeError: cannot read property', '', 'More context line', 'anonymous@/bundle.js:1:2'].join('\n');

    const { frames, message } = parseStack(stack);

    expect(message).toBe('TypeError: cannot read property\n\nMore context line');
    expect(frames).toHaveLength(1);
  });

  it('returns empty frames for an empty string', () => {
    const { frames, message } = parseStack('');
    expect(frames).toEqual([]);
    expect(message).toBe('');
  });

  it('returns empty frames and uses the first line as message when nothing matches', () => {
    const stack = ['Something went wrong', 'not a stack frame', 'still not'].join('\n');
    const { frames, message } = parseStack(stack);

    expect(frames).toEqual([]);
    expect(message).toBe('Something went wrong');
  });
});

describe('isRelevantFrame', () => {
  it('returns false when file path contains node_modules', () => {
    const frame: StackFrame = {
      file: '/project/node_modules/react/cjs/react.development.js',
      lineNumber: 100,
      column: 1,
      methodName: 'createElement',
    };
    expect(isRelevantFrame(frame)).toBe(false);
  });

  it('returns false when file path contains InternalBytecode', () => {
    const frame: StackFrame = {
      file: 'InternalBytecode.js',
      lineNumber: 1,
      column: 1180,
      methodName: 'tryCallOne',
    };
    expect(isRelevantFrame(frame)).toBe(false);
  });

  it('returns false when file starts with address at', () => {
    const frame: StackFrame = {
      file: 'address at synthetic.js',
      lineNumber: 0,
      column: 0,
      methodName: 'native',
    };
    expect(isRelevantFrame(frame)).toBe(false);
  });

  it('returns false for an empty file string', () => {
    const frame: StackFrame = {
      file: '',
      lineNumber: 1,
      column: 1,
      methodName: 'foo',
    };
    expect(isRelevantFrame(frame)).toBe(false);
  });

  it('returns true for user test paths like modules/counter/tests/counter.test.tsx', () => {
    const frame: StackFrame = {
      file: 'modules/counter/tests/counter.test.tsx',
      lineNumber: 12,
      column: 3,
      methodName: 'it',
    };
    expect(isRelevantFrame(frame)).toBe(true);
  });

  it('returns true for package source paths like packages/vitest-react-native-runtime/src/runtime/retry.ts', () => {
    const frame: StackFrame = {
      file: 'packages/vitest-react-native-runtime/src/runtime/retry.ts',
      lineNumber: 40,
      column: 8,
      methodName: 'withRetry',
    };
    expect(isRelevantFrame(frame)).toBe(true);
  });
});

describe('rebuildStack', () => {
  it('keeps only relevant frames in V8 format and preserves the message as the first line', () => {
    const message = 'AssertionError: boom';
    const frames: StackFrame[] = [
      {
        methodName: 'hidden',
        file: '/app/node_modules/lodash/lodash.js',
        lineNumber: 1,
        column: 1,
      },
      {
        methodName: 'userTest',
        file: 'modules/counter/tests/counter.test.tsx',
        lineNumber: 20,
        column: 4,
      },
    ];

    const out = rebuildStack(message, frames);

    expect(out).toBe(
      ['AssertionError: boom', '    at userTest (modules/counter/tests/counter.test.tsx:20:4)'].join('\n'),
    );
  });

  it('falls back to all frames when every frame is non-relevant', () => {
    const message = 'Error: only internals';
    const frames: StackFrame[] = [
      {
        methodName: 'a',
        file: '/x/node_modules/a/index.js',
        lineNumber: 1,
        column: 1,
      },
      {
        methodName: 'b',
        file: 'InternalBytecode.js',
        lineNumber: 1,
        column: 1,
      },
    ];

    const out = rebuildStack(message, frames);

    expect(out).toBe(
      ['Error: only internals', '    at a (/x/node_modules/a/index.js:1:1)', '    at b (InternalBytecode.js:1:1)'].join(
        '\n',
      ),
    );
  });

  it('formats each frame as four-space-indented V8 at methodName (file:line:col)', () => {
    const message = 'RangeError: oops';
    const frames: StackFrame[] = [
      {
        methodName: '<anonymous>',
        file: '/tmp/script.ts',
        lineNumber: 7,
        column: 0,
      },
    ];

    const out = rebuildStack(message, frames);
    const lines = out.split('\n');

    expect(lines[0]).toBe('RangeError: oops');
    expect(lines[1]).toBe('    at <anonymous> (/tmp/script.ts:7:0)');
  });

  it('preserves a multi-line message as the leading block before stack lines', () => {
    const message = ['First line of error', 'Second line of error'].join('\n');
    const frames: StackFrame[] = [
      {
        methodName: 'fn',
        file: 'packages/vitest-react-native-runtime/src/runtime/retry.ts',
        lineNumber: 1,
        column: 1,
      },
    ];

    const out = rebuildStack(message, frames);

    expect(out.startsWith(message + '\n')).toBe(true);
    expect(out.endsWith('    at fn (packages/vitest-react-native-runtime/src/runtime/retry.ts:1:1)')).toBe(true);
  });
});
