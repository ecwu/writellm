import type { ComponentProps } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

export const Breadcrumb = (props: ComponentProps<'nav'>) => (
  <nav aria-label="breadcrumb" data-slot="breadcrumb" {...props} />
);
export const BreadcrumbList = ({ className, ...props }: ComponentProps<'ol'>) => (
  <ol
    data-slot="breadcrumb-list"
    className={cn('flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground', className)}
    {...props}
  />
);
export const BreadcrumbItem = ({ className, ...props }: ComponentProps<'li'>) => (
  <li
    data-slot="breadcrumb-item"
    className={cn('inline-flex items-center gap-1.5', className)}
    {...props}
  />
);
export const BreadcrumbPage = ({ className, ...props }: ComponentProps<'span'>) => (
  <span
    data-slot="breadcrumb-page"
    aria-current="page"
    className={cn('font-medium text-foreground', className)}
    {...props}
  />
);
export const BreadcrumbSeparator = ({ className, children, ...props }: ComponentProps<'li'>) => (
  <li
    data-slot="breadcrumb-separator"
    role="presentation"
    aria-hidden="true"
    className={cn('[&>svg]:size-3.5', className)}
    {...props}
  >
    {children ?? <ChevronRight />}
  </li>
);
