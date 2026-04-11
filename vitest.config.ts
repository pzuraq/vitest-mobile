import { defineConfig } from 'vitest/config';
import { nativePlugin } from 'vitest-react-native-runtime';

export default defineConfig({
  test: {
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
