
import { ArrowLeft } from 'lucide-react';
import { MarkdownEditor } from '../../components/MarkdownEditor';
import { Button } from '../../components/ui/button';
import { sectionMarkdownForStorage } from '../../../shared/sectionMarkdown';
import type {
  FocusedWorkspaceState,
  RetrievedKnowledgeSource,
  SectionNodeRecord
} from '../../../shared/types';
import { useAutosaveDraft } from './useAutosaveDraft';

export function WritingView({
  section,
  onCitationClick,
  onBack,
  onState,
  onError
}: {
  section: SectionNodeRecord;
  onCitationClick: (publicRef: string) => void;
  onBack: () => Promise<void>;
  onState: (state: FocusedWorkspaceState) => void;
  onError: (message: string) => void;
}) {
  const { draft, saveState, scheduleDraftSave, flushPendingSave } = useAutosaveDraft({
    section,
    onState,
    onError
  });

  async function handleBack() {
    await flushPendingSave();
    await onBack();
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
      </header>
      <div className="writing-view-body">
        <div className="writing-editor-shell">
          <MarkdownEditor
            key={section.id}
            value={draft}
            onChange={scheduleDraftSave}
            normalizeValue={sectionMarkdownForStorage}
            onCitationClick={onCitationClick}
            citationSources={getSectionSources(section)}
          />
        </div>
      </div>
    </section>
  );
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
