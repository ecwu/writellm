import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  NodeResizeControl,
  Position,
  ReactFlow,
  applyNodeChanges,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps
} from '@xyflow/react';
import {
  ArrowLeft,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  FolderPlus,
  GitBranch,
  Library,
  List,
  Plus,
  RefreshCw,
  Save,
  Settings,
  Trash2,
  Upload,
  X
} from 'lucide-react';
import { toast } from 'sonner';
import { getApi } from './api';
import { LatexEditor } from './components/LatexEditor';
import { Outline } from './components/Outline';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import {
  Menubar,
  MenubarContent,
  MenubarGroup,
  MenubarItem,
  MenubarLabel,
  MenubarMenu,
  MenubarSeparator,
  MenubarTrigger
} from './components/ui/menubar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from './components/ui/select';
import { Separator } from './components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle
} from './components/ui/sheet';
import { Toaster } from './components/ui/sonner';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger
} from './components/ui/sidebar';
import { Textarea } from './components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './components/ui/tooltip';
import type {
  CompositionTreeNode,
  ContentNodeRecord,
  EdgeKind,
  FocusedWorkspaceState,
  LlmProviderKind,
  NodeRecord,
  NodeStats,
  PublicLlmSettings,
  SectionNodeRecord,
  UpdateNodeLayoutPayload
} from '../shared/types';

const emptyState: FocusedWorkspaceState = {
  workspace: null,
  compositionTree: [],
  focusSectionId: null,
  nodes: [],
  visibleNodes: [],
  contextNodes: [],
  nodeStats: {},
  edges: [],
  nodeLayouts: []
};

type Selection = { type: 'node'; id: string } | { type: 'edge'; id: string } | null;

type ContentPreset = 'main' | 'artifact';

type ChildViewMode = 'graph' | 'list';

type LlmDraftState = {
  open: boolean;
  runId: string | null;
  targetSectionId: string | null;
  prompt: string;
  contextNodeIds: string[];
  content: string;
  status: 'idle' | 'running' | 'done' | 'error';
  error?: string;
};

const emptyLlmDraft: LlmDraftState = {
  open: false,
  runId: null,
  targetSectionId: null,
  prompt: '',
  contextNodeIds: [],
  content: '',
  status: 'idle'
};

type PaperNodeData = Record<string, unknown> & {
  nodeId: string;
  canvasSectionId: string;
  kind: NodeRecord['kind'];
  eyebrow: string;
  title: string;
  meta?: string;
  content?: string;
  tone: 'child-container' | 'author_text' | 'source_note' | 'artifact';
  layoutKey: string;
  onLayoutChange: (payload: UpdateNodeLayoutPayload) => void;
};

type PaperNode = Node<PaperNodeData, 'paper'>;

const DEFAULT_NODE_WIDTH = 210;
const DEFAULT_NODE_HEIGHT = 96;
const DEFAULT_CONTENT_NODE_WIDTH = 280;
const DEFAULT_CONTENT_NODE_HEIGHT = 180;
const DEFAULT_EDGE_KIND: EdgeKind = 'related-to';

