import type { Theme } from './theme';
import type { UiTaskStatus } from '../tasks';

export function statusIcon(status: UiTaskStatus): string {
  switch (status) {
    case 'pass':
      return '✓';
    case 'fail':
      return '✗';
    case 'running':
      return '⋯';
    case 'pending':
      return '○';
    case 'skip':
      return '·';
    default:
      return '·';
  }
}

export function statusColor(status: UiTaskStatus, colors: Theme['colors']): string {
  switch (status) {
    case 'pass':
      return colors.pass;
    case 'fail':
      return colors.fail;
    case 'running':
      return colors.warning;
    default:
      return colors.textDim;
  }
}
