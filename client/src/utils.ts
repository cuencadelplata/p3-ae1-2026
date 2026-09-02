import type { AccountStatusEnum } from './types';

export function statusBadge(status: AccountStatusEnum): string {
  if (status === 'ACTIVO') return 'badge-activo';
  if (status === 'EN_REVISIÓN') return 'badge-revision';
  return 'badge-bloqueado';
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
