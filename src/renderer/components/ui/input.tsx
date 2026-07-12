import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...p }, r) => <input ref={r} className={cn('ui-input', className)} {...p} />,
);
Input.displayName = 'Input';
