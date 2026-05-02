
import { Bot, Check, FileText, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select';
import { Textarea } from '../../components/ui/textarea';
import { formatContentFlags, formatContentPreview } from '../../app/formatters';
import type { ContentPreset, LlmDraftState, Selection } from '../../app/types';
import type { ContentNodeRecord, EdgeKind, FocusedWorkspaceState, SectionNodeRecord } from '../../../shared/types';

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
  onDeleteNode,
  onOpenGenerate,
  onPromptChange,
  onContextNodeToggle,
  onGenerate,
  onRegenerate,
  onCancelGenerate,
  onSaveGenerate,
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
  onDeleteNode: () => void;
  onOpenGenerate: (sectionId: string) => void;
  onPromptChange: (value: string) => void;
  onContextNodeToggle: (nodeId: string, checked: boolean) => void;
  onGenerate: (prompt: string, sectionId: string, contextNodeIds: string[]) => void;
  onRegenerate: () => void;
  onCancelGenerate: () => void;
  onSaveGenerate: () => void;
  onUpdateEdgeKind: (relationType: EdgeKind) => void;
  onDeleteEdge: () => void;
}) {
  const generateTargetId = selectedSection?.id ?? selectedContent?.parentId ?? focusSection?.id ?? null;
  const generationComplete = llmDraft.status === 'done' && llmDraft.content.trim().length > 0;
  const generationRunning = llmDraft.status === 'running';
  const generationMessage = llmDraft.content
    ? llmDraft.content
    : generationRunning
      ? 'Waiting for the first token...'
      : llmDraft.error;
  const availableContextNodes = llmDraft.targetSectionId ? contextNodes : [];

  return (
    <div className="floating-action-toolbar" aria-label="Node actions">
      {llmDraft.open ? (
        <div className="floating-generate-composer">
          <Textarea
            value={llmDraft.prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            placeholder="Prompt for a new generation"
            disabled={generationRunning}
          />
          <div className="floating-generation-context">
            <div className="floating-generation-context-heading">
              <span>Context</span>
              <span>{availableContextNodes.length} node{availableContextNodes.length === 1 ? '' : 's'}</span>
            </div>
            {availableContextNodes.length > 0 ? (
              <div className="floating-generation-context-list">
                {availableContextNodes.map((node) => {
                  const checked = llmDraft.contextNodeIds.includes(node.id);
                  const disabled = generationRunning || !node.content.trim();
                  return (
                    <label key={node.id} className="floating-generation-context-item">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={(event) => onContextNodeToggle(node.id, event.target.checked)}
                      />
                      <span>
                        <strong>{node.title}</strong>
                        <em>{formatContentFlags(node)}</em>
                        <small>{formatContentPreview(node)}</small>
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <p>No content nodes in this workspace.</p>
            )}
          </div>
          {generationMessage ? (
            <div className="floating-generation-output">
              {generationMessage}
            </div>
          ) : null}
          <div className="floating-generation-actions">
            <button type="button" title="Cancel generation" onClick={onCancelGenerate}>
              <X />
              <span className="sr-only">Cancel generation</span>
            </button>
            {generationComplete ? (
              <>
                <button type="button" title="Regenerate" onClick={onRegenerate}>
                  <RefreshCw />
                  <span className="sr-only">Regenerate</span>
                </button>
                <button type="button" title="Save generation as content" onClick={onSaveGenerate}>
                  <Check />
                  <span className="sr-only">Save generation as content</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                title="Generate"
                onClick={() => {
                  if (llmDraft.targetSectionId && llmDraft.prompt.trim()) {
                    onGenerate(
                      llmDraft.prompt.trim(),
                      llmDraft.targetSectionId,
                      llmDraft.contextNodeIds
                    );
                  }
                }}
                disabled={generationRunning || !llmDraft.prompt.trim() || !llmDraft.targetSectionId}
              >
                <Bot />
                <span className="sr-only">Generate</span>
              </button>
            )}
          </div>
        </div>
      ) : null}
      <div className="floating-action-buttons">
        {selectedSection ? (
          <>
            <button
              type="button"
              title="Create main content"
              onClick={() => onCreateInSection(selectedSection.id, 'main')}
            >
              <FileText />
              <span className="sr-only">Create main content</span>
            </button>
            <button
              type="button"
              title="Create artifact content"
              onClick={() => onCreateInSection(selectedSection.id, 'artifact')}
            >
              <Plus />
              <span className="sr-only">Create artifact content</span>
            </button>
            <button
              type="button"
              className={llmDraft.open ? 'active' : undefined}
              title="Generate with LLM"
              onClick={() => onOpenGenerate(selectedSection.id)}
            >
              <Bot />
              <span className="sr-only">Generate with LLM</span>
            </button>
          </>
        ) : null}
        {selectedContent ? (
          <>
            <button
              type="button"
              title="Create connected artifact content"
              onClick={() => onCreateConnectedContent(selectedContent.id, 'artifact')}
            >
              <Plus />
              <span className="sr-only">Create connected artifact content</span>
            </button>
            <button
              type="button"
              title="Create connected main content"
              onClick={() => onCreateConnectedContent(selectedContent.id, 'main')}
            >
              <FileText />
              <span className="sr-only">Create connected main content</span>
            </button>
            <button type="button" className="danger" title="Delete content" onClick={onDeleteNode}>
              <Trash2 />
              <span className="sr-only">Delete content</span>
            </button>
            {generateTargetId ? (
              <button
                type="button"
                className={llmDraft.open ? 'active' : undefined}
                title="Generate with LLM"
                onClick={() => onOpenGenerate(generateTargetId)}
              >
                <Bot />
                <span className="sr-only">Generate with LLM</span>
              </button>
            ) : null}
          </>
        ) : null}
        {selectedEdge ? (
          <div className="floating-edge-editor">
            <span>Relation</span>
            <Select value={selectedEdge.relationType} onValueChange={(value) => onUpdateEdgeKind(value as EdgeKind)}>
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="informs">informs</SelectItem>
                <SelectItem value="generates">generates</SelectItem>
                <SelectItem value="revises">revises</SelectItem>
                <SelectItem value="related-to">related-to</SelectItem>
              </SelectContent>
            </Select>
            <button type="button" className="danger edge-delete-button" title="Delete edge" onClick={onDeleteEdge}>
              <Trash2 />
              <span className="sr-only">Delete edge</span>
            </button>
          </div>
        ) : null}
        {!selection ? (
          <button type="button" disabled title="Select a node">
            <Plus />
            <span className="sr-only">Select a node</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
