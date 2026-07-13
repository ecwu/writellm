import { FileText, FolderPlus, X } from 'lucide-react';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { EmptyState } from '@/components/patterns/EmptyState';
import { StatusNotice } from '@/components/patterns/StatusNotice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import type { SourceSummary, SourcesApi } from '../../../shared/sources';
import { SourceDetail } from './SourceDetail';
import { createSourceLibraryState, loadSourceLibrary, sourceLibraryReducer } from './source-state';

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
    <section className="grid min-w-0 gap-4 p-4" aria-labelledby="source-library-title">
      <header className="flex flex-wrap items-start justify-between gap-4 [&_h2]:m-0 [&_p]:m-0">
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
        <ul className="m-0 grid list-none gap-2.5 p-0" aria-label="Pending imports">
          {state.candidates.map((candidate) => (
            <li
              key={candidate.candidateId}
              className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-l-4 border-primary bg-card p-3 text-left"
            >
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
        <div className="grid gap-2.5">
          {state.sources.map((source) => (
            <Button
              key={source.sourceId}
              type="button"
              variant="ghost"
              className={cn(
                'grid h-auto min-h-11 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center justify-normal gap-3 border border-border bg-card p-3 text-left hover:bg-accent [&_progress]:col-[2/-1] [&_progress]:w-full',
                source.state === 'failed'
                  ? 'border-l-4 border-l-destructive'
                  : source.state === 'partial'
                    ? 'border-l-4 border-l-primary border-l-dashed'
                    : source.state === 'queued' ||
                        source.state === 'parsing' ||
                        source.state === 'indexing'
                      ? 'border-l-4 border-l-primary'
                      : undefined,
              )}
              onClick={() => {
                setSelected(source);
                onSelect?.(source);
              }}
            >
              <FileText aria-hidden="true" />
              <span className="grid min-w-0">
                <strong className="truncate">{source.displayName}</strong>
                <span>{stageLabel(source)}</span>
                {source.retrying && <span>Retrying failed work…</span>}
              </span>
              <Badge>{source.state}</Badge>
              <progress
                value={source.progress.completed}
                max={Math.max(1, source.progress.total)}
                aria-label={`${source.displayName} processing progress`}
              />
            </Button>
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
