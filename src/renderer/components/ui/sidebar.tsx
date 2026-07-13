import {
  createContext,
  type CSSProperties,
  type ComponentProps,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { PanelLeftIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

type SidebarContextValue = {
  open: boolean;
  setOpen(open: boolean): void;
  toggleSidebar(): void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) throw new Error('useSidebar must be used within SidebarProvider.');
  return context;
}

export function SidebarProvider({
  defaultOpen = true,
  open: controlledOpen,
  onOpenChange,
  className,
  style,
  children,
  ...props
}: ComponentProps<'div'> & {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?(open: boolean): void;
}) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const open = controlledOpen ?? internalOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      onOpenChange?.(next);
      if (controlledOpen === undefined) setInternalOpen(next);
    },
    [controlledOpen, onOpenChange],
  );
  const value = useMemo(
    () => ({ open, setOpen, toggleSidebar: () => setOpen(!open) }),
    [open, setOpen],
  );

  return (
    <SidebarContext.Provider value={value}>
      <div
        data-slot="sidebar-wrapper"
        data-state={open ? 'expanded' : 'collapsed'}
        style={
          {
            '--sidebar-width': '21.875rem',
            '--sidebar-width-icon': '4rem',
            ...style,
          } as CSSProperties
        }
        className={cn('group/sidebar-wrapper flex min-h-svh w-full bg-sidebar text-xs', className)}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

export function Sidebar({ className, ...props }: ComponentProps<'nav'>) {
  return (
    <nav
      data-slot="sidebar"
      className={cn('flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground', className)}
      {...props}
    />
  );
}

export function SidebarInset({ className, ...props }: ComponentProps<'main'>) {
  return (
    <main
      data-slot="sidebar-inset"
      className={cn('relative flex min-h-0 min-w-0 flex-1 flex-col bg-background', className)}
      {...props}
    />
  );
}

export function SidebarTrigger({ className, onClick, ...props }: ComponentProps<typeof Button>) {
  const context = useContext(SidebarContext);
  const label = context?.open === false ? 'Expand sidebar' : 'Collapse sidebar';
  return (
    <Button
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon"
      className={cn('shrink-0', className)}
      onClick={(event) => {
        onClick?.(event);
        context?.toggleSidebar();
      }}
      {...props}
    >
      <PanelLeftIcon aria-hidden="true" focusable="false" />
      <span className="sr-only">{label}</span>
    </Button>
  );
}

export const SidebarHeader = ({ className, ...props }: ComponentProps<'div'>) => (
  <div data-slot="sidebar-header" className={cn('flex flex-col gap-0 p-2', className)} {...props} />
);
export const SidebarContent = ({ className, ...props }: ComponentProps<'div'>) => (
  <div
    data-slot="sidebar-content"
    className={cn('flex min-h-0 flex-1 flex-col gap-0 overflow-auto', className)}
    {...props}
  />
);
export const SidebarFooter = ({ className, ...props }: ComponentProps<'div'>) => (
  <div data-slot="sidebar-footer" className={cn('flex flex-col gap-0 p-2', className)} {...props} />
);
export const SidebarGroup = ({ className, ...props }: ComponentProps<'div'>) => (
  <div
    data-slot="sidebar-group"
    className={cn('relative flex w-full min-w-0 flex-col p-2', className)}
    {...props}
  />
);
export const SidebarGroupContent = ({ className, ...props }: ComponentProps<'div'>) => (
  <div data-slot="sidebar-group-content" className={cn('w-full text-xs', className)} {...props} />
);
export const SidebarMenu = ({ className, ...props }: ComponentProps<'ul'>) => (
  <ul
    data-slot="sidebar-menu"
    className={cn('flex w-full min-w-0 flex-col gap-0', className)}
    {...props}
  />
);
export const SidebarMenuItem = ({ className, ...props }: ComponentProps<'li'>) => (
  <li data-slot="sidebar-menu-item" className={cn('relative', className)} {...props} />
);

export function SidebarMenuButton({
  isActive = false,
  className,
  children,
  ...props
}: ComponentProps<'button'> & { isActive?: boolean; children: ReactNode }) {
  return (
    <button
      data-slot="sidebar-menu-button"
      data-active={isActive}
      className={cn(
        'flex min-h-11 w-full min-w-11 items-center gap-2 overflow-hidden rounded-none p-2 text-left text-xs font-medium outline-none transition-colors',
        'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-1 focus-visible:ring-sidebar-ring',
        'disabled:pointer-events-none disabled:opacity-50 data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground',
        '[&>svg]:size-4 [&>svg]:shrink-0 [&>span:last-child]:truncate',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
