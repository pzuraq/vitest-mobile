/**
 * Stub for `node:console` — Vitest's console-spy path destructures `Console`.
 * We expose a no-op class and re-export the global console.
 */

export class Console {
  constructor() {}
  log() {}
  warn() {}
  error() {}
  info() {}
  debug() {}
}

export default globalThis.console;
