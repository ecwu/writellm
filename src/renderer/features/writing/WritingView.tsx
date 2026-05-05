import { useRef, useState } from 'react';
import { ArrowLeft, Check, Code2, Eye, FilePenLine, History, PlusCircle, RefreshCw, WandSparkles, WholeWord, X } from 'lucide-react';
import { getApi } from '../../api';
import { MarkdownEditor, type MarkdownEditorHandle } from '../../components/MarkdownEditor';
import { Button } from '../../components/ui/button';
import { Textarea } from '../../components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip';
import { sectionMarkdownForStorage } from '../../../shared/sectionMarkdown';
import type {
  SectionLlmEditMode,
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

type EditorLlmState = {
  open: boolean;
  mode: EditorLlmMode;
  prompt: string;
  output: string;
  status: 'idle' | 'running' | 'done' | 'error';
  error?: string;
  runId: string | null;
  targetRange: EditorSelectionRange | null;
  baseMarkdown: string;
  selectedText: string;
  prefixContext: string;
  suffixContext: string;
  resolvedPrompt: string;
  systemPrompt: string;
  retrievedSources: RetrievedKnowledgeSource[];
};

const emptyEditorLlm: EditorLlmState = {
  open: false,
  mode: 'rewrite-all',
  prompt: '',
  output: '',
  status: 'idle',
  runId: null,
  targetRange: null,
  baseMarkdown: '',
  selectedText: '',
  prefixContext: '',
  suffixContext: '',
  resolvedPrompt: '',
  systemPrompt: '',
  retrievedSources: []
};

export function WritingView({
  section,
  onCitationClick,
  onBack,
  onHistory,
  onState,
  onError
}: {
  section: SectionNodeRecord;
  onCitationClick: (publicRef: string) => void;
  onBack: () => Promise<void>;
  onHistory: (section: SectionNodeRecord) => void;
  onState: (state: FocusedWorkspaceState) => void;
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
  const [editorLlm, setEditorLlm] = useState<EditorLlmState>(emptyEditorLlm);
  const selectedText = getSelectedText(editorRef.current?.getValue() ?? draft, selection);
  const hasSelection = selectedText.trim().length > 0;
  const editorLlmRunning = editorLlm.status === 'running';
  const editorLlmDone = editorLlm.status === 'done' && editorLlm.output.trim().length > 0;

  async function handleBack() {
    await cancelEditorLlm();
    await flushPendingSave();
    await onBack();
  }

  async function handleHistory() {
    await flushPendingSave();
    onHistory(section);
  }

  function openEditorLlm(mode: EditorLlmMode) {
    if (mode === 'rewrite-selection' && !hasSelection) {
      onError('Select text before rewriting a selection.');
      return;
    }
    const currentSelection = editorRef.current?.getSelection() ?? selection;
    const targetRange = mode === 'rewrite-all'
      ? { startOffset: 0, endOffset: editorRef.current?.getValue().length ?? draft.length }
      : mode === 'rewrite-selection'
        ? currentSelection
        : { startOffset: currentSelection.endOffset, endOffset: currentSelection.endOffset };
    if (editorLlm.status === 'running' && editorLlm.runId) {
      void getApi().cancelLlmGeneration(editorLlm.runId);
    }
    setEditorLlm({
      ...emptyEditorLlm,
      open: true,
      mode,
      prompt: '',
      targetRange
    });
  }

  async function runEditorLlm() {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    await flushPendingSave();
    const markdown = editor.getValue();
    const currentSelection = editor.getSelection();
    const targetRange = editorLlm.mode === 'rewrite-all'
      ? { startOffset: 0, endOffset: markdown.length }
      : editorLlm.mode === 'rewrite-selection'
        ? currentSelection
        : { startOffset: currentSelection.endOffset, endOffset: currentSelection.endOffset };
    if (editorLlm.mode === 'rewrite-selection' && targetRange.startOffset === targetRange.endOffset) {
      onError('Select text before rewriting a selection.');
      return;
    }
    const runId = globalThis.crypto.randomUUID();
    const request = buildEditorLlmRequest(editorLlm.mode, {
      sectionTitle: section.title,
      markdown,
      instruction: editorLlm.prompt,
      targetRange
    });
    setEditorLlm((current) => ({
      ...current,
      runId,
      targetRange,
      baseMarkdown: markdown,
      selectedText: request.selectedText,
      prefixContext: request.prefixContext,
      suffixContext: request.suffixContext,
      resolvedPrompt: request.prompt,
      systemPrompt: request.systemPrompt,
      retrievedSources: [],
      output: '',
      status: 'running',
      error: undefined
    }));
    try {
      const result = await getApi().generateWithLlm({
        runId,
        sectionId: section.id,
        focusSectionId: section.id,
        prompt: request.prompt,
        contextNodeIds: [],
        maxKnowledgeChunks: 6,
        requireInlineCitations: true,
        systemPrompt: request.systemPrompt
      });
      if (result.canceled) {
        setEditorLlm(emptyEditorLlm);
        return;
      }
      setEditorLlm((current) => current.runId === runId
        ? {
            ...current,
            output: result.content.trim(),
            retrievedSources: result.sources ?? [],
            status: 'done'
          }
        : current
      );
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setEditorLlm((current) => current.runId === runId
        ? { ...current, status: 'error', error: message }
        : current
      );
      onError(message);
    }
  }

  async function cancelEditorLlm() {
    if (editorLlm.status === 'running' && editorLlm.runId) {
      await getApi().cancelLlmGeneration(editorLlm.runId);
    }
    setEditorLlm(emptyEditorLlm);
  }

  async function applyEditorLlm() {
    if (!editorLlmDone || !editorLlm.targetRange) {
      return;
    }
    const currentMarkdown = editorRef.current?.getValue() ?? draft;
    if (sectionMarkdownForStorage(currentMarkdown) !== sectionMarkdownForStorage(editorLlm.baseMarkdown)) {
      onError('The section changed after this LLM edit was generated. Regenerate before applying it.');
      return;
    }
    try {
      const next = await getApi().applySectionLlmEdit({
        sectionId: section.id,
        focusSectionId: section.id,
        mode: sectionLlmEditMode(editorLlm.mode),
        userPrompt: editorLlm.prompt,
        resolvedPrompt: editorLlm.resolvedPrompt,
        systemPrompt: editorLlm.systemPrompt,
        generatedContent: editorLlm.output,
        baseMarkdown: editorLlm.baseMarkdown,
        targetStart: editorLlm.targetRange.startOffset,
        targetEnd: editorLlm.targetRange.endOffset,
        selectedText: editorLlm.selectedText,
        prefixContext: editorLlm.prefixContext,
        suffixContext: editorLlm.suffixContext,
        retrievedSources: editorLlm.retrievedSources,
        contextNodeIds: []
      });
      onState(next);
      setEditorLlm(emptyEditorLlm);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <section className="writing-view">
      <header className="writing-view-header">
        <Button variant="outline" size="sm" onClick={() => void handleBack()}>
          <ArrowLeft />
          Back
        </Button>
        <div className="writing-view-title">
          <p>Section Markdown</p>
          <h1>{section.title}</h1>
        </div>
        <div className="writing-view-meta" aria-live="polite">
          <span>{section.markdownPath}</span>
          <span>{saveState === 'saving' ? 'Saving' : saveState === 'error' ? 'Save failed' : 'Saved'}</span>
        </div>
        <div className="writing-view-mode-toggle" role="group" aria-label="Editor view mode">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={editorViewMode === 'raw' ? 'default' : 'outline'}
                size="icon-sm"
                onClick={() => setEditorViewMode('raw')}
                aria-label="Raw Markdown view"
                title="Raw Markdown view"
              >
                <Code2 />
                <span className="sr-only">Raw Markdown</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Raw Markdown</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={editorViewMode === 'decorated' ? 'default' : 'outline'}
                size="icon-sm"
                onClick={() => setEditorViewMode('decorated')}
                aria-label="Decorated Markdown view"
                title="Decorated Markdown view"
              >
                <Eye />
                <span className="sr-only">Decorated Markdown</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Decorated Markdown</TooltipContent>
          </Tooltip>
        </div>
        <Button variant="outline" size="sm" onClick={() => void handleHistory()}>
          <History />
          History
        </Button>
      </header>
      <div className="writing-view-body">
        <div className="writing-editor-shell">
          <MarkdownEditor
            ref={editorRef}
            key={section.id}
            value={draft}
            onChange={scheduleDraftSave}
            onSelectionChange={setSelection}
            normalizeValue={sectionMarkdownForStorage}
            onCitationClick={onCitationClick}
            citationSources={getSectionSources(section)}
            renderMarkdown={editorViewMode === 'decorated'}
          />
          <div className="writing-floating-toolbar" aria-label="Editor actions">
            {editorLlm.open ? (
              <div className="writing-llm-composer">
                <div className="writing-llm-composer-heading">
                  <span>{editorLlmModeLabel(editorLlm.mode)}</span>
                  <span>{editorLlmTargetLabel(editorLlm.mode, editorLlm.targetRange, editorRef.current?.getValue() ?? draft)}</span>
                </div>
                <Textarea
                  value={editorLlm.prompt}
                  onChange={(event) => setEditorLlm((current) => ({ ...current, prompt: event.target.value }))}
                  placeholder={editorLlmPlaceholder(editorLlm.mode)}
                  disabled={editorLlmRunning}
                />
                {editorLlm.output || editorLlm.error || editorLlmRunning ? (
                  <div className={`writing-llm-output${editorLlm.status === 'error' ? ' is-error' : ''}`}>
                    {editorLlm.output || editorLlm.error || 'Waiting for the first token...'}
                  </div>
                ) : null}
                <div className="writing-llm-actions">
                  <button type="button" title="Cancel" aria-label="Cancel" onClick={() => void cancelEditorLlm()}>
                    <X />
                  </button>
                  {editorLlmDone ? (
                    <>
                      <button type="button" title="Regenerate" aria-label="Regenerate" onClick={() => void runEditorLlm()}>
                        <RefreshCw />
                      </button>
                      <button type="button" title="Apply" aria-label="Apply" onClick={() => void applyEditorLlm()}>
                        <Check />
                      </button>
                    </>
                  ) : (
                    <button type="button" title="Generate edit" aria-label="Generate edit" disabled={editorLlmRunning} onClick={() => void runEditorLlm()}>
                      <WandSparkles />
                    </button>
                  )}
                </div>
              </div>
            ) : null}
            <div className="writing-floating-buttons">
              <button
                type="button"
                className={editorLlm.open && editorLlm.mode === 'rewrite-all' ? 'active' : undefined}
                title="Rewrite section"
                aria-label="Rewrite section"
                onClick={() => openEditorLlm('rewrite-all')}
              >
                <FilePenLine />
                <span className="sr-only">Rewrite section</span>
              </button>
              <button
                type="button"
                className={editorLlm.open && editorLlm.mode === 'rewrite-selection' ? 'active' : undefined}
                title="Rewrite selection"
                aria-label="Rewrite selection"
                disabled={!hasSelection}
                onClick={() => openEditorLlm('rewrite-selection')}
              >
                <WholeWord />
                <span className="sr-only">Rewrite selection</span>
              </button>
              <button
                type="button"
                className={editorLlm.open && editorLlm.mode === 'continue' ? 'active' : undefined}
                title="Continue writing"
                aria-label="Continue writing"
                onClick={() => openEditorLlm('continue')}
              >
                <PlusCircle />
                <span className="sr-only">Continue writing</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function getSelectedText(markdown: string, range: EditorSelectionRange): string {
  const start = Math.max(0, Math.min(range.startOffset, markdown.length));
  const end = Math.max(start, Math.min(range.endOffset, markdown.length));
  return markdown.slice(start, end);
}

function editorLlmModeLabel(mode: EditorLlmMode): string {
  switch (mode) {
    case 'rewrite-all':
      return 'Rewrite section';
    case 'rewrite-selection':
      return 'Rewrite selection';
    case 'continue':
      return 'Continue writing';
  }
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

function editorLlmTargetLabel(mode: EditorLlmMode, range: EditorSelectionRange | null, markdown: string): string {
  if (mode === 'rewrite-all') {
    return `${markdown.trim().length} chars`;
  }
  if (!range) {
    return 'No target';
  }
  if (mode === 'continue') {
    return `Insert at ${range.startOffset}`;
  }
  return `${Math.max(0, range.endOffset - range.startOffset)} selected chars`;
}

function editorLlmSystemPrompt(mode: EditorLlmMode): string {
  const scope = mode === 'rewrite-all'
    ? 'Return the full rewritten Markdown section.'
    : mode === 'rewrite-selection'
      ? 'Return only the replacement text for the selected Markdown fragment.'
      : 'Return only the continuation text to insert at the cursor.';
  return [
    'You are an expert Markdown editor for academic and technical writing.',
    scope,
    'Preserve Markdown syntax and citation markers unless the user explicitly asks to change them.',
    'Do not include explanations, alternatives, labels, or fenced wrappers around the answer.'
  ].join(' ');
}

function sectionLlmEditMode(mode: EditorLlmMode): SectionLlmEditMode {
  switch (mode) {
    case 'rewrite-all':
      return 'rewrite_section';
    case 'rewrite-selection':
      return 'rewrite_selection';
    case 'continue':
      return 'continue_at_cursor';
  }
}

function buildEditorLlmRequest(
  mode: EditorLlmMode,
  input: {
    sectionTitle: string;
    markdown: string;
    instruction: string;
    targetRange: EditorSelectionRange;
  }
): {
  prompt: string;
  systemPrompt: string;
  selectedText: string;
  prefixContext: string;
  suffixContext: string;
} {
  const selectedText = getSelectedText(input.markdown, input.targetRange);
  const prefix = input.markdown.slice(Math.max(0, input.targetRange.startOffset - 2400), input.targetRange.startOffset);
  const suffix = input.markdown.slice(input.targetRange.endOffset, input.targetRange.endOffset + 1600);
  const instruction = input.instruction.trim() || 'No additional requirements.';
  const systemPrompt = editorLlmSystemPrompt(mode);

  if (mode === 'rewrite-all') {
    return {
      prompt: [
        `Section title: ${input.sectionTitle}`,
        `User requirements: ${instruction}`,
        '',
        'Rewrite the full Markdown section below.',
        '',
        input.markdown
      ].join('\n'),
      systemPrompt,
      selectedText,
      prefixContext: prefix,
      suffixContext: suffix
    };
  }

  if (mode === 'rewrite-selection') {
    return {
      prompt: [
        `Section title: ${input.sectionTitle}`,
        `User requirements: ${instruction}`,
        '',
        'Context before selection:',
        prefix || '(none)',
        '',
        'Selected Markdown to rewrite:',
        selectedText,
        '',
        'Context after selection:',
        suffix || '(none)'
      ].join('\n'),
      systemPrompt,
      selectedText,
      prefixContext: prefix,
      suffixContext: suffix
    };
  }

  return {
    prompt: [
      `Section title: ${input.sectionTitle}`,
      `User requirements: ${instruction}`,
      '',
      'Continue the Markdown section at the insertion point.',
      '',
      'Context before insertion:',
      prefix || '(none)',
      '',
      'Context after insertion:',
      suffix || '(none)'
    ].join('\n'),
    systemPrompt,
    selectedText,
    prefixContext: prefix,
    suffixContext: suffix
  };
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
