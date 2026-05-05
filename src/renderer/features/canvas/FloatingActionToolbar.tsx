
import { NotebookPen, PlusCircle, Trash2, WandSparkles } from 'lucide-react';
import { getApi } from '../../api';
import {
  Field,
  FieldLabel
} from '../../components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select';
import {
  LlmExecutionFlow,
  type LlmFlowAdoptInput,
  type LlmFlowGenerateInput,
  type LlmFlowGenerateProgress
} from '../llm/LlmExecutionFlow';
import type { ContentPreset, LlmDraftState, Selection } from '../../app/types';
import type {
  ContentNodeRecord,
  EdgeKind,
  FocusedWorkspaceState,
  RetrievedKnowledgeSource,
  SectionNodeRecord
} from '../../../shared/types';

export function FloatingActionToolbar({
  selection,
  selectedSection,
  selectedContent,
  selectedEdge,
  focusSection,
  llmDraft,
  contextNodes,
  onCreateInSection,
  onCreateConnectedContent,
  onOpenSectionMarkdown,
  onDeleteNode,
  onOpenGenerate,
  onCancelGenerate,
  onAdoptGenerate,
  onUpdateEdgeKind,
  onDeleteEdge
}: {
  selection: Selection;
  selectedSection: SectionNodeRecord | null;
  selectedContent: ContentNodeRecord | null;
  selectedEdge: FocusedWorkspaceState['edges'][number] | null;
  focusSection: SectionNodeRecord | null;
  llmDraft: LlmDraftState;
  contextNodes: ContentNodeRecord[];
  onCreateInSection: (sectionId: string, preset: ContentPreset) => void;
  onCreateConnectedContent: (nodeId: string, preset: ContentPreset) => void;
  onOpenSectionMarkdown: (section: SectionNodeRecord) => void;
  onDeleteNode: () => void;
  onOpenGenerate: (sectionId: string) => void;
  onCancelGenerate: () => void;
  onAdoptGenerate: (payload: {
    sectionId: string;
    prompt: string;
    content: string;
    contextNodeIds: string[];
    retrievedSources: RetrievedKnowledgeSource[];
  }) => Promise<void>;
  onUpdateEdgeKind: (relationType: EdgeKind) => void;
  onDeleteEdge: () => void;
}) {
  const generateTargetId = selectedSection?.id ?? selectedContent?.parentId ?? focusSection?.id ?? null;
  const generationTarget = selectedSection?.id === generateTargetId ? selectedSection : focusSection;
  const focusSectionId = focusSection?.id ?? generateTargetId;

  async function retrieveFlowSources(knowledgeRetrievalPrompt: string): Promise<RetrievedKnowledgeSource[]> {
    if (!generateTargetId) {
      throw new Error('Choose a section before generating.');
    }
    return getApi().searchKnowledge({
      query: knowledgeRetrievalPrompt,
      sectionId: generateTargetId,
      focusSectionId,
      contextNodeIds: llmDraft.contextNodeIds,
      maxChunks: 10
    });
  }

  async function generateFlowResult(
    input: LlmFlowGenerateInput,
    onProgress: (progress: LlmFlowGenerateProgress) => void
  ) {
    if (!generateTargetId) {
      throw new Error('Choose a section before generating.');
    }
    const runId = globalThis.crypto.randomUUID();
    const unsubscribe = getApi().onLlmStream((event) => {
      if (event.runId !== runId) {
        return;
      }
      if (event.type === 'chunk') {
        onProgress({ content: event.content });
        return;
      }
      if (event.type === 'done') {
        onProgress({ content: event.content.trim(), sources: event.sources ?? input.sources });
      }
    });
    const result = await getApi().generateWithLlm({
      runId,
      sectionId: generateTargetId,
      focusSectionId,
      prompt: input.prompt,
      useKnowledgeSources: input.useKnowledgeSources,
      knowledgeRetrievalPrompt: input.knowledgeRetrievalPrompt,
      contextNodeIds: llmDraft.contextNodeIds,
      prefetchedKnowledgeSources: input.useKnowledgeSources ? input.sources : undefined,
      maxKnowledgeChunks: 10,
      requireInlineCitations: input.useKnowledgeSources
    }).finally(unsubscribe);
    const content = result.content.trim();
    const sources = result.sources ?? input.sources;
    onProgress({ content, sources });
    return { content, sources };
  }

  async function adoptFlowResult(input: LlmFlowAdoptInput): Promise<void> {
    if (!generateTargetId) {
      throw new Error('Choose a section before generating.');
    }
    await onAdoptGenerate({
      sectionId: generateTargetId,
      prompt: input.prompt,
      content: input.content,
      contextNodeIds: llmDraft.contextNodeIds,
      retrievedSources: input.useKnowledgeSources ? input.sources : []
    });
  }

  return (
    <div className="floating-action-toolbar" aria-label="Node actions">
      {llmDraft.open ? (
        <div className="floating-generate-composer">
          <LlmExecutionFlow
            label="Generate with LLM"
            placeholder="Prompt for a new generation"
            defaultUseKnowledgeSources={llmDraft.useKnowledgeSources}
            buildKnowledgeRetrievalPrompt={(prompt) =>
              buildCanvasKnowledgeRetrievalPrompt(prompt, generationTarget, contextNodes, llmDraft.contextNodeIds)
            }
            retrieveSources={retrieveFlowSources}
            generate={generateFlowResult}
            onAdopt={adoptFlowResult}
            onCancel={onCancelGenerate}
          />
        </div>
      ) : null}
      <div className="floating-action-buttons">
        {selectedSection ? (
          <>
            <button
              type="button"
              title="Edit Markdown"
              aria-label="Edit Markdown"
              onClick={() => onOpenSectionMarkdown(selectedSection)}
            >
              <NotebookPen />
              <span className="sr-only">Edit Markdown</span>
            </button>
            <button
              type="button"
              className={llmDraft.open ? 'active' : undefined}
              title="Generate with LLM"
              aria-label="Generate with LLM"
              onClick={() => onOpenGenerate(selectedSection.id)}
            >
              <WandSparkles />
              <span className="sr-only">Generate with LLM</span>
            </button>
          </>
        ) : null}
        {selectedContent ? (
          <>
            {generateTargetId ? (
              <button
                type="button"
                className={llmDraft.open ? 'active' : undefined}
                title="Generate with LLM"
                aria-label="Generate with LLM"
                onClick={() => onOpenGenerate(generateTargetId)}
              >
                <WandSparkles />
                <span className="sr-only">Generate with LLM</span>
              </button>
            ) : null}
            <button
              type="button"
              className="danger"
              title="Delete content"
              aria-label="Delete content"
              onClick={onDeleteNode}
            >
              <Trash2 />
              <span className="sr-only">Delete content</span>
            </button>
          </>
        ) : null}
        {selectedEdge ? (
          <div className="floating-edge-editor">
            <Field orientation="horizontal" className="floating-edge-field">
              <FieldLabel htmlFor="floating-edge-relation">Relation</FieldLabel>
              <Select value={selectedEdge.relationType} onValueChange={(value) => onUpdateEdgeKind(value as EdgeKind)}>
                <SelectTrigger id="floating-edge-relation" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="informs">informs</SelectItem>
                  <SelectItem value="generates">generates</SelectItem>
                  <SelectItem value="revises">revises</SelectItem>
                  <SelectItem value="related-to">related-to</SelectItem>
                  <SelectItem value="cites">cites</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <button type="button" className="danger edge-delete-button" title="Delete edge" onClick={onDeleteEdge}>
              <Trash2 />
              <span className="sr-only">Delete edge</span>
            </button>
          </div>
        ) : null}
        {!selection ? (
          <button type="button" disabled title="Select a node" aria-label="Select a node">
            <PlusCircle />
            <span className="sr-only">Select a node</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

function buildCanvasKnowledgeRetrievalPrompt(
  prompt: string,
  targetSection: SectionNodeRecord | null,
  contextNodes: ContentNodeRecord[],
  selectedContextNodeIds: string[]
): string {
  const selectedIds = new Set(selectedContextNodeIds);
  const selectedContext = contextNodes
    .filter((node) => selectedIds.has(node.id))
    .map((node) => `${node.title}\n${node.content.trim().slice(0, 900)}`)
    .filter((text) => text.trim())
    .join('\n\n---\n\n');
  return [
    `Section title: ${targetSection?.title ?? 'Untitled section'}`,
    `Section intent: ${targetSection?.intent?.trim() || 'Not provided'}`,
    `User prompt: ${prompt}`,
    selectedContext ? `Selected context:\n${selectedContext}` : null
  ].filter(Boolean).join('\n\n');
}
