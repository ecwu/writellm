import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Code2, Eye, FilePenLine, History, PlusCircle, WholeWord, X } from 'lucide-react';
import { getApi } from '../../api';
import type { ChildViewMode } from '../../app/types';
import { MarkdownEditor, type MarkdownEditorHandle } from '../../components/MarkdownEditor';
import { SegmentedIconToggle } from '../../components/SegmentedIconToggle';
import { Button } from '../../components/ui/button';
import { Spinner } from '../../components/ui/spinner';
import { ViewModeToggle } from '../../layout/ChildrenViewHeader';
import { sectionMarkdownForStorage, sectionTreeMarkdownForExport } from '../../../shared/sectionMarkdown';
import type {
  CompositionTreeNode,
  CreateGenerationTaskResult,
  GenerationRoundRecord,
  FocusedWorkspaceState,
  RetrievedKnowledgeSource,
  SectionNodeRecord,
  WritingPatchRecord
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
  const [latestPatch, setLatestPatch] = useState<WritingPatchRecord | null>(null);
  const [isCreatingGeneration, setIsCreatingGeneration] = useState(false);
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
  const latestRoundRunning = latestRound?.status === 'pending' || latestRound?.status === 'retrieving' || latestRound?.status === 'processing';
  const generationDisabled = isCreatingGeneration || latestRoundRunning;

  useEffect(() => {
    if (isRootMarkdownView) {
      setLatestRound(null);
      setLatestPatch(null);
      return;
    }
    let canceled = false;
    async function loadLatestRoundForSection() {
      try {
        const sessions = await getApi().listGenerationSessions(section.id);
        const roundGroups = await Promise.all(
          sessions.map((session) => getApi().listGenerationRounds(session.id))
        );
        const rounds = roundGroups.flat().sort((left, right) =>
          new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
        );
        const nextRound = rounds[0] ?? null;
        const nextPatch = nextRound?.patchId ? await getApi().getWritingPatch(nextRound.patchId) : null;
        if (!canceled) {
          setLatestRound(nextRound);
          setLatestPatch(nextPatch);
        }
      } catch (caught) {
        if (!canceled) {
          onError(caught instanceof Error ? caught.message : String(caught));
        }
      }
    }
    void loadLatestRoundForSection();
    return () => {
      canceled = true;
    };
  }, [isRootMarkdownView, section.id]);

  useEffect(() => {
    if (!latestRound || latestRound.status !== 'pending' && latestRound.status !== 'retrieving' && latestRound.status !== 'processing') {
      return;
    }
    let canceled = false;
    async function pollRound() {
      const next = await getApi().getGenerationRound(latestRound!.id);
      if (!canceled) {
        setLatestRound(next);
        if (next?.patchId) {
          const patch = await getApi().getWritingPatch(next.patchId);
          if (!canceled) {
            setLatestPatch(patch);
          }
        }
      }
    }
    const timer = window.setInterval(() => void pollRound(), 1000);
    void pollRound();
    return () => {
      canceled = true;
      window.clearInterval(timer);
    };
  }, [latestRound?.id, latestRound?.status]);

  useEffect(() => {
    if (!latestRound) {
      return;
    }
    return getApi().onGenerationEvent((event) => {
      if (event.roundId !== latestRound.id) {
        return;
      }
      void getApi().getGenerationRound(event.roundId).then((round) => {
        setLatestRound(round);
        if (round?.patchId) {
          void getApi().getWritingPatch(round.patchId).then(setLatestPatch);
        }
      }).catch((caught: unknown) => onError(caught instanceof Error ? caught.message : String(caught)));
      if (event.type === 'patch_created') {
        onStatus('Suggestion ready.');
      } else if (event.type === 'round_error') {
        onError(formatSuggestionError(event.errorMessage));
      }
    });
  }, [latestRound?.id, onError, onStatus]);

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
    if (generationDisabled) {
      return;
    }
    if (!generationPrompt.trim()) {
      onError('Tell the assistant what to change first.');
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
    setIsCreatingGeneration(true);
    setLatestRound(null);
    setLatestPatch(null);
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
        executionMode: result.executionMode,
        outputMode: 'patchProposal',
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
        patchId: result.patchId ?? null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        adoptedAt: null
      });
      setGenerationPrompt('');
      onStatus(result.status === 'retrieving' ? 'Collecting sources.' : result.executionMode === 'interactive' ? 'Suggestion started.' : 'Suggestion queued.');
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsCreatingGeneration(false);
    }
  }

  async function cancelLatestRound(round: GenerationRoundRecord) {
    try {
      const next = await getApi().cancelGenerationTask(round.id);
      setLatestRound(next);
      setLatestPatch(null);
      onStatus('Suggestion canceled.');
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function retryLatestRound(round: GenerationRoundRecord) {
    try {
      const result = await getApi().retryGenerationTask(round.id);
      setLatestRound({
        ...round,
        id: result.roundId,
        sessionId: result.sessionId,
        status: result.status,
        executionMode: result.executionMode,
        content: null,
        errorMessage: null,
        patchId: result.patchId ?? null,
        startedAt: null,
        completedAt: null,
        adoptedAt: null,
        updatedAt: new Date().toISOString()
      });
      setLatestPatch(null);
      onStatus('Trying again.');
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function dismissLatestRound(round: GenerationRoundRecord) {
    try {
      await getApi().discardGenerationTask(round.id);
      setLatestRound(null);
      setLatestPatch(null);
      onStatus('Suggestion dismissed.');
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
                if (event.key === 'Enter' && !generationDisabled) {
                  void enqueueGenerationTask();
                }
              }}
              placeholder={editorLlmPlaceholder(activeGenerationMode)}
              disabled={generationDisabled}
            />
            <label className="writing-knowledge-toggle">
              <input
                type="checkbox"
                checked={generationUsesKnowledge}
                onChange={(event) => setGenerationUsesKnowledge(event.target.checked)}
                disabled={generationDisabled}
              />
              <span>Sources</span>
            </label>
            <Button size="sm" onClick={() => void enqueueGenerationTask()} disabled={generationDisabled || !generationPrompt.trim()}>
              {generationDisabled ? <Spinner /> : null}
              {generationButtonLabel(isCreatingGeneration, latestRound)}
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
              patch={latestPatch}
              onReview={() => void createPatchForLatestRound(latestRound, { action: 'review' })}
              onAccept={() => void createPatchForLatestRound(latestRound, { action: 'accept' })}
              onSaveCandidate={() => void createPatchForLatestRound(latestRound, { action: 'candidate' })}
              onReject={() => void createPatchForLatestRound(latestRound, { action: 'reject' })}
              onCancel={() => void cancelLatestRound(latestRound)}
              onRetry={() => void retryLatestRound(latestRound)}
              onDismiss={() => void dismissLatestRound(latestRound)}
            />
          ) : null}
        </div>
      </div>
    </section>
  );

  async function createPatchForLatestRound(round: GenerationRoundRecord, options: { action: 'review' | 'accept' | 'candidate' | 'reject' }) {
    try {
      const patch = round.patchId
        ? await getApi().getWritingPatch(round.patchId) ?? await getApi().createPatchFromGenerationRound({ roundId: round.id })
        : await getApi().createPatchFromGenerationRound({ roundId: round.id });
      setLatestPatch(patch);
      if (options.action === 'candidate') {
        const next = await getApi().saveWritingPatchAsCandidate(patch.id);
        onState(next);
        onStatus('Suggestion saved as a separate draft.');
      } else if (options.action === 'accept') {
        const riskLevel = patch.patch.validation?.riskLevel ?? patch.riskLevel;
        if (riskLevel === 'high') {
          const confirmed = window.confirm('This suggestion changes sensitive details such as citations or numbers. Apply it anyway?');
          if (!confirmed) {
            return;
          }
        }
        const next = await getApi().acceptWritingPatch({ patchId: patch.id });
        onState(next);
        onStatus('Suggestion applied.');
      } else if (options.action === 'reject') {
        await getApi().rejectWritingPatch(patch.id);
        onStatus('Suggestion dismissed.');
      } else {
        onGenerationQueued({
          roundId: round.id,
          sessionId: round.sessionId,
          status: round.status,
          executionMode: round.executionMode,
          patchId: patch.id
        });
        onStatus('Suggestion opened in Assist details.');
      }
      setLatestRound(await getApi().getGenerationRound(round.id));
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught));
    }
  }
}

