/**
 * vitest-react-native-runtime init — scaffold a new test harness Expo app.
 *
 * Usage: npx vitest-react-native-runtime init [directory]
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dest: string = process.argv[2] || './test-app';
const destDir: string = resolve(process.cwd(), dest);

if (existsSync(destDir)) {
  console.error(`Error: ${dest} already exists. Remove it first or choose a different name.`);
  process.exit(1);
}

console.log(`\nScaffolding test harness app in ${dest}...`);
mkdirSync(destDir, { recursive: true });

// ── Generated files ────────────────────────────────────────────────

writeFileSync(
  resolve(destDir, 'package.json'),
  JSON.stringify(
    {
      name: 'vitest-native-app',
      version: '0.1.0',
      private: true,
      main: 'index.ts',
      scripts: {
        start: 'expo start --dev-client',
        android: 'expo run:android',
        ios: 'expo run:ios',
        prebuild: 'expo prebuild --clean',
      },
      dependencies: {
        expo: '~55.0.0',
        'expo-build-properties': '~55.0.0',
        react: '19.2.0',
        'react-native': '0.83.4',
        'vitest-react-native-runtime': '*',
        birpc: '^2.3.0',
        '@vitest/runner': '^4.0.0',
        '@vitest/expect': '^4.0.0',
        '@vitest/utils': '^4.0.0',
      },
      devDependencies: {
        '@babel/plugin-transform-class-static-block': '^7.24.0',
        '@types/react': '~19.2.0',
        typescript: '~5.3.3',
      },
    },
    null,
    2,
  ) + '\n',
);

writeFileSync(
  resolve(destDir, 'app.json'),
  JSON.stringify(
    {
      expo: {
        name: 'vitest-native',
        slug: 'vitest-native',
        version: '0.1.0',
        orientation: 'portrait',
        scheme: 'vitest-native',
        newArchEnabled: true,
        plugins: [['expo-build-properties', { ios: { deploymentTarget: '16.0' } }]],
        ios: {
          supportsTablet: true,
          bundleIdentifier: 'com.vitest.nativetest',
        },
        android: {
          adaptiveIcon: { backgroundColor: '#ffffff' },
          package: 'com.vitest.nativetest',
        },
      },
    },
    null,
    2,
  ) + '\n',
);

writeFileSync(
  resolve(destDir, 'App.tsx'),
  `import { createTestHarness } from 'vitest-react-native-runtime/runtime';

export default createTestHarness();
`,
);

writeFileSync(
  resolve(destDir, 'index.ts'),
  `import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
`,
);

writeFileSync(
  resolve(destDir, 'metro.config.js'),
  `const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// If this app lives inside a monorepo, hoist the watch folders so Metro
// can resolve vitest-react-native-runtime from the workspace root.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.unstable_enablePackageExports = true;
config.resolver.unstable_conditionNames = ['import', 'require', 'default'];

// Redirect virtual modules injected by the vitest pool
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'vitest-react-native-runtime/test-registry') {
    const registryPath = process.env.VITEST_NATIVE_REGISTRY_PATH;
    if (registryPath) return { type: 'sourceFile', filePath: registryPath };
  }
  if (moduleName === 'vitest') {
    return context.resolveRequest(context, 'vitest-react-native-runtime/vitest-shim', platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
`,
);

writeFileSync(
  resolve(destDir, 'babel.config.js'),
  `module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['@babel/plugin-transform-class-static-block'],
  };
};
`,
);

writeFileSync(
  resolve(destDir, 'tsconfig.json'),
  JSON.stringify(
    {
      extends: 'expo/tsconfig.base',
      compilerOptions: { strict: true },
    },
    null,
    2,
  ) + '\n',
);

console.log(`
Done! Next steps:

1. Customize ${dest}/app.json if needed (bundle ID, display name, etc.)

2. Install dependencies:

     cd ${dest} && npm install

3. Build and install on your device or emulator:

     npx vitest-react-native-runtime bootstrap android --app-dir ${dest}
     # or
     npx vitest-react-native-runtime bootstrap ios --app-dir ${dest}

   This will build the app, boot an emulator/simulator, and install.
   You can also run the steps separately:

     npx vitest-react-native-runtime build android --app-dir ${dest}
     npx vitest-react-native-runtime install android --app-dir ${dest}

4. Point your vitest config at this app:

     // vitest.config.ts
     import { defineConfig } from 'vitest/config';
     import { nativePlugin } from 'vitest-react-native-runtime';

     export default defineConfig({
       plugins: [nativePlugin({
         platform: 'android', // or 'ios'
         appDir: '${dest}',
       })],
     });

5. Run your tests:

     npx vitest run

   The pool will automatically boot an emulator if none is running,
   start Metro, launch the app, and stream results back to Vitest.
`);