function formatWorkspaceTitle(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

export function App() {
  const [state, setState] = useState<FocusedWorkspaceState>(emptyState);
  const [workspacePath, setWorkspacePath] = useState(
    '/Users/zhenghaowu/Developer/llm-write-canvas/my-paper.paperlab'
  );
  const [selection, setSelection] = useState<Selection>(null);
  const [flowNodes, setFlowNodes] = useState<Node[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [llmSettings, setLlmSettings] = useState<PublicLlmSettings | null>(null);
  const [llmDraft, setLlmDraft] = useState<LlmDraftState>(emptyLlmDraft);
  const [childViewModes, setChildViewModes] = useState<Record<string, ChildViewMode>>({});
  const [writingNodeId, setWritingNodeId] = useState<string | null>(null);

  const apiAvailable = Boolean(window.paperlab);
  const focusSection = state.nodes.find(
    (node): node is SectionNodeRecord => node.kind === 'section' && node.id === state.focusSectionId
  );
  const selectedNode =
    selection?.type === 'node' ? state.nodes.find((node) => node.id === selection.id) ?? null : null;
  const selectedSection = selectedNode?.kind === 'section' ? selectedNode : null;
  const selectedContent = selectedNode?.kind === 'content' ? selectedNode : null;
  const writingContent = writingNodeId
    ? state.nodes.find((node): node is ContentNodeRecord => node.kind === 'content' && node.id === writingNodeId) ?? null
    : null;
  const writingSection = writingContent
    ? state.nodes.find(
        (node): node is SectionNodeRecord => node.kind === 'section' && node.id === writingContent.parentId
      ) ?? null
    : null;
  const selectedEdge =
    selection?.type === 'edge' ? state.edges.find((edge) => edge.id === selection.id) : null;
  const currentChildViewMode = state.focusSectionId
    ? getChildViewMode(state.focusSectionId)
    : 'graph';

  function getChildViewMode(sectionId: string): ChildViewMode {
    return childViewModes[sectionId] ?? (sectionId === state.workspace?.rootNodeId ? 'list' : 'graph');
  }

  function setFocusedChildViewMode(mode: ChildViewMode) {
    const focusId = state.focusSectionId;
    if (!focusId) {
      return;
    }
    setChildViewModes((current) => ({ ...current, [focusId]: mode }));
    if (mode === 'list' && selection?.type !== 'node') {
      setSelection({ type: 'node', id: focusId });
    }
  }

  useEffect(() => {
    if (!apiAvailable) {
      notifyError('Run this app through Electron to use local workspace features.');
      return;
    }
    void refresh();
    void getApi().getLlmSettings().then(setLlmSettings).catch((caught) => {
      notifyError(caught instanceof Error ? caught.message : String(caught));
    });
    const unsubscribe = getApi().onLlmStream((event) => {
      if (event.type === 'started') {
        setLlmDraft((current) =>
          current.runId === event.runId ? { ...current, status: 'running', content: '', error: undefined } : current
        );
        return;
      }

      if (event.type === 'chunk' || event.type === 'done') {
        setLlmDraft((current) =>
          current.runId === event.runId
            ? {
                ...current,
                content: event.content,
                status: event.type === 'done' ? 'done' : 'running'
              }
            : current
        );
        return;
      }

      if (event.type === 'canceled') {
        setLlmDraft((current) => (current.runId === event.runId ? emptyLlmDraft : current));
        return;
      }

      setLlmDraft((current) =>
        current.runId === event.runId ? { ...current, status: 'error', error: event.message } : current
      );
      notifyError(event.message);
    });
    return unsubscribe;
  }, [apiAvailable]);

  useEffect(() => {
    if (writingNodeId && !writingContent) {
      setWritingNodeId(null);
    }
  }, [writingNodeId, writingContent]);

  function notifyStatus(message: string) {
    toast.success(message);
  }

  function notifyError(message: string) {
    toast.error(message);
  }

  async function refresh(focusSectionId = state.focusSectionId ?? undefined) {
    const next = await getApi().getState(focusSectionId);
    setState(next);
    if (!selection && next.focusSectionId) {
      setSelection({ type: 'node', id: next.focusSectionId });
    } else if (selection?.type === 'edge' && !next.edges.some((edge) => edge.id === selection.id)) {
      setSelection(next.focusSectionId ? { type: 'node', id: next.focusSectionId } : null);
    } else if (selection?.type === 'node' && !next.nodes.some((node) => node.id === selection.id)) {
      setSelection(next.focusSectionId ? { type: 'node', id: next.focusSectionId } : null);
    }
  }

  async function run(action: () => Promise<FocusedWorkspaceState | void>, message?: string) {
    try {
      const next = await action();
      if (next) {
        setState(next);
      }
      if (message) {
        notifyStatus(message);
      }
    } catch (caught) {
      notifyError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  const persistNodeLayout = useCallback(async (payload: UpdateNodeLayoutPayload) => {
    try {
      const next = await getApi().updateNodeLayout(payload);
      setState(next);
    } catch (caught) {
      notifyError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  const graph = useMemo(
    () => buildGraph(state, selection, (payload) => void persistNodeLayout(payload)),
    [persistNodeLayout, state, selection]
  );
  const nodeTypes = useMemo(() => ({ paper: PaperFlowNode }), []);

  useEffect(() => {
    setFlowNodes((current) => reconcileNodes(graph.nodes, current));
  }, [graph.nodes]);

  function onNodesChange(changes: NodeChange[]) {
    setFlowNodes((current) => applyNodeChanges(changes, current));
  }

  function persistNodeLayoutFromNode(node: Node) {
    const data = node.data as PaperNodeData;
    if (!data.canvasSectionId || !data.nodeId) {
      return;
    }
    const width = node.width ?? node.measured?.width;
    const height = node.height ?? node.measured?.height;
    if (!width || !height) {
      return;
    }

    void persistNodeLayout({
      canvasSectionId: data.canvasSectionId,
      nodeId: data.nodeId,
      x: node.position.x,
      y: node.position.y,
      width,
      height
    });
  }

  async function createOrOpenWorkspace(mode: 'create' | 'open') {
    if (!workspacePath.trim()) {
      notifyError('Workspace path is required.');
      return;
    }
    await run(async () => {
      const summary =
        mode === 'create'
          ? await getApi().createWorkspace(workspacePath.trim())
          : await getApi().openWorkspace(workspacePath.trim());
      const next = await getApi().getState(summary.rootNodeId);
      setSelection({ type: 'node', id: summary.rootNodeId });
      return next;
    }, mode === 'create' ? 'Workspace created.' : 'Workspace opened.');
  }

  async function focusSectionById(sectionId: string) {
    await run(async () => getApi().getState(sectionId));
    setSelection({ type: 'node', id: sectionId });
  }

  function openWritingView(content: ContentNodeRecord) {
    setSelection({ type: 'node', id: content.id });
    setWritingNodeId(content.id);
  }

  async function closeWritingView(content: ContentNodeRecord) {
    await run(async () => getApi().getState(content.parentId));
    setWritingNodeId(null);
    setSelection({ type: 'node', id: content.id });
  }

  async function moveSectionInOutline(sectionId: string, parentId: string | null, index: number) {
    if (!parentId || index < 0) {
      return;
    }
    await run(
      async () => {
        await getApi().moveNode(sectionId, parentId, index);
        return getApi().getState(state.focusSectionId ?? parentId);
      },
      'Composition order updated.'
    );
  }

  async function onConnect(connection: Connection) {
    if (!connection.source || !connection.target) {
      return;
    }
    const source = state.nodes.find((node) => node.id === connection.source);
    const target = state.nodes.find((node) => node.id === connection.target);
    if (source?.kind !== 'content' || target?.kind !== 'content') {
      notifyError('Process edges can only connect content nodes.');
      return;
    }
    await run(async () => {
      const edge = await getApi().createNodeEdge(source.id, target.id, DEFAULT_EDGE_KIND);
      setSelection({ type: 'edge', id: edge.id });
      return getApi().getState(state.focusSectionId ?? undefined);
    }, 'Process edge created.');
  }

  async function updateSelectedEdgeKind(relationType: EdgeKind) {
    if (!selectedEdge) {
      return;
    }

    await run(async () => {
      const next = await getApi().updateNodeEdge(selectedEdge.id, relationType, state.focusSectionId);
      setSelection({ type: 'edge', id: selectedEdge.id });
      return next;
    }, 'Process edge updated.');
  }

  async function deleteSelectedEdge() {
    if (!selectedEdge) {
      return;
    }

    await run(async () => {
      const next = await getApi().deleteNodeEdge(selectedEdge.id, state.focusSectionId);
      setSelection(next.focusSectionId ? { type: 'node', id: next.focusSectionId } : null);
      return next;
    }, 'Process edge deleted.');
  }

  async function createSection(parentId: string | null) {
    if (!parentId) {
      return;
    }
    const existingIds = new Set(state.nodes.map((node) => node.id));
    await run(async () => {
      const next = await getApi().createNode({
        kind: 'section',
        parentId,
        title: 'New section',
        intent: ''
      });
      const created = next.nodes.find((node) => !existingIds.has(node.id) && node.kind === 'section');
      if (created) {
        setSelection({ type: 'node', id: created.id });
      }
      return next;
    }, 'Section created.');
  }

  async function createContentInSection(sectionId: string, preset: ContentPreset) {
    const existingIds = new Set(state.nodes.map((node) => node.id));
    const payload =
      preset === 'main'
        ? {
            kind: 'content' as const,
            parentId: sectionId,
            title: 'Main draft',
            content: 'Write confirmed LaTeX text here.',
            isMain: true,
            isArtifact: false,
            isLlm: false
          }
        : {
            kind: 'content' as const,
            parentId: sectionId,
            title: 'Source material',
            content: 'Paste source material or informal context here.',
            isMain: false,
            isArtifact: true,
            isLlm: false
          };

    await run(async () => {
      const next = await getApi().createNode(payload);
      const created = next.nodes.find((node) => !existingIds.has(node.id) && node.kind === 'content');
      if (created) {
        setSelection({ type: 'node', id: created.id });
      }
      return next;
    }, preset === 'main' ? 'Main content created.' : 'Artifact content created.');
  }

  async function createConnectedContent(fromNodeId: string, preset: ContentPreset) {
    const source = state.nodes.find((node) => node.id === fromNodeId);
    if (source?.kind !== 'content') {
      notifyError('Select a content node before adding connected content.');
      return;
    }
    const existingIds = new Set(state.nodes.map((node) => node.id));
    await run(async () => {
      const createdState = await getApi().createNode({
        kind: 'content',
        parentId: source.parentId,
        title: preset === 'main' ? 'Main draft' : 'Source material',
        content: preset === 'main'
          ? 'Write confirmed LaTeX text here.'
          : 'Paste source material or informal context here.',
        isMain: preset === 'main',
        isArtifact: preset === 'artifact',
        isLlm: false
      });
      const created = createdState.nodes.find((node) => !existingIds.has(node.id) && node.kind === 'content');
      if (!created) {
        return createdState;
      }
      await getApi().createNodeEdge(fromNodeId, created.id, DEFAULT_EDGE_KIND);
      const next = await getApi().getState(state.focusSectionId ?? source.parentId);
      setSelection({ type: 'node', id: created.id });
      return next;
    }, 'Content created and connected.');
  }

  async function deleteSelectedNode() {
    if (!selectedNode) {
      return;
    }

    await run(async () => {
      const next = await getApi().deleteNode(selectedNode.id);
      setSelection(next.focusSectionId ? { type: 'node', id: next.focusSectionId } : null);
      return next;
    }, selectedNode.kind === 'section' ? 'Section deleted.' : 'Content deleted.');
  }

  function openGenerateComposer(sectionId: string) {
    if (llmDraft.status === 'running' && llmDraft.runId) {
      void getApi().cancelLlmGeneration(llmDraft.runId);
    }
    setLlmDraft({
      open: true,
      runId: null,
      targetSectionId: sectionId,
      prompt: '',
      contextNodeIds: [],
      content: '',
      status: 'idle'
    });
  }

  async function startLlmGeneration(prompt: string, sectionId: string, contextNodeIds: string[]) {
    const runId = globalThis.crypto.randomUUID();
    setLlmDraft({
      open: true,
      runId,
      targetSectionId: sectionId,
      prompt,
      contextNodeIds,
      content: '',
      status: 'running'
    });

    try {
      await getApi().generateWithLlm({
        runId,
        sectionId,
        focusSectionId: state.focusSectionId ?? sectionId,
        prompt,
        contextNodeIds
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setLlmDraft((current) =>
        current.runId === runId ? { ...current, status: 'error', error: message } : current
      );
    }
  }

  async function cancelLlmDraft() {
    const runId = llmDraft.runId;
    if (llmDraft.status === 'running' && runId) {
      await getApi().cancelLlmGeneration(runId);
    }
    setLlmDraft(emptyLlmDraft);
  }

  async function saveLlmDraft() {
    if (!llmDraft.targetSectionId || !llmDraft.content.trim()) {
      return;
    }

    const existingIds = new Set(state.nodes.map((node) => node.id));
    await run(async () => {
      const next = await getApi().saveLlmGeneration({
        sectionId: llmDraft.targetSectionId!,
        focusSectionId: state.focusSectionId ?? llmDraft.targetSectionId,
        prompt: llmDraft.prompt,
        content: llmDraft.content,
        contextNodeIds: llmDraft.contextNodeIds,
        contextRelationType: DEFAULT_EDGE_KIND
      });
      const created = next.nodes.find((node) => !existingIds.has(node.id) && node.kind === 'content');
      if (created) {
        setSelection({ type: 'node', id: created.id });
      }
      setLlmDraft(emptyLlmDraft);
      return next;
    }, 'LLM generation saved.');
  }

  async function exportLatex() {
    const rootId = state.workspace?.rootNodeId;
    if (!rootId) {
      return;
    }
    try {
      const result = await getApi().exportLatex(rootId);
      notifyStatus(`Exported ${result.path}`);
    } catch (caught) {
      notifyError(caught instanceof Error ? caught.message : String(caught));
    }
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
            workspacePath={workspacePath}
            workspaceTitle={state.workspace ? formatWorkspaceTitle(state.workspace.path) : 'No workspace'}
            onWorkspacePath={setWorkspacePath}
            onCreateWorkspace={() => void createOrOpenWorkspace('create')}
            onOpenWorkspace={() => void createOrOpenWorkspace('open')}
            onRefresh={() => void refresh()}
            onExport={() => void exportLatex()}
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
            canExport={Boolean(state.workspace)}
            canSelectFocus={Boolean(focusSection)}
            hasSelection={Boolean(selection)}
          />
          <SettingsSheet
            open={settingsOpen}
            settings={llmSettings}
            onOpenChange={setSettingsOpen}
            onSaved={setLlmSettings}
            onError={notifyError}
            onStatus={notifyStatus}
          />

          <div className="flex min-h-0 flex-1">
            <SidebarLeft
              nodes={state.compositionTree}
              activeId={state.focusSectionId}
              onSelectSection={(id) => void focusSectionById(id)}
              onMoveSection={(id, parentId, index) => void moveSectionInOutline(id, parentId, index)}
              onAddChild={() => void createSection(state.focusSectionId)}
            />

            <SidebarInset className="min-h-[calc(100svh-var(--header-height))] overflow-hidden">
              {writingContent ? (
                <WritingView
                  contentNode={writingContent}
                  parentSection={writingSection}
                  onBack={() => closeWritingView(writingContent)}
                  onState={setState}
                  onError={notifyError}
                />
              ) : currentChildViewMode === 'graph' ? (
                <section className="canvas-pane">
                  <ChildrenViewHeader
                    title={focusSection?.title ?? 'No focused section'}
                    detail={`${graph.nodes.length} visible node${graph.nodes.length === 1 ? '' : 's'}`}
                    mode={currentChildViewMode}
                    onModeChange={setFocusedChildViewMode}
                  />
                  <ReactFlow
                    nodes={flowNodes}
                    edges={graph.edges}
                    nodeTypes={nodeTypes}
                    fitView
                    nodesDraggable
                    onNodesChange={onNodesChange}
                    onNodeDragStop={(_event, node) => persistNodeLayoutFromNode(node)}
                    onConnect={(connection) => void onConnect(connection)}
                    onEdgeClick={(_event, edge) => {
                      if (state.edges.some((processEdge) => processEdge.id === edge.id)) {
                        setSelection({ type: 'edge', id: edge.id });
                      }
                    }}
                    onNodeClick={(_event, node) => setSelection({ type: 'node', id: node.id })}
                    onNodeDoubleClick={(_event, node) => {
                      const record = state.nodes.find((candidate) => candidate.id === node.id);
                      if (record?.kind === 'section') {
                        void focusSectionById(record.id);
                      } else if (record?.kind === 'content') {
                        openWritingView(record);
                      }
                    }}
                  >
                    <Background />
                    <Controls />
                  </ReactFlow>
                  <FloatingActionToolbar
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
                </section>
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
                onStatus={notifyStatus}
                onError={notifyError}
              />
            </SidebarRight>
          </div>
        </SidebarProvider>
        <Toaster richColors position="top-center" />
      </div>
    </TooltipProvider>
  );
}

function SiteHeader({
  apiAvailable,
  llmSettings,
  workspacePath,
  workspaceTitle,
  onWorkspacePath,
  onCreateWorkspace,
  onOpenWorkspace,
  onRefresh,
  onExport,
  onClearSelection,
  onSelectFocus,
  onGenerateFromFocus,
  onSettings,
  canExport,
  canSelectFocus,
  hasSelection
}: {
  apiAvailable: boolean;
  llmSettings: PublicLlmSettings | null;
  workspacePath: string;
  workspaceTitle: string;
  onWorkspacePath: (path: string) => void;
  onCreateWorkspace: () => void;
  onOpenWorkspace: () => void;
  onRefresh: () => void;
  onExport: () => void;
  onClearSelection: () => void;
  onSelectFocus: () => void;
  onGenerateFromFocus: () => void;
  onSettings: () => void;
  canExport: boolean;
  canSelectFocus: boolean;
  hasSelection: boolean;
}) {
  const llmConfigured = Boolean(llmSettings?.hasApiKey);
  const llmModel = llmSettings?.model.trim() ?? '';
  const llmStatus = llmConfigured ? `Configured: ${llmModel}` : 'Not configured';

  return (
    <header className="sticky top-0 z-50 flex h-(--header-height) shrink-0 items-center gap-3 border-b bg-background px-3">
      <SidebarTrigger />
      <Separator orientation="vertical" className="data-vertical:h-6 data-vertical:self-center" />
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Library className="size-4" />
        </div>
        <div className="grid min-w-0 leading-tight">
          <div className="truncate text-sm font-semibold">PaperLab</div>
          <div className="truncate text-xs text-muted-foreground">{workspaceTitle}</div>
        </div>
      </div>
      <Menubar className="shrink-0 border-0 bg-transparent p-0">
        <MenubarMenu>
          <MenubarTrigger>File</MenubarTrigger>
          <MenubarContent className="w-[min(28rem,calc(100vw-2rem))]">
            <MenubarLabel>Workspace path</MenubarLabel>
            <div className="px-1.5 pb-1.5">
              <Input
                value={workspacePath}
                onChange={(event) => onWorkspacePath(event.target.value)}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === 'Enter' && apiAvailable) {
                    onOpenWorkspace();
                  }
                }}
                aria-label="Workspace path"
                className="h-8 w-full bg-background"
              />
            </div>
            <MenubarSeparator />
            <MenubarGroup>
              <MenubarItem onSelect={onCreateWorkspace} disabled={!apiAvailable}>
                <Plus />
                New workspace
              </MenubarItem>
              <MenubarItem onSelect={onOpenWorkspace} disabled={!apiAvailable}>
                <FileText />
                Open workspace
              </MenubarItem>
            </MenubarGroup>
            <MenubarSeparator />
            <MenubarGroup>
              <MenubarItem onSelect={onRefresh} disabled={!apiAvailable}>
                <RefreshCw />
                Refresh
              </MenubarItem>
              <MenubarItem onSelect={onExport} disabled={!canExport}>
                <Upload />
                Export main.tex
              </MenubarItem>
            </MenubarGroup>
          </MenubarContent>
        </MenubarMenu>
        <MenubarMenu>
          <MenubarTrigger>Edit</MenubarTrigger>
          <MenubarContent>
            <MenubarGroup>
              <MenubarItem onSelect={onSelectFocus} disabled={!canSelectFocus}>
                <GitBranch />
                Select focused section
              </MenubarItem>
              <MenubarItem onSelect={onClearSelection} disabled={!hasSelection}>
                <X />
                Clear selection
              </MenubarItem>
            </MenubarGroup>
          </MenubarContent>
        </MenubarMenu>
        <MenubarMenu>
          <MenubarTrigger className="llm-menu-trigger" title={llmStatus}>
            <span>LLM</span>
            <span className={`llm-status-dot ${llmConfigured ? 'configured' : 'missing'}`} aria-hidden="true" />
            {llmConfigured && llmModel ? <span className="llm-menu-model">{llmModel}</span> : null}
          </MenubarTrigger>
          <MenubarContent>
            <MenubarLabel>
              <span className="llm-menu-summary">
                <span className={`llm-status-dot ${llmConfigured ? 'configured' : 'missing'}`} aria-hidden="true" />
                <span>
                  <span className="llm-menu-summary-title">
                    {llmConfigured ? 'Configured' : 'Not configured'}
                  </span>
                  <span className="llm-menu-summary-detail">
                    {llmConfigured && llmModel ? llmModel : 'Add an API key in Settings'}
                  </span>
                </span>
              </span>
            </MenubarLabel>
            <MenubarSeparator />
            <MenubarGroup>
              <MenubarItem onSelect={onGenerateFromFocus} disabled={!apiAvailable || !canSelectFocus}>
                <Bot />
                Generate for focused section
              </MenubarItem>
              <MenubarItem onSelect={onSettings} disabled={!apiAvailable}>
                <Settings />
                Settings
              </MenubarItem>
            </MenubarGroup>
          </MenubarContent>
        </MenubarMenu>
      </Menubar>
    </header>
  );
}

function SettingsSheet({
  open,
  settings,
  onOpenChange,
  onSaved,
  onError,
  onStatus
}: {
  open: boolean;
  settings: PublicLlmSettings | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (settings: PublicLlmSettings) => void;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
}) {
  const [provider, setProvider] = useState<LlmProviderKind>('openai-compatible');
  const [baseURL, setBaseURL] = useState('https://api.openai.com/v1');
  const [model, setModel] = useState('gpt-5');
  const [apiKey, setApiKey] = useState('');

  useEffect(() => {
    if (!settings) {
      return;
    }
    setProvider(settings.provider);
    setBaseURL(settings.baseURL);
    setModel(settings.model);
    setApiKey('');
  }, [settings, open]);

  function updateProvider(nextProvider: LlmProviderKind) {
    setProvider(nextProvider);
    if (nextProvider === 'anthropic-compatible' && baseURL === 'https://api.openai.com/v1') {
      setBaseURL('https://api.anthropic.com/v1');
      setModel('claude-sonnet-4-5');
    }
    if (nextProvider === 'openai-compatible' && baseURL === 'https://api.anthropic.com/v1') {
      setBaseURL('https://api.openai.com/v1');
      setModel('gpt-5');
    }
  }

  async function saveSettings() {
    try {
      const next = await getApi().updateLlmSettings({
        provider,
        baseURL,
        model,
        apiKey: apiKey.trim() ? apiKey : undefined
      });
      onSaved(next);
      setApiKey('');
      onStatus('LLM settings saved.');
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Settings</SheetTitle>
        </SheetHeader>
        <div className="settings-form">
          <section className="panel">
            <div className="artifact-heading">
              <div>
                <h2>LLM</h2>
                <p className="muted">{settings?.hasApiKey ? 'API key saved' : 'API key missing'}</p>
              </div>
            </div>
            <label className="field-label">
              Provider
              <Select value={provider} onValueChange={(value) => updateProvider(value as LlmProviderKind)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai-compatible">OpenAI compatible</SelectItem>
                  <SelectItem value="anthropic-compatible">Anthropic compatible</SelectItem>
                </SelectContent>
              </Select>
            </label>
            <label className="field-label">
              URL
              <Input value={baseURL} onChange={(event) => setBaseURL(event.target.value)} />
            </label>
            <label className="field-label">
              Model
              <Input value={model} onChange={(event) => setModel(event.target.value)} />
            </label>
            <label className="field-label">
              API Key
              <Input
                value={apiKey}
                type="password"
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={settings?.hasApiKey ? 'Stored; enter a new key to replace' : 'API key'}
              />
            </label>
            <div className="button-row">
              <Button size="sm" onClick={() => void saveSettings()} disabled={!baseURL.trim() || !model.trim()}>
                <Save />
                Save
              </Button>
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SidebarLeft({
  nodes,
  activeId,
  onSelectSection,
  onMoveSection,
  onAddChild
}: {
  nodes: FocusedWorkspaceState['compositionTree'];
  activeId: string | null;
  onSelectSection: (id: string) => void;
  onMoveSection: (id: string, parentId: string | null, index: number) => void;
  onAddChild: () => void;
}) {
  return (
    <Sidebar className="top-(--header-height) h-[calc(100svh-var(--header-height))]" collapsible="offcanvas">
      <SidebarHeader>
        <div className="px-2 py-1 text-xs font-medium text-sidebar-foreground/70">Navigation</div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarSeparator />
        <SidebarGroup className="min-h-0 flex-1">
          <div className="flex items-center justify-between px-2">
            <SidebarGroupLabel className="px-0">Composition</SidebarGroupLabel>
            <Button variant="ghost" size="icon-xs" onClick={onAddChild} disabled={!activeId} title="Add child section">
              <FolderPlus />
              <span className="sr-only">Add child section</span>
            </Button>
          </div>
          <SidebarGroupContent>
            <Outline nodes={nodes} activeId={activeId} onSelect={onSelectSection} onMove={onMoveSection} />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}

function SidebarRight({ children }: { children: React.ReactNode }) {
  return (
    <Sidebar side="right" className="top-(--header-height) h-[calc(100svh-var(--header-height))]" collapsible="offcanvas">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="cursor-default">
              <div className="flex size-8 items-center justify-center rounded-lg bg-sidebar-accent text-sidebar-accent-foreground">
                <Save className="size-4" />
              </div>
              <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">Inspector</span>
                <span className="truncate text-xs text-sidebar-foreground/70">Edit selected content</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup className="min-h-0 flex-1">
          <SidebarGroupContent>{children}</SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}

function ViewModeToggle({
  mode,
  onModeChange
}: {
  mode: ChildViewMode;
  onModeChange: (mode: ChildViewMode) => void;
}) {
  return (
    <div className="view-mode-toggle" role="group" aria-label="Children view mode">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={mode === 'graph' ? 'default' : 'outline'}
            size="icon-sm"
            onClick={() => onModeChange('graph')}
            aria-label="Graph view"
            title="Graph view"
          >
            <GitBranch />
            <span className="sr-only">Graph</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Graph</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={mode === 'list' ? 'default' : 'outline'}
            size="icon-sm"
            onClick={() => onModeChange('list')}
            aria-label="List view"
            title="List view"
          >
            <List />
            <span className="sr-only">List</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>List</TooltipContent>
      </Tooltip>
    </div>
  );
}

function ChildrenViewHeader({
  title,
  detail,
  mode,
  onModeChange
}: {
  title: string;
  detail: string;
  mode: ChildViewMode;
  onModeChange: (mode: ChildViewMode) => void;
}) {
  return (
    <div className="children-view-header">
      <div className="children-view-title">
        <h1>{title}</h1>
        <p className="muted">{detail}</p>
      </div>
      <ViewModeToggle mode={mode} onModeChange={onModeChange} />
    </div>
  );
}

type SectionListItem = {
  node: CompositionTreeNode;
  depth: number;
};

function SectionListView({
  state,
  focusSectionId,
  rootNodeId,
  selection,
  onSelection,
  onFocusSection,
  childViewMode,
  onChildViewMode,
  onState,
  onError
}: {
  state: FocusedWorkspaceState;
  focusSectionId: string | null;
  rootNodeId: string | null;
  selection: Selection;
  onSelection: (selection: Selection) => void;
  onFocusSection: (sectionId: string) => void;
  childViewMode: ChildViewMode;
  onChildViewMode: (mode: ChildViewMode) => void;
  onState: (state: FocusedWorkspaceState) => void;
  onError: (message: string) => void;
}) {
  const focusNode = useMemo(
    () => (focusSectionId ? findSectionTreeNode(state.compositionTree, focusSectionId) : null),
    [focusSectionId, state.compositionTree]
  );
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!focusNode) {
      setExpandedIds(new Set());
      return;
    }
    setExpandedIds(new Set(collectSectionTreeIds(focusNode.children)));
  }, [focusNode?.id]);

  const rows = useMemo(() => {
    if (!focusNode) {
      return [];
    }
    const nextRows: SectionListItem[] = [];
    appendVisibleSectionRows(focusNode.children, expandedIds, nextRows, 0);
    return nextRows;
  }, [expandedIds, focusNode]);

  if (!focusSectionId || !focusNode) {
    return (
      <section className="section-list-view empty">
        <p className="muted">Open a workspace to manage sections.</p>
      </section>
    );
  }

  return (
    <section className="section-list-view">
      <ChildrenViewHeader
        title={focusNode.title}
        detail={`${rows.length} visible section${rows.length === 1 ? '' : 's'}`}
        mode={childViewMode}
        onModeChange={onChildViewMode}
      />
      {focusNode.children.length === 0 ? (
        <div className="section-list-empty">
          <p className="muted">This section has no child sections yet.</p>
        </div>
      ) : (
        <div className="section-list-table" role="treegrid" aria-label="Section list">
          <div className="section-list-heading" role="row">
            <div>Section</div>
            <div>Intent</div>
            <div>Metadata</div>
            <div />
          </div>
          <div className="section-list-body">
            {rows.map(({ node, depth }) => (
              <SectionListRow
                key={node.id}
                node={node}
                depth={depth}
                selected={selection?.type === 'node' && selection.id === node.id}
                expanded={expandedIds.has(node.id)}
                rootNodeId={rootNodeId}
                stats={state.nodeStats[node.id]}
                focusSectionId={focusSectionId}
                onSelection={onSelection}
                onFocusSection={onFocusSection}
                onToggleExpanded={(id) => {
                  setExpandedIds((current) => {
                    const next = new Set(current);
                    if (next.has(id)) {
                      next.delete(id);
                    } else {
                      next.add(id);
                    }
                    return next;
                  });
                }}
                onState={onState}
                onError={onError}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function SectionListRow({
  node,
  depth,
  selected,
  expanded,
  rootNodeId,
  stats,
  focusSectionId,
  onSelection,
  onFocusSection,
  onToggleExpanded,
  onState,
  onError
}: {
  node: CompositionTreeNode;
  depth: number;
  selected: boolean;
  expanded: boolean;
  rootNodeId: string | null;
  stats: NodeStats | undefined;
  focusSectionId: string;
  onSelection: (selection: Selection) => void;
  onFocusSection: (sectionId: string) => void;
  onToggleExpanded: (sectionId: string) => void;
  onState: (state: FocusedWorkspaceState) => void;
  onError: (message: string) => void;
}) {
  const [title, setTitle] = useState(node.title);
  const [intent, setIntent] = useState(node.intent ?? '');
  const [editingField, setEditingField] = useState<'title' | 'intent' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const hasChildren = node.children.length > 0;

  useEffect(() => {
    setTitle(node.title);
    setIntent(node.intent ?? '');
    setEditingField(null);
    setError(null);
  }, [node.id]);

  async function saveSectionDraft(): Promise<boolean> {
    if (!title.trim()) {
      setError('Title is required.');
      setEditingField('title');
      return false;
    }

    const trimmedTitle = title.trim();
    setTitle(trimmedTitle);
    if (trimmedTitle === node.title && intent === (node.intent ?? '')) {
      setError(null);
      return true;
    }

    try {
      setError(null);
      setSaving(true);
      await getApi().updateNode(node.id, {
        title: trimmedTitle,
        intent
      });
      onState(await getApi().getState(focusSectionId));
      return true;
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function commitEditingField(field: 'title' | 'intent') {
    const saved = await saveSectionDraft();
    if (saved) {
      setEditingField((current) => (current === field ? null : current));
    }
  }

  return (
    <div
      className={`section-list-row${selected ? ' selected' : ''}${error ? ' invalid' : ''}`}
      role="row"
      onClick={() => onSelection({ type: 'node', id: node.id })}
    >
      <div className="section-list-title-cell" style={{ '--section-depth': depth } as CSSProperties}>
        <button
          type="button"
          className="section-list-expander"
          onClick={(event) => {
            event.stopPropagation();
            if (hasChildren) {
              onToggleExpanded(node.id);
            }
          }}
          disabled={!hasChildren}
          title={hasChildren ? (expanded ? 'Collapse section' : 'Expand section') : 'No child sections'}
        >
          {hasChildren ? expanded ? <ChevronDown /> : <ChevronRight /> : <span aria-hidden="true" />}
        </button>
        {editingField === 'title' ? (
          <Input
            value={title}
            autoFocus
            aria-label={`${node.title} title`}
            className="section-list-title-input"
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => {
              const nextTitle = event.target.value;
              setTitle(nextTitle);
              if (nextTitle.trim()) {
                setError(null);
              }
            }}
            onBlur={() => void commitEditingField('title')}
          />
        ) : (
          <button
            type="button"
            className="section-list-title-display"
            onClick={(event) => {
              event.stopPropagation();
              onSelection({ type: 'node', id: node.id });
              setEditingField('title');
            }}
          >
            {title || node.title}
          </button>
        )}
      </div>
      <div className="section-list-intent-cell">
        {editingField === 'intent' ? (
          <Textarea
            value={intent}
            autoFocus
            aria-label={`${node.title} intent`}
            className="section-list-intent-input"
            placeholder="Intent"
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => {
              setIntent(event.target.value);
            }}
            onBlur={() => void commitEditingField('intent')}
          />
        ) : (
          <button
            type="button"
            className={`section-list-intent-display${intent.trim() ? '' : ' empty'}`}
            onClick={(event) => {
              event.stopPropagation();
              onSelection({ type: 'node', id: node.id });
              setEditingField('intent');
            }}
          >
            {intent.trim() ? intent : 'No intent'}
          </button>
        )}
        {error ? <span className="section-list-error">{error}</span> : null}
      </div>
      <div className="section-list-meta-cell">
        <span>{node.children.length} child sections</span>
        <span>{formatNodeStats(stats)}</span>
        {node.id === rootNodeId ? <span>Root</span> : null}
        {saving ? <span>Saving</span> : null}
      </div>
      <div className="section-list-action-cell">
        <Button
          variant="ghost"
          size="sm"
          onClick={(event) => {
            event.stopPropagation();
            onFocusSection(node.id);
          }}
        >
          Enter
        </Button>
      </div>
    </div>
  );
}

function WritingView({
  contentNode,
  parentSection,
  onBack,
  onState,
  onError
}: {
  contentNode: ContentNodeRecord;
  parentSection: SectionNodeRecord | null;
  onBack: () => Promise<void>;
  onState: (state: FocusedWorkspaceState) => void;
  onError: (message: string) => void;
}) {
  const [draft, setDraft] = useState(contentNode.content);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const timerRef = useRef<number | null>(null);
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());
  const draftRef = useRef(contentNode.content);
  const lastSavedRef = useRef(contentNode.content);
  const contentRef = useRef(contentNode);
  const onStateRef = useRef(onState);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    contentRef.current = contentNode;
    onStateRef.current = onState;
    onErrorRef.current = onError;
  }, [contentNode, onState, onError]);

  useEffect(() => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    draftRef.current = contentNode.content;
    lastSavedRef.current = contentNode.content;
    setDraft(contentNode.content);
    setSaveState('saved');
  }, [contentNode.id]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (draftRef.current !== lastSavedRef.current) {
        void persistDraft(draftRef.current, true);
      }
    };
  }, []);

  function persistDraft(value: string, silent = false) {
    if (value === lastSavedRef.current) {
      return saveChainRef.current;
    }

    saveChainRef.current = saveChainRef.current.then(async () => {
      const content = contentRef.current;
      if (value === lastSavedRef.current) {
        return;
      }

      try {
        if (!silent) {
          setSaveState('saving');
        }
        const next = await getApi().updateNode(content.id, { content: value });
        lastSavedRef.current = value;
        onStateRef.current(next);
        if (!silent) {
          setSaveState(draftRef.current === value ? 'saved' : 'saving');
        }
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        if (!silent) {
          setSaveState(draftRef.current === value ? 'error' : 'saving');
          onErrorRef.current(message);
        }
      }
    });

    return saveChainRef.current;
  }

  function scheduleDraftSave(value: string) {
    setDraft(value);
    draftRef.current = value;
    setSaveState(value === lastSavedRef.current ? 'saved' : 'saving');

    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void persistDraft(value);
    }, 700);
  }

  async function flushPendingSave() {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    await persistDraft(draftRef.current);
  }

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
          <LatexEditor key={contentNode.id} value={draft} onChange={scheduleDraftSave} />
        </div>
      </div>
    </section>
  );
}

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

function Inspector(props: InspectorProps) {
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

function FloatingActionToolbar({
  selection,
  selectedSection,
  selectedContent,
  selectedEdge,
  focusSection,
  llmDraft,
  contextNodes,
  onCreateInSection,
  onCreateConnectedContent,
  onDeleteNode,
  onOpenGenerate,
  onPromptChange,
  onContextNodeToggle,
  onGenerate,
  onRegenerate,
  onCancelGenerate,
  onSaveGenerate,
  onUpdateEdgeKind,
  onDeleteEdge
}: {
  selection: Selection;
  selectedSection: SectionNodeRecord | null;
  selectedContent: ContentNodeRecord | null;
  selectedEdge: FocusedWorkspaceState['edges'][number] | null;
  focusSection: SectionNodeRecord | null;
  llmDraft: LlmDraftState;
  contextNodes: ContentNodeRecord[];
  onCreateInSection: (sectionId: string, preset: ContentPreset) => void;
  onCreateConnectedContent: (nodeId: string, preset: ContentPreset) => void;
  onDeleteNode: () => void;
  onOpenGenerate: (sectionId: string) => void;
  onPromptChange: (value: string) => void;
  onContextNodeToggle: (nodeId: string, checked: boolean) => void;
  onGenerate: (prompt: string, sectionId: string, contextNodeIds: string[]) => void;
  onRegenerate: () => void;
  onCancelGenerate: () => void;
  onSaveGenerate: () => void;
  onUpdateEdgeKind: (relationType: EdgeKind) => void;
  onDeleteEdge: () => void;
}) {
  const generateTargetId = selectedSection?.id ?? selectedContent?.parentId ?? focusSection?.id ?? null;
  const generationComplete = llmDraft.status === 'done' && llmDraft.content.trim().length > 0;
  const generationRunning = llmDraft.status === 'running';
  const generationMessage = llmDraft.content
    ? llmDraft.content
    : generationRunning
      ? 'Waiting for the first token...'
      : llmDraft.error;
  const availableContextNodes = llmDraft.targetSectionId ? contextNodes : [];

  return (
    <div className="floating-action-toolbar" aria-label="Node actions">
      {llmDraft.open ? (
        <div className="floating-generate-composer">
          <Textarea
            value={llmDraft.prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            placeholder="Prompt for a new generation"
            disabled={generationRunning}
          />
          <div className="floating-generation-context">
            <div className="floating-generation-context-heading">
              <span>Context</span>
              <span>{availableContextNodes.length} node{availableContextNodes.length === 1 ? '' : 's'}</span>
            </div>
            {availableContextNodes.length > 0 ? (
              <div className="floating-generation-context-list">
                {availableContextNodes.map((node) => {
                  const checked = llmDraft.contextNodeIds.includes(node.id);
                  const disabled = generationRunning || !node.content.trim();
                  return (
                    <label key={node.id} className="floating-generation-context-item">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={(event) => onContextNodeToggle(node.id, event.target.checked)}
                      />
                      <span>
                        <strong>{node.title}</strong>
                        <em>{formatContentFlags(node)}</em>
                        <small>{formatContentPreview(node)}</small>
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <p>No content nodes in this workspace.</p>
            )}
          </div>
          {generationMessage ? (
            <div className="floating-generation-output">
              {generationMessage}
            </div>
          ) : null}
          <div className="floating-generation-actions">
            <button type="button" title="Cancel generation" onClick={onCancelGenerate}>
              <X />
              <span className="sr-only">Cancel generation</span>
            </button>
            {generationComplete ? (
              <>
                <button type="button" title="Regenerate" onClick={onRegenerate}>
                  <RefreshCw />
                  <span className="sr-only">Regenerate</span>
                </button>
                <button type="button" title="Save generation as content" onClick={onSaveGenerate}>
                  <Check />
                  <span className="sr-only">Save generation as content</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                title="Generate"
                onClick={() => {
                  if (llmDraft.targetSectionId && llmDraft.prompt.trim()) {
                    onGenerate(
                      llmDraft.prompt.trim(),
                      llmDraft.targetSectionId,
                      llmDraft.contextNodeIds
                    );
                  }
                }}
                disabled={generationRunning || !llmDraft.prompt.trim() || !llmDraft.targetSectionId}
              >
                <Bot />
                <span className="sr-only">Generate</span>
              </button>
            )}
          </div>
        </div>
      ) : null}
      <div className="floating-action-buttons">
        {selectedSection ? (
          <>
            <button
              type="button"
              title="Create main content"
              onClick={() => onCreateInSection(selectedSection.id, 'main')}
            >
              <FileText />
              <span className="sr-only">Create main content</span>
            </button>
            <button
              type="button"
              title="Create artifact content"
              onClick={() => onCreateInSection(selectedSection.id, 'artifact')}
            >
              <Plus />
              <span className="sr-only">Create artifact content</span>
            </button>
            <button
              type="button"
              className={llmDraft.open ? 'active' : undefined}
              title="Generate with LLM"
              onClick={() => onOpenGenerate(selectedSection.id)}
            >
              <Bot />
              <span className="sr-only">Generate with LLM</span>
            </button>
          </>
        ) : null}
        {selectedContent ? (
          <>
            <button
              type="button"
              title="Create connected artifact content"
              onClick={() => onCreateConnectedContent(selectedContent.id, 'artifact')}
            >
              <Plus />
              <span className="sr-only">Create connected artifact content</span>
            </button>
            <button
              type="button"
              title="Create connected main content"
              onClick={() => onCreateConnectedContent(selectedContent.id, 'main')}
            >
              <FileText />
              <span className="sr-only">Create connected main content</span>
            </button>
            <button type="button" className="danger" title="Delete content" onClick={onDeleteNode}>
              <Trash2 />
              <span className="sr-only">Delete content</span>
            </button>
            {generateTargetId ? (
              <button
                type="button"
                className={llmDraft.open ? 'active' : undefined}
                title="Generate with LLM"
                onClick={() => onOpenGenerate(generateTargetId)}
              >
                <Bot />
                <span className="sr-only">Generate with LLM</span>
              </button>
            ) : null}
          </>
        ) : null}
        {selectedEdge ? (
          <div className="floating-edge-editor">
            <span>Relation</span>
            <Select value={selectedEdge.relationType} onValueChange={(value) => onUpdateEdgeKind(value as EdgeKind)}>
              <SelectTrigger size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="informs">informs</SelectItem>
                <SelectItem value="generates">generates</SelectItem>
                <SelectItem value="revises">revises</SelectItem>
                <SelectItem value="related-to">related-to</SelectItem>
              </SelectContent>
            </Select>
            <button type="button" className="danger edge-delete-button" title="Delete edge" onClick={onDeleteEdge}>
              <Trash2 />
              <span className="sr-only">Delete edge</span>
            </button>
          </div>
        ) : null}
        {!selection ? (
          <button type="button" disabled title="Select a node">
            <Plus />
            <span className="sr-only">Select a node</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}

function PaperFlowNode({ data, selected }: NodeProps<PaperNode>) {
  return (
    <div className={`paper-flow-node tone-${data.tone}${selected ? ' selected' : ''}`}>
      <NodeResizeControl
        position="bottom-right"
        className="paper-node-resize-overlay"
        minWidth={160}
        minHeight={88}
        onResizeEnd={(_event, params) => {
          data.onLayoutChange({
            canvasSectionId: data.canvasSectionId,
            nodeId: data.nodeId,
            x: params.x,
            y: params.y,
            width: params.width,
            height: params.height
          });
        }}
      >
        <span className="paper-node-resize-grip" aria-hidden="true" />
      </NodeResizeControl>
      <Handle
        id="top-target"
        type="target"
        position={Position.Top}
        className="paper-node-handle paper-node-handle-vertical"
      />
      <Handle
        id="left-target"
        type="target"
        position={Position.Left}
        className="paper-node-handle paper-node-handle-horizontal"
      />
      <div className="paper-node-eyebrow">{data.eyebrow}</div>
      <div className="paper-node-title">{data.title}</div>
      {data.meta ? <div className="paper-node-meta">{data.meta}</div> : null}
      {data.content ? <div className="paper-node-content">{data.content}</div> : null}
      <Handle
        id="right-source"
        type="source"
        position={Position.Right}
        className="paper-node-handle paper-node-handle-horizontal"
      />
      <Handle
        id="bottom-source"
        type="source"
        position={Position.Bottom}
        className="paper-node-handle paper-node-handle-vertical"
      />
    </div>
  );
}

function findSectionTreeNode(nodes: CompositionTreeNode[], id: string): CompositionTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }
    const child = findSectionTreeNode(node.children, id);
    if (child) {
      return child;
    }
  }
  return null;
}

function collectSectionTreeIds(nodes: CompositionTreeNode[]): string[] {
  return nodes.flatMap((node) => [node.id, ...collectSectionTreeIds(node.children)]);
}

function appendVisibleSectionRows(
  nodes: CompositionTreeNode[],
  expandedIds: Set<string>,
  rows: SectionListItem[],
  depth: number
) {
  nodes.forEach((node) => {
    rows.push({ node, depth });
    if (expandedIds.has(node.id)) {
      appendVisibleSectionRows(node.children, expandedIds, rows, depth + 1);
    }
  });
}

function buildGraph(
  state: FocusedWorkspaceState,
  selection: Selection,
  onLayoutChange: (payload: UpdateNodeLayoutPayload) => void
): {
  nodes: PaperNode[];
  edges: Edge[];
} {
  const focusId = state.focusSectionId;
  const nodes: PaperNode[] = [];
  const edges: Edge[] = [];
  const layoutByNodeId = new Map(state.nodeLayouts.map((layout) => [layout.nodeId, layout]));

  if (!focusId) {
    return { nodes, edges };
  }

  const getNodeLayout = (
    nodeId: string,
    defaultPosition: { x: number; y: number },
    defaultSize: { width: number; height: number }
  ) => {
    const layout = layoutByNodeId.get(nodeId);
    const width = layout?.width ?? defaultSize.width;
    const height = layout?.height ?? defaultSize.height;

    return {
      position: layout ? { x: layout.x, y: layout.y } : defaultPosition,
      width,
      height,
      style: { width, height }
    };
  };

  const childSections = state.visibleNodes.filter(
    (node): node is SectionNodeRecord => node.kind === 'section' && node.parentId === focusId
  );
  childSections.forEach((section, index) => {
    const stats = state.nodeStats[section.id];
    nodes.push({
      id: section.id,
      type: 'paper',
      ...getNodeLayout(
        section.id,
        { x: 40 + index * 260, y: 80 },
        { width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT }
      ),
      selected: selection?.type === 'node' && selection.id === section.id,
      data: {
        nodeId: section.id,
        canvasSectionId: focusId,
        kind: 'section',
        eyebrow: `Section ${index + 1}`,
        title: section.title,
        meta: formatNodeStats(stats),
        tone: 'child-container',
        layoutKey: `section:${section.id}:${index}`,
        onLayoutChange
      }
    });
  });

  const orderedContent = orderContentNodes(
    state.visibleNodes.filter(
      (node): node is ContentNodeRecord => node.kind === 'content' && node.parentId === focusId
    ),
    state.edges
  );

  orderedContent.forEach((content, index) => {
    nodes.push({
      id: content.id,
      type: 'paper',
      ...getNodeLayout(
        content.id,
        { x: 80 + index * 280, y: 220 },
        { width: DEFAULT_CONTENT_NODE_WIDTH, height: DEFAULT_CONTENT_NODE_HEIGHT }
      ),
      selected: selection?.type === 'node' && selection.id === content.id,
      data: {
        nodeId: content.id,
        canvasSectionId: focusId,
        kind: 'content',
        eyebrow: formatContentFlags(content),
        title: content.title,
        content: content.content || undefined,
        tone: content.isLlm ? 'artifact' : content.isArtifact ? 'source_note' : 'author_text',
        layoutKey: `content:${content.id}:${index}`,
        onLayoutChange
      }
    });
  });

  const visibleContentIds = new Set(orderedContent.map((node) => node.id));
  state.edges.forEach((edge) => {
    if (!visibleContentIds.has(edge.fromNodeId) || !visibleContentIds.has(edge.toNodeId)) {
      return;
    }

    edges.push({
      id: edge.id,
      source: edge.fromNodeId,
      sourceHandle: 'right-source',
      target: edge.toNodeId,
      targetHandle: 'left-target',
      label: edge.relationType,
      markerEnd: { type: MarkerType.ArrowClosed },
      type: 'smoothstep',
      selected: selection?.type === 'edge' && selection.id === edge.id,
      className: selection?.type === 'edge' && selection.id === edge.id ? 'process-edge selected-edge' : 'process-edge'
    });
  });

  return { nodes, edges };
}

function orderContentNodes(contentNodes: ContentNodeRecord[], edges: FocusedWorkspaceState['edges']): ContentNodeRecord[] {
  const byId = new Map(contentNodes.map((node) => [node.id, node]));
  const sorted = [...contentNodes].sort(compareNodeOrder);
  const indegree = new Map(sorted.map((node) => [node.id, 0]));
  const outgoing = new Map(sorted.map((node) => [node.id, [] as string[]]));

  edges.forEach((edge) => {
    if (!byId.has(edge.fromNodeId) || !byId.has(edge.toNodeId)) {
      return;
    }
    outgoing.get(edge.fromNodeId)?.push(edge.toNodeId);
    indegree.set(edge.toNodeId, (indegree.get(edge.toNodeId) ?? 0) + 1);
  });

  const queue = sorted.filter((node) => indegree.get(node.id) === 0);
  const ordered: ContentNodeRecord[] = [];
  const seen = new Set<string>();

  while (queue.length > 0) {
    queue.sort(compareNodeOrder);
    const node = queue.shift()!;
    if (seen.has(node.id)) {
      continue;
    }
    seen.add(node.id);
    ordered.push(node);

    outgoing.get(node.id)?.forEach((targetId) => {
      const nextIndegree = (indegree.get(targetId) ?? 0) - 1;
      indegree.set(targetId, nextIndegree);
      if (nextIndegree === 0) {
        const target = byId.get(targetId);
        if (target) {
          queue.push(target);
        }
      }
    });
  }

  sorted.forEach((node) => {
    if (!seen.has(node.id)) {
      ordered.push(node);
    }
  });

  return ordered;
}

function compareNodeOrder(left: NodeRecord, right: NodeRecord) {
  return left.sortOrder - right.sortOrder || left.createdAt.localeCompare(right.createdAt);
}

function formatContentPreview(node: ContentNodeRecord) {
  const content = node.content.trim();
  if (!content) {
    return 'Empty content';
  }
  return content.length > 110 ? `${content.slice(0, 110)}...` : content;
}

function getGenerationPrompt(node: ContentNodeRecord | null | undefined) {
  const prompt = node?.metadata.prompt;
  if (typeof prompt !== 'string') {
    return undefined;
  }
  const trimmed = prompt.trim();
  return trimmed || undefined;
}

function formatNodeStats(stats?: NodeStats) {
  const counts = stats ?? {
    sectionCount: 0,
    contentCount: 0,
    mainContentCount: 0,
    artifactCount: 0,
    llmCount: 0
  };

  return [
    formatCount(counts.sectionCount, 'section'),
    formatCount(counts.contentCount, 'content'),
    formatCount(counts.mainContentCount, 'main'),
    formatCount(counts.artifactCount, 'artifact'),
    formatCount(counts.llmCount, 'LLM')
  ].join(' · ');
}

function formatContentFlags(node: ContentNodeRecord) {
  const flags = [
    node.isMain ? 'main' : null,
    node.isArtifact ? 'artifact' : null,
    node.isLlm ? 'LLM' : null
  ].filter(Boolean);
  return flags.length > 0 ? flags.join(' · ') : 'content';
}

function formatCount(count: number, label: string) {
  return `${count} ${label}${count === 1 || label === 'LLM' ? '' : 's'}`;
}

function reconcileNodes(nextNodes: Node[], currentNodes: Node[]): Node[] {
  const currentById = new Map(currentNodes.map((node) => [node.id, node]));

  return nextNodes.map((nextNode) => {
    const currentNode = currentById.get(nextNode.id);
    if (!currentNode) {
      return nextNode;
    }

    const keepInteractiveLayout =
      currentNode.data?.layoutKey === nextNode.data?.layoutKey ||
      currentNode.dragging ||
      currentNode.resizing;

    return {
      ...nextNode,
      position: keepInteractiveLayout ? currentNode.position : nextNode.position,
      width: keepInteractiveLayout ? currentNode.width ?? nextNode.width : nextNode.width,
      height: keepInteractiveLayout ? currentNode.height ?? nextNode.height : nextNode.height,
      style: keepInteractiveLayout ? currentNode.style ?? nextNode.style : nextNode.style,
      selected: nextNode.selected,
      dragging: currentNode.dragging,
      resizing: currentNode.resizing
    };
  });
}
