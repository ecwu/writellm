import { useEffect, useMemo, useRef, useState } from 'react';
import { Code2, Eye, FilePenLine, History, PlusCircle, WholeWord } from 'lucide-react';
import { getApi } from '../../api';
import type { ChildViewMode } from '../../app/types';
import { MarkdownEditor, type MarkdownEditorHandle } from '../../components/MarkdownEditor';
import { SegmentedIconToggle } from '../../components/SegmentedIconToggle';
import { Button } from '../../components/ui/button';
import { ViewModeToggle } from '../../layout/ChildrenViewHeader';
import { sectionMarkdownForStorage, sectionTreeMarkdownForExport } from '../../../shared/sectionMarkdown';
import type {
  CompositionTreeNode,
  CreateGenerationTaskResult,
  GenerationRoundRecord,
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
type EditorViewMode = 'raw' | 'decorated';

export function WritingView({
  section,
  compositionTree,
  rootNodeId,
  childViewMode,
  onChildViewMode,
  onCitationClick,
  onHistory,
  onState,
  onStatus,
  onGenerationQueued,
  onError
}: {
  section: SectionNodeRecord;
  compositionTree: CompositionTreeNode[];
  rootNodeId: string | null;
  childViewMode: ChildViewMode;
  onChildViewMode: (mode: ChildViewMode) => void;
  onCitationClick: (publicRef: string) => void;
  onHistory: (section: SectionNodeRecord) => void;
  onState: (state: FocusedWorkspaceState) => void;
  onStatus: (message: string) => void;
  onGenerationQueued: (result: CreateGenerationTaskResult) => void;
  onError: (message: string) => void;
}) {
  const { draft, saveState, scheduleDraftSave, flushPendingSave } = useAutosaveDraft({
    section,
    onState,
    onError
  });
  const editorRef = useRef<MarkdownEditorHandle | null>(null);
  const [editorViewMode, setEditorViewMode] = useState<EditorViewMode>('decorated');
  const [selection, setSelection] = useState<EditorSelectionRange>({
    startOffset: 0,
    endOffset: 0
  });
  const [activeGenerationMode, setActiveGenerationMode] = useState<EditorLlmMode>('rewrite-all');
  const [generationPrompt, setGenerationPrompt] = useState('');
  const [generationUsesKnowledge, setGenerationUsesKnowledge] = useState(true);
  const [latestRound, setLatestRound] = useState<GenerationRoundRecord | null>(null);
  const generationInputRef = useRef<HTMLInputElement | null>(null);
  const rootTreeNode = useMemo(
    () => (rootNodeId ? findSectionTreeNode(compositionTree, rootNodeId) : null),
    [compositionTree, rootNodeId]
  );
  const isRootMarkdownView = Boolean(rootTreeNode && section.id === rootNodeId);
  const displayedMarkdown = isRootMarkdownView && rootTreeNode
    ? sectionTreeMarkdownForExport(rootTreeNode)
    : draft;
  const citationSources = useMemo(
    () => isRootMarkdownView && rootTreeNode ? getSectionTreeSources(rootTreeNode) : getSectionSources(section),
    [isRootMarkdownView, rootTreeNode, section]
  );
  const selectedText = getSelectedText(editorRef.current?.getValue() ?? displayedMarkdown, selection);
  const hasSelection = selectedText.trim().length > 0;

  useEffect(() => {
    if (!latestRound || latestRound.status !== 'pending' && latestRound.status !== 'processing') {
      return;
    }
    let canceled = false;
    async function pollRound() {
      const next = await getApi().getGenerationRound(latestRound!.id);
      if (!canceled) {
        setLatestRound(next);
      }
    }
    const timer = window.setInterval(() => void pollRound(), 1000);
    void pollRound();
    return () => {
      canceled = true;
      window.clearInterval(timer);
    };
  }, [latestRound?.id, latestRound?.status]);
  async function handleChildViewMode(mode: ChildViewMode) {
    if (mode === childViewMode) {
      return;
    }
    if (!isRootMarkdownView) {
      await flushPendingSave();
    }
    onChildViewMode(mode);
  }

  async function handleHistory() {
    if (!isRootMarkdownView) {
      await flushPendingSave();
    }
    onHistory(section);
  }

  async function enqueueGenerationTask() {
    if (!generationPrompt.trim()) {
      onError('Generation prompt is required.');
      return;
    }
    const editor = editorRef.current;
    if (!editor) {
      onError('Editor is not ready.');
      return;
    }
    await flushPendingSave();
    const currentSelection = editor.getSelection();
    if (activeGenerationMode === 'rewrite-selection' && currentSelection.startOffset === currentSelection.endOffset) {
      onError('Select text before rewriting a selection.');
      return;
    }
    try {
      const result = await getApi().createGenerationTask({
        sectionId: section.id,
        focusSectionId: section.id,
        mode: generationModeFromEditor(activeGenerationMode),
        prompt: generationPrompt,
        useKnowledgeSources: generationUsesKnowledge,
        contextNodeIds: [],
        requireInlineCitations: generationUsesKnowledge,
        targetStart: activeGenerationMode === 'rewrite-all' ? 0 : currentSelection.startOffset,
        targetEnd: activeGenerationMode === 'rewrite-all'
          ? editor.getValue().length
          : activeGenerationMode === 'continue'
            ? currentSelection.startOffset
            : currentSelection.endOffset
      });
      setLatestRound({
        id: result.roundId,
        sessionId: result.sessionId,
        status: result.status,
        mode: generationModeFromEditor(activeGenerationMode),
        prompt: generationPrompt,
        resolvedPrompt: null,
        systemPrompt: null,
        content: null,
        retrievedSources: [],
        retrievalTrace: [],
        modelProvider: null,
        modelName: null,
        errorMessage: null,
        jobId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        adoptedAt: null
      });
      setGenerationPrompt('');
      onGenerationQueued(result);
      onStatus('Generation task queued.');
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught));
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

  return (
    <section className="writing-view">
      <header className="writing-view-header">
        <div className="writing-view-title">
          <p>{isRootMarkdownView ? 'Document Markdown' : 'Section Markdown'}</p>
          <h1>{section.title}</h1>
        </div>
        <div className="writing-view-controls">
          <div className="writing-view-meta" aria-live="polite">
            <span>{isRootMarkdownView ? 'Composition preview' : section.markdownPath}</span>
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
              { value: 'raw', label: 'Raw Markdown view', icon: <Code2 /> },
              { value: 'decorated', label: 'Decorated Markdown view', icon: <Eye /> }
            ]}
          />
          <ViewModeToggle mode={childViewMode} onModeChange={(mode) => void handleChildViewMode(mode)} />
        </div>
      </header>
      <div className="writing-view-body">
        <div className="writing-editor-shell">
          <MarkdownEditor
            ref={editorRef}
            key={`${section.id}:${isRootMarkdownView ? 'composition' : 'section'}`}
            value={displayedMarkdown}
            onChange={isRootMarkdownView ? noop : scheduleDraftSave}
            onSelectionChange={setSelection}
            normalizeValue={isRootMarkdownView ? undefined : sectionMarkdownForStorage}
            onCitationClick={onCitationClick}
            citationSources={citationSources}
            renderMarkdown={editorViewMode === 'decorated'}
            readOnly={isRootMarkdownView}
          />
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
                if (event.key === 'Enter') {
                  void enqueueGenerationTask();
                }
              }}
              placeholder={editorLlmPlaceholder(activeGenerationMode)}
            />
            <label className="writing-knowledge-toggle">
              <input
                type="checkbox"
                checked={generationUsesKnowledge}
                onChange={(event) => setGenerationUsesKnowledge(event.target.checked)}
              />
              <span>Sources</span>
            </label>
            <Button size="sm" onClick={() => void enqueueGenerationTask()}>
              Generate
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
          {!isRootMarkdownView && latestRound ? (
            <WritingPatchNotice
              round={latestRound}
              onReview={() => void createPatchForLatestRound(latestRound, { action: 'review' })}
              onSaveCandidate={() => void createPatchForLatestRound(latestRound, { action: 'candidate' })}
              onReject={() => void createPatchForLatestRound(latestRound, { action: 'reject' })}
            />
          ) : null}
        </div>
      </div>
    </section>
  );

  async function createPatchForLatestRound(round: GenerationRoundRecord, options: { action: 'review' | 'candidate' | 'reject' }) {
    try {
      const patch = await getApi().createPatchFromGenerationRound({ roundId: round.id });
      if (options.action === 'candidate') {
        const next = await getApi().saveWritingPatchAsCandidate(patch.id);
        onState(next);
        onStatus('Patch saved as candidate.');
      } else if (options.action === 'reject') {
        await getApi().rejectWritingPatch(patch.id);
        onStatus('Patch rejected.');
      } else {
        onStatus('Patch ready in Inspector.');
      }
      setLatestRound(await getApi().getGenerationRound(round.id));
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught));
    }
  }
}

