/**
 * Babel plugin: wrap test file bodies in an exports.__run function.
 *
 * Transforms *.test.{ts,tsx} files so that:
 * - Import/export declarations stay at the top level (Metro needs them)
 * - All other statements (describe, it, afterEach, etc.) get wrapped in exports.__run
 * - module.hot.accept() is added so the file is its own HMR boundary
 * - module.hot.dispose() notifies listeners with the filename when the file changes
 */

import type {
  Node,
  Statement,
  Expression,
  FunctionExpression,
  BlockStatement,
  ExpressionStatement,
  AssignmentExpression,
  MemberExpression,
  Identifier,
  IfStatement,
  CallExpression,
  ArrowFunctionExpression,
  StringLiteral,
  LogicalExpression,
  LVal,
  FunctionDeclaration,
} from '@babel/types';

type FunctionParameter = Identifier | LVal;

/**
 * Subset of @babel/types builder + type-guard API that this plugin uses.
 * @babel/core doesn't ship .d.ts, so we type the parameter manually.
 */
interface BabelTypes {
  isImportDeclaration(node: Node | null | undefined): boolean;
  isExportNamedDeclaration(node: Node | null | undefined): boolean;
  isExportDefaultDeclaration(node: Node | null | undefined): boolean;
  isExportAllDeclaration(node: Node | null | undefined): boolean;
  isTSTypeAliasDeclaration(node: Node | null | undefined): boolean;
  isTSInterfaceDeclaration(node: Node | null | undefined): boolean;
  functionExpression(
    id: Identifier | null | undefined,
    params: FunctionParameter[],
    body: BlockStatement,
  ): FunctionExpression;
  blockStatement(body: Statement[]): BlockStatement;
  expressionStatement(expression: Expression): ExpressionStatement;
  assignmentExpression(operator: string, left: LVal | MemberExpression, right: Expression): AssignmentExpression;
  memberExpression(object: Expression, property: Expression | Identifier): MemberExpression;
  identifier(name: string): Identifier;
  ifStatement(test: Expression, consequent: Statement): IfStatement;
  callExpression(callee: Expression, args: (Expression | FunctionDeclaration)[]): CallExpression;
  arrowFunctionExpression(params: FunctionParameter[], body: BlockStatement | Expression): ArrowFunctionExpression;
  stringLiteral(value: string): StringLiteral;
  logicalExpression(operator: '||' | '&&' | '??', left: Expression, right: Expression): LogicalExpression;
}

interface BabelPluginState {
  filename?: string;
  file?: { opts?: { filename?: string } };
}

interface ProgramPath {
  node: { body: Statement[] };
}

function isTestFile(filename: string | undefined): boolean {
  if (!filename) return false;
  return /\.test\.(tsx?|jsx?)$/.test(filename);
}

function isTopLevelDeclaration(node: Node, t: BabelTypes): boolean {
  return (
    t.isImportDeclaration(node) ||
    t.isExportNamedDeclaration(node) ||
    t.isExportDefaultDeclaration(node) ||
    t.isExportAllDeclaration(node) ||
    t.isTSTypeAliasDeclaration(node) ||
    t.isTSInterfaceDeclaration(node)
  );
}

/**
 * Extract a short key from a filename like "packages/counter/tests/counter.test.tsx"
 * → "counter/counter.test.tsx"
 */
function extractTestKey(filename: string): string {
  const match = filename.match(/packages\/([^/]+)\/tests\/(.+)$/);
  if (match) return `${match[1]}/${match[2]}`;
  // Fallback: just the basename
  const parts = filename.split('/');
  return parts[parts.length - 1] ?? filename;
}

export default function testWrapperPlugin({ types: t }: { types: BabelTypes }) {
  return {
    name: 'vitest-mobile-test-wrapper',
    visitor: {
      Program(path: ProgramPath, state: BabelPluginState) {
        const filename: string | undefined = state.filename ?? state.file?.opts?.filename;
        if (!isTestFile(filename)) return;

        const topLevel: Statement[] = [];
        const body: Statement[] = [];

        for (const node of path.node.body) {
          if (isTopLevelDeclaration(node, t)) {
            topLevel.push(node);
          } else {
            body.push(node);
          }
        }

        if (body.length === 0) return;

        const testKey = extractTestKey(filename ?? '');

        // exports.__run = function() { ...body... }
        const runFn = t.functionExpression(null, [], t.blockStatement(body));
        const runExport = t.expressionStatement(
          t.assignmentExpression('=', t.memberExpression(t.identifier('exports'), t.identifier('__run')), runFn),
        );

        // exports.__testKey = "counter/counter.test.tsx"
        const keyExport = t.expressionStatement(
          t.assignmentExpression(
            '=',
            t.memberExpression(t.identifier('exports'), t.identifier('__testKey')),
            t.stringLiteral(testKey),
          ),
        );

        // if (module.hot) { module.hot.accept(); module.hot.dispose(...) }
        const hmrBlock = t.ifStatement(
          t.memberExpression(t.identifier('module'), t.identifier('hot')),
          t.blockStatement([
            // module.hot.accept()
            t.expressionStatement(
              t.callExpression(
                t.memberExpression(
                  t.memberExpression(t.identifier('module'), t.identifier('hot')),
                  t.identifier('accept'),
                ),
                [],
              ),
            ),
            // module.hot.dispose(() => { listeners?.forEach(fn => fn(testKey)) })
            t.expressionStatement(
              t.callExpression(
                t.memberExpression(
                  t.memberExpression(t.identifier('module'), t.identifier('hot')),
                  t.identifier('dispose'),
                ),
                [
                  t.arrowFunctionExpression(
                    [],
                    t.blockStatement([
                      // globalThis.__TEST_HMR_LISTENERS__ && globalThis.__TEST_HMR_LISTENERS__.forEach(fn => fn(testKey))
                      t.expressionStatement(
                        t.logicalExpression(
                          '&&',
                          t.memberExpression(t.identifier('globalThis'), t.identifier('__TEST_HMR_LISTENERS__')),
                          t.callExpression(
                            t.memberExpression(
                              t.memberExpression(t.identifier('globalThis'), t.identifier('__TEST_HMR_LISTENERS__')),
                              t.identifier('forEach'),
                            ),
                            [
                              t.arrowFunctionExpression(
                                [t.identifier('fn')],
                                t.callExpression(t.identifier('fn'), [t.stringLiteral(testKey)]),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ]),
                  ),
                ],
              ),
            ),
          ]),
        );

        path.node.body = [...topLevel, runExport, keyExport, hmrBlock];
      },
    },
  };
}
