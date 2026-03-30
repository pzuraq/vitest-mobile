import { defineConfig } from 'vitest/config';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { nativePlugin } from 'vitest-react-native-runtime';

const __dir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    nativePlugin({
      platform: 'android',
      bundleId: 'com.vitest.nativetest',
      appDir: resolve(__dir, 'app'),
    }),
  ],
  test: {
    name: 'android',
    include: ['modules/**/tests/**/*.test.tsx'],
  },
});