function WritingPatchNotice({
  round,
  patch,
  onReview,
  onAccept,
  onSaveCandidate,
  onReject,
  onCancel,
  onRetry,
  onDismiss
}: {
  round: GenerationRoundRecord;
  patch: WritingPatchRecord | null;
  onReview: () => void;
  onAccept: () => void;
  onSaveCandidate: () => void;
  onReject: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  if (round.status === 'pending' || round.status === 'retrieving' || round.status === 'processing') {
    return (
      <div className="writing-patch-notice">
        <span><Spinner /> {generationRunningLabel(round.status)}</span>
        <div>
          <Button variant="outline" size="sm" onClick={onCancel}>
            <X />
            Cancel
          </Button>
        </div>
      </div>
    );
  }
  if (round.status === 'done') {
    return (
      <div className="writing-patch-notice">
        <span>Suggestion ready</span>
        <div>
          <Button size="sm" onClick={onReview}>Open Details</Button>
          <Button variant="outline" size="sm" onClick={onSaveCandidate}>Save Copy</Button>
          <Button variant="outline" size="sm" onClick={onReject}>Dismiss</Button>
        </div>
      </div>
    );
  }
  if (round.status === 'patch_created') {
    return (
      <div className="writing-patch-notice">
        <span>Suggestion ready</span>
        {patch ? <p>{patchPreviewText(patch)}</p> : null}
        <div>
          <Button variant="outline" size="sm" onClick={onReview}>Details</Button>
          {patch && canApplyPatchToSection(patch) ? (
            <Button size="sm" onClick={onAccept}>
              <Check />
              Apply
            </Button>
          ) : null}
          <Button variant="outline" size="sm" onClick={onSaveCandidate}>Save Copy</Button>
          <Button variant="outline" size="sm" onClick={onReject}>Dismiss</Button>
        </div>
      </div>
    );
  }
  if (round.status === 'saved_as_candidate' || round.status === 'patch_rejected' || round.status === 'patch_accepted') {
    return null;
  }
  if (round.status === 'error') {
    return (
      <div className="writing-patch-notice is-error">
        <span>{formatSuggestionError(round.errorMessage)}</span>
        <div>
          <Button variant="outline" size="sm" onClick={onRetry}>Retry</Button>
          <Button variant="outline" size="sm" onClick={onDismiss}>
            <X />
            Dismiss
          </Button>
        </div>
      </div>
    );
  }
  return null;
}

function generationButtonLabel(isCreatingGeneration: boolean, round: GenerationRoundRecord | null): string {
  if (isCreatingGeneration) {
    return 'Starting';
  }
  if (round?.status === 'retrieving') {
    return 'Collecting';
  }
  if (round?.status === 'pending' || round?.status === 'processing') {
    return 'Drafting';
  }
  return 'Suggest';
}

function generationRunningLabel(status: GenerationRoundRecord['status']): string {
  if (status === 'retrieving') {
    return 'Collecting sources';
  }
  if (status === 'pending') {
    return 'Queued to draft';
  }
  return 'Drafting a suggestion';
}

function formatSuggestionError(message: string | null | undefined): string {
  if (!message) {
    return 'Could not draft a suggestion.';
  }
  if (message.includes('invalid_type') && message.includes('expected array')) {
    return 'The assistant returned suggestion metadata in an unexpected shape. Try again.';
  }
  if (message.length > 180) {
    return `${message.slice(0, 180)}...`;
  }
  return message;
}

function patchPreviewText(record: WritingPatchRecord): string {
  const operation = record.patch.operation;
  const text = operation.type === 'replace'
    ? operation.after
    : operation.type === 'insert'
      ? operation.text
      : operation.content;
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > 240 ? `${normalized.slice(0, 240)}...` : normalized;
}

function canApplyPatchToSection(record: WritingPatchRecord): boolean {
  return record.patch.kind === 'replace_selection' ||
    record.patch.kind === 'insert_at_cursor' ||
    record.patch.kind === 'replace_section';
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
