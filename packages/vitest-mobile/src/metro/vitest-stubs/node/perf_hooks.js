/**
 * Stub for `node:perf_hooks` — just re-expose the global performance object.
 */

export const performance = globalThis.performance ?? { now: () => Date.now() };

export default { performance };
