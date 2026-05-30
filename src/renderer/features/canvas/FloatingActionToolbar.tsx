import { useState } from 'react';
import { NotebookPen, PlusCircle, Trash2, WandSparkles } from 'lucide-react';
import { getApi } from '../../api';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Spinner } from '../../components/ui/spinner';
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
import type { ContentPreset, LlmDraftState, Selection } from '../../app/types';
import type {
  ContentNodeRecord,
  EdgeKind,
  FocusedWorkspaceState,
  SectionNodeRecord
} from '../../../shared/types';

export function FloatingActionToolbar({
  selection,
  selectedSection,
  selectedContent,
  selectedEdge,
  focusSection,
  llmDraft,
  onCreateInSection,
  onCreateConnectedContent,
  onOpenSectionMarkdown,
  onDeleteNode,
  onOpenGenerate,
  onCancelGenerate,
  onUpdateEdgeKind,
  onDeleteEdge
}: {
  selection: Selection;
  selectedSection: SectionNodeRecord | null;
  selectedContent: ContentNodeRecord | null;
  selectedEdge: FocusedWorkspaceState['edges'][number] | null;
  focusSection: SectionNodeRecord | null;
  llmDraft: LlmDraftState;
  onCreateInSection: (sectionId: string, preset: ContentPreset) => void;
  onCreateConnectedContent: (nodeId: string, preset: ContentPreset) => void;
  onOpenSectionMarkdown: (section: SectionNodeRecord) => void;
  onDeleteNode: () => void;
  onOpenGenerate: (sectionId: string) => void;
  onCancelGenerate: () => void;
  onUpdateEdgeKind: (relationType: EdgeKind) => void;
  onDeleteEdge: () => void;
}) {
  const [canvasPrompt, setCanvasPrompt] = useState('');
  const [canvasUseKnowledge, setCanvasUseKnowledge] = useState(true);
  const [canvasSubmitting, setCanvasSubmitting] = useState(false);
  const [canvasStatus, setCanvasStatus] = useState<string | null>(null);
  const [canvasError, setCanvasError] = useState<string | null>(null);
  const generateTargetId = selectedSection?.id ?? selectedContent?.parentId ?? focusSection?.id ?? null;
  const focusSectionId = focusSection?.id ?? generateTargetId;

  async function enqueueCanvasGeneration() {
    if (!generateTargetId || !canvasPrompt.trim() || canvasSubmitting) {
      return;
    }
    setCanvasSubmitting(true);
    setCanvasStatus(null);
    setCanvasError(null);
    try {
      const result = await getApi().createGenerationTask({
        sectionId: generateTargetId,
        focusSectionId,
        mode: 'append',
        prompt: canvasPrompt,
        useKnowledgeSources: canvasUseKnowledge,
        contextNodeIds: llmDraft.contextNodeIds,
        requireInlineCitations: canvasUseKnowledge
      });
      setCanvasPrompt('');
      setCanvasStatus(result.executionMode === 'interactive' ? 'Suggestion started. It will appear in Assist.' : 'Suggestion queued. It will appear in Assist.');
    } catch (caught) {
      setCanvasError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setCanvasSubmitting(false);
    }
  }

  return (
    <div className="floating-action-toolbar" aria-label="Node actions">
      {llmDraft.open ? (
        <div className="floating-generate-composer">
          <div className="canvas-generation-task-creator">
            <Input
              value={canvasPrompt}
              onChange={(event) => setCanvasPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !canvasSubmitting) {
                  void enqueueCanvasGeneration();
                }
              }}
              placeholder="Ask for a writing suggestion"
              disabled={canvasSubmitting}
            />
            <label>
              <input
                type="checkbox"
                checked={canvasUseKnowledge}
                onChange={(event) => setCanvasUseKnowledge(event.target.checked)}
                disabled={canvasSubmitting}
              />
              <span>Sources</span>
            </label>
            <div className="button-row">
              <Button size="sm" onClick={() => void enqueueCanvasGeneration()} disabled={!canvasPrompt.trim() || canvasSubmitting}>
                {canvasSubmitting ? <Spinner /> : null}
                {canvasSubmitting ? 'Starting' : 'Suggest'}
              </Button>
              <Button variant="outline" size="sm" onClick={onCancelGenerate}>
                Cancel
              </Button>
            </div>
            {canvasStatus ? <p className="floating-generation-status">{canvasStatus}</p> : null}
            {canvasError ? <p className="floating-generation-status is-error">{canvasError}</p> : null}
          </div>
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
              title="Writing assist"
              aria-label="Writing assist"
              onClick={() => onOpenGenerate(selectedSection.id)}
            >
              <WandSparkles />
              <span className="sr-only">Writing assist</span>
            </button>
          </>
        ) : null}
        {selectedContent ? (
          <>
            {generateTargetId ? (
              <button
                type="button"
                className={llmDraft.open ? 'active' : undefined}
                title="Writing assist"
                aria-label="Writing assist"
                onClick={() => onOpenGenerate(generateTargetId)}
              >
                <WandSparkles />
                <span className="sr-only">Writing assist</span>
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
