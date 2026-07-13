import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import type { ChapterApi, ChapterDocument } from '../shared/chapters';
import { CHAPTER_KIND, CHAPTER_SCHEMA_VERSION } from '../shared/chapters';
import type { ProjectSnapshot } from '../shared/project';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Label } from './components/ui/label';
import { openChapterSession } from './features/editor/chapter-session';
import { ChapterEditor } from './features/editor/components/ChapterEditor';
import { KnowledgeBaseWorkspace } from './features/sources/KnowledgeBaseWorkspace';
import {
  createSourceLibraryState,
  loadSourceLibrary,
  sourceLibraryReducer,
} from './features/sources/source-state';
import { WritingOrientationPanel } from './features/writing-orientation/WritingOrientationPanel';
import { LaunchPage } from './launch/LaunchPage';
import { SettingsArea } from './workspace/components/SettingsArea';
import { WorkspaceDetail } from './workspace/components/WorkspaceDetail';
import type { WorkspaceLeaveGuard } from './workspace/WorkspaceShell';
import { WorkspaceShell } from './workspace/WorkspaceShell';

const runtimeChapter: ChapterDocument = {
  kind: CHAPTER_KIND,
  schemaVersion: CHAPTER_SCHEMA_VERSION,
  projectId: '00000000-0000-4000-8000-000000000001',
  chapterId: '00000000-0000-4000-8000-000000000002',
  outlineItemId: '00000000-0000-4000-8000-000000000003',
  revision: 0,
  editorFormat: 'blocknote-json',
  editorSchemaVersion: 1,
  blocks: [
    {
      id: 'runtime-block',
      type: 'paragraph',
      props: {},
      content: [{ type: 'text', text: 'Compiled BlockNote runtime', styles: {} }],
      children: [],
    },
  ],
  citations: [],
  createdAt: '2026-07-12T00:00:00.000Z',
  updatedAt: '2026-07-12T00:00:00.000Z',
};
const runtimeChapterApi: ChapterApi = {
  openForOutlineItem: async () => ({
    ok: true,
    value: { document: runtimeChapter, created: false },
  }),
  load: async () => ({ ok: true, value: runtimeChapter }),
  save: async () => ({ ok: true, value: { document: { ...runtimeChapter, revision: 1 } } }),
  previewMarkdownExport: async () => ({
    ok: true,
    value: {
      previewId: '00000000-0000-4000-8000-000000000004',
      markdown: 'Compiled BlockNote runtime\n',
      warnings: [],
      expiresAt: '2099-01-01T00:00:00.000Z',
    },
  }),
  exportMarkdown: async () => ({ ok: true, value: { status: 'canceled' } }),
};

