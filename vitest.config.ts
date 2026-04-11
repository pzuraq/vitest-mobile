import { defineConfig } from 'vitest/config';
import { nativePlugin } from 'vitest-mobile';

const isRunMode = process.argv.includes('run') || !!process.env.CI;

export default defineConfig({
  test: {
    teardownTimeout: 500,
    forceExit: isRunMode,
    projects: [
      {
        plugins: [nativePlugin({ platform: 'ios' })],
        test: {
          name: 'ios',
          include: ['test-packages/**/tests/**/*.test.tsx'],
        },
      },
      {
        plugins: [nativePlugin({ platform: 'android' })],
        test: {
          name: 'android',
          include: ['test-packages/**/tests/**/*.test.tsx'],
        },
      },
    ],
  },
});
