import { describe, it } from 'vitest';
var _rerunCb = null;
exports.__run = function (rerunCb) {
  if (typeof rerunCb === "function") _rerunCb = rerunCb;
  describe('x', () => {
    it('passes', () => {});
  });
};
if (module.hot) {
  module.hot.accept();
  module.hot.dispose(() => {
    typeof _rerunCb === "function" && _rerunCb();
  });
}
