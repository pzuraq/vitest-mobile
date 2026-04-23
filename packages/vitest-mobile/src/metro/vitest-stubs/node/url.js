/**
 * Stub for `node:url` — used at module-top for `pathToFileURL(import.meta.url)`.
 * We return a minimal URL-like object that satisfies `toString()` / `href`.
 */

export function pathToFileURL(p) {
  const href = `file://${p}`;
  return { href, toString: () => href, pathname: p };
}

export function fileURLToPath(u) {
  return String(u).replace(/^file:\/\//, '');
}

export const URL = globalThis.URL;
export const URLSearchParams = globalThis.URLSearchParams;

export default { pathToFileURL, fileURLToPath, URL, URLSearchParams };
