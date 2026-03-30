const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// Watch workspace root (for hoisted node_modules), packages, and modules
config.watchFolders = [
  workspaceRoot,
];

// Resolve node_modules from both app and workspace root
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

// Enable package.json "exports" field resolution — required for
// @vitest/expect which uses subpath exports like "@vitest/utils/diff"
config.resolver.unstable_enablePackageExports = true;

// Conditions for exports resolution (react-native takes priority)
config.resolver.unstable_conditionNames = ['import', 'require', 'default'];

module.exports = config;
