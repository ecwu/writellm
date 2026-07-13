import type { ReactNode, RefObject } from 'react';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { cn } from '@/lib/cn';

type Props = {
  rail: ReactNode;
  context?: ReactNode;
  detail?: ReactNode;
  content?: ReactNode;
  status?: ReactNode;
  settings?: ReactNode;
  settingsOpen: boolean;
  sidebarExpanded: boolean;
  compactPane: 'list' | 'detail';
  workspaceRef?: RefObject<HTMLDivElement | null>;
  onToggleSidebar(): void;
};

export function WorkspaceNavigationFrame({
  rail,
  context,
  detail,
  content,
  status,
  settings,
  settingsOpen,
  sidebarExpanded,
  compactPane,
  workspaceRef,
  onToggleSidebar,
}: Props) {
  return (
    <SidebarProvider
      open={sidebarExpanded}
      onOpenChange={(open) => {
        if (open !== sidebarExpanded) onToggleSidebar();
      }}
      className="workspace-navigation-shell h-svh min-h-0 overflow-hidden"
    >
      <div className="relative grid h-full min-h-0 w-full grid-rows-[minmax(0,1fr)_auto]">
        <div
          ref={workspaceRef}
          className={cn(
            'workspace-navigation-project group/workspace relative grid min-h-0 min-w-0 overflow-hidden transition-[grid-template-columns] duration-200 ease-linear',
            sidebarExpanded
              ? 'grid-cols-[4rem_minmax(0,17.875rem)_minmax(0,1fr)]'
              : 'grid-cols-[4rem_0_minmax(0,1fr)]',
            'max-[719px]:grid-cols-1 max-[719px]:grid-rows-[auto_minmax(0,1fr)]',
          )}
          data-sidebar-expanded={sidebarExpanded}
          data-compact-pane={compactPane}
          inert={settingsOpen ? true : undefined}
          aria-hidden={settingsOpen || undefined}
        >
          {rail}
          {content ? (
            content
          ) : (
            <>
              <aside
                className={cn(
                  'workspace-context-sidebar col-start-2 min-h-0 min-w-0 overflow-hidden border-r border-sidebar-border bg-sidebar',
                  'max-[719px]:col-start-1 max-[719px]:row-start-2',
                  compactPane === 'detail' &&
                    'max-[719px]:invisible max-[719px]:pointer-events-none',
                )}
                aria-label="Current category items"
              >
                {context}
              </aside>
              <SidebarInset
                className={cn(
                  'workspace-main-inset col-start-3 overflow-hidden',
                  'max-[719px]:col-start-1 max-[719px]:row-start-2',
                  compactPane === 'list' && 'max-[719px]:invisible max-[719px]:pointer-events-none',
                )}
              >
                {detail}
              </SidebarInset>
            </>
          )}
        </div>
        {settingsOpen && settings}
        {status}
      </div>
    </SidebarProvider>
  );
}
