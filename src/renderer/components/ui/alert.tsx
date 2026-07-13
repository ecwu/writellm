import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

const alertVariants = cva(
  'group/alert relative grid w-full gap-0.5 rounded-none border px-2.5 py-2 text-left text-xs has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2 *:[svg]:row-span-2 *:[svg]:size-4',
  {
    variants: {
      variant: {
        default: 'bg-card text-card-foreground',
        destructive: 'bg-card text-destructive *:data-[slot=alert-description]:text-destructive/90',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);
export function Alert({
  className,
  variant,
  ...props
}: ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      data-ui-surface
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}
export const AlertTitle = ({ className, ...props }: ComponentProps<'div'>) => (
  <div
    data-slot="alert-title"
    className={cn('font-medium group-has-[>svg]/alert:col-start-2', className)}
    {...props}
  />
);
export const AlertDescription = ({ className, ...props }: ComponentProps<'div'>) => (
  <div
    data-slot="alert-description"
    className={cn('text-xs/relaxed text-muted-foreground', className)}
    {...props}
  />
);
export const AlertAction = ({ className, ...props }: ComponentProps<'div'>) => (
  <div
    data-slot="alert-action"
    className={cn('absolute top-1.25 right-1.25', className)}
    {...props}
  />
);
