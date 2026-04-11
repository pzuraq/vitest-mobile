import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { attachCodeFrames, type BiRpcMessage } from '../../src/node/code-frame';

interface TaskError {
  message?: string;
  stack?: string;
  stackStr?: string;
  codeFrame?: string;
  [key: string]: unknown;
}

interface TaskResult {
  errors?: TaskError[];
  [key: string]: unknown;
}

function onTaskUpdateMessage(result: TaskResult): BiRpcMessage {
  return {
    m: 'onTaskUpdate',
    a: [[['task-id', result, undefined]]],
  };
}

describe('attachCodeFrames', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `attach-codeframe-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('sets err.codeFrame from the first user-file stack frame for onTaskUpdate', () => {
    const absPath = join(tempDir, 'user.ts');
    writeFileSync(absPath, ['a', 'b', 'c', 'd', 'broken here'].join('\n'), 'utf-8');
    const stack = `Error: boom\n    at test (${absPath}:5:8)`;
    const err: TaskError = { message: 'boom', stack };
    const result: TaskResult = { errors: [err] };

    attachCodeFrames(onTaskUpdateMessage(result));

    expect(err.codeFrame).toBeDefined();
    expect(String(err.codeFrame)).toContain(absPath);
    expect(String(err.codeFrame)).toContain('5');
    expect(String(err.codeFrame)).toContain('8');
  });

  it('includes the caret pointing at the correct column', () => {
    const absPath = join(tempDir, 'caret.ts');
    const lines = Array.from({ length: 10 }, (_, i) => `line_${i + 1}`);
    writeFileSync(absPath, lines.join('\n'), 'utf-8');
    const err: TaskError = { stack: `Error\n    at fn (${absPath}:5:10)` };

    attachCodeFrames(onTaskUpdateMessage({ errors: [err] }));

    expect(err.codeFrame).toBeDefined();
    expect(String(err.codeFrame)).toMatch(/\^/);
  });

  it('skips errors that already have codeFrame', () => {
    const absPath = join(tempDir, 'skip.ts');
    writeFileSync(absPath, 'x\n', 'utf-8');
    const existing = 'already attached frame';
    const err: TaskError = {
      codeFrame: existing,
      stack: `at x (${absPath}:1:1)`,
    };
    attachCodeFrames(onTaskUpdateMessage({ errors: [err] }));
    expect(err.codeFrame).toBe(existing);
  });

  it('skips stack frames that point into node_modules', () => {
    const err: TaskError = {
      stack: 'at dep (/project/node_modules/pkg/index.js:1:1)',
    };
    attachCodeFrames(onTaskUpdateMessage({ errors: [err] }));
    expect(err.codeFrame).toBeUndefined();
  });

  it('does nothing when message type is not onTaskUpdate', () => {
    const absPath = join(tempDir, 'ignored.ts');
    writeFileSync(absPath, 'y\n', 'utf-8');
    const err: TaskError = { stack: `at x (${absPath}:1:1)` };
    const msg: BiRpcMessage = { m: 'other', a: [[['id', { errors: [err] }, undefined]]] };
    attachCodeFrames(msg);
    expect(err.codeFrame).toBeUndefined();
  });

  it('does nothing when there are no errors', () => {
    const msg: BiRpcMessage = onTaskUpdateMessage({});
    expect(() => attachCodeFrames(msg)).not.toThrow();
    const msgEmpty: BiRpcMessage = onTaskUpdateMessage({ errors: [] });
    attachCodeFrames(msgEmpty);
  });

  it('uses stackStr if stack is not present', () => {
    const absPath = join(tempDir, 'stackstr.ts');
    writeFileSync(absPath, 'code\n', 'utf-8');
    const err: TaskError = { stackStr: `Error\n    at fn (${absPath}:1:1)` };

    attachCodeFrames(onTaskUpdateMessage({ errors: [err] }));
    expect(err.codeFrame).toBeDefined();
  });

  it('handles non-existent file paths gracefully', () => {
    const err: TaskError = {
      stack: 'at fn (/nonexistent/path/file.ts:1:1)',
    };
    attachCodeFrames(onTaskUpdateMessage({ errors: [err] }));
    expect(err.codeFrame).toBeUndefined();
  });
});
