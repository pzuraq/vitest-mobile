/**
 * Stub for `node:util` — minimal promisify / format / inspect for
 * Vitest internals that format errors or adapt Node callbacks.
 */

export function promisify(fn) {
  return (...args) =>
    new Promise((resolve, reject) => {
      fn(...args, (err, value) => (err ? reject(err) : resolve(value)));
    });
}

export function format(...args) {
  return args.map(a => (typeof a === 'string' ? a : safeStringify(a))).join(' ');
}

export function inspect(value) {
  return safeStringify(value);
}

function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export const types = {
  isPromise: v => v && typeof v.then === 'function',
  isMap: v => v instanceof Map,
  isSet: v => v instanceof Set,
  isDate: v => v instanceof Date,
  isRegExp: v => v instanceof RegExp,
};

export default { promisify, format, inspect, types };
