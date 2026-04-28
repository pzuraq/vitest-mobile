import a from 'a';
export const exported = 1;
export default {};
export * from 'b';
type Foo = number;
interface Bar {
  x: number;
}
var _rerunCb = null;
exports.__run = function (rerunCb) {
  if (typeof rerunCb === "function") _rerunCb = rerunCb;
  describe('only-this-gets-wrapped', () => {});
};
if (module.hot) {
  module.hot.accept();
  module.hot.dispose(() => {
    typeof _rerunCb === "function" && _rerunCb();
  });
}
