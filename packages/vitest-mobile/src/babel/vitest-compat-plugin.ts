/**
 * Babel plugin: make Vitest's Node-built dist files load cleanly under Metro.
 *
 * Scope is intentionally narrow — only files under `node_modules/vitest/` and
 * `node_modules/@vitest/*` are rewritten. User code and all other deps are
 * untouched.
 *
 * Two incompatibility classes are addressed:
 *
 * 1. `import.meta.url` → empty string.
 *    Vitest's bundled `worker.js` statically imports an inspector chunk that
 *    calls `createRequire(import.meta.url)` at module top. Our `node:module`
 *    stub's `createRequire` ignores its argument, but `import.meta.url` may
 *    not be supported by all Metro versions. Rewriting it to `""` removes
 *    that surface without affecting runtime behaviour (the `createRequire`
 *    thunk is never called on our path).
 *
 * 2. Dynamic `import(expr)` with a non-literal specifier → `Promise.reject`.
 *    Metro's Babel pipeline rejects `import(x)` when `x` isn't a string
 *    literal. Vitest's dist has several such call-sites as lazy bridges for
 *    optional features:
 *      - coverage provider (`@vitest/coverage-v8` / `-istanbul`)
 *      - custom test environments (`vitest-environment-*`)
 *      - `nativeModuleRunner` / `nativeModuleMocker` URL imports
 *      - OpenTelemetry SDK (`config.experimental.openTelemetry.sdkPath`)
 *    None of these code paths are reached on device (we use Metro for module
 *    loading, disable coverage / traces, and don't wire `@vitest/mocker`),
 *    so rewriting them to a rejected Promise preserves the observable
 *    behaviour: if some path unexpectedly calls into one, it fails with an
 *    explicit error rather than silently hanging.
 *
 * Literal dynamic imports — `import('node:vm')`, `import('@edge-runtime/vm')`,
 * `import('happy-dom')`, `import('jsdom')` — are left alone and resolved via
 * the stub table in `metro-runner.ts`.
 */

import type {
  MemberExpression,
  MetaProperty,
  StringLiteral,
  CallExpression,
  Expression,
  NewExpression,
} from '@babel/types';

interface BabelPath<T> {
  node: T;
  replaceWith: (node: unknown) => void;
}

interface PluginApi {
  types: {
    stringLiteral: (value: string) => StringLiteral;
    identifier: (name: string) => { type: 'Identifier'; name: string };
    memberExpression: (object: Expression, property: Expression) => MemberExpression;
    newExpression: (callee: Expression, args: Expression[]) => NewExpression;
    callExpression: (callee: Expression, args: Expression[]) => CallExpression;
  };
}

interface PluginPass {
  filename?: string;
}

function isVitestInternalFile(filename: string | undefined): boolean {
  if (!filename) return false;
  return (
    filename.includes('/node_modules/vitest/') ||
    filename.includes('\\node_modules\\vitest\\') ||
    filename.includes('/node_modules/@vitest/') ||
    filename.includes('\\node_modules\\@vitest\\')
  );
}

export default function vitestCompatPlugin({ types: t }: PluginApi) {
  return {
    name: 'vitest-compat',
    visitor: {
      MemberExpression(path: BabelPath<MemberExpression>, state: PluginPass) {
        if (!isVitestInternalFile(state.filename)) return;
        const { object, property } = path.node;
        if (object.type !== 'MetaProperty') return;
        const meta = object as MetaProperty;
        if (meta.meta.name !== 'import' || meta.property.name !== 'meta') return;
        // Hermes has no `import.meta`. Rewrite every `import.meta.X` access:
        //  - `.url`      → `""`  (consumed by `createRequire(import.meta.url)`)
        //  - everything else → `undefined` (e.g. `.resolve`, `.env`, …)
        const propName =
          property.type === 'Identifier' ? property.name : property.type === 'StringLiteral' ? property.value : null;
        if (propName === 'url') {
          path.replaceWith(t.stringLiteral(''));
        } else {
          path.replaceWith(t.identifier('undefined'));
        }
      },
      CallExpression(path: BabelPath<CallExpression>, state: PluginPass) {
        // Only dynamic import(...) — identified by a callee of type `Import`.
        const callee = path.node.callee as { type?: string };
        if (callee?.type !== 'Import') return;
        if (!isVitestInternalFile(state.filename)) return;
        const arg = path.node.arguments[0];
        // Literal specifiers are fine; Metro can bundle them and our stub
        // table (in metro-runner.ts) redirects them on-disk.
        if (arg && arg.type === 'StringLiteral') return;
        // Everything else — `import(expr)` where expr is a variable, call,
        // template literal, etc. — becomes a rejected Promise. Vitest's dist
        // only uses this pattern for optional-feature loaders we never run.
        path.replaceWith(
          t.callExpression(t.memberExpression(t.identifier('Promise'), t.identifier('reject')), [
            t.newExpression(t.identifier('Error'), [
              t.stringLiteral('[vitest-mobile] dynamic import() with non-literal specifier not supported on device'),
            ]),
          ]),
        );
      },
    },
  };
}
