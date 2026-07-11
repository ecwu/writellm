import { useEffect, useMemo, useRef, useState } from 'react';
import { Code2, Eye, FilePenLine, History, PlusCircle, WholeWord } from 'lucide-react';
import { getApi } from '../../api';
import type { ChildViewMode } from '../../app/types';
import { BlockEditor, type BlockEditorHandle } from '../../components/BlockEditor';
import { MarkdownEditor, type MarkdownEditorHandle } from '../../components/MarkdownEditor';
import { SegmentedIconToggle } from '../../components/SegmentedIconToggle';
import { Button } from '../../components/ui/button';
import { Spinner } from '../../components/ui/spinner';
import { ViewModeToggle } from '../../layout/ChildrenViewHeader';
import { sectionTreeMarkdownForExport } from '../../../shared/sectionMarkdown';
import type {
  CompositionTreeNode,
  DocumentBlockRecord,
  FocusedWorkspaceState,
  RetrievedKnowledgeSource,
  SectionNodeRecord
} from '../../../shared/types';
import { useAutosaveDraft } from './useAutosaveDraft';

type EditorSelectionRange = {
  startOffset: number;
  endOffset: number;
};

type EditorLlmMode = 'rewrite-all' | 'rewrite-selection' | 'continue';
type EditorViewMode = 'blocks' | 'markdown';

