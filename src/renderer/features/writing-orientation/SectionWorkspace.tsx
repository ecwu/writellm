import type { ReactNode } from 'react';
import { EmptyState } from '@/components/patterns/EmptyState';
import { Button } from '@/components/ui/button';
import { WorkspaceDetail } from '../../workspace/components/WorkspaceDetail';
import { WorkspaceLocationHeader } from '../../workspace/components/WorkspaceLocationHeader';
import type { SectionNavigationItem } from './orientation-state';
import { SectionNavigationList } from './SectionNavigationList';

export function SectionWorkspace({
  projectName,
  items,
  selectedId,
  onSelect,
  onAdd,
  onBack,
  children,
}: {
  projectName: string;
  items: readonly SectionNavigationItem[];
  selectedId: string | null;
  onSelect(id: string): void;
  onAdd(): void;
  onBack?(): void;
  children?: ReactNode;
}) {
  const selected = items.find((item) => item.id === selectedId) ?? null;
  return (
    <div
      className="workspace-owner-pane grid h-full min-h-0 min-w-0 grid-cols-[minmax(0,17.875rem)_minmax(0,1fr)] group-data-[sidebar-expanded=false]/workspace:grid-cols-[0_minmax(0,1fr)] max-[719px]:grid-cols-1"
      data-owner="sections"
    >
      <aside
        className="workspace-owner-context min-h-0 min-w-0 overflow-hidden border-r border-sidebar-border bg-sidebar max-[719px]:col-start-1 max-[719px]:row-start-1 max-[719px]:group-data-[compact-pane=detail]/workspace:invisible max-[719px]:group-data-[compact-pane=detail]/workspace:pointer-events-none"
        aria-label="Sections navigation"
      >
        <SectionNavigationList
          items={items}
          selectedId={selected?.id ?? null}
          onSelect={onSelect}
          onAdd={onAdd}
        />
      </aside>
      <div className="flex min-h-0 min-w-0 overflow-hidden bg-background max-[719px]:col-start-1 max-[719px]:row-start-1 max-[719px]:group-data-[compact-pane=list]/workspace:invisible max-[719px]:group-data-[compact-pane=list]/workspace:pointer-events-none">
        <WorkspaceDetail label="Section detail">
          <WorkspaceLocationHeader
            project={projectName}
            category="Sections"
            item={selected?.title}
            showBack
            onBack={onBack}
          />
          {selected ? (
            children
          ) : (
            <EmptyState
              title="Choose a section"
              description={
                items.length
                  ? 'Select a section to view its plan or chapter.'
                  : 'Create your first section to start shaping this article.'
              }
              action={
                items.length ? undefined : (
                  <Button type="button" onClick={onAdd}>
                    Create first section
                  </Button>
                )
              }
            />
          )}
        </WorkspaceDetail>
      </div>
    </div>
  );
}
