import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ContextNavigationList } from '../../workspace/components/ContextNavigationList';
import type { SectionNavigationItem } from './orientation-state';

const statusLabel = {
  'not-started': 'Not started',
  'in-progress': 'In progress',
  completed: 'Completed',
} as const;
export function SectionNavigationList({
  items,
  selectedId,
  onSelect,
  onAdd,
}: {
  items: readonly SectionNavigationItem[];
  selectedId: string | null;
  onSelect(id: string): void;
  onAdd(): void;
}) {
  return (
    <ContextNavigationList
      label="Sections"
      description="Article structure and writing status"
      items={items.map((item) => ({
        id: item.id,
        title: item.title || 'Untitled section',
        description: item.summary || 'No summary yet',
        status: statusLabel[item.status],
        meta: item.chapter.kind === 'linked' ? 'Chapter linked' : 'Chapter not created',
      }))}
      selectedId={selectedId}
      onSelect={onSelect}
      action={
        <Button type="button" size="icon" variant="ghost" aria-label="Add section" onClick={onAdd}>
          <Plus aria-hidden="true" focusable="false" />
        </Button>
      }
      empty={
        <div className="context-navigation-empty">
          <p>No sections yet.</p>
          <Button type="button" onClick={onAdd}>
            <Plus aria-hidden="true" focusable="false" />
            Create first section
          </Button>
        </div>
      }
    />
  );
}
