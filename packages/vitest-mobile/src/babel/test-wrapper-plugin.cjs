/**
 * Babel plugin: wrap test file bodies in an exports.__run function.
 *
 * CJS source entry so Babel can load the plugin without requiring a built dist/.
 */

function isTestFile(filename) {
  if (!filename) return false;
  return /\.test\.(tsx?|jsx?)$/.test(filename);
}

function isTopLevelDeclaration(node, t) {
  return (
    t.isImportDeclaration(node) ||
    t.isExportNamedDeclaration(node) ||
    t.isExportDefaultDeclaration(node) ||
    t.isExportAllDeclaration(node) ||
    t.isTSTypeAliasDeclaration(node) ||
    t.isTSInterfaceDeclaration(node)
  );
}

function extractTestKey(filename) {
  const match = filename.match(/packages\/([^/]+)\/tests\/(.+)$/);
  if (match) return `${match[1]}/${match[2]}`;
  const parts = filename.split('/');
  return parts[parts.length - 1] || filename;
}

module.exports = function testWrapperPlugin({ types: t }) {
  return {
    name: 'vitest-mobile-test-wrapper',
    visitor: {
      Program(path, state) {
        const filename = state.filename || state.file?.opts?.filename;
        if (!isTestFile(filename)) return;

        const topLevel = [];
        const body = [];

        for (const node of path.node.body) {
          if (isTopLevelDeclaration(node, t)) {
            topLevel.push(node);
          } else {
            body.push(node);
          }
        }

        if (body.length === 0) return;

        const testKey = extractTestKey(filename || '');

        const runFn = t.functionExpression(null, [], t.blockStatement(body));
        const runExport = t.expressionStatement(
          t.assignmentExpression('=', t.memberExpression(t.identifier('exports'), t.identifier('__run')), runFn),
        );

        const keyExport = t.expressionStatement(
          t.assignmentExpression(
            '=',
            t.memberExpression(t.identifier('exports'), t.identifier('__testKey')),
            t.stringLiteral(testKey),
          ),
        );

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
};
