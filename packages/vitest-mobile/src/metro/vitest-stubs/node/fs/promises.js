/**
 * Stub for `node:fs/promises` — never called on the device.
 */

export const readFile = () => Promise.resolve('');
export const writeFile = () => Promise.resolve();
export const mkdir = () => Promise.resolve(undefined);
export const unlink = () => Promise.resolve();
export const stat = () => Promise.reject(new Error('fs.stat not supported on device'));
export const readdir = () => Promise.resolve([]);

export default { readFile, writeFile, mkdir, unlink, stat, readdir };
