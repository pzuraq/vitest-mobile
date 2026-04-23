import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as babel from '@babel/core';
import testWrapperPlugin from '../../src/babel/test-wrapper-plugin';
import inlineAppRootPlugin from '../../src/babel/inline-app-root-plugin';
import vitestCompatPlugin from '../../src/babel/vitest-compat-plugin';

const FIXTURES_ROOT = path.join(__dirname, 'fixtures', 'babel-plugins');

interface TransformOptions {
  filename: string;
  plugin: babel.PluginItem;
  sourceType?: 'module' | 'script';
}

function transform(source: string, { filename, plugin, sourceType = 'module' }: TransformOptions): string {
  const out = babel.transformSync(source, {
    filename,
    plugins: [plugin],
    sourceType,
    configFile: false,
    babelrc: false,
    ast: false,
    code: true,
    parserOpts: { plugins: ['typescript', 'jsx'] },
  });
  if (!out || typeof out.code !== 'string') {
    throw new Error('babel.transformSync produced no code');
  }
  return out.code;
}

interface FixtureCase {
  /** Fixture directory, relative to `tests/unit/fixtures/babel-plugins/<group>/`. */
  name: string;
  /** Filename to feed Babel (controls plugin scope decisions). */
  filename: string;
  /** Env vars to set for the duration of the case. */
  env?: Record<string, string>;
}

/**
 * Reads a fixture file and normalizes the trailing newline so on-disk
 * conventions don't drift from babel's no-trailing-newline output.
 */
function readFixture(file: string): string {
  return fs.readFileSync(file, 'utf8').replace(/\n+$/, '');
}

/**
 * Run a single fixture case: read input.ts, transform it with `plugin`,
 * and assert the result equals output.ts.
 */
function runFixture(group: string, c: FixtureCase, plugin: babel.PluginItem): void {
  const dir = path.join(FIXTURES_ROOT, group, c.name);
  const input = readFixture(path.join(dir, 'input.ts'));
  const expected = readFixture(path.join(dir, 'output.ts'));
  const actual = transform(input, { filename: c.filename, plugin });
  expect(actual.replace(/\n+$/, '')).toBe(expected);
}

// ── test-wrapper-plugin ───────────────────────────────────────────────────────

describe('test-wrapper-plugin', () => {
  const wrapperCases: FixtureCase[] = [
    { name: 'basic', filename: '/proj/foo.test.ts' },
    { name: 'hoists-declarations', filename: '/proj/x.test.ts' },
    { name: 'non-test-file', filename: '/proj/foo.ts' },
    { name: 'only-top-level-declarations', filename: '/proj/foo.test.ts' },
  ];

  for (const c of wrapperCases) {
    it(c.name, () => runFixture('test-wrapper', c, testWrapperPlugin));
  }

  it('matches .test.ts, .test.tsx, .test.js, and .test.jsx extensions', () => {
    const source = `it('a', () => {});`;
    for (const filename of ['/p/a.test.ts', '/p/a.test.tsx', '/p/a.test.js', '/p/a.test.jsx']) {
      const out = transform(source, { filename, plugin: testWrapperPlugin });
      expect(out, filename).toContain('exports.__run');
    }
  });
});

// ── inline-app-root-plugin ────────────────────────────────────────────────────

