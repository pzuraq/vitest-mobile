import type { ModuleStatus } from './types';

export function statusIcon(status: ModuleStatus): string {
  switch (status) {
    case 'pass':
      return '✓';
    case 'fail':
      return '✗';
    case 'running':
      return '⋯';
    case 'pending':
      return '○';
    default:
      return '·';
  }
}

export function statusColor(status: ModuleStatus): string {
  switch (status) {
    case 'pass':
      return '#4ade80';
    case 'fail':
      return '#f87171';
    case 'running':
      return '#fbbf24';
    default:
      return '#64748b';
  }
}
