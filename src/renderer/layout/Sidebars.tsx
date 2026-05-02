
import type { ReactNode } from 'react';
import { FolderPlus, Save } from 'lucide-react';
import { Outline } from '../components/Outline';
import { Button } from '../components/ui/button';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator
} from '../components/ui/sidebar';
import type { FocusedWorkspaceState } from '../../shared/types';

export function SidebarLeft({
  nodes,
  activeId,
  onSelectSection,
  onMoveSection,
  onAddChild
}: {
  nodes: FocusedWorkspaceState['compositionTree'];
  activeId: string | null;
  onSelectSection: (id: string) => void;
  onMoveSection: (id: string, parentId: string | null, index: number) => void;
  onAddChild: () => void;
}) {
  return (
    <Sidebar className="top-(--header-height) h-[calc(100svh-var(--header-height))]" collapsible="offcanvas">
      <SidebarHeader>
        <div className="px-2 py-1 text-xs font-medium text-sidebar-foreground/70">Navigation</div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarSeparator />
        <SidebarGroup className="min-h-0 flex-1">
          <div className="flex items-center justify-between px-2">
            <SidebarGroupLabel className="px-0">Composition</SidebarGroupLabel>
            <Button variant="ghost" size="icon-xs" onClick={onAddChild} disabled={!activeId} title="Add child section">
              <FolderPlus />
              <span className="sr-only">Add child section</span>
            </Button>
          </div>
          <SidebarGroupContent>
            <Outline nodes={nodes} activeId={activeId} onSelect={onSelectSection} onMove={onMoveSection} />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}


export function SidebarRight({ children }: { children: ReactNode }) {
  return (
    <Sidebar side="right" className="top-(--header-height) h-[calc(100svh-var(--header-height))]" collapsible="offcanvas">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="cursor-default">
              <div className="flex size-8 items-center justify-center rounded-lg bg-sidebar-accent text-sidebar-accent-foreground">
                <Save className="size-4" />
              </div>
              <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">Inspector</span>
                <span className="truncate text-xs text-sidebar-foreground/70">Edit selected content</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="min-h-0 flex-1">
          <SidebarGroupContent>{children}</SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
