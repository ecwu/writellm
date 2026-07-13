import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

export function Card({
  className,
  size = 'default',
  ...props
}: ComponentProps<'div'> & { size?: 'default' | 'sm' }) {
  return (
    <div
      data-slot="card"
      data-size={size}
      data-ui-surface
      className={cn(
        'group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-none bg-card py-(--card-spacing) text-xs/relaxed text-card-foreground ring-1 ring-foreground/10 [--card-spacing:--spacing(4)] has-data-[slot=card-footer]:pb-0 data-[size=sm]:[--card-spacing:--spacing(3)]',
        className,
      )}
      {...props}
    />
  );
}
export const CardHeader = ({ className, ...props }: ComponentProps<'div'>) => (
  <div
    data-slot="card-header"
    className={cn('grid auto-rows-min items-start gap-1 px-(--card-spacing)', className)}
    {...props}
  />
);
export const CardTitle = ({ className, ...props }: ComponentProps<'div'>) => (
  <div
    data-slot="card-title"
    className={cn('cn-font-heading text-sm font-medium', className)}
    {...props}
  />
);
export const CardDescription = ({ className, ...props }: ComponentProps<'div'>) => (
  <div
    data-slot="card-description"
    className={cn('text-xs/relaxed text-muted-foreground', className)}
    {...props}
  />
);
export const CardAction = ({ className, ...props }: ComponentProps<'div'>) => (
  <div
    data-slot="card-action"
    className={cn('col-start-2 row-span-2 row-start-1 self-start justify-self-end', className)}
    {...props}
  />
);
export const CardContent = ({ className, ...props }: ComponentProps<'div'>) => (
  <div data-slot="card-content" className={cn('px-(--card-spacing)', className)} {...props} />
);
export const CardFooter = ({ className, ...props }: ComponentProps<'div'>) => (
  <div
    data-slot="card-footer"
    className={cn('flex items-center rounded-none border-t p-(--card-spacing)', className)}
    {...props}
  />
);
