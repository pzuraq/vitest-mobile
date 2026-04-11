/**
 * Shared utility for resolving Vitest filepaths to test-registry keys.
 */

/**
 * Map a vitest full filepath to a test-registry key.
 * Keys are like "counter/counter.test.tsx".
 *
 * Tries direct match, then filename match, then suffix match.
 */
export function resolveRegistryKey(filepath: string, keys: string[]): string | null {
  if (keys.includes(filepath)) return filepath;

  const filename = filepath.split('/').pop() ?? filepath;
  const match = keys.find(k => {
    const keyFilename = k.split('/').pop() ?? k;
    return keyFilename === filename;
  });
  if (match) return match;

  const suffixMatch = keys.find(k => filepath.endsWith(k) || filepath.endsWith(k.replace('./', '')));
  return suffixMatch ?? null;
}
