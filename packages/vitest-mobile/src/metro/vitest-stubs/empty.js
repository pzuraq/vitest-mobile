/**
 * Canonical empty module — the fallback stub for any module declared in
 * `STUBBED_MODULES` (in `assets/templates/node/metro.config.cjs`) that
 * doesn't have a dedicated file at the derived path. Destructured imports
 * resolve to `undefined`; default imports resolve to `{}`. Safe so long as
 * nothing in the import chain reads a specific named export at module-top
 * — if one does, drop a dedicated file under the corresponding namespace
 * directory (e.g. `node/<name>.js`, `vite/<name>.js`) exporting real values.
 */

export default {};
