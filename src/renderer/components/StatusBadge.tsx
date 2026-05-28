import type { ReactNode } from 'react';
import { Badge } from './ui/badge';
import { cn } from '../lib/utils';

type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'active';

const statusToneByValue: Record<string, StatusTone> = {
  indexed: 'success',
  done: 'success',
  applied: 'success',
  patch_accepted: 'success',
  saved_as_candidate: 'success',
  low: 'success',
  saved: 'success',
  root: 'active',
  saving: 'warning',
  queued: 'warning',
  uploading: 'warning',
  extracting: 'warning',
  downloading: 'warning',
  indexing: 'warning',
  running: 'warning',
  patch_created: 'warning',
  medium: 'warning',
  high: 'warning',
  error: 'danger',
  failed: 'danger',
  blocked: 'danger',
  patch_rejected: 'danger',
  rejected: 'danger'
};

const toneClassName: Record<StatusTone, string> = {
  neutral: '',
  success: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  warning: 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  danger: 'border-destructive/20 bg-destructive/10 text-destructive',
  active: 'border-primary/20 bg-primary/10 text-primary'
};

export function StatusBadge({
  status,
  children,
  className
}: {
  status: string;
  children?: ReactNode;
  className?: string;
}) {
  const tone = statusToneByValue[status.toLowerCase()] ?? 'neutral';
  return (
    <Badge variant={tone === 'neutral' ? 'outline' : 'secondary'} className={cn(toneClassName[tone], className)}>
      {children ?? status}
    </Badge>
  );
}
