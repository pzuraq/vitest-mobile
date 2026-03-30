/**
 * Collector — registers describe/it/hook blocks into a suite tree.
 */

export interface TestNode {
  type: 'test';
  name: string;
  fn: () => void | Promise<void>;
  only: boolean;
  skip: boolean;
}

export interface SuiteNode {
  type: 'suite';
  name: string;
  children: Array<SuiteNode | TestNode>;
  beforeAll: Array<() => void | Promise<void>>;
  afterAll: Array<() => void | Promise<void>>;
  beforeEach: Array<() => void | Promise<void>>;
  afterEach: Array<() => void | Promise<void>>;
}

let rootSuite: SuiteNode = createSuite('root');
let currentSuite: SuiteNode = rootSuite;

function createSuite(name: string): SuiteNode {
  return {
    type: 'suite',
    name,
    children: [],
    beforeAll: [],
    afterAll: [],
    beforeEach: [],
    afterEach: [],
  };
}

export function describe(name: string, fn: () => void): void {
  const suite = createSuite(name);
  currentSuite.children.push(suite);
  const parentSuite = currentSuite;
  currentSuite = suite;
  fn();
  currentSuite = parentSuite;
}

function createIt(name: string, fn: () => void | Promise<void>, options: { only?: boolean; skip?: boolean } = {}): void {
  currentSuite.children.push({
    type: 'test',
    name,
    fn,
    only: options.only ?? false,
    skip: options.skip ?? false,
  });
}

export function it(name: string, fn: () => void | Promise<void>): void {
  createIt(name, fn);
}

it.only = function (name: string, fn: () => void | Promise<void>): void {
  createIt(name, fn, { only: true });
};

it.skip = function (name: string, fn: () => void | Promise<void>): void {
  createIt(name, fn, { skip: true });
};

export function beforeAll(fn: () => void | Promise<void>): void {
  currentSuite.beforeAll.push(fn);
}

export function afterAll(fn: () => void | Promise<void>): void {
  currentSuite.afterAll.push(fn);
}

export function beforeEach(fn: () => void | Promise<void>): void {
  currentSuite.beforeEach.push(fn);
}

export function afterEach(fn: () => void | Promise<void>): void {
  currentSuite.afterEach.push(fn);
}

export function getRootSuite(): SuiteNode {
  return rootSuite;
}

export function resetCollector(): void {
  rootSuite = createSuite('root');
  currentSuite = rootSuite;
}
