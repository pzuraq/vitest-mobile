/**
 * Stub for `node:fs` — filesystem access isn't reachable from the runtime
 * paths we execute. All members throw / no-op.
 */

const notSupported = name => () => {
  throw new Error(`[vitest-mobile] fs.${name}() not supported on device`);
};

export const readFileSync = () => '';
export const existsSync = () => false;
export const writeFileSync = notSupported('writeFileSync');
export const statSync = notSupported('statSync');
export const mkdirSync = notSupported('mkdirSync');
export const readdirSync = () => [];
export const unlinkSync = () => {};
export const promises = {
  readFile: () => Promise.resolve(''),
  writeFile: () => Promise.resolve(),
  mkdir: () => Promise.resolve(undefined),
  unlink: () => Promise.resolve(),
  stat: () => Promise.reject(new Error('fs.stat not supported on device')),
};

export default {
  readFileSync,
  existsSync,
  writeFileSync,
  statSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
  promises,
};
