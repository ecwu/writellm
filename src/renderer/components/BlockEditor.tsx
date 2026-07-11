import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import { markdownFromBlocks } from '../../shared/documentBlocks';
import type { DocumentBlockKind, DocumentBlockRecord, UpdateDocumentBlockPayload } from '../../shared/types';
import { Button } from './ui/button';

export type BlockEditorHandle = {
  getSelection: () => { startOffset: number; endOffset: number };
  getValue: () => string;
  flushPendingChanges: () => Promise<void>;
};

const blockKinds: Array<{ value: DocumentBlockKind; label: string }> = [
  { value: 'paragraph', label: 'Text' },
  { value: 'heading', label: 'Heading' },
  { value: 'quote', label: 'Quote' },
  { value: 'code', label: 'Code' },
  { value: 'list_item', label: 'List item' },
  { value: 'divider', label: 'Divider' },
  { value: 'image', label: 'Image' }
];

export const BlockEditor = forwardRef<BlockEditorHandle, {
  blocks: DocumentBlockRecord[];
  readOnly?: boolean;
  onCreateBlock: (afterBlockId: string | null) => Promise<void>;
  onUpdateBlock: (blockId: string, payload: UpdateDocumentBlockPayload) => Promise<void>;
  onDeleteBlock: (blockId: string) => Promise<void>;
  onSelectionChange?: (selection: { startOffset: number; endOffset: number }) => void;
}>(function BlockEditor({
  blocks,
  readOnly = false,
  onCreateBlock,
  onUpdateBlock,
  onDeleteBlock,
  onSelectionChange
}, ref) {
  const orderedBlocks = useMemo(
    () => [...blocks].sort((left, right) => left.sortOrder - right.sortOrder || left.createdAt.localeCompare(right.createdAt)),
    [blocks]
  );
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const draftsRef = useRef<Record<string, string>>({});
  const timersRef = useRef(new Map<string, number>());
  const pendingRef = useRef(new Map<string, Promise<void>>());
  const selectionRef = useRef({ startOffset: 0, endOffset: 0 });
  const onSelectionChangeRef = useRef(onSelectionChange);
  const blocksRef = useRef(orderedBlocks);

  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange;
  }, [onSelectionChange]);

  useEffect(() => {
    blocksRef.current = orderedBlocks;
    setDrafts((current) => {
      const next: Record<string, string> = {};
      orderedBlocks.forEach((block) => {
        next[block.id] = Object.hasOwn(current, block.id) ? current[block.id] : block.content;
      });
      draftsRef.current = next;
      return next;
    });
  }, [orderedBlocks]);

  useEffect(() => () => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current.clear();
  }, []);

  useImperativeHandle(ref, () => ({
    getSelection() {
      return selectionRef.current;
    },
    getValue() {
      return markdownFromBlocks(withDrafts(blocksRef.current, draftsRef.current));
    },
    async flushPendingChanges() {
      const blockIds = [...timersRef.current.keys()];
      blockIds.forEach((blockId) => {
        const timer = timersRef.current.get(blockId);
        if (timer) {
          window.clearTimeout(timer);
        }
        timersRef.current.delete(blockId);
        void persistBlock(blockId);
      });
      await Promise.all([...pendingRef.current.values()]);
    }
  }), []);

  function setDraft(blockId: string, content: string) {
    const next = { ...draftsRef.current, [blockId]: content };
    draftsRef.current = next;
    setDrafts(next);
    const timer = timersRef.current.get(blockId);
    if (timer) {
      window.clearTimeout(timer);
    }
    timersRef.current.set(blockId, window.setTimeout(() => {
      timersRef.current.delete(blockId);
      void persistBlock(blockId);
    }, 500));
  }

  function persistBlock(blockId: string): Promise<void> {
    const block = blocksRef.current.find((item) => item.id === blockId);
    if (!block) {
      return Promise.resolve();
    }
    const content = draftsRef.current[blockId] ?? block.content;
    if (content === block.content) {
      return Promise.resolve();
    }
    const pending = onUpdateBlock(blockId, { content })
      .then(() => undefined)
      .finally(() => pendingRef.current.delete(blockId));
    pendingRef.current.set(blockId, pending);
    return pending;
  }

  function handleSelection(blockId: string, start: number, end: number) {
    const rendered = withDrafts(blocksRef.current, draftsRef.current);
    const index = rendered.findIndex((block) => block.id === blockId);
    const prefix = index > 0 ? markdownFromBlocks(rendered.slice(0, index)).length : 0;
    const block = rendered[index];
    const leading = typeof block?.attributes.leadingNewlines === 'string' ? block.attributes.leadingNewlines.length : 0;
    selectionRef.current = {
      startOffset: prefix + leading + start,
      endOffset: prefix + leading + end
    };
    onSelectionChangeRef.current?.(selectionRef.current);
  }

  return (
    <div className="block-editor" aria-label="Block editor">
      {orderedBlocks.map((block) => (
        <article key={block.id} className={`block-editor-row block-editor-row-${block.kind}`}>
          <GripVertical className="block-editor-grip" aria-hidden="true" />
          <select
            className="block-editor-kind"
            aria-label="Block type"
            value={block.kind}
            disabled={readOnly}
            onChange={(event) => void onUpdateBlock(block.id, { kind: event.target.value as DocumentBlockKind })}
          >
            {blockKinds.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}
          </select>
          <textarea
            className="block-editor-text"
            value={drafts[block.id] ?? block.content}
            readOnly={readOnly}
            rows={Math.max(2, Math.min(12, (drafts[block.id] ?? block.content).split('\n').length + 1))}
            placeholder="Start writing…"
            onChange={(event) => setDraft(block.id, event.target.value)}
            onSelect={(event) => handleSelection(block.id, event.currentTarget.selectionStart, event.currentTarget.selectionEnd)}
            onKeyUp={(event) => handleSelection(block.id, event.currentTarget.selectionStart, event.currentTarget.selectionEnd)}
          />
          {!readOnly ? (
            <div className="block-editor-actions">
              <button type="button" aria-label="Add block below" onClick={() => void onCreateBlock(block.id)}><Plus /></button>
              <button type="button" aria-label="Delete block" onClick={() => void onDeleteBlock(block.id)}><Trash2 /></button>
            </div>
          ) : null}
        </article>
      ))}
      {!readOnly ? (
        <Button variant="ghost" size="sm" className="block-editor-add" onClick={() => void onCreateBlock(orderedBlocks.at(-1)?.id ?? null)}>
          <Plus />
          Add block
        </Button>
      ) : null}
    </div>
  );
});

function withDrafts(blocks: DocumentBlockRecord[], drafts: Record<string, string>): DocumentBlockRecord[] {
  return blocks.map((block) => ({ ...block, content: drafts[block.id] ?? block.content }));
}