export function WritingView({
  section,
  blocks,
  compositionTree,
  rootNodeId,
  childViewMode,
  onChildViewMode,
  onCitationClick,
  onHistory,
  onState,
  onStatus,
  onError
}: {
  section: SectionNodeRecord;
  blocks: DocumentBlockRecord[];
  compositionTree: CompositionTreeNode[];
  rootNodeId: string | null;
  childViewMode: ChildViewMode;
  onChildViewMode: (mode: ChildViewMode) => void;
  onCitationClick: (publicRef: string) => void;
  onHistory: (section: SectionNodeRecord) => void;
  onState: (state: FocusedWorkspaceState) => void;
  onStatus: (message: string) => void;
  onError: (message: string) => void;
}) {
  const { draft, saveState, scheduleDraftSave, flushPendingSave } = useAutosaveDraft({
    section,
    onState,
    onError
  });
  const editorRef = useRef<MarkdownEditorHandle | null>(null);
  const blockEditorRef = useRef<BlockEditorHandle | null>(null);
  const [editorViewMode, setEditorViewMode] = useState<EditorViewMode>('blocks');
  const [selection, setSelection] = useState<EditorSelectionRange>({
    startOffset: 0,
    endOffset: 0
  });
  const [activeGenerationMode, setActiveGenerationMode] = useState<EditorLlmMode>('rewrite-all');
  const [generationPrompt, setGenerationPrompt] = useState('');
  const [isCreatingGeneration, setIsCreatingGeneration] = useState(false);
  const generationInputRef = useRef<HTMLInputElement | null>(null);
  const rootTreeNode = useMemo(
    () => (rootNodeId ? findSectionTreeNode(compositionTree, rootNodeId) : null),
    [compositionTree, rootNodeId]
  );
  const isRootMarkdownView = Boolean(rootTreeNode && section.id === rootNodeId);
  const isBlockView = !isRootMarkdownView && editorViewMode === 'blocks';
  const displayedMarkdown = isRootMarkdownView && rootTreeNode
    ? sectionTreeMarkdownForExport(rootTreeNode)
    : draft;
  const citationSources = useMemo(
    () => isRootMarkdownView && rootTreeNode ? getSectionTreeSources(rootTreeNode) : getSectionSources(section),
    [isRootMarkdownView, rootTreeNode, section]
  );
  const selectedText = getSelectedText(
    (isBlockView ? blockEditorRef.current : editorRef.current)?.getValue() ?? displayedMarkdown,
    selection
  );
  const hasSelection = selectedText.trim().length > 0;
  const generationDisabled = isCreatingGeneration;

  async function handleChildViewMode(mode: ChildViewMode) {
    if (mode === childViewMode) {
      return;
    }
    if (isBlockView) {
      await blockEditorRef.current?.flushPendingChanges();
    } else if (!isRootMarkdownView) {
      await flushPendingSave();
    }
    onChildViewMode(mode);
  }

  async function handleHistory() {
    if (isBlockView) {
      await blockEditorRef.current?.flushPendingChanges();
    } else if (!isRootMarkdownView) {
      await flushPendingSave();
    }
    onHistory(section);
  }

  async function enqueueGenerationTask() {
    if (generationDisabled) {
      return;
    }
    if (!generationPrompt.trim()) {
      onError('Tell the assistant what to change first.');
      return;
    }
    const editor = isBlockView ? blockEditorRef.current : editorRef.current;
    if (!editor) {
      onError('Editor is not ready.');
      return;
    }
    if (isBlockView) {
      await blockEditorRef.current?.flushPendingChanges();
    } else {
      await flushPendingSave();
    }
    const currentSelection = editor.getSelection();
    if (activeGenerationMode === 'rewrite-selection' && currentSelection.startOffset === currentSelection.endOffset) {
      onError('Select text before rewriting a selection.');
      return;
    }
    setIsCreatingGeneration(true);
    try {
      const result = await getApi().startPiRun({
        sectionId: section.id,
        focusSectionId: section.id,
        mode: generationModeFromEditor(activeGenerationMode),
        prompt: generationPrompt,
        targetStart: activeGenerationMode === 'rewrite-all' ? 0 : currentSelection.startOffset,
        targetEnd: activeGenerationMode === 'rewrite-all'
          ? editor.getValue().length
          : activeGenerationMode === 'continue'
            ? currentSelection.startOffset
            : currentSelection.endOffset
      });
      setGenerationPrompt('');
      onStatus(`Pi agent run ${result.runId.slice(0, 12)} started in the assistant hub.`);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsCreatingGeneration(false);
    }
  }

  function activateGenerationMode(mode: EditorLlmMode) {
    if (activeGenerationMode === mode) {
      generationInputRef.current?.focus();
      return;
    }
    if (mode === 'rewrite-selection' && !hasSelection) {
      onError('Select text before rewriting a selection.');
      return;
    }
    setActiveGenerationMode(mode);
    window.setTimeout(() => generationInputRef.current?.focus(), 0);
  }

  async function createBlock(afterBlockId: string | null) {
    try {
      const next = await getApi().createDocumentBlock({ sectionId: section.id, afterBlockId });
      onState(next);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function updateBlock(blockId: string, payload: { content?: string; kind?: DocumentBlockRecord['kind']; attributes?: Record<string, unknown> }) {
    try {
      const next = await getApi().updateDocumentBlock(blockId, payload);
      onState(next);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function deleteBlock(blockId: string) {
    try {
      const next = await getApi().deleteDocumentBlock(blockId);
      onState(next);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <section className="writing-view">
      <header className="writing-view-header">
        <div className="writing-view-title">
          <p>{isRootMarkdownView ? 'Block document preview' : 'Logical section'}</p>
          <h1>{section.title}</h1>
        </div>
        <div className="writing-view-controls">
          <div className="writing-view-meta" aria-live="polite">
            <span>{isRootMarkdownView ? 'Composition preview' : 'SQLite block range'}</span>
            <span>{isRootMarkdownView ? 'Generated' : saveState === 'saving' ? 'Saving' : saveState === 'error' ? 'Save failed' : 'Saved'}</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => void handleHistory()}>
            <History />
            History
          </Button>
          <SegmentedIconToggle
            value={editorViewMode}
            label="Editor view mode"
            className="writing-view-mode-toggle"
            onValueChange={setEditorViewMode}
            options={[
              { value: 'blocks', label: 'Block editor view', icon: <Eye /> },
              { value: 'markdown', label: 'Markdown interchange view', icon: <Code2 /> }
            ]}
          />
          <ViewModeToggle mode={childViewMode} onModeChange={(mode) => void handleChildViewMode(mode)} />
        </div>
      </header>
      <div className="writing-view-body">
        <div className="writing-editor-shell">
          {isBlockView ? (
            <BlockEditor
              ref={blockEditorRef}
              blocks={blocks}
              onCreateBlock={createBlock}
              onUpdateBlock={updateBlock}
              onDeleteBlock={deleteBlock}
              onSelectionChange={setSelection}
            />
          ) : (
            <MarkdownEditor
              ref={editorRef}
              key={`${section.id}:${isRootMarkdownView ? 'composition' : 'section'}`}
              value={displayedMarkdown}
              onChange={isRootMarkdownView ? noop : scheduleDraftSave}
              onSelectionChange={setSelection}
              onCitationClick={onCitationClick}
              citationSources={citationSources}
              renderMarkdown
              readOnly={isRootMarkdownView}
            />
          )}
          {isRootMarkdownView ? null : <div className="writing-floating-toolbar" aria-label="Editor actions">
            <div className="writing-generation-mode" aria-hidden="true">
              {activeGenerationMode === 'rewrite-all' ? <FilePenLine /> : null}
              {activeGenerationMode === 'rewrite-selection' ? <WholeWord /> : null}
              {activeGenerationMode === 'continue' ? <PlusCircle /> : null}
            </div>
            <input
              ref={generationInputRef}
              value={generationPrompt}
              onChange={(event) => setGenerationPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !generationDisabled) {
                  void enqueueGenerationTask();
                }
              }}
              placeholder={editorLlmPlaceholder(activeGenerationMode)}
              disabled={generationDisabled}
            />
            <Button size="sm" onClick={() => void enqueueGenerationTask()} disabled={generationDisabled || !generationPrompt.trim()}>
              {generationDisabled ? <Spinner /> : null}
              {generationButtonLabel(isCreatingGeneration)}
            </Button>
            <div className="writing-floating-buttons">
              <button
                type="button"
                className={activeGenerationMode === 'rewrite-all' ? 'active' : undefined}
                title="Rewrite section"
                aria-label="Rewrite section"
                onClick={() => activateGenerationMode('rewrite-all')}
              >
                <FilePenLine />
                <span className="sr-only">Rewrite section</span>
              </button>
              <button
                type="button"
                className={activeGenerationMode === 'rewrite-selection' ? 'active' : undefined}
                title="Rewrite selection"
                aria-label="Rewrite selection"
                disabled={!hasSelection}
                onClick={() => activateGenerationMode('rewrite-selection')}
              >
                <WholeWord />
                <span className="sr-only">Rewrite selection</span>
              </button>
              <button
                type="button"
                className={activeGenerationMode === 'continue' ? 'active' : undefined}
                title="Continue writing"
                aria-label="Continue writing"
                onClick={() => activateGenerationMode('continue')}
              >
                <PlusCircle />
                <span className="sr-only">Continue writing</span>
              </button>
            </div>
          </div>}
        </div>
      </div>
    </section>
  );
}
function generationButtonLabel(isCreatingGeneration: boolean): string {
  if (isCreatingGeneration) {
    return 'Starting';
  }
  return 'Suggest';
}

function getSelectedText(markdown: string, range: EditorSelectionRange): string {
  const start = Math.max(0, Math.min(range.startOffset, markdown.length));
  const end = Math.max(start, Math.min(range.endOffset, markdown.length));
  return markdown.slice(start, end);
}

function editorLlmPlaceholder(mode: EditorLlmMode): string {
  switch (mode) {
    case 'rewrite-all':
      return 'How should this section change?';
    case 'rewrite-selection':
      return 'How should the selection change?';
    case 'continue':
      return 'What should come next?';
  }
}

function generationModeFromEditor(mode: EditorLlmMode) {
  switch (mode) {
    case 'rewrite-all':
      return 'rewrite_section';
    case 'rewrite-selection':
      return 'rewrite_selection';
    case 'continue':
      return 'continue';
  }
}

function getSectionSources(section: SectionNodeRecord): RetrievedKnowledgeSource[] {
  const sources = section.citationSources;
  if (!Array.isArray(sources)) {
    return [];
  }
  return sources.filter((source): source is RetrievedKnowledgeSource => {
    if (!source || typeof source !== 'object') {
      return false;
    }
    const candidate = source as Partial<RetrievedKnowledgeSource>;
    return Boolean(
      candidate.publicRef &&
      candidate.itemTitle &&
      candidate.chunkId &&
      typeof candidate.snippet === 'string'
    );
  });
}

function getSectionTreeSources(root: CompositionTreeNode): RetrievedKnowledgeSource[] {
  const byRef = new Map<string, RetrievedKnowledgeSource>();

  const visit = (section: CompositionTreeNode): void => {
    getSectionSources(section).forEach((source) => {
      byRef.set(source.publicRef.toLowerCase(), source);
    });
    section.children.forEach(visit);
  };

  visit(root);
  return [...byRef.values()];
}

function findSectionTreeNode(nodes: CompositionTreeNode[], sectionId: string): CompositionTreeNode | null {
  for (const node of nodes) {
    if (node.id === sectionId) {
      return node;
    }
    const child = findSectionTreeNode(node.children, sectionId);
    if (child) {
      return child;
    }
  }
  return null;
}

function noop(): void {}
