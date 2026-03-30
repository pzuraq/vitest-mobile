/**
 * Formatter — pretty-prints test results to the terminal.
 */

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
const SKIP = '\x1b[33m○\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

export function formatSuiteStart(name: string, path: string[]): string {
  const indent = '  '.repeat(path.length - 1);
  return `${indent}${BOLD}${name}${RESET}`;
}

export function formatTestPass(name: string, path: string[], duration: number): string {
  const indent = '  '.repeat(path.length - 1);
  return `${indent}${PASS} ${name} ${DIM}(${duration}ms)${RESET}`;
}

export function formatTestFail(
  name: string,
  path: string[],
  duration: number,
  error: { message: string; stack?: string }
): string {
  const indent = '  '.repeat(path.length - 1);
  const errorIndent = '  '.repeat(path.length);
  let output = `${indent}${FAIL} ${RED}${name}${RESET} ${DIM}(${duration}ms)${RESET}`;
  output += `\n${errorIndent}${RED}${error.message}${RESET}`;
  return output;
}

export function formatTestSkip(name: string, path: string[]): string {
  const indent = '  '.repeat(path.length - 1);
  return `${indent}${SKIP} ${DIM}${name}${RESET}`;
}

export function formatRunComplete(result: {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  duration: number;
}): string {
  const lines: string[] = [''];

  const parts: string[] = [];
  if (result.passed > 0) parts.push(`${GREEN}${result.passed} passed${RESET}`);
  if (result.failed > 0) parts.push(`${RED}${result.failed} failed${RESET}`);
  if (result.skipped > 0) parts.push(`${YELLOW}${result.skipped} skipped${RESET}`);

  lines.push(`${BOLD}Tests:${RESET}  ${parts.join(', ')}, ${result.total} total`);
  lines.push(`${BOLD}Time:${RESET}   ${(result.duration / 1000).toFixed(3)}s`);
  lines.push('');

  return lines.join('\n');
}
