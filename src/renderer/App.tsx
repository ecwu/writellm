import { useEffect, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  applyNodeChanges,
  type Connection,
  type Edge,
  type Node,
  type NodeChange
} from '@xyflow/react';
import {
  Bot,
  Check,
  FileText,
  FolderPlus,
  GitBranch,
  Library,
  MessageSquare,
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
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage
} from './components/ui/breadcrumb';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
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
  SidebarFooter,
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
import { TooltipProvider } from './components/ui/tooltip';
import type {
  ArtifactRecord,
  AuthorTextRecord,
  ContainerRecord,
  EdgeKind,
  FocusedWorkspaceState,
  LlmProviderKind,
  PublicLlmSettings,
  ReviewCommentRecord,
  TextRange
} from '../shared/types';

const emptyState: FocusedWorkspaceState = {
  workspace: null,
  compositionTree: [],
  focusContainerId: null,
  containers: [],
  artifacts: [],
  authorTexts: [],
  reviewComments: [],
  edges: []
};

type Selection =
  | { type: 'container'; id: string }
  | { type: 'artifact'; id: string }
  | { type: 'edge'; id: string }
  | null;

type QuickArtifactKind = 'author_text' | 'source_note';

type LlmDraftState = {
  open: boolean;
  runId: string | null;
  targetContainerId: string | null;
  prompt: string;
  content: string;
  status: 'idle' | 'running' | 'done' | 'error';
  error?: string;
};

const emptyLlmDraft: LlmDraftState = {
  open: false,
  runId: null,
  targetContainerId: null,
  prompt: '',
  content: '',
  status: 'idle'
};

type PaperNodeData = Record<string, unknown> & {
  artifactId?: string;
  containerId?: string;
  eyebrow: string;
  title: string;
  meta?: string;
  tone: 'container' | 'child-container' | 'author_text' | 'source_note' | 'review_comment' | 'artifact';
  layoutKey: string;
};

type PaperNode = Node<PaperNodeData, 'paper'>;

