
import { useEffect, useState } from 'react';
import { BookOpen, Pencil, Save, Trash2, X } from 'lucide-react';
import { getApi } from '../../api';
import { MarkdownEditor } from '../../components/MarkdownEditor';
import { Button } from '../../components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel
} from '../../components/ui/field';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { formatContentFlags, getGenerationPrompt } from '../../app/formatters';
import type { Selection } from '../../app/types';
import type {
  ContentNodeRecord,
  FocusedWorkspaceState,
  LlmOperationRecord,
  RetrievedKnowledgeSource,
  SectionNodeRecord
} from '../../../shared/types';

type InspectorProps = {
  state: FocusedWorkspaceState;
  focusSection: SectionNodeRecord | null;
  selectedSection: SectionNodeRecord | null;
  selectedContent: ContentNodeRecord | null;
  onState: (state: FocusedWorkspaceState) => void;
  onSelection: (selection: Selection) => void;
  onCitationClick: (publicRef: string) => void;
  onOpenKnowledgeSource: (content: ContentNodeRecord) => void;
  onStatus: (message: string) => void;
  onError: (message: string) => void;
};

export function Inspector(props: InspectorProps) {
  const {
    state,
    focusSection,
    selectedSection,
    selectedContent,
    onState,
    onSelection,
    onCitationClick,
    onOpenKnowledgeSource,
    onStatus,
    onError
  } = props;
  const [contentDraft, setContentDraft] = useState('');
  const [contentTitle, setContentTitle] = useState('');
  const [sectionTitle, setSectionTitle] = useState('');
  const [sectionIntent, setSectionIntent] = useState('');
  const [sectionEditing, setSectionEditing] = useState(false);
  const [saveTimer, setSaveTimer] = useState<number | null>(null);

  useEffect(() => {
    setContentDraft(selectedContent?.content ?? '');
    setContentTitle(selectedContent?.title ?? '');
    setSectionTitle(selectedSection?.title ?? '');
    setSectionIntent(selectedSection?.intent ?? '');
    setSectionEditing(false);
  }, [
    selectedContent?.id,
    selectedContent?.title,
    selectedContent?.content,
    selectedSection?.id,
    selectedSection?.title,
    selectedSection?.intent
  ]);

  function scheduleContentSave(value: string) {
    setContentDraft(value);
    if (saveTimer) {
      window.clearTimeout(saveTimer);
    }
    const timer = window.setTimeout(() => {
      void persistContent({ content: value });
    }, 700);
    setSaveTimer(timer);
  }

  async function persistContent(
    patch: Partial<Pick<ContentNodeRecord, 'title' | 'content' | 'isMain' | 'isLlm'>>
  ) {
    if (!selectedContent) {
      return;
    }
    try {
      await getApi().updateNode(selectedContent.id, patch);
      onState(await getApi().getState(state.focusSectionId ?? undefined));
      onStatus('Content saved.');
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function saveSection() {
    if (!selectedSection || !sectionTitle.trim()) {
      return;
    }
    try {
      await getApi().updateNode(selectedSection.id, {
        title: sectionTitle.trim(),
        intent: sectionIntent
      });
      onState(await getApi().getState(state.focusSectionId ?? undefined));
      setSectionEditing(false);
      onStatus('Section saved.');
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function deleteSection() {
    if (!selectedSection) {
      return;
    }
    try {
      const next = await getApi().deleteNode(selectedSection.id);
      onState(next);
      onSelection(next.focusSectionId ? { type: 'node', id: next.focusSectionId } : null);
      onStatus('Section deleted.');
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function deleteContent() {
    if (!selectedContent) {
      return;
    }
    try {
      await getApi().deleteNode(selectedContent.id);
      onState(await getApi().getState(state.focusSectionId ?? undefined));
      onSelection(focusSection ? { type: 'node', id: focusSection.id } : null);
      onStatus('Content deleted.');
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  const selectedGenerationPrompt = getGenerationPrompt(selectedContent);
  const selectedGenerationSources = getGenerationSources(selectedContent);
  const selectedIsKnowledgeSource = selectedContent?.metadata.nodeRole === 'knowledge-source';
  const selectedSectionLlmSummary = formatSectionLlmOperationSummary(selectedSection);
  const sectionTitleMissing = sectionEditing && !sectionTitle.trim();
  const contentTitleMissing = selectedContent ? !contentTitle.trim() : false;

  return (
    <div className="inspector">
      {selectedSection ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Section</h2>
              <p className="muted">Metadata</p>
            </div>
            {!sectionEditing ? (
              <Button variant="outline" size="sm" onClick={() => setSectionEditing(true)}>
                <Pencil />
                Edit
              </Button>
            ) : null}
          </div>
          {sectionEditing ? (
            <FieldGroup>
              <Field data-invalid={sectionTitleMissing}>
                <FieldLabel htmlFor="inspector-section-title">Title</FieldLabel>
                <Input
                  id="inspector-section-title"
                  value={sectionTitle}
                  onChange={(event) => setSectionTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      void saveSection();
                    }
                  }}
                  aria-invalid={sectionTitleMissing}
                />
                {sectionTitleMissing ? (
                  <FieldError>Section title is required.</FieldError>
                ) : (
                  <FieldDescription>Shown in the outline, canvas, and generated Markdown.</FieldDescription>
                )}
              </Field>
              <Field>
                <FieldLabel htmlFor="inspector-section-intent">Intent</FieldLabel>
                <Textarea
                  id="inspector-section-intent"
                  value={sectionIntent}
                  onChange={(event) => setSectionIntent(event.target.value)}
                  placeholder="Writing intent for this section"
                />
                <FieldDescription>Guide model generation and retrieval for this section.</FieldDescription>
              </Field>
              <div className="button-row">
                <Button size="sm" onClick={() => void saveSection()} disabled={!sectionTitle.trim()}>
                  <Save />
                  Save
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSectionTitle(selectedSection.title);
                    setSectionIntent(selectedSection.intent ?? '');
                    setSectionEditing(false);
                  }}
                >
                  <X />
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => void deleteSection()}
                  disabled={selectedSection.id === state.workspace?.rootNodeId}
                >
                  <Trash2 />
                  Delete
                </Button>
              </div>
            </FieldGroup>
          ) : (
            <div className="metadata-list">
              <MetadataRow label="Title" value={selectedSection.title} />
              <MetadataRow label="Intent" value={selectedSection.intent || 'Not set'} />
              <MetadataRow label="Markdown" value={selectedSection.markdownPath} />
              {selectedSectionLlmSummary ? (
                <MetadataRow label="LLM ops" value={selectedSectionLlmSummary} />
              ) : null}
              <MetadataRow label="Node ID" value={selectedSection.id} />
              <MetadataRow label="Updated" value={selectedSection.updatedAt} />
            </div>
          )}
        </section>
      ) : null}

      {selectedContent ? (
        <section className="panel editor-panel">
          <div className="panel-heading">
            <div>
              <h2>{selectedContent.title}</h2>
              <p className="muted">{formatContentFlags(selectedContent)}</p>
            </div>
            {selectedIsKnowledgeSource ? (
              <Button variant="outline" size="sm" onClick={() => onOpenKnowledgeSource(selectedContent)}>
                <BookOpen />
                Source
              </Button>
            ) : null}
            <Button variant="destructive" size="sm" onClick={() => void deleteContent()}>
              <Trash2 />
              Delete
            </Button>
          </div>
          <Field data-invalid={contentTitleMissing}>
            <FieldLabel htmlFor="inspector-content-title">Title</FieldLabel>
            <Input
              id="inspector-content-title"
              value={contentTitle}
              onChange={(event) => setContentTitle(event.target.value)}
              onBlur={() => void persistContent({ title: contentTitle.trim() || selectedContent.title })}
              aria-invalid={contentTitleMissing}
            />
            {contentTitleMissing ? (
              <FieldError>Blank titles keep the current title when saved.</FieldError>
            ) : (
              <FieldDescription>Used for canvas labels and knowledge source references.</FieldDescription>
            )}
          </Field>
          {selectedGenerationPrompt ? (
            <div className="generation-prompt">
              <span>Input prompt</span>
              <p>{selectedGenerationPrompt}</p>
            </div>
          ) : null}
          {selectedGenerationSources.length > 0 ? (
            <div className="generation-prompt">
              <span>Sources</span>
              {selectedGenerationSources.map((source) => (
                <p key={source.chunkId} className="citation-source-row">
                  <button type="button" onClick={() => onCitationClick(source.publicRef)}>
                    Open
                  </button>
                  [{source.publicRef}] {source.itemTitle}: {source.snippet}
                </p>
              ))}
            </div>
          ) : null}
          <MarkdownEditor
            key={selectedContent.id}
            value={contentDraft}
            onChange={scheduleContentSave}
            onCitationClick={onCitationClick}
            citationSources={selectedGenerationSources}
          />
        </section>
      ) : !selectedSection ? (
        <section className="panel">
          <h2>No selection</h2>
          <p className="muted">Select a node on the canvas or in the outline.</p>
        </section>
      ) : null}
    </div>
  );
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="metadata-row">
      <span>{label}</span>
      <p>{value}</p>
    </div>
  );
}

function getGenerationSources(node: ContentNodeRecord | null): RetrievedKnowledgeSource[] {
  const sources = node?.metadata.retrievedSources;
  if (!Array.isArray(sources)) {
    return [];
  }
  return sources.filter((source): source is RetrievedKnowledgeSource => {
    if (!source || typeof source !== 'object') {
      return false;
    }
    const candidate = source as Partial<RetrievedKnowledgeSource>;
    return Boolean(
      candidate.label &&
      candidate.publicRef &&
      candidate.itemId &&
      candidate.itemPublicRef &&
      candidate.itemTitle &&
      candidate.chunkId &&
      typeof candidate.snippet === 'string' &&
      typeof candidate.score === 'number'
    );
  });
}

function formatSectionLlmOperationSummary(section: SectionNodeRecord | null): string | null {
  const operations = getSectionLlmOperations(section);
  if (operations.length === 0) {
    return null;
  }
  const latest = operations[operations.length - 1];
  return `${operations.length} operation${operations.length === 1 ? '' : 's'} · latest ${latest.status}`;
}

function getSectionLlmOperations(section: SectionNodeRecord | null): LlmOperationRecord[] {
  const operations = section?.metadata.llmOperations;
  if (!Array.isArray(operations)) {
    return [];
  }
  return operations.filter((operation): operation is LlmOperationRecord => {
    if (!operation || typeof operation !== 'object') {
      return false;
    }
    const candidate = operation as Partial<LlmOperationRecord>;
    return Boolean(candidate.operationId && candidate.status && candidate.type);
  });
}