describe('inline-app-root-plugin', () => {
  const appRootCases: FixtureCase[] = [
    {
      name: 'replaces-app-root-relative',
      filename: '/abs/app/root/nested/dir/test-context.ts',
      env: { VITEST_MOBILE_APP_ROOT: '/abs/app/root' },
    },
    {
      name: 'replaces-app-root-abs',
      filename: '/abs/app/root/anything.ts',
      env: { VITEST_MOBILE_APP_ROOT: '/abs/app/root' },
    },
    {
      name: 'same-directory-as-app-root',
      filename: '/abs/app/file.ts',
      env: { VITEST_MOBILE_APP_ROOT: '/abs/app' },
    },
    {
      name: 'skips-assignment-target',
      filename: '/abs/app/root/file.ts',
      env: { VITEST_MOBILE_APP_ROOT: '/abs/app/root' },
    },
    {
      name: 'leaves-unrelated-env-vars',
      filename: '/abs/app/root/file.ts',
      env: { VITEST_MOBILE_APP_ROOT: '/abs/app/root' },
    },
    {
      name: 'replaces-test-pattern-marker',
      filename: '/abs/app/root/file.ts',
      env: {
        VITEST_MOBILE_APP_ROOT: '/abs/app/root',
        VITEST_MOBILE_TEST_PATTERN_SOURCE: '\\.test\\.tsx?$',
      },
    },
    {
      name: 'leaves-other-regex-literals',
      filename: '/abs/app/root/file.ts',
      env: { VITEST_MOBILE_APP_ROOT: '/abs/app/root' },
    },
  ];

  let prevAppRoot: string | undefined;
  let prevPattern: string | undefined;

  beforeEach(() => {
    prevAppRoot = process.env.VITEST_MOBILE_APP_ROOT;
    prevPattern = process.env.VITEST_MOBILE_TEST_PATTERN_SOURCE;
  });

  afterEach(() => {
    if (prevAppRoot === undefined) delete process.env.VITEST_MOBILE_APP_ROOT;
    else process.env.VITEST_MOBILE_APP_ROOT = prevAppRoot;
    if (prevPattern === undefined) delete process.env.VITEST_MOBILE_TEST_PATTERN_SOURCE;
    else process.env.VITEST_MOBILE_TEST_PATTERN_SOURCE = prevPattern;
  });

  for (const c of appRootCases) {
    it(c.name, () => {
      if (c.env) Object.assign(process.env, c.env);
      runFixture('inline-app-root', c, inlineAppRootPlugin);
    });
  }

  it('throws when VITEST_MOBILE_APP_ROOT is not set on the worker process', () => {
    delete process.env.VITEST_MOBILE_APP_ROOT;
    expect(() =>
      transform(`var d = process.env.VITEST_MOBILE_APP_ROOT;`, {
        filename: '/abs/app/root/file.ts',
        plugin: inlineAppRootPlugin,
      }),
    ).toThrow(/VITEST_MOBILE_APP_ROOT is not set/);
  });

  it('throws when /__VM_TEST_PATTERN__/ is present but VITEST_MOBILE_TEST_PATTERN_SOURCE is not set', () => {
    process.env.VITEST_MOBILE_APP_ROOT = '/abs/app/root';
    delete process.env.VITEST_MOBILE_TEST_PATTERN_SOURCE;
    expect(() =>
      transform(`var r = /__VM_TEST_PATTERN__/;`, {
        filename: '/abs/app/root/file.ts',
        plugin: inlineAppRootPlugin,
      }),
    ).toThrow(/VITEST_MOBILE_TEST_PATTERN_SOURCE is not set/);
  });
});

// ── vitest-compat-plugin ──────────────────────────────────────────────────────

describe('vitest-compat-plugin', () => {
  const compatCases: FixtureCase[] = [
    {
      name: 'rewrites-import-meta-url-vitest',
      filename: '/proj/node_modules/vitest/dist/index.js',
    },
    {
      name: 'rewrites-import-meta-url-subvitest',
      filename: '/proj/node_modules/@vitest/runner/dist/index.js',
    },
    {
      name: 'rewrites-other-import-meta-to-undefined',
      filename: '/proj/node_modules/vitest/dist/index.js',
    },
    {
      name: 'rewrites-non-literal-dynamic-import',
      filename: '/proj/node_modules/vitest/dist/index.js',
    },
    {
      name: 'leaves-literal-dynamic-import-alone',
      filename: '/proj/node_modules/vitest/dist/index.js',
    },
    {
      name: 'leaves-user-code-untouched',
      filename: '/proj/src/foo.ts',
    },
    {
      name: 'windows-style-node_modules-path',
      filename: 'C:\\proj\\node_modules\\vitest\\dist\\index.js',
    },
  ];

  for (const c of compatCases) {
    it(c.name, () => runFixture('vitest-compat', c, vitestCompatPlugin));
  }
});
