import { forwardRef, type SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...p }, r) => <select ref={r} className={cn('ui-select', className)} {...p} />,
);
Select.displayName = 'Select';
