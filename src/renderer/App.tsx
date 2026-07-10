import { lazy, Suspense, useEffect, useState, type CSSProperties } from 'react';
import { formatWorkspaceTitle } from './app/formatters';
import { useWriteLLMApp } from './app/useWriteLLMApp';
import { Toaster } from './components/ui/sonner';
import { SidebarInset, SidebarProvider } from './components/ui/sidebar';
import { TooltipProvider } from './components/ui/tooltip';
import { GenerationHub } from './features/generation/GenerationHub';
import { SectionListView } from './features/sections/SectionListView';
import { SiteHeader } from './layout/SiteHeader';
import { SidebarLeft, SidebarRight } from './layout/Sidebars';
import { WorkspaceChooserDialog } from './layout/WorkspaceChooserDialog';
import type { AppearanceSettings, PublicLlmSettings, SectionNodeRecord } from '../shared/types';

const CitationCoverageView = lazy(() => import('./features/research/CitationCoverageView').then(({ CitationCoverageView }) => ({ default: CitationCoverageView })));
const Inspector = lazy(() => import('./features/inspector/Inspector').then(({ Inspector }) => ({ default: Inspector })));
const KnowledgePage = lazy(() => import('./features/knowledge/KnowledgePage').then(({ KnowledgePage }) => ({ default: KnowledgePage })));
const ProjectBriefPage = lazy(() => import('./features/project/ProjectBriefPage').then(({ ProjectBriefPage }) => ({ default: ProjectBriefPage })));
const SectionHistoryDialog = lazy(() => import('./features/sections/SectionHistoryDialog').then(({ SectionHistoryDialog }) => ({ default: SectionHistoryDialog })));
const SettingsDialog = lazy(() => import('./features/settings/SettingsDialog').then(({ SettingsDialog }) => ({ default: SettingsDialog })));
const WritingView = lazy(() => import('./features/writing/WritingView').then(({ WritingView }) => ({ default: WritingView })));

const defaultAppearance: AppearanceSettings = {
  theme: 'system',
  accentColor: 'deep-teal',
  fontFamily: 'geist'
};

