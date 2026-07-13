import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { EmptyState } from '@/components/patterns/EmptyState';
import { StatusNotice } from '@/components/patterns/StatusNotice';
import type { SourcesApi } from '../../../shared/sources';
import { WorkspaceDetail } from '../../workspace/components/WorkspaceDetail';
import { WorkspaceLocationHeader } from '../../workspace/components/WorkspaceLocationHeader';
import { KnowledgeBaseNavigationList } from './KnowledgeBaseNavigationList';
import { SourceDetail } from './SourceDetail';
import {
  createSourceLibraryState,
  loadSourceLibrary,
  projectSourceNavigationItems,
  type SourceLibraryAction,
  type SourceLibraryState,
  sourceLibraryReducer,
} from './source-state';

export function KnowledgeBaseWorkspace({
  api,
  projectName,
  onItemActivated,
  onBack,
  library,
  onOpenSettings,
}: {
  api: SourcesApi;
  projectName: string;
  onItemActivated?(): void;
  onBack?(): void;
  onOpenSettings?(): void;
  library?: {
    state: SourceLibraryState;
    dispatch(action: SourceLibraryAction): void;
    reload(): void;
  };
}) {
  const [localState, localDispatch] = useReducer(
    sourceLibraryReducer,
    undefined,
    createSourceLibraryState,
  );
  const state = library?.state ?? localState;
  const dispatch = library?.dispatch ?? localDispatch;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const alive = useRef(true);
  const reload = useCallback(async () => {
    if (library) {
      library.reload();
      return;
    }
    dispatch({ type: 'load.start' });
    const action = await loadSourceLibrary(api);
    if (alive.current) dispatch(action);
  }, [api, dispatch, library]);
  useEffect(() => {
    if (library) return;
    alive.current = true;
    void reload();
    const unsubscribe = api.subscribeSourceEvents({ afterSequence: 0 }, (event) =>
      dispatch({ type: 'event', event }),
    );
    return () => {
      alive.current = false;
      unsubscribe();
    };
  }, [api, dispatch, library, reload]);
  useEffect(() => {
    if (state.needsResync) void reload();
  }, [reload, state.needsResync]);
  useEffect(() => {
    if (selectedId && !state.sources.some((source) => source.sourceId === selectedId)) {
      setSelectedId(null);
      onBack?.();
    }
  }, [onBack, selectedId, state.sources]);
  const selected = state.sources.find((source) => source.sourceId === selectedId) ?? null;
  const importSources = async () => {
    dispatch({ type: 'import.start' });
    setNotice('');
    try {
      const result = await api.importSourcesFromDialog({
        expectedCatalogRevision: state.catalogRevision,
      });
      if (result.status === 'accepted') {
        dispatch({ type: 'import.finish', outcomes: result.outcomes });
        setNotice(
          result.outcomes.some((item) => item.status === 'rejected')
            ? 'Some selected PDFs could not be imported. Review the source list and try those files again.'
            : 'Import queued. You can keep writing while processing continues.',
        );
        void reload();
      } else if (result.status !== 'canceled') {
        setNotice(
          result.status === 'error'
            ? 'PDFs could not be imported safely. Review Settings or try again.'
            : 'The source list changed. Reload and try again.',
        );
      }
    } catch {
      setNotice('PDF import could not be started. Check the connection and try again.');
    } finally {
      dispatch({ type: 'import.finish', outcomes: [] });
    }
  };
  return (
    <div
      className="workspace-owner-pane grid h-full min-h-0 min-w-0 grid-cols-[minmax(0,17.875rem)_minmax(0,1fr)] group-data-[sidebar-expanded=false]/workspace:grid-cols-[0_minmax(0,1fr)] max-[719px]:grid-cols-1"
      data-owner="knowledge-base"
    >
      <aside
        className="workspace-owner-context flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-sidebar-border bg-sidebar max-[719px]:col-start-1 max-[719px]:row-start-1 max-[719px]:group-data-[compact-pane=detail]/workspace:invisible max-[719px]:group-data-[compact-pane=detail]/workspace:pointer-events-none"
        aria-label="Knowledge Base navigation"
      >
        <div className="min-h-0 flex-1">
          <KnowledgeBaseNavigationList
            items={projectSourceNavigationItems(state.sources)}
            selectedId={selectedId}
            importing={state.importing}
            onSelect={(id) => {
              setSelectedId(id);
              onItemActivated?.();
            }}
            onImport={() => void importSources()}
          />
        </div>
        <div className="shrink-0 border-t border-sidebar-border px-3 py-2">
          {state.phase === 'error' && (
            <StatusNotice tone="error">
              Sources are unavailable. Retry loading this project.
            </StatusNotice>
          )}
          {notice && <StatusNotice tone="info">{notice}</StatusNotice>}
        </div>
      </aside>
      <div className="flex min-h-0 min-w-0 overflow-hidden bg-background max-[719px]:col-start-1 max-[719px]:row-start-1 max-[719px]:group-data-[compact-pane=list]/workspace:invisible max-[719px]:group-data-[compact-pane=list]/workspace:pointer-events-none">
        <WorkspaceDetail label="Knowledge Base detail">
          <WorkspaceLocationHeader
            project={projectName}
            category="Knowledge Base"
            item={selected?.displayName}
            showBack
            onBack={onBack}
          />
          {selected ? (
            <SourceDetail
              api={api}
              source={selected}
              onBack={() => {
                setSelectedId(null);
                onBack?.();
              }}
              onOpenSettings={onOpenSettings}
            />
          ) : (
            <EmptyState
              title={state.phase === 'loading' ? 'Loading sources…' : 'Choose a source'}
              description={
                state.sources.length
                  ? 'Select a source to inspect processing, content, and search eligibility.'
                  : 'Import a PDF to build this project’s knowledge base.'
              }
            />
          )}
        </WorkspaceDetail>
      </div>
    </div>
  );
}
