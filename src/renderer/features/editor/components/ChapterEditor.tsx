import { BlockNoteView } from '@blocknote/ariakit';
import { BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core';
import { useCreateBlockNote } from '@blocknote/react';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { ClipboardPaste, Download, Save } from 'lucide-react';
import '@blocknote/ariakit/style.css';
import { Button } from '@/components/ui/button';
import type {
  BlockNoteBlockSnapshot,
  ChapterApi,
  ChapterDocument,
  MarkdownPastePreview,
  MarkdownPreview,
} from '../../../../shared/chapters';
import type { WorkspaceLeaveGuard } from '../../../workspace/WorkspaceShell';
import { previewMarkdownPaste } from '../adapter/markdown-paste';
import {
  chapterDraftReducer,
  chapterIsDirty,
  createChapterDraftState,
} from '../chapter-draft-state';
import { ChapterConflictDialog } from './ChapterConflictDialog';
import { MarkdownExportDialog } from './MarkdownExportDialog';
import { MarkdownPasteDialog } from './MarkdownPasteDialog';

const schema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    heading: defaultBlockSpecs.heading,
    bulletListItem: defaultBlockSpecs.bulletListItem,
    numberedListItem: defaultBlockSpecs.numberedListItem,
    checkListItem: defaultBlockSpecs.checkListItem,
    table: defaultBlockSpecs.table,
    codeBlock: defaultBlockSpecs.codeBlock,
    quote: defaultBlockSpecs.quote,
    image: defaultBlockSpecs.image,
  },
});
const snapshot = (value: unknown) => JSON.parse(JSON.stringify(value)) as BlockNoteBlockSnapshot[];
export function ChapterEditor({
  initialDocument,
  title,
  api,
  onLeaveGuardChange,
}: {
  initialDocument: ChapterDocument;
  title: string;
  api: ChapterApi;
  onLeaveGuardChange?(guard: WorkspaceLeaveGuard): void;
}) {
  const [document, setDocument] = useState(initialDocument),
    [draft, dispatch] = useReducer(
      chapterDraftReducer,
      initialDocument.revision,
      createChapterDraftState,
    ),
    [paste, setPaste] = useState<MarkdownPastePreview | null>(null),
    [exportPreview, setExportPreview] = useState<MarkdownPreview | null>(null),
    [feedback, setFeedback] = useState(''),
    [exportBusy, setExportBusy] = useState(false);
  const stateRef = useRef(draft);
  stateRef.current = draft;
  const mutation = useRef<string | undefined>(undefined);
  const editor = useCreateBlockNote({ schema, initialContent: initialDocument.blocks as never[] });
  const save = useCallback(async () => {
    const state = stateRef.current;
    if (state.saveStatus === 'saving' || !chapterIsDirty(state)) return { ok: true as const };
    dispatch({ type: 'save.start' });
    const generation = state.localGeneration;
    const mutationId = mutation.current ?? crypto.randomUUID();
    mutation.current = mutationId;
    const result = await api.save({
      chapterId: document.chapterId,
      baseRevision: state.baseRevision,
      mutationId,
      blocks: snapshot(editor.document),
      citations: document.citations,
    });
    if (result.ok) {
      mutation.current = undefined;
      setDocument(result.value.document);
      dispatch({ type: 'save.success', revision: result.value.document.revision, generation });
      return { ok: true as const };
    }
    if (result.error.code === 'REVISION_CONFLICT')
      dispatch({ type: 'conflict', error: result.error });
    else dispatch({ type: 'save.failure', error: result.error });
    return { ok: false as const, message: result.error.message };
  }, [api, document, editor]);
  useEffect(() => {
    if (!chapterIsDirty(draft) || draft.saveStatus === 'saving' || draft.saveStatus === 'conflict')
      return;
    const timer = setTimeout(() => void save(), 900);
    return () => clearTimeout(timer);
  }, [draft, save]);
  useEffect(() => {
    onLeaveGuardChange?.({
      ownerId: 'chapter',
      dirty: chapterIsDirty(draft),
      save,
      discard: () => {
        editor.replaceBlocks(editor.document, document.blocks as never[]);
        dispatch({ type: 'reload', revision: document.revision });
      },
    });
  }, [document, draft, editor, onLeaveGuardChange, save]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
      }
    };
    globalThis.document.addEventListener('keydown', key);
    return () => globalThis.document.removeEventListener('keydown', key);
  }, [save]);
  const status =
    draft.saveStatus === 'saved'
      ? 'Saved'
      : draft.saveStatus === 'dirty'
        ? 'Unsaved changes'
        : draft.saveStatus === 'saving'
          ? 'Saving…'
          : (draft.lastError?.message ?? draft.saveStatus);
  const pasteMarkdown = async () => {
    const value = window.prompt('Paste Markdown to preview');
    if (value === null) return;
    try {
      setPaste(
        await previewMarkdownPaste(value, (input) => editor.tryParseMarkdownToBlocks(input)),
      );
    } catch {
      setFeedback('Markdown could not be converted.');
    }
  };
  const previewExport = async () => {
    const result = await api.previewMarkdownExport({
      chapterId: document.chapterId,
      blocks: snapshot(editor.document),
      citations: document.citations,
    });
    if (result.ok) setExportPreview(result.value);
    else setFeedback(result.error.message);
  };
  const conflictOpen = draft.saveStatus === 'conflict';
  const reloadSaved = async () => {
    const result = await api.load({ chapterId: document.chapterId });
    if (result.ok) {
      setDocument(result.value);
      editor.replaceBlocks(editor.document, result.value.blocks as never[]);
      dispatch({ type: 'reload', revision: result.value.revision });
    }
  };
  const keepCurrent = async () => {
    const result = await api.load({ chapterId: document.chapterId });
    if (result.ok) dispatch({ type: 'acknowledge', revision: result.value.revision });
  };
  return (
    <article
      className="mx-auto grid max-w-6xl gap-4 [&_.bn-container]:min-h-96 [&_.bn-container]:border [&_.bn-container]:bg-card [&_.bn-container]:text-foreground [&_.bn-editor]:bg-transparent [&_.bn-editor]:text-inherit"
      aria-labelledby="chapter-title"
    >
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="m-0 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Chapter
          </p>
          <h2 id="chapter-title">{title}</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void pasteMarkdown()}>
            <ClipboardPaste aria-hidden="true" focusable="false" />
            Paste Markdown
          </Button>
          <Button variant="secondary" onClick={() => void previewExport()}>
            <Download aria-hidden="true" focusable="false" />
            Export Markdown
          </Button>
          <Button
            onClick={() => void save()}
            busy={draft.saveStatus === 'saving'}
            disabled={!chapterIsDirty(draft)}
          >
            <Save aria-hidden="true" focusable="false" />
            Save now
          </Button>
        </div>
        <span role="status" aria-live="polite">
          {status}
        </span>
      </header>
      {feedback && <p role="alert">{feedback}</p>}
      {document.citations.some((citation) => citation.status === 'needs-review') && (
        <p role="alert">Some citations need review after editing.</p>
      )}
      <BlockNoteView
        data-testid="blocknote-editor"
        editor={editor}
        onChange={() => dispatch({ type: 'edit' })}
      />
      <ChapterConflictDialog
        open={conflictOpen}
        onKeep={() => void keepCurrent()}
        onReload={() => void reloadSaved()}
        onCancel={() => {}}
      />
      <MarkdownPasteDialog
        preview={paste}
        onCancel={() => setPaste(null)}
        onConfirm={() => {
          if (paste) {
            editor.insertBlocks(
              paste.candidateBlocks as never[],
              editor.document[editor.document.length - 1],
              'after',
            );
            setPaste(null);
            dispatch({ type: 'edit' });
          }
        }}
      />
      <MarkdownExportDialog
        preview={exportPreview}
        busy={exportBusy}
        onCancel={() => setExportPreview(null)}
        onExport={() => {
          if (!exportPreview) return;
          setExportBusy(true);
          void api
            .exportMarkdown({ chapterId: document.chapterId, previewId: exportPreview.previewId })
            .then((result) => {
              setExportBusy(false);
              setExportPreview(null);
              setFeedback(
                result.ok
                  ? result.value.status === 'canceled'
                    ? 'Export canceled.'
                    : 'Markdown exported.'
                  : result.error.message,
              );
            });
        }}
      />
    </article>
  );
}
