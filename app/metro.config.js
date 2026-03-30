const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.unstable_enablePackageExports = true;
config.resolver.unstable_conditionNames = ['import', 'require', 'default'];

// Virtual test registry — pool passes the path via env var
const registryPath = process.env.VITEST_NATIVE_REGISTRY_PATH;
if (registryPath) {
  const originalResolver = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (moduleName === 'vitest-react-native-runtime/test-registry') {
      return { type: 'sourceFile', filePath: registryPath };
    }
    if (moduleName === 'vitest') {
      return context.resolveRequest(context, 'vitest-react-native-runtime/vitest-shim', platform);
    }
    if (originalResolver) {
      return originalResolver(context, moduleName, platform);
    }
    return context.resolveRequest(context, moduleName, platform);
  };
}

module.exports = config;
