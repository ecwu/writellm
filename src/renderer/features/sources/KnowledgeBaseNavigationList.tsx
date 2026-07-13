import { FolderPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ContextNavigationList } from '../../workspace/components/ContextNavigationList';
import type { SourceNavigationItem } from './source-state';

const labels = {
  queued: 'Waiting to process',
  parsing: 'Parsing',
  indexing: 'Indexing',
  partial: 'Partially available',
  available: 'Available',
  failed: 'Processing failed',
} as const;
function progressFor(item: SourceNavigationItem) {
  if (item.state !== 'parsing' && item.state !== 'indexing') return undefined;
  const total = Math.max(1, item.progress.total);
  const completed = Math.min(total, Math.max(0, item.progress.completed));
  if (item.state === 'parsing') {
    const remaining = Math.max(0, total - completed);
    return {
      value: completed,
      max: total,
      label: `Parsing progress for ${item.displayName}`,
      text: `${completed} processed, ${remaining} remaining`,
    };
  }
  const searchable = Math.max(0, item.eligibility.indexed);
  const failed = Math.max(0, item.eligibility.failed);
  const remaining = Math.max(0, item.eligibility.eligible - searchable - failed);
  return {
    value: completed,
    max: total,
    label: `Indexing progress for ${item.displayName}`,
    text: `${searchable} searchable, ${failed} failed, ${remaining} remaining`,
  };
}

export function KnowledgeBaseNavigationList({
  items,
  selectedId,
  importing,
  onSelect,
  onImport,
}: {
  items: readonly SourceNavigationItem[];
  selectedId: string | null;
  importing: boolean;
  onSelect(id: string): void;
  onImport(): void;
}) {
  return (
    <ContextNavigationList
      label="Knowledge Base"
      description="Imported PDFs and processing status"
      items={items.map((item) => ({
        id: item.id,
        title: item.displayName,
        description:
          item.state === 'available'
            ? `${item.eligibility.indexed} searchable blocks`
            : `${item.progress.completed} of ${item.progress.total} in ${item.progress.stage}`,
        status: item.retrying ? 'Retrying' : labels[item.state],
        meta:
          item.state === 'available'
            ? 'Searchable'
            : item.state === 'partial'
              ? 'Limited search'
              : item.retryable
                ? 'Retry available'
                : 'Not searchable yet',
        progress: progressFor(item),
      }))}
      selectedId={selectedId}
      onSelect={onSelect}
      action={
        <Button
          type="button"
          size="icon"
          variant="secondary"
          aria-label="Import PDFs"
          busy={importing}
          onClick={onImport}
        >
          <FolderPlus aria-hidden="true" focusable="false" />
        </Button>
      }
      empty={
        <div className="context-navigation-empty">
          <p>No sources yet.</p>
          <Button type="button" busy={importing} onClick={onImport}>
            <FolderPlus aria-hidden="true" focusable="false" />
            Import PDFs
          </Button>
        </div>
      }
    />
  );
}
