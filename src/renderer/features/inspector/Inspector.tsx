
import { useEffect, useState } from 'react';
import { Save, Trash2 } from 'lucide-react';
import { getApi } from '../../api';
import { LatexEditor } from '../../components/LatexEditor';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Textarea } from '../../components/ui/textarea';
import { formatContentFlags, getGenerationPrompt } from '../../app/formatters';
import type { Selection } from '../../app/types';
import type { ContentNodeRecord, FocusedWorkspaceState, SectionNodeRecord } from '../../../shared/types';

type InspectorProps = {
  state: FocusedWorkspaceState;
  focusSection: SectionNodeRecord | null;
  selectedSection: SectionNodeRecord | null;
  selectedContent: ContentNodeRecord | null;
  onState: (state: FocusedWorkspaceState) => void;
  onSelection: (selection: Selection) => void;
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
    onStatus,
    onError
  } = props;
  const [contentDraft, setContentDraft] = useState('');
  const [contentTitle, setContentTitle] = useState('');
  const [sectionTitle, setSectionTitle] = useState('');
  const [sectionIntent, setSectionIntent] = useState('');
  const [saveTimer, setSaveTimer] = useState<number | null>(null);

  useEffect(() => {
    setContentDraft(selectedContent?.content ?? '');
    setContentTitle(selectedContent?.title ?? '');
    setSectionTitle(selectedSection?.title ?? '');
    setSectionIntent(selectedSection?.intent ?? '');
  }, [selectedContent?.id, selectedSection?.id]);

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
    patch: Partial<Pick<ContentNodeRecord, 'title' | 'content' | 'isMain' | 'isLlm' | 'isArtifact'>>
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

  async function setActiveMain() {
    if (!selectedContent) {
      return;
    }
    try {
      onState(await getApi().setActiveMainNode(selectedContent.parentId, selectedContent.id));
      onStatus('Active main content updated.');
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  const selectedGenerationPrompt = getGenerationPrompt(selectedContent);

  return (
    <div className="inspector">
      {selectedSection ? (
        <section className="panel">
          <h2>Section</h2>
          <p className="muted">Section</p>
          <label className="field-label">
            Title
            <Input
              value={sectionTitle}
              onChange={(event) => setSectionTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void saveSection();
                }
              }}
            />
          </label>
          <label className="field-label">
            Intent
            <Textarea
              value={sectionIntent}
              onChange={(event) => setSectionIntent(event.target.value)}
              placeholder="Writing intent for this section"
            />
          </label>
          <div className="button-row">
            <Button size="sm" onClick={() => void saveSection()} disabled={!sectionTitle.trim()}>
              <Save />
              Save
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
        </section>
      ) : null}

      {selectedContent ? (
        <section className="panel editor-panel">
          <div className="artifact-heading">
            <div>
              <h2>{selectedContent.title}</h2>
              <p className="muted">{formatContentFlags(selectedContent)}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void setActiveMain()}
              disabled={state.nodes.some(
                (node) =>
                  node.kind === 'section' &&
                  node.id === selectedContent.parentId &&
                  node.activeMainNodeId === selectedContent.id
              )}
            >
              Main
            </Button>
            <Button variant="destructive" size="sm" onClick={() => void deleteContent()}>
              <Trash2 />
              Delete
            </Button>
          </div>
          <label className="field-label">
            Title
            <Input
              value={contentTitle}
              onChange={(event) => setContentTitle(event.target.value)}
              onBlur={() => void persistContent({ title: contentTitle.trim() || selectedContent.title })}
            />
          </label>
          <div className="button-row">
            <label className="inline-flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={selectedContent.isMain}
                onChange={(event) => void persistContent({ isMain: event.target.checked })}
              />
              Main candidate
            </label>
            <label className="inline-flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={selectedContent.isArtifact}
                onChange={(event) => void persistContent({ isArtifact: event.target.checked })}
              />
              Artifact
            </label>
            <label className="inline-flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={selectedContent.isLlm}
                onChange={(event) => void persistContent({ isLlm: event.target.checked })}
              />
              LLM
            </label>
          </div>
          {selectedGenerationPrompt ? (
            <div className="artifact-prompt">
              <span>Input prompt</span>
              <p>{selectedGenerationPrompt}</p>
            </div>
          ) : null}
          <LatexEditor
            key={selectedContent.id}
            value={contentDraft}
            onChange={scheduleContentSave}
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