function WritingPatchNotice({
  round,
  onReview,
  onSaveCandidate,
  onReject
}: {
  round: GenerationRoundRecord;
  onReview: () => void;
  onSaveCandidate: () => void;
  onReject: () => void;
}) {
  if (round.status === 'pending' || round.status === 'processing') {
    return (
      <div className="writing-patch-notice">
        <span>Generating patch proposal</span>
      </div>
    );
  }
  if (round.status === 'done') {
    return (
      <div className="writing-patch-notice">
        <span>Proposed patch ready</span>
        <div>
          <Button size="sm" onClick={onReview}>Review Diff</Button>
          <Button variant="outline" size="sm" onClick={onSaveCandidate}>Save as Candidate</Button>
          <Button variant="outline" size="sm" onClick={onReject}>Reject</Button>
        </div>
      </div>
    );
  }
  if (round.status === 'patch_created') {
    return (
      <div className="writing-patch-notice">
        <span>Patch ready in Inspector</span>
      </div>
    );
  }
  if (round.status === 'saved_as_candidate' || round.status === 'patch_rejected' || round.status === 'patch_accepted') {
    return null;
  }
  if (round.status === 'error') {
    return (
      <div className="writing-patch-notice is-error">
        <span>{round.errorMessage || 'Patch generation failed'}</span>
      </div>
    );
  }
  return null;
}

function getSelectedText(markdown: string, range: EditorSelectionRange): string {
  const start = Math.max(0, Math.min(range.startOffset, markdown.length));
  const end = Math.max(start, Math.min(range.endOffset, markdown.length));
  return markdown.slice(start, end);
}

function editorLlmPlaceholder(mode: EditorLlmMode): string {
  switch (mode) {
    case 'rewrite-all':
      return 'Optional requirements for rewriting the whole section';
    case 'rewrite-selection':
      return 'Optional requirements for rewriting the selected text';
    case 'continue':
      return 'Optional requirements for what to write next';
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
