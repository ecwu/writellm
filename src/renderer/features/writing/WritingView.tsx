import { useMemo, useRef, useState } from 'react';
import { Code2, Eye, FilePenLine, History, PlusCircle, WholeWord } from 'lucide-react';
import { getApi } from '../../api';
import type { ChildViewMode } from '../../app/types';
import { MarkdownEditor, type MarkdownEditorHandle } from '../../components/MarkdownEditor';
import { SegmentedIconToggle } from '../../components/SegmentedIconToggle';
import { Button } from '../../components/ui/button';
import {
  LlmExecutionFlow,
  type LlmFlowAdoptInput,
  type LlmFlowGenerateInput,
  type LlmFlowGenerateProgress
} from '../llm/LlmExecutionFlow';
import { ViewModeToggle } from '../../layout/ChildrenViewHeader';
import { sectionMarkdownForStorage, sectionTreeMarkdownForExport } from '../../../shared/sectionMarkdown';
import type {
  CompositionTreeNode,
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
  useKnowledgeSources: boolean;
  knowledgeRetrievalPrompt: string;
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
  useKnowledgeSources: true,
  knowledgeRetrievalPrompt: '',
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
  compositionTree,
  rootNodeId,
  childViewMode,
  onChildViewMode,
  onCitationClick,
  onHistory,
  onState,
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
  async function handleChildViewMode(mode: ChildViewMode) {
    if (mode === childViewMode) {
      return;
    }
    await cancelEditorLlm();
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

  function openEditorLlm(mode: EditorLlmMode) {
    if (mode === 'rewrite-selection' && !hasSelection) {
      onError('Select text before rewriting a selection.');
      return;
    }
    const markdown = editorRef.current?.getValue() ?? draft;
    const currentSelection = editorRef.current?.getSelection() ?? selection;
    const targetRange = mode === 'rewrite-all'
      ? { startOffset: 0, endOffset: markdown.length }
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
      knowledgeRetrievalPrompt: buildEditorKnowledgeRetrievalPrompt(mode, {
        sectionTitle: section.title,
        sectionIntent: section.intent ?? '',
        markdown,
        instruction: '',
        targetRange
      }),
      targetRange
    });
  }

  async function retrieveEditorFlowSources(
    knowledgeRetrievalPrompt: string,
    options: { retrievalMode: 'classic' | 'sourcev2'; runId?: string }
  ): Promise<RetrievedKnowledgeSource[]> {
    return getApi().searchKnowledge({
      query: knowledgeRetrievalPrompt,
      sectionId: section.id,
      focusSectionId: section.id,
      contextNodeIds: [],
      retrievalMode: options.retrievalMode,
      runId: options.runId
    });
  }

  async function generateEditorFlowResult(
    input: LlmFlowGenerateInput,
    onProgress: (progress: LlmFlowGenerateProgress) => void
  ) {
    const editor = editorRef.current;
    if (!editor) {
      throw new Error('Editor is not ready.');
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
      throw new Error('Select text before rewriting a selection.');
    }
    const request = buildEditorLlmRequest(editorLlm.mode, {
      sectionTitle: section.title,
      sectionIntent: section.intent ?? '',
      markdown,
      instruction: input.prompt,
      targetRange
    });
    const runId = globalThis.crypto.randomUUID();
    setEditorLlm((current) => ({
      ...current,
      runId,
      prompt: input.prompt,
      useKnowledgeSources: input.useKnowledgeSources,
      knowledgeRetrievalPrompt: input.knowledgeRetrievalPrompt,
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
    const unsubscribe = getApi().onLlmStream((event) => {
      if (event.runId !== runId) {
        return;
      }
      if (event.type === 'chunk' || event.type === 'done') {
        const content = event.type === 'done' ? event.content.trim() : event.content;
        const sources = event.type === 'done' ? event.sources ?? input.sources : undefined;
        setEditorLlm((current) => current.runId === runId
          ? {
              ...current,
              output: content,
              retrievedSources: sources ?? current.retrievedSources,
              status: event.type === 'done' ? 'done' : 'running'
            }
          : current
        );
        onProgress({ content, sources });
      }
    });
    const result = await getApi().generateWithLlm({
      runId,
      sectionId: section.id,
      focusSectionId: section.id,
      prompt: request.prompt,
      useKnowledgeSources: input.useKnowledgeSources,
      retrievalMode: input.retrievalMode,
      knowledgeRetrievalPrompt: input.knowledgeRetrievalPrompt,
      prefetchedKnowledgeSources: input.useKnowledgeSources ? input.sources : undefined,
      contextNodeIds: [],
      requireInlineCitations: input.useKnowledgeSources,
      systemPrompt: request.systemPrompt
    }).finally(unsubscribe);
    if (result.canceled) {
      setEditorLlm(emptyEditorLlm);
      return { content: '', sources: [] };
    }
    const content = result.content.trim();
    const sources = result.sources ?? input.sources;
    setEditorLlm((current) => current.runId === runId
      ? {
          ...current,
          output: content,
          retrievedSources: sources,
          status: 'done'
        }
      : current
    );
    return { content, sources };
  }

  async function cancelEditorLlm() {
    if (editorLlm.status === 'running' && editorLlm.runId) {
      await getApi().cancelLlmGeneration(editorLlm.runId);
    }
    setEditorLlm(emptyEditorLlm);
  }

  async function adoptEditorFlowResult(input: LlmFlowAdoptInput) {
    if (!editorLlm.targetRange) {
      throw new Error('No generated edit is ready to apply.');
    }
    const currentMarkdown = editorRef.current?.getValue() ?? draft;
    if (sectionMarkdownForStorage(currentMarkdown) !== sectionMarkdownForStorage(editorLlm.baseMarkdown)) {
      throw new Error('The section changed after this LLM edit was generated. Regenerate before applying it.');
    }
    const next = await getApi().applySectionLlmEdit({
      sectionId: section.id,
      focusSectionId: section.id,
      mode: sectionLlmEditMode(editorLlm.mode),
      userPrompt: input.prompt,
      resolvedPrompt: editorLlm.resolvedPrompt,
      systemPrompt: editorLlm.systemPrompt,
      generatedContent: input.content,
      baseMarkdown: editorLlm.baseMarkdown,
      targetStart: editorLlm.targetRange.startOffset,
      targetEnd: editorLlm.targetRange.endOffset,
      selectedText: editorLlm.selectedText,
      prefixContext: editorLlm.prefixContext,
      suffixContext: editorLlm.suffixContext,
      retrievedSources: input.useKnowledgeSources ? input.sources : [],
      contextNodeIds: []
    });
    onState(next);
    setEditorLlm(emptyEditorLlm);
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
            {editorLlm.open ? (
              <div className="writing-llm-composer">
                <LlmExecutionFlow
                  label={`${editorLlmModeLabel(editorLlm.mode)} · ${editorLlmTargetLabel(editorLlm.mode, editorLlm.targetRange, editorRef.current?.getValue() ?? draft)}`}
                  placeholder={editorLlmPlaceholder(editorLlm.mode)}
                  defaultUseKnowledgeSources={editorLlm.useKnowledgeSources}
                  buildKnowledgeRetrievalPrompt={(prompt) =>
                    buildEditorKnowledgeRetrievalPrompt(editorLlm.mode, {
                      sectionTitle: section.title,
                      sectionIntent: section.intent ?? '',
                      markdown: editorRef.current?.getValue() ?? draft,
                      instruction: prompt,
                      targetRange: editorLlm.targetRange ?? selection
                    })
                  }
                  retrieveSources={retrieveEditorFlowSources}
                  generate={generateEditorFlowResult}
                  onAdopt={adoptEditorFlowResult}
                  onCancel={() => void cancelEditorLlm()}
                />
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
          </div>}
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
    sectionIntent: string;
    markdown: string;
    instruction: string;
    targetRange: EditorSelectionRange;
  }
): {
  prompt: string;
  systemPrompt: string;
  knowledgeRetrievalPrompt: string;
  selectedText: string;
  prefixContext: string;
  suffixContext: string;
} {
  const selectedText = getSelectedText(input.markdown, input.targetRange);
  const prefix = input.markdown.slice(Math.max(0, input.targetRange.startOffset - 2400), input.targetRange.startOffset);
  const suffix = input.markdown.slice(input.targetRange.endOffset, input.targetRange.endOffset + 1600);
  const instruction = input.instruction.trim() || 'No additional requirements.';
  const systemPrompt = editorLlmSystemPrompt(mode);
  const knowledgeRetrievalPrompt = buildEditorKnowledgeRetrievalPrompt(mode, input);

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
      knowledgeRetrievalPrompt,
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
      knowledgeRetrievalPrompt,
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
    knowledgeRetrievalPrompt,
    selectedText,
    prefixContext: prefix,
    suffixContext: suffix
  };
}

function buildEditorKnowledgeRetrievalPrompt(
  mode: EditorLlmMode,
  input: {
    sectionTitle: string;
    sectionIntent: string;
    markdown: string;
    instruction: string;
    targetRange: EditorSelectionRange;
  }
): string {
  const selectedText = getSelectedText(input.markdown, input.targetRange);
  const prefix = input.markdown.slice(Math.max(0, input.targetRange.startOffset - 1600), input.targetRange.startOffset);
  const suffix = input.markdown.slice(input.targetRange.endOffset, input.targetRange.endOffset + 1000);
  const instruction = input.instruction.trim();
  const sections = [
    `Section title: ${input.sectionTitle}`,
    `Section intent: ${input.sectionIntent.trim() || 'Not provided'}`
  ];

  if (instruction) {
    sections.push(`User requirements: ${instruction}`);
  }

  if (mode === 'rewrite-all') {
    sections.push('', 'Markdown section to rewrite:', input.markdown.slice(0, 3000) || '(empty)');
  } else if (mode === 'rewrite-selection') {
    sections.push(
      '',
      'Selected Markdown to rewrite:',
      selectedText || '(empty)',
      '',
      'Nearby context:',
      [prefix, suffix].filter((value) => value.trim()).join('\n\n') || '(none)'
    );
  } else {
    sections.push(
      '',
      'Continue writing at the insertion point.',
      '',
      'Context before insertion:',
      prefix || '(none)',
      '',
      'Context after insertion:',
      suffix || '(none)'
    );
  }

  return sections.join('\n');
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
