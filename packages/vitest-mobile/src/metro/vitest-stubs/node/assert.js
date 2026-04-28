/**
 * Stub for `node:assert` — Vitest rarely uses runtime assertions on the
 * device path, but some coverage/snapshot paths destructure it.
 */

function assertFn(value, message) {
  if (!value) throw new Error(message ?? 'assertion failed');
}

export const ok = assertFn;
export const strictEqual = (a, b, message) => {
  if (a !== b) throw new Error(message ?? `${a} !== ${b}`);
};
export const deepStrictEqual = () => {};
export const notStrictEqual = () => {};
export const fail = message => {
  throw new Error(message ?? 'assert.fail');
};

const assert = Object.assign(assertFn, {
  ok,
  strictEqual,
  deepStrictEqual,
  notStrictEqual,
  fail,
});

export default assert;