function formatWorkspaceTitle(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

export function App() {
  const [state, setState] = useState<FocusedWorkspaceState>(emptyState);
  const [workspacePath, setWorkspacePath] = useState(
    '/Users/zhenghaowu/Developer/llm-write-canvas/my-paper.paperlab'
  );
  const [selection, setSelection] = useState<Selection>(null);
  const [range, setRange] = useState<TextRange>({});
  const [flowNodes, setFlowNodes] = useState<Node[]>([]);
  const [edgeKind, setEdgeKind] = useState<EdgeKind>('informs');
  const [commentComposerOpen, setCommentComposerOpen] = useState(false);
  const [commentDraft, setCommentDraft] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [llmSettings, setLlmSettings] = useState<PublicLlmSettings | null>(null);
  const [llmDraft, setLlmDraft] = useState<LlmDraftState>(emptyLlmDraft);

  const apiAvailable = Boolean(window.paperlab);
  const focusContainer = state.containers.find((container) => container.id === state.focusContainerId);
  const selectedContainer =
    selection?.type === 'container'
      ? state.containers.find((container) => container.id === selection.id)
      : null;
  const selectedArtifact =
    selection?.type === 'artifact'
      ? state.artifacts.find((artifact) => artifact.id === selection.id)
      : null;
  const selectedAuthorText =
    selectedArtifact?.kind === 'author_text'
      ? state.authorTexts.find((text) => text.artifactId === selectedArtifact.id)
      : null;
  const selectedEdge =
    selection?.type === 'edge' ? state.edges.find((edge) => edge.id === selection.id) : null;

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

  function notifyStatus(message: string) {
    toast.success(message);
  }

  function notifyError(message: string) {
    toast.error(message);
  }

  async function refresh(focusContainerId = state.focusContainerId ?? undefined) {
    const next = await getApi().getState(focusContainerId);
    setState(next);
    if (!selection && next.focusContainerId) {
      setSelection({ type: 'container', id: next.focusContainerId });
    } else if (selection?.type === 'edge' && !next.edges.some((edge) => edge.id === selection.id)) {
      setSelection(next.focusContainerId ? { type: 'container', id: next.focusContainerId } : null);
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

  const graph = useMemo(() => buildGraph(state, selection), [state, selection]);
  const nodeTypes = useMemo(() => ({ paper: PaperFlowNode }), []);

  useEffect(() => {
    setCommentComposerOpen(false);
    setCommentDraft('');
  }, [selectedAuthorText?.artifactId]);

  useEffect(() => {
    setFlowNodes((current) => reconcileNodes(graph.nodes, current));
  }, [graph.nodes]);

  function onNodesChange(changes: NodeChange[]) {
    setFlowNodes((current) => applyNodeChanges(changes, current));
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
      const next = await getApi().getState(summary.rootContainerId);
      setSelection({ type: 'container', id: summary.rootContainerId });
      return next;
    }, mode === 'create' ? 'Workspace created.' : 'Workspace opened.');
  }

  async function focusContainerById(containerId: string) {
    await run(async () => getApi().getState(containerId));
    setSelection({ type: 'container', id: containerId });
  }

  async function moveContainerInOutline(containerId: string, parentId: string | null, index: number) {
    if (!parentId || index < 0) {
      return;
    }
    await run(
      async () => {
        await getApi().moveContainer(containerId, parentId, index);
        return getApi().getState(state.focusContainerId ?? parentId);
      },
      'Composition order updated.'
    );
  }

  async function onConnect(connection: Connection) {
    if (!connection.source || !connection.target) {
      return;
    }
    const source = graph.nodeIdToArtifactId.get(connection.source);
    const target = graph.nodeIdToArtifactId.get(connection.target);
    if (!source || !target) {
      notifyError('Process edges can only connect artifact nodes.');
      return;
    }
    await run(async () => {
      const edge = await getApi().createProcessEdge(source, target, edgeKind);
      setSelection({ type: 'edge', id: edge.id });
      return getApi().getState(state.focusContainerId ?? undefined);
    }, 'Process edge created.');
  }

  async function updateSelectedEdgeKind(relationType: EdgeKind) {
    if (!selectedEdge) {
      return;
    }

    try {
      const api = getApi();
      if (typeof api.updateProcessEdge !== 'function') {
        toast.error('The Electron preload is out of date. Reload the window before editing edge properties.', {
          action: {
            label: 'Reload',
            onClick: () => window.location.reload()
          }
        });
        return;
      }

      await api.updateProcessEdge(selectedEdge.id, relationType);
      const next = await api.getState(state.focusContainerId ?? undefined);
      setState(next);
      setSelection({ type: 'edge', id: selectedEdge.id });
      notifyStatus('Process edge updated.');
    } catch (caught) {
      notifyError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function createConnectedArtifact(fromArtifactId: string, artifactKind: QuickArtifactKind) {
    const sourceArtifact = state.artifacts.find((artifact) => artifact.id === fromArtifactId);
    const containerId = sourceArtifact?.containerId ?? state.focusContainerId;
    if (!containerId) {
      notifyError('Select an artifact inside a container before adding the next artifact.');
      return;
    }

    const existingIds = new Set(state.artifacts.map((artifact) => artifact.id));
    const label = artifactKind === 'author_text' ? 'AuthorText' : 'SourceNote';

    await run(async () => {
      const createdState =
        artifactKind === 'author_text'
          ? await getApi().createAuthorText(
              containerId,
              'Write confirmed LaTeX text here.',
              fromArtifactId
            )
          : await getApi().createSourceNote(containerId, {
              title: 'Source note',
              content: 'Paste source material or informal context here.'
            });

      const createdArtifact = createdState.artifacts.find((artifact) => !existingIds.has(artifact.id));
      if (!createdArtifact) {
        return createdState;
      }

      await getApi().createProcessEdge(fromArtifactId, createdArtifact.id, edgeKind);
      const next = await getApi().getState(state.focusContainerId ?? containerId);
      setSelection({ type: 'artifact', id: createdArtifact.id });
      return next;
    }, `${label} created and connected.`);
  }

  async function createArtifactInContainer(containerId: string, artifactKind: QuickArtifactKind) {
    const existingIds = new Set(state.artifacts.map((artifact) => artifact.id));
    const label = artifactKind === 'author_text' ? 'AuthorText' : 'SourceNote';

    await run(async () => {
      const createdState =
        artifactKind === 'author_text'
          ? await getApi().createAuthorText(containerId, 'Write confirmed LaTeX text here.')
          : await getApi().createSourceNote(containerId, {
              title: 'Source note',
              content: 'Paste source material or informal context here.'
            });

      const createdArtifact = createdState.artifacts.find((artifact) => !existingIds.has(artifact.id));
      if (createdArtifact) {
        setSelection({ type: 'artifact', id: createdArtifact.id });
      }
      return createdState;
    }, `${label} created.`);
  }

  async function deleteSelectedArtifact() {
    if (!selectedArtifact) {
      return;
    }

    await run(async () => {
      await getApi().deleteArtifact(selectedArtifact.id);
      const next = await getApi().getState(state.focusContainerId ?? undefined);
      setSelection(focusContainer ? { type: 'container', id: focusContainer.id } : null);
      return next;
    }, 'Artifact deleted.');
  }

  async function createSelectedReviewComment() {
    if (!selectedAuthorText || !commentDraft.trim()) {
      return;
    }

    await run(async () => {
      await getApi().createReviewComment(selectedAuthorText.artifactId, range, {
        source: 'manual',
        reviewerLabel: 'Manual',
        content: commentDraft.trim(),
        severity: 'minor'
      });
      const next = await getApi().getState(state.focusContainerId ?? undefined);
      setCommentDraft('');
      setCommentComposerOpen(false);
      return next;
    }, 'ReviewComment created.');
  }

  function openGenerateComposer(containerId: string) {
    if (llmDraft.status === 'running' && llmDraft.runId) {
      void getApi().cancelLlmGeneration(llmDraft.runId);
    }
    setCommentComposerOpen(false);
    setLlmDraft({
      open: true,
      runId: null,
      targetContainerId: containerId,
      prompt: '',
      content: '',
      status: 'idle'
    });
  }

  async function startLlmGeneration(prompt: string, containerId: string) {
    const runId = globalThis.crypto.randomUUID();
    setLlmDraft({
      open: true,
      runId,
      targetContainerId: containerId,
      prompt,
      content: '',
      status: 'running'
    });

    try {
      await getApi().generateWithLlm({ runId, containerId, prompt });
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
    if (!llmDraft.targetContainerId || !llmDraft.content.trim()) {
      return;
    }

    const existingIds = new Set(state.artifacts.map((artifact) => artifact.id));
    await run(async () => {
      const next = await getApi().saveLlmGeneration({
        containerId: llmDraft.targetContainerId!,
        prompt: llmDraft.prompt,
        content: llmDraft.content
      });
      const createdArtifact = next.artifacts.find((artifact) => !existingIds.has(artifact.id));
      if (createdArtifact) {
        setSelection({ type: 'artifact', id: createdArtifact.id });
      }
      setLlmDraft(emptyLlmDraft);
      return next;
    }, 'LLM generation saved.');
  }

  async function exportLatex() {
    const rootId = state.workspace?.rootContainerId;
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
            } as React.CSSProperties
          }
        >
          <SiteHeader
            apiAvailable={apiAvailable}
            workspacePath={workspacePath}
            workspaceTitle={state.workspace ? formatWorkspaceTitle(state.workspace.path) : 'No workspace'}
            focusTitle={focusContainer?.title ?? 'PaperLab workspace'}
            onWorkspacePath={setWorkspacePath}
            onCreateWorkspace={() => void createOrOpenWorkspace('create')}
            onOpenWorkspace={() => void createOrOpenWorkspace('open')}
            onRefresh={() => void refresh()}
            onExport={() => void exportLatex()}
            onSettings={() => setSettingsOpen(true)}
            canExport={Boolean(state.workspace)}
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
              activeContainerTitle={focusContainer?.title ?? 'No focus'}
              nodes={state.compositionTree}
              activeId={state.focusContainerId}
              onSelectContainer={(id) => void focusContainerById(id)}
              onMoveContainer={(id, parentId, index) => void moveContainerInOutline(id, parentId, index)}
              onAddChild={() =>
                void run(
                  async () =>
                    getApi().createContainer(state.focusContainerId, {
                      title: 'New section',
                      intent: ''
                    }),
                  'Container created.'
                )
              }
            />

            <SidebarInset className="min-h-[calc(100svh-var(--header-height))] overflow-hidden">
              <section className="canvas-pane">
                <div className="canvas-toolbar">
                  <div className="flex min-w-0 items-center gap-2">
                    <GitBranch className="size-4 text-muted-foreground" />
                    <span className="truncate">
                      {focusContainer ? `Focused: ${focusContainer.title}` : 'Focused canvas'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">Edge</span>
                    <Select value={edgeKind} onValueChange={(value) => setEdgeKind(value as EdgeKind)}>
                      <SelectTrigger size="sm" className="w-[140px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="informs">informs</SelectItem>
                        <SelectItem value="generates">generates</SelectItem>
                        <SelectItem value="reviews">reviews</SelectItem>
                        <SelectItem value="revises">revises</SelectItem>
                        <SelectItem value="addresses">addresses</SelectItem>
                        <SelectItem value="related-to">related-to</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <ReactFlow
                  nodes={flowNodes}
                  edges={graph.edges}
                  nodeTypes={nodeTypes}
                  fitView
                  nodesDraggable
                  onNodesChange={onNodesChange}
                  onConnect={(connection) => void onConnect(connection)}
                  onEdgeClick={(_event, edge) => {
                    if (state.edges.some((processEdge) => processEdge.id === edge.id)) {
                      setSelection({ type: 'edge', id: edge.id });
                    }
                  }}
                  onNodeClick={(_event, node) => {
                    const artifactId = graph.nodeIdToArtifactId.get(node.id);
                    const containerId = graph.nodeIdToContainerId.get(node.id);
                    if (artifactId) {
                      setSelection({ type: 'artifact', id: artifactId });
                    } else if (containerId) {
                      setSelection({ type: 'container', id: containerId });
                    }
                  }}
                  onNodeDoubleClick={(_event, node) => {
                    const containerId = graph.nodeIdToContainerId.get(node.id);
                    if (containerId) {
                      void focusContainerById(containerId);
                    }
                  }}
                >
                  <Background />
                  <Controls />
                </ReactFlow>
                <FloatingActionToolbar
                  selection={selection}
                  selectedContainer={selectedContainer ?? null}
                  selectedArtifact={selectedArtifact ?? null}
                  selectedAuthorText={selectedAuthorText ?? null}
                  selectedEdge={selectedEdge ?? null}
                  focusContainer={focusContainer ?? null}
                  commentComposerOpen={commentComposerOpen}
                  commentDraft={commentDraft}
                  llmDraft={llmDraft}
                  onCreateInContainer={(containerId, artifactKind) =>
                    void createArtifactInContainer(containerId, artifactKind)
                  }
                  onCreateConnectedArtifact={(artifactId, artifactKind) =>
                    void createConnectedArtifact(artifactId, artifactKind)
                  }
                  onDeleteArtifact={() => void deleteSelectedArtifact()}
                  onToggleCommentComposer={() => {
                    if (llmDraft.status === 'running' && llmDraft.runId) {
                      void getApi().cancelLlmGeneration(llmDraft.runId);
                    }
                    setLlmDraft(emptyLlmDraft);
                    setCommentComposerOpen((open) => !open);
                  }}
                  onCommentDraftChange={setCommentDraft}
                  onCreateComment={() => void createSelectedReviewComment()}
                  onOpenGenerate={openGenerateComposer}
                  onPromptChange={(prompt) => setLlmDraft((current) => ({ ...current, prompt }))}
                  onGenerate={(prompt, containerId) => void startLlmGeneration(prompt, containerId)}
                  onRegenerate={() => {
                    if (llmDraft.targetContainerId && llmDraft.prompt.trim()) {
                      void startLlmGeneration(llmDraft.prompt.trim(), llmDraft.targetContainerId);
                    }
                  }}
                  onCancelGenerate={() => void cancelLlmDraft()}
                  onSaveGenerate={() => void saveLlmDraft()}
                  onUpdateEdgeKind={(relationType) => void updateSelectedEdgeKind(relationType)}
                />
              </section>
            </SidebarInset>

            <SidebarRight>
              <Inspector
                state={state}
                focusContainer={focusContainer ?? null}
                selectedContainer={selectedContainer ?? null}
                selectedArtifact={selectedArtifact ?? null}
                selectedAuthorText={selectedAuthorText ?? null}
                range={range}
                onRangeChange={setRange}
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
  workspacePath,
  workspaceTitle,
  focusTitle,
  onWorkspacePath,
  onCreateWorkspace,
  onOpenWorkspace,
  onRefresh,
  onExport,
  onSettings,
  canExport
}: {
  apiAvailable: boolean;
  workspacePath: string;
  workspaceTitle: string;
  focusTitle: string;
  onWorkspacePath: (path: string) => void;
  onCreateWorkspace: () => void;
  onOpenWorkspace: () => void;
  onRefresh: () => void;
  onExport: () => void;
  onSettings: () => void;
  canExport: boolean;
}) {
  return (
    <header className="sticky top-0 z-50 flex h-(--header-height) shrink-0 items-center gap-3 border-b bg-background px-3">
      <SidebarTrigger />
      <Separator orientation="vertical" className="data-[orientation=vertical]:h-4" />
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Library className="size-4" />
        </div>
        <div className="grid min-w-0 leading-tight">
          <div className="truncate text-sm font-semibold">PaperLab</div>
          <div className="truncate text-xs text-muted-foreground">{workspaceTitle}</div>
        </div>
      </div>
      <Separator orientation="vertical" className="hidden data-[orientation=vertical]:h-4 md:block" />
      <Breadcrumb className="hidden min-w-0 flex-1 lg:block">
        <BreadcrumbList className="flex-nowrap">
          <BreadcrumbItem>
            <BreadcrumbPage className="line-clamp-1">{focusTitle}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2 lg:max-w-3xl">
        <Input
          value={workspacePath}
          onChange={(event) => onWorkspacePath(event.target.value)}
          aria-label="Workspace path"
          className="hidden h-8 min-w-0 flex-1 bg-background md:flex"
        />
        <Button variant="outline" size="sm" onClick={onCreateWorkspace} disabled={!apiAvailable}>
          <Plus />
          <span className="hidden sm:inline">Create</span>
        </Button>
        <Button variant="outline" size="sm" onClick={onOpenWorkspace} disabled={!apiAvailable}>
          <FileText />
          <span className="hidden sm:inline">Open</span>
        </Button>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={!apiAvailable}>
          <RefreshCw />
          <span className="hidden xl:inline">Refresh</span>
        </Button>
        <Button variant="outline" size="sm" onClick={onSettings} disabled={!apiAvailable}>
          <Settings />
          <span className="hidden xl:inline">Settings</span>
        </Button>
        <Button variant="outline" size="sm" onClick={onExport} disabled={!canExport}>
          <Upload />
          <span className="hidden xl:inline">Export main.tex</span>
        </Button>
      </div>
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
  activeContainerTitle,
  nodes,
  activeId,
  onSelectContainer,
  onMoveContainer,
  onAddChild
}: {
  activeContainerTitle: string;
  nodes: FocusedWorkspaceState['compositionTree'];
  activeId: string | null;
  onSelectContainer: (id: string) => void;
  onMoveContainer: (id: string, parentId: string | null, index: number) => void;
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
            <Button variant="ghost" size="icon-xs" onClick={onAddChild} disabled={!activeId} title="Add child container">
              <FolderPlus />
              <span className="sr-only">Add child container</span>
            </Button>
          </div>
          <SidebarGroupContent>
            <Outline nodes={nodes} activeId={activeId} onSelect={onSelectContainer} onMove={onMoveContainer} />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="rounded-lg border bg-background p-2 text-xs text-muted-foreground">
          <div className="font-medium text-foreground">Focus</div>
          <div className="mt-1 truncate">{activeContainerTitle}</div>
        </div>
      </SidebarFooter>
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

type InspectorProps = {
  state: FocusedWorkspaceState;
  focusContainer: ContainerRecord | null;
  selectedContainer: ContainerRecord | null;
  selectedArtifact: ArtifactRecord | null;
  selectedAuthorText: AuthorTextRecord | null;
  range: TextRange;
  onRangeChange: (range: TextRange) => void;
  onState: (state: FocusedWorkspaceState) => void;
  onSelection: (selection: Selection) => void;
  onStatus: (message: string) => void;
  onError: (message: string) => void;
};

function Inspector(props: InspectorProps) {
  const {
    state,
    focusContainer,
    selectedContainer,
    selectedArtifact,
    selectedAuthorText,
    range,
    onRangeChange,
    onState,
    onSelection,
    onStatus,
    onError
  } = props;
  const [draft, setDraft] = useState('');
  const [containerTitle, setContainerTitle] = useState('');
  const [containerIntent, setContainerIntent] = useState('');
  const [saveTimer, setSaveTimer] = useState<number | null>(null);

  useEffect(() => {
    setDraft(selectedAuthorText?.content ?? selectedArtifact?.content ?? selectedContainer?.intent ?? '');
    setContainerTitle(selectedContainer?.title ?? '');
    setContainerIntent(selectedContainer?.intent ?? '');
    onRangeChange({});
  }, [selectedArtifact?.id, selectedAuthorText?.artifactId, selectedContainer?.id]);

  useEffect(() => {
    if (selectedArtifact?.kind === 'generation_candidate') {
      setDraft(selectedArtifact.content ?? '');
    }
  }, [selectedArtifact?.content, selectedArtifact?.kind]);

  function scheduleSave(value: string) {
    setDraft(value);
    if (saveTimer) {
      window.clearTimeout(saveTimer);
    }
    const timer = window.setTimeout(() => {
      void persist(value);
    }, 700);
    setSaveTimer(timer);
  }

  async function persist(value = draft) {
    try {
      if (selectedAuthorText) {
        await getApi().updateAuthorTextContent(selectedAuthorText.artifactId, value);
        onState(await getApi().getState(state.focusContainerId ?? undefined));
        onStatus('AuthorText saved.');
      } else if (selectedArtifact && selectedArtifact.kind !== 'review_comment') {
        await getApi().updateArtifactContent(selectedArtifact.id, value);
        onState(await getApi().getState(state.focusContainerId ?? undefined));
        onStatus('Artifact saved.');
      }
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function createSourceNote() {
    if (!focusContainer) {
      return;
    }
    onState(
      await getApi().createSourceNote(focusContainer.id, {
        title: 'Source note',
        content: 'Paste source material or informal context here.'
      })
    );
    onStatus('SourceNote created.');
  }

  async function createAuthorText() {
    if (!focusContainer) {
      return;
    }
    onState(await getApi().createAuthorText(focusContainer.id, 'Write confirmed LaTeX text here.'));
    onStatus('AuthorText created.');
  }

  async function promoteAuthorText() {
    if (!selectedAuthorText) {
      return;
    }
    onState(await getApi().setActiveAuthorText(selectedAuthorText.containerId, selectedAuthorText.artifactId));
    onStatus('AuthorText promoted to active.');
  }

  async function saveContainer() {
    if (!selectedContainer || !containerTitle.trim()) {
      return;
    }
    try {
      await getApi().updateContainer(selectedContainer.id, {
        title: containerTitle.trim(),
        intent: containerIntent
      });
      onState(await getApi().getState(state.focusContainerId ?? undefined));
      onStatus('Container saved.');
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function deleteContainer() {
    if (!selectedContainer) {
      return;
    }
    try {
      const next = await getApi().deleteContainer(selectedContainer.id);
      onState(next);
      onSelection(next.focusContainerId ? { type: 'container', id: next.focusContainerId } : null);
      onStatus('Container deleted.');
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function deleteArtifact() {
    if (!selectedArtifact) {
      return;
    }
    try {
      await getApi().deleteArtifact(selectedArtifact.id);
      onState(await getApi().getState(state.focusContainerId ?? undefined));
      onSelection(focusContainer ? { type: 'container', id: focusContainer.id } : null);
      onStatus('Artifact deleted.');
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  const comments = selectedAuthorText
    ? state.reviewComments.filter((comment) => comment.targetAuthorTextId === selectedAuthorText.artifactId)
    : [];

  return (
    <div className="inspector">
      {focusContainer ? (
        <div className="button-row">
          <Button variant="outline" size="sm" onClick={() => void createSourceNote()}>
            <Plus />
            SourceNote
          </Button>
          <Button variant="outline" size="sm" onClick={() => void createAuthorText()}>
            <FileText />
            AuthorText
          </Button>
        </div>
      ) : null}

      {selectedContainer ? (
        <section className="panel">
          <h2>Container</h2>
          <p className="muted">Container</p>
          <label className="field-label">
            Title
            <Input
              value={containerTitle}
              onChange={(event) => setContainerTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void saveContainer();
                }
              }}
            />
          </label>
          <label className="field-label">
            Intent
            <Textarea
              value={containerIntent}
              onChange={(event) => setContainerIntent(event.target.value)}
              placeholder="Writing intent for this section"
            />
          </label>
          <div className="button-row">
            <Button size="sm" onClick={() => void saveContainer()} disabled={!containerTitle.trim()}>
              <Save />
              Save
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => void deleteContainer()}
              disabled={selectedContainer.id === state.workspace?.rootContainerId}
            >
              <Trash2 />
              Delete
            </Button>
          </div>
        </section>
      ) : null}

      {selectedArtifact ? (
        <section className="panel editor-panel">
          <div className="artifact-heading">
            <div>
              <h2>{selectedArtifact.title ?? selectedArtifact.kind}</h2>
              <p className="muted">
                {selectedArtifact.kind}
                {selectedAuthorText ? ` · ${selectedAuthorText.lifecycleStatus}` : ''}
              </p>
            </div>
            {selectedAuthorText ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void promoteAuthorText()}
                disabled={selectedAuthorText.lifecycleStatus === 'active'}
              >
                Promote
              </Button>
            ) : null}
            <Button variant="destructive" size="sm" onClick={() => void deleteArtifact()}>
              <Trash2 />
              Delete
            </Button>
          </div>
          {selectedArtifact.kind === 'review_comment' ? (
            <p>{selectedArtifact.content}</p>
          ) : (
            <LatexEditor
              key={selectedArtifact.id}
              value={draft}
              onChange={scheduleSave}
              onSelectionChange={onRangeChange}
            />
          )}
        </section>
      ) : (
        <section className="panel">
          <h2>{focusContainer?.title ?? 'No selection'}</h2>
          <p className="muted">Select a node on the canvas or in the outline.</p>
        </section>
      )}

      {selectedAuthorText && comments.length > 0 ? (
        <section className="panel comments-panel">
          <h2>Comments</h2>
          <div className="comment-list">
            {comments.map((comment) => (
              <CommentItem
                key={comment.id}
                comment={comment}
                focusContainerId={state.focusContainerId}
                onState={onState}
              />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function CommentItem({
  comment,
  focusContainerId,
  onState
}: {
  comment: ReviewCommentRecord;
  focusContainerId: string | null;
  onState: (state: FocusedWorkspaceState) => void;
}) {
  return (
    <article className="comment-item">
      <div className="comment-meta">
        <span>{comment.severity ?? 'note'}</span>
        <span>{comment.status}</span>
      </div>
      {comment.quotedText ? <blockquote>{comment.quotedText}</blockquote> : null}
      <p>{comment.content}</p>
      <div className="button-row">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            void getApi()
              .updateReviewCommentStatus(comment.id, 'addressed')
              .then(() => getApi().getState(focusContainerId ?? undefined))
              .then(onState)
          }
        >
          Addressed
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            void getApi()
              .updateReviewCommentStatus(comment.id, 'wont_fix')
              .then(() => getApi().getState(focusContainerId ?? undefined))
              .then(onState)
          }
        >
          Won't fix
        </Button>
      </div>
    </article>
  );
}

function FloatingActionToolbar({
  selection,
  selectedContainer,
  selectedArtifact,
  selectedAuthorText,
  selectedEdge,
  focusContainer,
  commentComposerOpen,
  commentDraft,
  llmDraft,
  onCreateInContainer,
  onCreateConnectedArtifact,
  onDeleteArtifact,
  onToggleCommentComposer,
  onCommentDraftChange,
  onCreateComment,
  onOpenGenerate,
  onPromptChange,
  onGenerate,
  onRegenerate,
  onCancelGenerate,
  onSaveGenerate,
  onUpdateEdgeKind
}: {
  selection: Selection;
  selectedContainer: ContainerRecord | null;
  selectedArtifact: ArtifactRecord | null;
  selectedAuthorText: AuthorTextRecord | null;
  selectedEdge: FocusedWorkspaceState['edges'][number] | null;
  focusContainer: ContainerRecord | null;
  commentComposerOpen: boolean;
  commentDraft: string;
  llmDraft: LlmDraftState;
  onCreateInContainer: (containerId: string, artifactKind: QuickArtifactKind) => void;
  onCreateConnectedArtifact: (artifactId: string, artifactKind: QuickArtifactKind) => void;
  onDeleteArtifact: () => void;
  onToggleCommentComposer: () => void;
  onCommentDraftChange: (value: string) => void;
  onCreateComment: () => void;
  onOpenGenerate: (containerId: string) => void;
  onPromptChange: (value: string) => void;
  onGenerate: (prompt: string, containerId: string) => void;
  onRegenerate: () => void;
  onCancelGenerate: () => void;
  onSaveGenerate: () => void;
  onUpdateEdgeKind: (relationType: EdgeKind) => void;
}) {
  const title =
    selectedContainer?.title ??
    selectedArtifact?.title ??
    selectedArtifact?.kind ??
    selectedEdge?.relationType ??
    'Select a node';
  const context = selectedContainer ? 'Section' : selectedArtifact ? selectedArtifact.kind : selectedEdge ? 'Edge' : 'Canvas';
  const generateTargetId = selectedContainer?.id ?? selectedArtifact?.containerId ?? focusContainer?.id ?? null;
  const generationComplete = llmDraft.status === 'done' && llmDraft.content.trim().length > 0;
  const generationRunning = llmDraft.status === 'running';
  const generationMessage = llmDraft.content
    ? llmDraft.content
    : generationRunning
      ? 'Waiting for the first token...'
      : llmDraft.error;

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
          {generationMessage ? (
            <div className="floating-generation-output">
              {generationMessage}
            </div>
          ) : null}
          <div className="floating-comment-actions">
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
                <button type="button" title="Save generation as node" onClick={onSaveGenerate}>
                  <Check />
                  <span className="sr-only">Save generation as node</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                title="Generate"
                onClick={() => {
                  if (llmDraft.targetContainerId && llmDraft.prompt.trim()) {
                    onGenerate(llmDraft.prompt.trim(), llmDraft.targetContainerId);
                  }
                }}
                disabled={generationRunning || !llmDraft.prompt.trim() || !llmDraft.targetContainerId}
              >
                <Bot />
                <span className="sr-only">Generate</span>
              </button>
            )}
          </div>
        </div>
      ) : null}
      {selectedAuthorText && commentComposerOpen ? (
        <div className="floating-comment-composer">
          <Textarea
            value={commentDraft}
            onChange={(event) => onCommentDraftChange(event.target.value)}
            placeholder="Add a localized review comment"
          />
          <div className="floating-comment-actions">
            <button type="button" title="Close comment composer" onClick={onToggleCommentComposer}>
              <X />
              <span className="sr-only">Close comment composer</span>
            </button>
            <button
              type="button"
              title="Create comment"
              onClick={onCreateComment}
              disabled={!commentDraft.trim()}
            >
              <Check />
              <span className="sr-only">Create comment</span>
            </button>
          </div>
        </div>
      ) : null}
      <div className="floating-action-context">
        <span>{context}</span>
        <strong>{title}</strong>
      </div>
      <div className="floating-action-buttons">
        {selectedContainer ? (
          <>
            <button
              type="button"
              title="Create SourceNote"
              onClick={() => onCreateInContainer(selectedContainer.id, 'source_note')}
            >
              <Plus />
              <span className="sr-only">Create SourceNote</span>
            </button>
            <button
              type="button"
              title="Create AuthorText"
              onClick={() => onCreateInContainer(selectedContainer.id, 'author_text')}
            >
              <FileText />
              <span className="sr-only">Create AuthorText</span>
            </button>
            <button
              type="button"
              className={llmDraft.open ? 'active' : undefined}
              title="Generate with LLM"
              onClick={() => onOpenGenerate(selectedContainer.id)}
            >
              <Bot />
              <span className="sr-only">Generate with LLM</span>
            </button>
          </>
        ) : null}
        {selectedArtifact ? (
          <>
            <button
              type="button"
              title="Create connected SourceNote"
              onClick={() => onCreateConnectedArtifact(selectedArtifact.id, 'source_note')}
            >
              <Plus />
              <span className="sr-only">Create connected SourceNote</span>
            </button>
            <button
              type="button"
              title="Create connected AuthorText"
              onClick={() => onCreateConnectedArtifact(selectedArtifact.id, 'author_text')}
            >
              <FileText />
              <span className="sr-only">Create connected AuthorText</span>
            </button>
            <button type="button" className="danger" title="Delete Artifact" onClick={onDeleteArtifact}>
              <Trash2 />
              <span className="sr-only">Delete Artifact</span>
            </button>
            {selectedAuthorText ? (
              <button
                type="button"
                className={commentComposerOpen ? 'active' : undefined}
                title="Add comment"
                onClick={onToggleCommentComposer}
              >
                <MessageSquare />
                <span className="sr-only">Add comment</span>
              </button>
            ) : null}
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
                <SelectItem value="reviews">reviews</SelectItem>
                <SelectItem value="revises">revises</SelectItem>
                <SelectItem value="addresses">addresses</SelectItem>
                <SelectItem value="related-to">related-to</SelectItem>
              </SelectContent>
            </Select>
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

function PaperFlowNode({ data }: { data: PaperNodeData; selected?: boolean }) {
  return (
    <div className={`paper-flow-node tone-${data.tone}`}>
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

function buildGraph(
  state: FocusedWorkspaceState,
  selection: Selection
): {
  nodes: PaperNode[];
  edges: Edge[];
  nodeIdToArtifactId: Map<string, string>;
  nodeIdToContainerId: Map<string, string>;
} {
  const nodeIdToArtifactId = new Map<string, string>();
  const nodeIdToContainerId = new Map<string, string>();
  const focusId = state.focusContainerId;
  const childContainers = state.containers.filter((container) => container.parentId === focusId);
  const nodes: PaperNode[] = [];
  const edges: Edge[] = [];

  if (focusId) {
    const focus = state.containers.find((container) => container.id === focusId);
    if (focus) {
      const id = `container:${focus.id}`;
      nodeIdToContainerId.set(id, focus.id);
      nodes.push({
        id,
        type: 'paper',
        position: { x: 40, y: 40 },
        selected: selection?.type === 'container' && selection.id === focus.id,
        data: {
          containerId: focus.id,
          eyebrow: 'Focus container',
          title: focus.title,
          meta: focus.intent ?? undefined,
          tone: 'container',
          layoutKey: `container:${focus.id}:0`
        }
      });
    }
  }

  childContainers.forEach((container, index) => {
    const id = `container:${container.id}`;
    nodeIdToContainerId.set(id, container.id);
    nodes.push({
      id,
      type: 'paper',
      position: { x: 40 + index * 260, y: 190 },
      selected: selection?.type === 'container' && selection.id === container.id,
      data: {
        containerId: container.id,
        eyebrow: `Section ${index + 1}`,
        title: container.title,
        meta: container.intent ?? undefined,
        tone: 'child-container',
        layoutKey: `child:${container.id}:${index}`
      }
    });

    if (focusId) {
      edges.push({
        id: `composition:${focusId}:${container.id}`,
        source: `container:${focusId}`,
        sourceHandle: 'bottom-source',
        target: id,
        targetHandle: 'top-target',
        label: `section ${index + 1}`,
        markerEnd: { type: MarkerType.ArrowClosed },
        type: 'smoothstep',
        className: 'composition-edge'
      });
    }
  });

  const orderedArtifacts = orderArtifacts(state.artifacts, state.edges);

  orderedArtifacts.forEach((artifact, index) => {
    const id = `artifact:${artifact.id}`;
    nodeIdToArtifactId.set(id, artifact.id);
    nodes.push({
      id,
      type: 'paper',
      position: { x: 80 + index * 280, y: 360 },
      selected: selection?.type === 'artifact' && selection.id === artifact.id,
      data: {
        artifactId: artifact.id,
        eyebrow: artifact.kind,
        title: artifact.title ?? 'Untitled',
        meta: formatArtifactMeta(artifact),
        tone:
          artifact.kind === 'generation_candidate' || artifact.kind === 'revision_candidate'
            ? 'artifact'
            : artifact.kind,
        layoutKey: `artifact:${artifact.id}:${index}`
      }
    });
  });

  const visibleArtifactIds = new Set(state.artifacts.map((artifact) => artifact.id));
  state.edges.forEach((edge) => {
    if (!visibleArtifactIds.has(edge.fromArtifactId) || !visibleArtifactIds.has(edge.toArtifactId)) {
      return;
    }

    edges.push({
      id: edge.id,
      source: `artifact:${edge.fromArtifactId}`,
      sourceHandle: 'right-source',
      target: `artifact:${edge.toArtifactId}`,
      targetHandle: 'left-target',
      label: edge.relationType,
      markerEnd: { type: MarkerType.ArrowClosed },
      type: 'smoothstep',
      selected: selection?.type === 'edge' && selection.id === edge.id,
      className: selection?.type === 'edge' && selection.id === edge.id ? 'process-edge selected-edge' : 'process-edge'
    });
  });

  return { nodes, edges, nodeIdToArtifactId, nodeIdToContainerId };
}

function orderArtifacts(artifacts: ArtifactRecord[], edges: FocusedWorkspaceState['edges']): ArtifactRecord[] {
  const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const sorted = [...artifacts].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const indegree = new Map(sorted.map((artifact) => [artifact.id, 0]));
  const outgoing = new Map(sorted.map((artifact) => [artifact.id, [] as string[]]));

  edges.forEach((edge) => {
    if (!byId.has(edge.fromArtifactId) || !byId.has(edge.toArtifactId)) {
      return;
    }
    outgoing.get(edge.fromArtifactId)?.push(edge.toArtifactId);
    indegree.set(edge.toArtifactId, (indegree.get(edge.toArtifactId) ?? 0) + 1);
  });

  const queue = sorted.filter((artifact) => indegree.get(artifact.id) === 0);
  const ordered: ArtifactRecord[] = [];
  const seen = new Set<string>();

  while (queue.length > 0) {
    queue.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    const artifact = queue.shift()!;
    if (seen.has(artifact.id)) {
      continue;
    }
    seen.add(artifact.id);
    ordered.push(artifact);

    outgoing.get(artifact.id)?.forEach((targetId) => {
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

  sorted.forEach((artifact) => {
    if (!seen.has(artifact.id)) {
      ordered.push(artifact);
    }
  });

  return ordered;
}

function formatArtifactMeta(artifact: ArtifactRecord) {
  const content = artifact.content?.trim();
  if (!content) {
    return undefined;
  }
  return content.length > 90 ? `${content.slice(0, 90)}...` : content;
}

function reconcileNodes(nextNodes: Node[], currentNodes: Node[]): Node[] {
  const currentById = new Map(currentNodes.map((node) => [node.id, node]));

  return nextNodes.map((nextNode) => {
    const currentNode = currentById.get(nextNode.id);
    if (!currentNode) {
      return nextNode;
    }

    return {
      ...nextNode,
      position:
        currentNode.data?.layoutKey === nextNode.data?.layoutKey || currentNode.dragging
          ? currentNode.position
          : nextNode.position,
      selected: nextNode.selected,
      dragging: currentNode.dragging
    };
  });
}
