import { FileText, FolderPlus, X } from 'lucide-react';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { EmptyState } from '@/components/patterns/EmptyState';
import { StatusNotice } from '@/components/patterns/StatusNotice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { SourceSummary, SourcesApi } from '../../../shared/sources';
import { SourceDetail } from './SourceDetail';
import { createSourceLibraryState, loadSourceLibrary, sourceLibraryReducer } from './source-state';
import './source-library.css';

export function SourceLibrary({
  api,
  onSelect,
}: {
  api: SourcesApi;
  onSelect?: (source: SourceSummary) => void;
}) {
  const [state, dispatch] = useReducer(sourceLibraryReducer, undefined, createSourceLibraryState);
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<SourceSummary | null>(null);
  const alive = useRef(true);
  const reload = useCallback(async () => {
    dispatch({ type: 'load.start' });
    const action = await loadSourceLibrary(api);
    if (alive.current) dispatch(action);
  }, [api]);
  useEffect(() => {
    alive.current = true;
    void reload();
    const unsubscribe = api.subscribeSourceEvents({ afterSequence: 0 }, (event) =>
      dispatch({ type: 'event', event }),
    );
    return () => {
      alive.current = false;
      unsubscribe();
    };
  }, [api, reload]);
  useEffect(() => {
    if (state.needsResync) void reload();
  }, [state.needsResync, reload]);

  const importSources = async () => {
    dispatch({ type: 'import.start' });
    setNotice('');
    const result = await api.importSourcesFromDialog({
      expectedCatalogRevision: state.catalogRevision,
    });
    if (result.status === 'accepted') {
      dispatch({ type: 'import.finish', outcomes: result.outcomes });
      const rejected = result.outcomes.filter((outcome) => outcome.status === 'rejected').length;
      setNotice(
        rejected
          ? `${rejected} selected file${rejected === 1 ? '' : 's'} could not be imported.`
          : 'Import queued. You can keep writing while sources are processed.',
      );
    } else {
      dispatch({ type: 'import.finish', outcomes: [] });
      if (result.status !== 'canceled')
        setNotice('The source selection changed. Reload and try again.');
    }
  };

  if (selected)
    return <SourceDetail api={api} source={selected} onBack={() => setSelected(null)} />;
  return (
    <section className="source-library" aria-labelledby="source-library-title">
      <header className="source-library__header">
        <div>
          <h2 id="source-library-title">Source library</h2>
          <p>Import PDFs for background processing and indexing.</p>
        </div>
        <Button busy={state.importing} onClick={() => void importSources()}>
          <FolderPlus aria-hidden="true" /> Import PDFs
        </Button>
      </header>
      {notice && <StatusNotice tone="info">{notice}</StatusNotice>}
      {state.phase === 'error' && (
        <StatusNotice tone="error">
          Sources are unavailable. Reload the project and try again.
        </StatusNotice>
      )}
      {state.candidates.length > 0 && (
        <ul className="source-library__candidates" aria-label="Pending imports">
          {state.candidates.map((candidate) => (
            <li key={candidate.candidateId} className="source-card source-card--queued">
              <FileText aria-hidden="true" />
              <div>
                <strong>{candidate.displayName}</strong>
                <p>
                  {candidate.status === 'possible-duplicate'
                    ? 'Checking possible duplicate…'
                    : 'Preparing import…'}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Cancel import of ${candidate.displayName}`}
                onClick={() =>
                  void api.removeSource({
                    target: 'candidate',
                    candidateId: candidate.candidateId,
                    expectedCatalogRevision: state.catalogRevision,
                  })
                }
              >
                <X aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {state.phase === 'loading' && state.sources.length === 0 ? (
        <p role="status">Loading sources…</p>
      ) : state.sources.length === 0 && state.candidates.length === 0 ? (
        <EmptyState
          title="No sources yet"
          description="Import one or more PDFs to build this project's source library."
        />
      ) : (
        <div className="source-library__list">
          {state.sources.map((source) => (
            <button
              key={source.sourceId}
              type="button"
              className={`source-card source-card--${source.state}`}
              onClick={() => {
                setSelected(source);
                onSelect?.(source);
              }}
            >
              <FileText aria-hidden="true" />
              <span className="source-card__content">
                <strong>{source.displayName}</strong>
                <span>{stageLabel(source)}</span>
                {source.retrying && <span>Retrying failed work…</span>}
              </span>
              <Badge>{source.state}</Badge>
              <progress
                value={source.progress.completed}
                max={Math.max(1, source.progress.total)}
                aria-label={`${source.displayName} processing progress`}
              />
            </button>
          ))}
        </div>
      )}
      {state.nextCursor && (
        <Button
          variant="secondary"
          onClick={async () => dispatch(await loadSourceLibrary(api, state.nextCursor))}
        >
          Load more
        </Button>
      )}
    </section>
  );
}

function stageLabel(source: SourceSummary): string {
  if (source.state === 'available') return `${source.eligibility.indexed} searchable blocks`;
  if (source.state === 'partial')
    return `${source.eligibility.indexed} of ${source.eligibility.eligible} blocks searchable`;
  if (source.state === 'failed') return 'Processing failed — review details';
  return `${source.progress.stage}: ${source.progress.completed} of ${source.progress.total}`;
}
