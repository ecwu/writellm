import { useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, Save, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import type { KnowledgeItemRecord } from '../../../shared/types';

export function KnowledgePage({
  items,
  onCreate,
  onUpdate,
  onDelete,
  onReindex
}: {
  items: KnowledgeItemRecord[];
  onCreate: (title: string, content: string) => void;
  onUpdate: (itemId: string, title: string, content: string) => void;
  onDelete: (itemId: string) => void;
  onReindex: (itemId: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = items.find((item) => item.id === selectedId) ?? items[0] ?? null;
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const isCreating = !selected;

  useEffect(() => {
    if (!selected && selectedId) {
      setSelectedId(null);
    }
  }, [selected, selectedId]);

  useEffect(() => {
    setTitle(selected?.title ?? '');
    setContent(selected?.content ?? '');
  }, [selected?.id]);

  const indexedCount = useMemo(
    () => items.filter((item) => item.indexStatus === 'indexed').length,
    [items]
  );

  function save() {
    if (selected) {
      onUpdate(selected.id, title, content);
      return;
    }
    onCreate(title || 'Knowledge source', content);
  }

  function startNew() {
    setSelectedId(null);
    setTitle('');
    setContent('');
  }

  return (
    <main className="knowledge-page">
      <aside className="knowledge-page-sidebar">
        <div className="knowledge-page-header">
          <div>
            <h1>Knowledge</h1>
            <p>{indexedCount} indexed / {items.length} total</p>
          </div>
          <Button size="sm" onClick={startNew}>
            <Plus />
            New
          </Button>
        </div>
        {items.length > 0 ? (
          <div className="knowledge-source-list">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={selected?.id === item.id ? 'active' : undefined}
                onClick={() => setSelectedId(item.id)}
              >
                <span className="knowledge-source-title">{item.title}</span>
                <span className={`knowledge-source-status ${item.indexStatus}`}>{item.indexStatus}</span>
                <span className="knowledge-source-preview">{previewText(item.content)}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="knowledge-empty">
            <h2>No sources</h2>
            <p>Add text sources to make them available during generation.</p>
            <Button size="sm" onClick={startNew}>
              <Plus />
              Add source
            </Button>
          </div>
        )}
      </aside>

      <section className="knowledge-editor">
        <div className="knowledge-editor-header">
          <div>
            <p>{isCreating ? 'New source' : selected.indexStatus}</p>
            <h2>{isCreating ? 'Add knowledge source' : selected.title}</h2>
          </div>
          <div className="button-row">
            <Button size="sm" onClick={save} disabled={!content.trim()}>
              <Save />
              Save
            </Button>
            {selected ? (
              <>
                <Button variant="outline" size="sm" onClick={() => onReindex(selected.id)}>
                  <RefreshCw />
                  Reindex
                </Button>
                <Button variant="destructive" size="sm" onClick={() => onDelete(selected.id)}>
                  <Trash2 />
                  Delete
                </Button>
              </>
            ) : null}
          </div>
        </div>

        <div className="knowledge-editor-fields">
          <label className="field-label">
            Title
            <Input value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="field-label knowledge-text-field">
            Source text
            <Textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="Paste source text for retrieval"
            />
          </label>
        </div>
      </section>
    </main>
  );
}

function previewText(content: string): string {
  const trimmed = content.trim().replace(/\s+/g, ' ');
  if (!trimmed) {
    return 'Empty source';
  }
  return trimmed.length > 120 ? `${trimmed.slice(0, 120)}...` : trimmed;
}
