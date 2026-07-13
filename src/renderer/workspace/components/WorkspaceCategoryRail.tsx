import type { RefCallback } from 'react';
import { LibraryBig, ListTree, Settings } from 'lucide-react';
import type { ProjectSnapshot } from '../../../shared/project';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import type { WorkspaceCategoryId } from '../workspaceNavigationSession';

type Props = {
  project: ProjectSnapshot;
  activeCategory: WorkspaceCategoryId;
  settingsOpen: boolean;
  registerTrigger: (key: string) => RefCallback<HTMLButtonElement>;
  onCategory(category: WorkspaceCategoryId): void;
  onSettings(): void;
  onLeave(): void;
};
const categories = [
  { id: 'sections' as const, label: 'Sections', icon: ListTree },
  { id: 'knowledge-base' as const, label: 'Knowledge Base', icon: LibraryBig },
];

export function WorkspaceCategoryRail({
  project,
  activeCategory,
  settingsOpen,
  registerTrigger,
  onCategory,
  onSettings,
  onLeave,
}: Props) {
  return (
    <Sidebar
      className="workspace-category-rail col-start-1 row-start-1 w-16 border-r border-sidebar-border max-[719px]:col-start-1 max-[719px]:row-start-1 max-[719px]:h-auto max-[719px]:w-full max-[719px]:flex-row max-[719px]:border-r-0 max-[719px]:border-b"
      role="navigation"
      aria-label="Workspace categories"
    >
      <SidebarHeader className="max-[719px]:hidden">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              type="button"
              data-dialog-focus-fallback
              className="workspace-project-control justify-center px-0 text-sm font-medium"
              aria-label={`Leave ${project.displayName}`}
              title={project.displayName}
              onClick={onLeave}
            >
              <span aria-hidden="true">W</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent className="max-[719px]:overflow-x-auto">
        <SidebarGroup className="max-[719px]:p-1">
          <SidebarGroupContent>
            <SidebarMenu className="max-[719px]:flex-row">
              {categories.map(({ id, label, icon: Icon }) => (
                <SidebarMenuItem key={id}>
                  <SidebarMenuButton
                    ref={registerTrigger(`category-${id}`)}
                    type="button"
                    className="workspace-category-action justify-center px-0 max-[719px]:w-auto max-[719px]:justify-start max-[719px]:px-3"
                    aria-label={label}
                    aria-pressed={!settingsOpen && activeCategory === id}
                    title={label}
                    isActive={!settingsOpen && activeCategory === id}
                    onClick={() => onCategory(id)}
                  >
                    <Icon aria-hidden="true" focusable="false" />
                    <span className="hidden max-[719px]:inline">{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="mt-auto max-[719px]:mt-0 max-[719px]:ml-auto max-[719px]:border-l">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              ref={registerTrigger('settings')}
              type="button"
              className="workspace-category-action justify-center px-0 max-[719px]:w-auto max-[719px]:justify-start max-[719px]:px-3"
              aria-label="Settings"
              aria-pressed={settingsOpen}
              title="Settings"
              isActive={settingsOpen}
              onClick={onSettings}
            >
              <Settings aria-hidden="true" focusable="false" />
              <span className="hidden max-[719px]:inline">Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
