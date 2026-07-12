import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
export function Alert({ className, ...p }: HTMLAttributes<HTMLDivElement>) {
  return <div data-ui-surface className={cn('ui-alert', className)} {...p} />;
}
