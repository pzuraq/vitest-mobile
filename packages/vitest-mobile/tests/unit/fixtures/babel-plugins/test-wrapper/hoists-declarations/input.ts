import a from 'a';
export const exported = 1;
export default {};
export * from 'b';
type Foo = number;
interface Bar {
  x: number;
}
describe('only-this-gets-wrapped', () => {});
