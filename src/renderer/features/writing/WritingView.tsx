
import { ArrowLeft } from 'lucide-react';
import { LatexEditor } from '../../components/LatexEditor';
import { Button } from '../../components/ui/button';
import { formatContentFlags } from '../../app/formatters';
import type {
  ContentNodeRecord,
  FocusedWorkspaceState,
  RetrievedKnowledgeSource,
  SectionNodeRecord
} from '../../../shared/types';
import { useAutosaveDraft } from './useAutosaveDraft';

export function WritingView({
  contentNode,
  parentSection,
  onCitationClick,
  onBack,
  onState,
  onError
}: {
  contentNode: ContentNodeRecord;
  parentSection: SectionNodeRecord | null;
  onCitationClick: (publicRef: string) => void;
  onBack: () => Promise<void>;
  onState: (state: FocusedWorkspaceState) => void;
  onError: (message: string) => void;
}) {
  const { draft, saveState, scheduleDraftSave, flushPendingSave } = useAutosaveDraft({
    contentNode,
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
          <p>{parentSection?.title ?? 'Section'}</p>
          <h1>{contentNode.title}</h1>
        </div>
        <div className="writing-view-meta" aria-live="polite">
          <span>{formatContentFlags(contentNode)}</span>
          <span>{saveState === 'saving' ? 'Saving' : saveState === 'error' ? 'Save failed' : 'Saved'}</span>
        </div>
      </header>
      <div className="writing-view-body">
        <div className="writing-editor-shell">
          <LatexEditor
            key={contentNode.id}
            value={draft}
            onChange={scheduleDraftSave}
            onCitationClick={onCitationClick}
            citationSources={getGenerationSources(contentNode)}
          />
        </div>
      </div>
    </section>
  );
}

function getGenerationSources(node: ContentNodeRecord): RetrievedKnowledgeSource[] {
  const sources = node.metadata.retrievedSources;
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
