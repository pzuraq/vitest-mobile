/**
 * Doctor command — run environment diagnostics and print a report.
 */

import { checkAllEnvironments } from '../node/environment';
import type { NamedCheck } from '../node/types';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

function formatCheck(check: NamedCheck): string {
  const icon = check.ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
  const detail = check.detail ? ` ${DIM}(${check.detail})${RESET}` : '';
  let line = `    ${icon} ${check.message}${detail}`;
  if (!check.ok && check.fix) {
    line += `\n      ${YELLOW}Fix: ${check.fix}${RESET}`;
  }
  return line;
}

export function runDoctor(): number {
  const { android, ios, general } = checkAllEnvironments();

  console.log(`\n  ${BOLD}vitest-react-native-runtime doctor${RESET}\n`);

  console.log(`  ${BOLD}Android${RESET}`);
  for (const check of android) {
    console.log(formatCheck(check));
  }

  console.log(`\n  ${BOLD}iOS${RESET}`);
  for (const check of ios) {
    console.log(formatCheck(check));
  }

  console.log(`\n  ${BOLD}General${RESET}`);
  for (const check of general) {
    console.log(formatCheck(check));
  }

  const allChecks = [...android, ...ios, ...general];
  const failures = allChecks.filter(c => !c.ok && !c.autoFixable);

  console.log('');
  if (failures.length === 0) {
    console.log(`  ${GREEN}${BOLD}All checks passed!${RESET}\n`);
  } else {
    console.log(
      `  ${RED}${failures.length} issue${failures.length > 1 ? 's' : ''} found.${RESET} See fix instructions above.\n`,
    );
  }

  return failures.length === 0 ? 0 : 1;
}
