/**
 * Babel plugin: inline `process.env.VITEST_MOBILE_APP_ROOT*` to string literals.
 *
 * Two patterns are recognized so test-context can pass a relative path to
 * `require.context()` (Metro's `path.join(parentPath, '..', dep.name)` mangles
 * absolute first-arg directories — see `metro/src/DeltaBundler/buildSubgraph.js`)
 * while still having an absolute prefix to convert keys ↔ Vitest abs paths:
 *
 *   process.env.VITEST_MOBILE_APP_ROOT      → relative from current file dir
 *                                             to the absolute app root.
 *                                             Used as `require.context()`'s 1st arg.
 *   process.env.VITEST_MOBILE_APP_ROOT_ABS  → the absolute app root itself.
 *                                             Used to build `ROOT_PREFIX`.
 *
 * Both values are derived from the single env var
 * `process.env.VITEST_MOBILE_APP_ROOT` set on the pool / CLI parent process
 * (see `node/metro-runner.ts::prepareMetroConfig`). jest-worker children inherit
 * env vars at spawn time, so the value is available inside transform workers.
 *
 * Mirrors expo-router's babel plugin pattern, which inlines
 * `process.env.EXPO_ROUTER_APP_ROOT` as a relative path computed from the
 * file being transformed — see `babel-preset-expo/src/expo-router-plugin.ts`.
 */

import * as nodePath from 'node:path';
import type { MemberExpression, Identifier, StringLiteral, RegExpLiteral, Node } from '@babel/types';

interface BabelPath<T> {
  node: T;
  parent?: Node;
  parentPath?: { node: Node };
  replaceWith: (node: unknown) => void;
}

interface PluginApi {
  types: {
    stringLiteral(value: string): StringLiteral;
    regExpLiteral(pattern: string, flags?: string): RegExpLiteral;
  };
}

interface PluginPass {
  filename?: string;
  file?: { opts?: { filename?: string } };
}

const ENV_VAR_REL = 'VITEST_MOBILE_APP_ROOT';
const ENV_VAR_ABS = 'VITEST_MOBILE_APP_ROOT_ABS';
const TEST_PATTERN_MARKER = '__VM_TEST_PATTERN__';

function readAbsAppRoot(): string {
  const v = process.env[ENV_VAR_REL];
  if (!v) {
    throw new Error(`vitest-mobile-inline-app-root: ${ENV_VAR_REL} is not set on the Metro transform-worker process`);
  }
  return v;
}

export default function inlineAppRootPlugin({ types: t }: PluginApi) {
  return {
    name: 'vitest-mobile-inline-app-root',
    visitor: {
      RegExpLiteral(path: BabelPath<RegExpLiteral>) {
        // Marker regex `/__VM_TEST_PATTERN__/` is replaced with the regex
        // derived from Vitest's `cfg.include` patterns (see metro-runner's
        // `buildContextRegexSource`). Done as a `RegExpLiteral` so Metro's
        // `unstable_allowRequireContext` static analyzer accepts it.
        if (path.node.pattern !== TEST_PATTERN_MARKER) return;
        const source = process.env.VITEST_MOBILE_TEST_PATTERN_SOURCE;
        if (!source) {
          throw new Error(
            'vitest-mobile-inline-app-root: VITEST_MOBILE_TEST_PATTERN_SOURCE is not set on the Metro transform-worker process',
          );
        }
        path.replaceWith(t.regExpLiteral(source, ''));
      },
      MemberExpression(path: BabelPath<MemberExpression>, state: PluginPass) {
        const node = path.node;
        // Match: process.env.<NAME>
        if (node.object.type !== 'MemberExpression') return;
        const inner = node.object;
        if (inner.object.type !== 'Identifier') return;
        if ((inner.object as Identifier).name !== 'process') return;
        if (inner.property.type !== 'Identifier') return;
        if ((inner.property as Identifier).name !== 'env') return;
        const propName =
          node.property.type === 'Identifier'
            ? (node.property as Identifier).name
            : node.property.type === 'StringLiteral'
              ? (node.property as StringLiteral).value
              : null;
        if (propName !== ENV_VAR_REL && propName !== ENV_VAR_ABS) return;
        // Skip assignment targets (e.g. `process.env.VITEST_MOBILE_APP_ROOT = …`)
        const parent = path.parent;
        if (parent && parent.type === 'AssignmentExpression' && (parent as { left?: unknown }).left === node) {
          return;
        }
        const absRoot = readAbsAppRoot();
        if (propName === ENV_VAR_ABS) {
          path.replaceWith(t.stringLiteral(absRoot));
          return;
        }
        const filename = state.filename ?? state.file?.opts?.filename;
        if (!filename) {
          throw new Error('vitest-mobile-inline-app-root: no filename available for relative-path computation');
        }
        // Posix-slashed relative path. Metro's `path.join(parentPath, '..', dep.name)`
        // walks up from the calling file's parent and applies `dep.name`, so we want
        // the path from the file's directory back to the app root.
        const rel = nodePath.relative(nodePath.dirname(filename), absRoot);
        const relPosix = rel.split(nodePath.sep).join('/');
        path.replaceWith(t.stringLiteral(relPosix));
      },
    },
  };
}