function resolveTheme(appearance: AppearanceSettings) {
  if (appearance.theme !== 'system') {
    return appearance.theme;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyAppearance(appearance: AppearanceSettings) {
  const resolvedTheme = resolveTheme(appearance);
  document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
  document.documentElement.style.colorScheme = resolvedTheme;
  document.documentElement.dataset.accent = appearance.accentColor;
  document.documentElement.dataset.font = appearance.fontFamily;
}

export function App() {
  const [debugEnabled, setDebugEnabled] = useState(false);
  const [historySectionId, setHistorySectionId] = useState<string | null>(null);
  const {
    apiAvailable,
    state,
    setState,
    workspacePath,
    setWorkspacePath,
    selection,
    setSelection,
    settingsOpen,
    setSettingsOpen,
    workspaceChooserOpen,
    setWorkspaceChooserOpen,
    recentWorkspaces,
    activePage,
    setActivePage,
    knowledgeTarget,
    setKnowledgeTarget,
    llmSettings,
    setLlmSettings,
    focusSection,
    selectedSection,
    selectedContent,
    currentChildViewMode,
    notifyStatus,
    notifyError,
    refresh,
    createOrOpenWorkspace,
    pickWorkspaceFolder,
    pickNewWorkspacePath,
    focusSectionById,
    openKnowledgeCitation,
    openKnowledgeSourceNode,
    openWritingView,
    moveSectionInOutline,
    createSection,
    createKnowledgeItem,
    importKnowledgeFiles,
    updateKnowledgeItem,
    deleteKnowledgeItem,
    reindexKnowledgeItem,
    retryKnowledgeIngestJob,
    deleteKnowledgeIngestJob,
    exportLatex,
    createGitCheckpoint,
    setFocusedChildViewMode
  } = useWriteLLMApp();
  const appearance = llmSettings?.appearance ?? defaultAppearance;
  const historySection = historySectionId
    ? state.nodes.find((node): node is SectionNodeRecord => node.kind === 'section' && node.id === historySectionId) ?? null
    : null;

  useEffect(() => {
    applyAppearance(appearance);

    if (appearance.theme !== 'system') {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => applyAppearance(appearance);
    mediaQuery.addEventListener('change', handleChange);
    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, [appearance]);

  useEffect(() => {
    if (historySectionId && !historySection) {
      setHistorySectionId(null);
    }
  }, [historySectionId, historySection]);

  function handleSettingsSaved(settings: PublicLlmSettings) {
    setLlmSettings(settings);
  }

  function handleAppearancePreview(nextAppearance: AppearanceSettings) {
    applyAppearance(nextAppearance);
    setLlmSettings((current) =>
      current ? { ...current, appearance: nextAppearance } : current
    );
  }

  return (
    <TooltipProvider delayDuration={0}>
      <div className="[--header-height:calc(--spacing(14))]">
        <SidebarProvider
          className="flex min-h-svh flex-col bg-background"
          style={
            {
              '--sidebar-width': '20rem',
              '--sidebar-width-icon': '3.25rem'
            } as CSSProperties
          }
        >
          <SiteHeader
            apiAvailable={apiAvailable}
            llmSettings={llmSettings}
            workspaceTitle={state.workspace ? formatWorkspaceTitle(state.workspace.path) : 'No workspace'}
            activePage={activePage}
            onPageChange={setActivePage}
            onCreateWorkspace={() => void pickNewWorkspacePath()}
            onOpenWorkspace={() => void pickWorkspaceFolder()}
            onSwitchWorkspace={() => setWorkspaceChooserOpen(true)}
            onRefresh={() => void refresh()}
            onExport={() => void exportLatex()}
            onCheckpoint={() => void createGitCheckpoint()}
            onClearSelection={() => setSelection(null)}
            onSelectFocus={() => {
              if (focusSection) {
                setSelection({ type: 'node', id: focusSection.id });
              }
            }}
            onSettings={() => setSettingsOpen(true)}
            onRetryTask={(jobId) => void retryKnowledgeIngestJob(jobId)}
            onDeleteTask={(jobId) => void deleteKnowledgeIngestJob(jobId)}
            canExport={Boolean(state.workspace)}
            canSelectFocus={Boolean(focusSection)}
            hasSelection={Boolean(selection)}
            tasks={state.knowledgeIngestJobs}
          />
          <Suspense fallback={null}>
          <SettingsDialog
            open={settingsOpen}
            settings={llmSettings}
            debugEnabled={debugEnabled}
            onOpenChange={setSettingsOpen}
            onSaved={handleSettingsSaved}
            onAppearancePreview={handleAppearancePreview}
            onDebugEnabledChange={setDebugEnabled}
            onError={notifyError}
            onStatus={notifyStatus}
          />
          <WorkspaceChooserDialog
            open={workspaceChooserOpen}
            apiAvailable={apiAvailable}
            canClose={Boolean(state.workspace)}
            recentWorkspaces={recentWorkspaces}
            workspacePath={workspacePath}
            onOpenChange={(open) => {
              if (!open && !state.workspace) {
                return;
              }
              setWorkspaceChooserOpen(open);
            }}
            onWorkspacePath={setWorkspacePath}
            onOpenWorkspace={(path) => void createOrOpenWorkspace('open', path)}
            onCreateWorkspace={(path) => void createOrOpenWorkspace('create', path)}
            onPickWorkspace={() => void pickWorkspaceFolder()}
            onPickNewWorkspace={() => void pickNewWorkspacePath()}
          />
          <SectionHistoryDialog
            open={Boolean(historySection)}
            section={historySection}
            onOpenChange={(open) => {
              if (!open) {
                setHistorySectionId(null);
              }
            }}
            onState={setState}
            onStatus={notifyStatus}
            onError={notifyError}
          />

          {activePage === 'knowledge' ? (
            <KnowledgePage
              items={state.knowledgeItems}
              ingestJobs={state.knowledgeIngestJobs}
              workspacePath={state.workspace?.path ?? null}
              targetSource={knowledgeTarget}
              onTargetConsumed={() => setKnowledgeTarget(null)}
              onCreate={(title, content) => void createKnowledgeItem(title, content)}
              onImportFiles={() => void importKnowledgeFiles()}
              onUpdate={(itemId, title, content) => void updateKnowledgeItem(itemId, title, content)}
              onDelete={(itemId) => void deleteKnowledgeItem(itemId)}
              onReindex={(itemId) => void reindexKnowledgeItem(itemId)}
              onRetryIngest={(jobId) => void retryKnowledgeIngestJob(jobId)}
              onDeleteIngest={(jobId) => void deleteKnowledgeIngestJob(jobId)}
              debugEnabled={debugEnabled}
              onDebugError={notifyError}
            />
          ) : activePage === 'project' ? (
            <ProjectBriefPage
              brief={state.projectBrief}
              focusSectionId={state.focusSectionId}
              compositionTree={state.compositionTree}
              knowledgeCount={state.knowledgeItems.length}
              onState={setState}
              onStatus={notifyStatus}
              onError={notifyError}
            />
          ) : (
            <div className="flex min-h-0 flex-1">
              <SidebarLeft
                nodes={state.compositionTree}
                activeId={state.focusSectionId}
                onSelectSection={(id) => void focusSectionById(id)}
                onMoveSection={(id, parentId, index) => void moveSectionInOutline(id, parentId, index)}
                onAddChild={() => void createSection(state.focusSectionId)}
              />

              <SidebarInset className="min-h-[calc(100svh-var(--header-height))] overflow-hidden">
                {currentChildViewMode === 'markdown' && focusSection ? (
                  <WritingView
                    key={focusSection.id}
                    section={focusSection}
                    compositionTree={state.compositionTree}
                    rootNodeId={state.workspace?.rootNodeId ?? null}
                    childViewMode={currentChildViewMode}
                    onChildViewMode={setFocusedChildViewMode}
                    onCitationClick={(publicRef) => void openKnowledgeCitation(publicRef)}
                    onHistory={(section) => setHistorySectionId(section.id)}
                    onState={setState}
                    onStatus={notifyStatus}
                    onError={notifyError}
                  />
                ) : currentChildViewMode === 'references' ? (
                  <CitationCoverageView
                    state={state}
                    mode={currentChildViewMode}
                    onModeChange={setFocusedChildViewMode}
                    onCitationClick={(publicRef) => void openKnowledgeCitation(publicRef)}
                    onError={notifyError}
                  />
                ) : (
                  <SectionListView
                    state={state}
                    focusSectionId={state.focusSectionId}
                    rootNodeId={state.workspace?.rootNodeId ?? null}
                    selection={selection}
                    onSelection={setSelection}
                    onFocusSection={(id) => void focusSectionById(id)}
                    onOpenHistory={(section) => setHistorySectionId(section.id)}
                    childViewMode={currentChildViewMode}
                    onChildViewMode={setFocusedChildViewMode}
                    onState={setState}
                    onError={notifyError}
                  />
                )}
              </SidebarInset>

              <SidebarRight>
                <Inspector
                  state={state}
                  focusSection={focusSection ?? null}
                  selectedSection={selectedSection}
                  selectedContent={selectedContent}
                  onState={setState}
                  onSelection={setSelection}
                  onCitationClick={(publicRef) => void openKnowledgeCitation(publicRef)}
                  onOpenKnowledgeSource={(content) => void openKnowledgeSourceNode(content)}
                  onStatus={notifyStatus}
                  onError={notifyError}
                />
              </SidebarRight>
            </div>
          )}
          {state.workspace ? (
            <GenerationHub onState={setState} onStatus={notifyStatus} onError={notifyError} />
          ) : null}
          </Suspense>
        </SidebarProvider>
        <Toaster richColors position="top-center" />
      </div>
    </TooltipProvider>
  );
}
