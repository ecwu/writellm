import type { LabelHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
export function Label({ className, ...p }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('ui-label', className)} {...p} />;
}
