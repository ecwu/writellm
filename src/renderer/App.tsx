import { BookOpen, Map as MapIcon, Settings } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ChapterApi, ChapterDocument } from '../shared/chapters';
import { CHAPTER_KIND, CHAPTER_SCHEMA_VERSION } from '../shared/chapters';
import type { ProjectSnapshot } from '../shared/project';
import { openChapterSession } from './features/editor/chapter-session';
import { ChapterEditor } from './features/editor/components/ChapterEditor';
import { ProviderSettingsPanel } from './features/provider-settings/ProviderSettingsPanel';
import { SourceLibrary } from './features/sources/SourceLibrary';
import { WritingOrientationPanel } from './features/writing-orientation/WritingOrientationPanel';
import { LaunchPage } from './launch/LaunchPage';
import type { WorkspaceLeaveGuard } from './workspace/WorkspaceShell';
import { defaultWorkspaceSlot, WorkspaceShell } from './workspace/WorkspaceShell';

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
  const [leaveGuard, setLeaveGuard] = useState<WorkspaceLeaveGuard | undefined>();
  const [chapter, setChapter] = useState<{ document: ChapterDocument; title: string } | null>(null);
  const [chapterError, setChapterError] = useState('');
  const api = window.writellmWritingOrientation;
  const sourcesApi = window.writellmSources;
  const panels = useMemo(
    () => [
      {
        id: 'source-library',
        label: 'Source library',
        icon: BookOpen,
        disabled: !sourcesApi,
        render: () => <SourceLibrary api={sourcesApi} />,
      },
      {
        id: 'provider-settings',
        label: 'AI provider settings',
        icon: Settings,
        render: () => <ProviderSettingsPanel />,
      },
      {
        id: 'writing-orientation',
        label: 'Writing orientation',
        icon: MapIcon,
        render: () => (
          <WritingOrientationPanel
            api={api}
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
          />
        ),
      },
    ],
    [chapter],
  );
  if (new URLSearchParams(globalThis.location.search).has('editor-runtime'))
    return (
      <ChapterEditor
        initialDocument={runtimeChapter}
        title="Runtime chapter"
        api={runtimeChapterApi}
      />
    );
  if (!project) return <LaunchPage api={window.writellm} onProjectOpened={setProject} />;
  const slot = chapter ? (
    <ChapterEditor
      key={chapter.document.chapterId}
      initialDocument={chapter.document}
      title={chapter.title}
      api={window.writellmChapters}
      onLeaveGuardChange={setLeaveGuard}
    />
  ) : chapterError ? (
    <div role="alert">{chapterError}</div>
  ) : (
    defaultWorkspaceSlot
  );
  return (
    <WorkspaceShell
      project={project}
      workspaceSlot={slot}
      panels={panels}
      statuses={[]}
      leaveGuard={leaveGuard}
      onLeaveWorkspace={() => {
        setLeaveGuard(undefined);
        setChapter(null);
        setProject(null);
      }}
    />
  );
}
