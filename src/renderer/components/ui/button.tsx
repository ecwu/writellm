import { cva, type VariantProps } from 'class-variance-authority';
import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/cn';

const variants = cva('ui-button', {
  variants: {
    variant: {
      default: 'ui-button-primary',
      secondary: 'ui-button-secondary',
      ghost: 'ui-button-ghost',
      destructive: 'ui-button-destructive',
    },
    size: { default: '', sm: 'ui-button-sm', icon: 'ui-button-icon' },
  },
  defaultVariants: { variant: 'default', size: 'default' },
});
export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof variants> {}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(variants({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = 'Button';
