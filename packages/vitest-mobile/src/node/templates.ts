/**
 * templates — load files from `assets/templates/` and fill `{{KEY}}` placeholders.
 *
 * Two flavors:
 *
 *   `renderNodeTemplate(name, replacements)` — strict, returns a string.
 *     Used for the JS templates under `assets/templates/node/` that we emit
 *     into the harness project at runtime (transformer.cjs, metro.config.cjs,
 *     index.entry.js). Throws on any unfilled `{{KEY}}` so a typo in one of
 *     these templates surfaces immediately. Replacement values are escaped
 *     for safe drop-in between `"` … `"` in JS string literals — the
 *     templates use `Number("{{PORT}}")` for numeric values to keep that
 *     "placeholders live inside strings" invariant.
 *
 *   `applyTemplateTree(subdir, dest)` + `fillFilePlaceholders(file, repl)` —
 *     lax, mutate files on disk. Used for the iOS/Android template subtrees
 *     copied into the scaffolded harness project during a build. Lax in two
 *     ways: it does NOT throw on unfilled placeholders (some templates have
 *     conditional sections that legitimately leave KEYs unfilled), and it
 *     does NOT escape replacement values (these go into XML, plist, and
 *     gradle, not JS strings).
 *
 * Path resolution: every helper resolves relative to this module's compiled
 * location (`dist/node/`), so behavior is identical whether running from the
 * workspace symlink or an installed package.
 */

import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMPLATES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'templates');

const PLACEHOLDER_RE = /\{\{[A-Z0-9_]+\}\}/g;

/** Escape a string for safe drop-in between `"` … `"` in a JS template. */
function escapeForDoubleQuoted(value: string): string {
  // JSON.stringify handles backslash, quote, control chars, and the
  // line/paragraph separators that break JS sources. The surrounding
  // quotes it adds are provided by the template itself.
  const json = JSON.stringify(value);
  return json.slice(1, json.length - 1);
}

/** Strict: render a JS template under `node/` and throw on unfilled placeholders. */
export function renderNodeTemplate(name: string, replacements: Record<string, string>): string {
  let content = readFileSync(resolve(TEMPLATES_DIR, 'node', name), 'utf8');
  for (const [key, value] of Object.entries(replacements)) {
    content = content.replaceAll(`{{${key}}}`, escapeForDoubleQuoted(value));
  }
  const unfilled = content.match(PLACEHOLDER_RE);
  if (unfilled) {
    throw new Error(
      `vitest-mobile template ${name} has unfilled placeholder(s): ${Array.from(new Set(unfilled)).join(', ')}`,
    );
  }
  return content;
}

/**
 * Copy a subtree (e.g. `ios/`, `android/`) from the templates dir into the
 * scaffolded project, overwriting any files at the same paths.
 */
export function applyTemplateTree(subdir: 'ios' | 'android', dest: string): void {
  cpSync(resolve(TEMPLATES_DIR, subdir), resolve(dest, subdir), { recursive: true });
}

/**
 * Replace `{{KEY}}` placeholders in a file already on disk. Raw replacement
 * (no escaping); intended for native config files (XML, plist, gradle).
 * Unfilled placeholders are left in place — some templates use them
 * conditionally.
 */
export function fillFilePlaceholders(filePath: string, replacements: Record<string, string>): void {
  let content = readFileSync(filePath, 'utf8');
  for (const [key, value] of Object.entries(replacements)) {
    content = content.replaceAll(`{{${key}}}`, value);
  }
  writeFileSync(filePath, content);
}
