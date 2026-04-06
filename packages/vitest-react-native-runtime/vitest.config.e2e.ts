import { defineConfig } from 'vitest/config';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  test: {
    include: ['tests/e2e/**/*.test.ts'],
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
