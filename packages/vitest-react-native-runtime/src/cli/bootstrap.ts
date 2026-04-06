/**
 * vitest-react-native-runtime bootstrap — build, boot device, and install in one step.
 *
 * Usage:
 *   npx vitest-react-native-runtime bootstrap android [--app-dir ./test-app]
 *   npx vitest-react-native-runtime bootstrap ios     [--app-dir ./test-app]
 */

// Delegates to build + install by re-invoking with the same argv.
await import('./build');
await import('./install');
