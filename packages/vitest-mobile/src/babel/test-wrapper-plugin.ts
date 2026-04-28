/**
 * Babel plugin: wrap test file bodies in an exports.__run function.
 *
 * Transforms *.test.{ts,tsx} files so that:
 * - Import/export declarations stay at the top level (Metro needs them)
 * - `var _rerunCb` holds the current rerun callback from the pool
 * - All other statements (describe, it, afterEach, etc.) get wrapped in exports.__run
 * - module.hot.accept() is added so the file is its own HMR boundary
 * - module.hot.dispose() invokes _rerunCb (set by the next __run) so the control
 *   bridge can post an `update` for that file
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
  variableDeclaration(kind: 'var' | 'let' | 'const', decl: unknown[]): Statement;
  variableDeclarator(id: LVal, init?: Expression | null): unknown;
  nullLiteral(): Expression;
  binaryExpression(
    op: '===' | '!==' | '==' | '!=' | '<' | '>' | '...' | (string & {}),
    left: Expression,
    right: Expression,
  ): Expression;
  unaryExpression(op: 'void' | 'delete' | 'typeof' | '!' | '+' | '-', arg: Expression): Expression;
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

        // var _rerunCb;
        const varRun = t.variableDeclaration('var', [t.variableDeclarator(t.identifier('_rerunCb'), t.nullLiteral())]);

        // exports.__run = function (rerunCb) { if (typeof rerunCb === 'function') _rerunCb = rerunCb; ...body }
        const setWhenFn = t.ifStatement(
          t.binaryExpression('===', t.unaryExpression('typeof', t.identifier('rerunCb')), t.stringLiteral('function')),
          t.expressionStatement(t.assignmentExpression('=', t.identifier('_rerunCb'), t.identifier('rerunCb'))),
        );
        const runBody = t.blockStatement([setWhenFn, ...body]);
        const runFn = t.functionExpression(null, [t.identifier('rerunCb')], runBody);
        const runExport = t.expressionStatement(
          t.assignmentExpression('=', t.memberExpression(t.identifier('exports'), t.identifier('__run')), runFn),
        );

        // if (module.hot) { module.hot.accept(); module.hot.dispose(() => { void _rerunCb?.() }) }
        const hmrBlock = t.ifStatement(
          t.memberExpression(t.identifier('module'), t.identifier('hot')),
          t.blockStatement([
            t.expressionStatement(
              t.callExpression(
                t.memberExpression(
                  t.memberExpression(t.identifier('module'), t.identifier('hot')),
                  t.identifier('accept'),
                ),
                [],
              ),
            ),
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
                      t.expressionStatement(
                        t.logicalExpression(
                          '&&',
                          t.binaryExpression(
                            '===',
                            t.unaryExpression('typeof', t.identifier('_rerunCb')),
                            t.stringLiteral('function'),
                          ),
                          t.callExpression(t.identifier('_rerunCb'), []),
                        ),
                      ),
                    ]),
                  ),
                ],
              ),
            ),
          ]),
        );

        path.node.body = [...topLevel, varRun, runExport, hmrBlock];
      },
    },
  };
}