export function App() {
  const [project, setProject] = useState<ProjectSnapshot | null>(null);
  const [sourceLibrary, sourceDispatch] = useReducer(
    sourceLibraryReducer,
    undefined,
    createSourceLibraryState,
  );
  const [leaveGuard, setLeaveGuard] = useState<WorkspaceLeaveGuard | undefined>();
  const [chapter, setChapter] = useState<{ document: ChapterDocument; title: string } | null>(null);
  const [chapterError, setChapterError] = useState('');
  const api = window.writellmWritingOrientation;
  const sourcesApi = window.writellmSources;
  const projectId = project?.projectId;
  const reloadSources = useCallback(async () => {
    if (!sourcesApi) return;
    sourceDispatch({ type: 'load.start' });
    sourceDispatch(await loadSourceLibrary(sourcesApi));
  }, []);
  useEffect(() => {
    sourceDispatch({ type: 'reset' });
    if (!projectId || !sourcesApi) return;
    let active = true;
    void loadSourceLibrary(sourcesApi).then((action) => {
      if (active) sourceDispatch(action);
    });
    const unsubscribe = sourcesApi.subscribeSourceEvents({ afterSequence: 0 }, (event) => {
      if (active) sourceDispatch({ type: 'event', event });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [projectId]);
  useEffect(() => {
    if (project && sourceLibrary.needsResync) void reloadSources();
  }, [project, reloadSources, sourceLibrary.needsResync]);
  const sourceStatuses = useMemo(() => {
    if (!sourcesApi)
      return [
        {
          sourceId: 'knowledge-base',
          sequence: 0,
          state: 'owner-unavailable' as const,
          severity: 'warning' as const,
          message: 'Knowledge Base is unavailable for this project.',
        },
      ];
    if (sourceLibrary.phase === 'error')
      return [
        {
          sourceId: 'knowledge-base',
          sequence: sourceLibrary.catalogRevision + sourceLibrary.lastSequence + 1,
          state: 'error' as const,
          severity: 'error' as const,
          message: 'Sources could not be loaded. Retry the Knowledge Base.',
          action: { label: 'Retry', invoke: reloadSources },
        },
      ];
    const failed = sourceLibrary.sources.filter((source) => source.state === 'failed');
    const partial = sourceLibrary.sources.filter((source) => source.state === 'partial');
    const active = sourceLibrary.sources.filter((source) =>
      ['queued', 'parsing', 'indexing'].includes(source.state),
    );
    if (failed.length)
      return [
        {
          sourceId: 'knowledge-base',
          sequence: sourceLibrary.catalogRevision + sourceLibrary.lastSequence + 1,
          state: 'error' as const,
          severity: 'error' as const,
          message: `${failed.length} source${failed.length === 1 ? '' : 's'} failed processing. Open Knowledge Base to retry or remove affected sources.`,
        },
      ];
    if (partial.length)
      return [
        {
          sourceId: 'knowledge-base',
          sequence: sourceLibrary.catalogRevision + sourceLibrary.lastSequence + 1,
          state: 'needs-action' as const,
          severity: 'warning' as const,
          message: `${partial.length} source${partial.length === 1 ? '' : 's'} partially searchable; valid blocks remain available.`,
        },
      ];
    if (active.length)
      return [
        {
          sourceId: 'knowledge-base',
          sequence: sourceLibrary.catalogRevision + sourceLibrary.lastSequence + 1,
          state: 'in-progress' as const,
          severity: 'info' as const,
          message: `${active.length} source${active.length === 1 ? '' : 's'} processing in the background.`,
        },
      ];
    return [];
  }, [reloadSources, sourceLibrary]);
  if (new URLSearchParams(globalThis.location.search).has('editor-runtime'))
    return (
      <ChapterEditor
        initialDocument={runtimeChapter}
        title="Runtime chapter"
        api={runtimeChapterApi}
      />
    );
  if (new URLSearchParams(globalThis.location.search).has('workspace-navigation-runtime'))
    return <RuntimeNavigationFixture />;
  if (!project) return <LaunchPage api={window.writellm} onProjectOpened={setProject} />;
  const chapterNode = chapter ? (
    <ChapterEditor
      key={chapter.document.chapterId}
      initialDocument={chapter.document}
      title={chapter.title}
      api={window.writellmChapters}
      onLeaveGuardChange={setLeaveGuard}
    />
  ) : chapterError ? (
    <div role="alert">{chapterError}</div>
  ) : null;
  return (
    <WorkspaceShell
      project={project}
      sections={(controls) => (
        <WritingOrientationPanel
          api={api}
          workspace={{
            projectName: project.displayName,
            chapter:
              chapter && chapterNode
                ? { outlineItemId: chapter.document.outlineItemId, node: chapterNode }
                : undefined,
            onBack: controls.showList,
            onItemActivated: controls.activateItem,
          }}
          onLeaveGuardChange={(guard) => {
            if (!chapter) setLeaveGuard(guard);
          }}
          onStartWriting={async (input) => {
            setChapterError('');
            const result = await openChapterSession(window.writellmChapters, {
              outlineItemId: input.outlineItemId,
              baseOrientationRevision: input.baseOrientationRevision,
              mutationId: crypto.randomUUID(),
            });
            if (result.status === 'ready' && result.document) {
              setChapter({ document: result.document, title: input.title });
              return true;
            }
            setChapterError(result.message ?? 'Chapter could not be opened.');
            return false;
          }}
          onOpenLinkedChapter={async (input) => {
            setChapterError('');
            const result = await window.writellmChapters.load({ chapterId: input.chapterId });
            if (result.ok && result.value.outlineItemId === input.outlineItemId)
              setChapter({ document: result.value, title: input.title });
            else setChapterError('This chapter could not be opened safely.');
          }}
        />
      )}
      knowledgeBase={(controls) =>
        sourcesApi ? (
          <KnowledgeBaseWorkspace
            api={sourcesApi}
            projectName={project.displayName}
            onItemActivated={controls.activateItem}
            onBack={controls.showList}
            onOpenSettings={controls.openSettings}
            library={{ state: sourceLibrary, dispatch: sourceDispatch, reload: reloadSources }}
          />
        ) : (
          <p role="alert">Knowledge Base is unavailable.</p>
        )
      }
      settings={(close) => <SettingsArea onClose={close} />}
      statuses={sourceStatuses}
      leaveGuard={leaveGuard}
      onLeaveWorkspace={() => {
        setLeaveGuard(undefined);
        setChapter(null);
        setProject(null);
      }}
    />
  );
}

function RuntimeNavigationFixture() {
  return (
    <WorkspaceShell
      project={{
        projectId: 'runtime-navigation-project',
        displayName: 'Runtime navigation project',
      }}
      sections={
        <div className="flex h-full min-h-0 min-w-0 overflow-hidden">
          <WorkspaceDetail label="Runtime section detail">
            <div className="min-h-[1600px] p-6">
              <Label>
                Runtime Sections owner
                <Input defaultValue="persistent section draft" />
              </Label>
            </div>
          </WorkspaceDetail>
        </div>
      }
      knowledgeBase={
        <Label>
          Runtime Knowledge Base owner
          <Input defaultValue="persistent source state" />
        </Label>
      }
      settings={(close) => (
        <main aria-label="Application settings">
          <h1 data-settings-heading tabIndex={-1}>
            Settings
          </h1>
          <Label>
            Runtime write-only secret
            <Input type="password" />
          </Label>
          <Button type="button" onClick={close}>
            Back to workspace
          </Button>
        </main>
      )}
      onLeaveWorkspace={() => {}}
    />
  );
}
