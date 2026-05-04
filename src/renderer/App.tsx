import { useEffect, useState, type CSSProperties } from 'react';
import { formatWorkspaceTitle } from './app/formatters';
import { usePaperLabApp } from './app/usePaperLabApp';
import { Toaster } from './components/ui/sonner';
import { SidebarInset, SidebarProvider } from './components/ui/sidebar';
import { TooltipProvider } from './components/ui/tooltip';
import { CanvasView } from './features/canvas/CanvasView';
import { Inspector } from './features/inspector/Inspector';
import { KnowledgePage } from './features/knowledge/KnowledgePage';
import { SectionListView } from './features/sections/SectionListView';
import { SettingsDialog } from './features/settings/SettingsDialog';
import { WritingView } from './features/writing/WritingView';
import { SiteHeader } from './layout/SiteHeader';
import { SidebarLeft, SidebarRight } from './layout/Sidebars';
import { WorkspaceChooserDialog } from './layout/WorkspaceChooserDialog';
import type { PublicLlmSettings, ThemeMode } from '../shared/types';

function applyTheme(theme: ThemeMode) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.style.colorScheme = theme;
}

export function App() {
  const [debugEnabled, setDebugEnabled] = useState(false);
  const {
    apiAvailable,
    state,
    setState,
    workspacePath,
    setWorkspacePath,
    selection,
    setSelection,
    flowNodes,
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
    llmDraft,
    setLlmDraft,
    focusSection,
    selectedSection,
    selectedContent,
    writingSection,
    selectedEdge,
    currentChildViewMode,
    graph,
    nodeTypes,
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
    closeWritingView,
    moveSectionInOutline,
    onConnect,
    updateSelectedEdgeKind,
    deleteSelectedEdge,
    createSection,
    createContentInSection,
    createConnectedContent,
    deleteSelectedNode,
    openGenerateComposer,
    startLlmGeneration,
    cancelLlmDraft,
    saveLlmDraft,
    createKnowledgeItem,
    importKnowledgeFiles,
    updateKnowledgeItem,
    deleteKnowledgeItem,
    reindexKnowledgeItem,
    retryKnowledgeIngestJob,
    deleteKnowledgeIngestJob,
    excludeKnowledgeSource,
    exportLatex,
    createGitCheckpoint,
    setFocusedChildViewMode,
    onNodesChange,
    persistNodeLayoutFromNode
  } = usePaperLabApp();
  const theme = llmSettings?.appearance.theme ?? 'light';

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  function handleSettingsSaved(settings: PublicLlmSettings) {
    setLlmSettings(settings);
  }

  function handleThemePreview(themeMode: ThemeMode) {
    applyTheme(themeMode);
    setLlmSettings((current) =>
      current ? { ...current, appearance: { theme: themeMode } } : current
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
            onGenerateFromFocus={() => {
              if (focusSection) {
                openGenerateComposer(focusSection.id);
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
          <SettingsDialog
            open={settingsOpen}
            settings={llmSettings}
            debugEnabled={debugEnabled}
            onOpenChange={setSettingsOpen}
            onSaved={handleSettingsSaved}
            onThemePreview={handleThemePreview}
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
                {writingSection ? (
                  <WritingView
                    section={writingSection}
                    onCitationClick={(publicRef) => void openKnowledgeCitation(publicRef)}
                    onBack={() => closeWritingView(writingSection)}
                    onState={setState}
                    onError={notifyError}
                  />
                ) : currentChildViewMode === 'graph' ? (
                  <CanvasView
                    title={focusSection?.title ?? 'No focused section'}
                    visibleNodeCount={graph.nodes.length}
                    mode={currentChildViewMode}
                    onModeChange={setFocusedChildViewMode}
                    nodes={flowNodes}
                    edges={graph.edges}
                    nodeTypes={nodeTypes}
                    onNodesChange={onNodesChange}
                    onNodeDragStop={persistNodeLayoutFromNode}
                    onConnect={(connection) => void onConnect(connection)}
                    onEdgeClick={(edge) => {
                      if (state.edges.some((processEdge) => processEdge.id === edge.id)) {
                        setSelection({ type: 'edge', id: edge.id });
                      }
                    }}
                    onNodeClick={(node) => setSelection({ type: 'node', id: node.id })}
                    onNodeDoubleClick={(node) => {
                      const record = state.nodes.find((candidate) => candidate.id === node.id);
                      if (record?.kind === 'section') {
                        openWritingView(record);
                      } else if (record?.kind === 'content') {
                        if (record.metadata.nodeRole === 'knowledge-source') {
                          void openKnowledgeSourceNode(record);
                        } else {
                          const parent = state.nodes.find(
                            (candidate) => candidate.kind === 'section' && candidate.id === record.parentId
                          );
                          if (parent?.kind === 'section') {
                            openWritingView(parent);
                          }
                        }
                      }
                    }}
                    selection={selection}
                    selectedSection={selectedSection}
                    selectedContent={selectedContent}
                    selectedEdge={selectedEdge ?? null}
                    focusSection={focusSection ?? null}
                    llmDraft={llmDraft}
                    contextNodes={state.contextNodes}
                    onCreateInSection={(sectionId, preset) => void createContentInSection(sectionId, preset)}
                    onCreateConnectedContent={(nodeId, preset) => void createConnectedContent(nodeId, preset)}
                    onDeleteNode={() => void deleteSelectedNode()}
                    onOpenGenerate={openGenerateComposer}
                    onPromptChange={(prompt) => setLlmDraft((current) => ({ ...current, prompt }))}
                    onContextNodeToggle={(nodeId, checked) =>
                      setLlmDraft((current) => ({
                        ...current,
                        contextNodeIds: checked
                          ? [...new Set([...current.contextNodeIds, nodeId])]
                          : current.contextNodeIds.filter((id) => id !== nodeId)
                      }))
                    }
                    onOpenSectionMarkdown={openWritingView}
                    onExcludeKnowledgeSource={excludeKnowledgeSource}
                    onGenerate={(prompt, sectionId, contextNodeIds) =>
                      void startLlmGeneration(prompt, sectionId, contextNodeIds)
                    }
                    onRegenerate={() => {
                      if (llmDraft.targetSectionId && llmDraft.prompt.trim()) {
                        void startLlmGeneration(
                          llmDraft.prompt.trim(),
                          llmDraft.targetSectionId,
                          llmDraft.contextNodeIds
                        );
                      }
                    }}
                    onCancelGenerate={() => void cancelLlmDraft()}
                    onSaveGenerate={() => void saveLlmDraft()}
                    onUpdateEdgeKind={(relationType) => void updateSelectedEdgeKind(relationType)}
                    onDeleteEdge={() => void deleteSelectedEdge()}
                  />
                ) : (
                  <SectionListView
                    state={state}
                    focusSectionId={state.focusSectionId}
                    rootNodeId={state.workspace?.rootNodeId ?? null}
                    selection={selection}
                    onSelection={setSelection}
                    onFocusSection={(id) => void focusSectionById(id)}
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
        </SidebarProvider>
        <Toaster richColors position="top-center" />
      </div>
    </TooltipProvider>
  );
}
