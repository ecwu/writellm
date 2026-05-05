import { useCallback, useEffect, useMemo, useState } from 'react';
import { applyNodeChanges, type Connection, type Node, type NodeChange, type NodeTypes } from '@xyflow/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getApi } from '../api';
import { emptyLlmDraft, emptyState, DEFAULT_EDGE_KIND } from './constants';
import type { AppPage, ChildViewMode, ContentPreset, PaperNodeData, Selection } from './types';
import { PaperFlowNode } from '../features/canvas/PaperFlowNode';
import { buildGraph, reconcileNodes } from '../features/canvas/graph';
import type {
  ContentNodeRecord,
  EdgeKind,
  FocusedWorkspaceState,
  KnowledgeSourceTarget,
  PublicLlmSettings,
  RecentWorkspace,
  RetrievedKnowledgeSource,
  SectionNodeRecord,
  UpdateNodeLayoutPayload
} from '../../shared/types';

const queryKeys = {
  workspaceState: ['workspaceState'] as const,
  recentWorkspaces: ['recentWorkspaces'] as const,
  llmSettings: ['llmSettings'] as const
};

export function useWriteLLMApp() {
  const queryClient = useQueryClient();
  const [workspacePath, setWorkspacePath] = useState(
    '/Users/zhenghaowu/Developer/llm-write-canvas/my-paper.writellm'
  );
  const [selection, setSelection] = useState<Selection>(null);
  const [flowNodes, setFlowNodes] = useState<Node[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workspaceChooserOpen, setWorkspaceChooserOpen] = useState(true);
  const [llmDraft, setLlmDraft] = useState(emptyLlmDraft);
  const [childViewModes, setChildViewModes] = useState<Record<string, ChildViewMode>>({});
  const [writingSectionId, setWritingSectionId] = useState<string | null>(null);
  const [activePage, setActivePageState] = useState<AppPage>('workspace');
  const [knowledgeTarget, setKnowledgeTarget] = useState<KnowledgeSourceTarget | null>(null);

  const apiAvailable = Boolean(window.writellm);
  const workspaceStateQuery = useQuery({
    queryKey: queryKeys.workspaceState,
    queryFn: () => getApi().getState(),
    enabled: apiAvailable
  });
  const recentWorkspacesQuery = useQuery({
    queryKey: queryKeys.recentWorkspaces,
    queryFn: () => getApi().listRecentWorkspaces(),
    enabled: apiAvailable
  });
  const llmSettingsQuery = useQuery({
    queryKey: queryKeys.llmSettings,
    queryFn: () => getApi().getLlmSettings(),
    enabled: apiAvailable
  });
  const state = workspaceStateQuery.data ?? emptyState;
  const recentWorkspaces = recentWorkspacesQuery.data ?? [];
  const llmSettings = llmSettingsQuery.data ?? null;
  const setState = useCallback((next: FocusedWorkspaceState | ((current: FocusedWorkspaceState) => FocusedWorkspaceState)) => {
    queryClient.setQueryData<FocusedWorkspaceState>(queryKeys.workspaceState, (current) =>
      typeof next === 'function' ? next(current ?? emptyState) : next
    );
  }, [queryClient]);
  const setLlmSettings = useCallback((
    next: PublicLlmSettings | null | ((current: PublicLlmSettings | null) => PublicLlmSettings | null)
  ) => {
    queryClient.setQueryData<PublicLlmSettings | null>(queryKeys.llmSettings, (current) =>
      typeof next === 'function' ? next(current ?? null) : next
    );
  }, [queryClient]);
  const workspaceMutation = useMutation({
    mutationFn: async ({ action }: { action: () => Promise<FocusedWorkspaceState | void>; message?: string }) => action(),
    onSuccess: (next, variables) => {
      if (next) {
        setState(next);
      }
      if (variables.message) {
        notifyStatus(variables.message);
      }
    },
    onError: (caught) => {
      notifyError(caught instanceof Error ? caught.message : String(caught));
    }
  });
  const focusSection = state.nodes.find(
    (node): node is SectionNodeRecord => node.kind === 'section' && node.id === state.focusSectionId
  );
  const selectedNode =
    selection?.type === 'node' ? state.nodes.find((node) => node.id === selection.id) ?? null : null;
  const selectedSection = selectedNode?.kind === 'section' ? selectedNode : null;
  const selectedContent = selectedNode?.kind === 'content' ? selectedNode : null;
  const writingSection = writingSectionId
    ? state.nodes.find((node): node is SectionNodeRecord => node.kind === 'section' && node.id === writingSectionId) ?? null
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

  function setActivePage(page: AppPage) {
    setActivePageState(page);
    if (page === 'knowledge') {
      setWritingSectionId(null);
      if (llmDraft.status === 'running' && llmDraft.runId) {
        void getApi().cancelLlmGeneration(llmDraft.runId);
      }
      setLlmDraft(emptyLlmDraft);
    }
  }

  function openKnowledgeTarget(target: KnowledgeSourceTarget) {
    setKnowledgeTarget(target);
    setActivePage('knowledge');
  }

  async function openKnowledgeCitation(publicRef: string) {
    try {
      const target = await getApi().resolveKnowledgeCitation({ publicRef });
      if (!target) {
        notifyError(`Citation not found: [${publicRef}]`);
        return;
      }
      openKnowledgeTarget(target);
    } catch (caught) {
      notifyError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function openKnowledgeSourceNode(node: ContentNodeRecord) {
    const chunkId = typeof node.metadata.knowledgeChunkId === 'string' ? node.metadata.knowledgeChunkId : undefined;
    const publicRef = typeof node.metadata.publicRef === 'string' ? node.metadata.publicRef : undefined;
    if (!chunkId && !publicRef) {
      return;
    }
    try {
      const target = await getApi().resolveKnowledgeCitation({ chunkId, publicRef });
      if (!target) {
        notifyError('Knowledge source no longer exists.');
        return;
      }
      openKnowledgeTarget(target);
    } catch (caught) {
      notifyError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  useEffect(() => {
    if (!apiAvailable) {
      notifyError('Run this app through Electron to use local workspace features.');
      return;
    }
    const unsubscribeLlm = getApi().onLlmStream((event) => {
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
                status: event.type === 'done' ? 'done' : 'running',
                retrievedSources: event.type === 'done' ? event.sources ?? current.retrievedSources : current.retrievedSources
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
    const unsubscribeKnowledgeIngest = getApi().onKnowledgeIngestUpdated(() => {
      void refresh();
    });
    return () => {
      unsubscribeLlm();
      unsubscribeKnowledgeIngest();
    };
  }, [apiAvailable]);

  useEffect(() => {
    const error = workspaceStateQuery.error ?? recentWorkspacesQuery.error ?? llmSettingsQuery.error;
    if (error) {
      notifyError(error instanceof Error ? error.message : String(error));
    }
  }, [workspaceStateQuery.error, recentWorkspacesQuery.error, llmSettingsQuery.error]);

  useEffect(() => {
    if (!state.focusSectionId) {
      return;
    }
    if (!selection) {
      setSelection({ type: 'node', id: state.focusSectionId });
      return;
    }
    if (selection.type === 'edge' && !state.edges.some((edge) => edge.id === selection.id)) {
      setSelection({ type: 'node', id: state.focusSectionId });
      return;
    }
    if (selection.type === 'node' && !state.nodes.some((node) => node.id === selection.id)) {
      setSelection({ type: 'node', id: state.focusSectionId });
    }
  }, [selection, state.edges, state.focusSectionId, state.nodes]);

  useEffect(() => {
    if (writingSectionId && !writingSection) {
      setWritingSectionId(null);
    }
  }, [writingSectionId, writingSection]);

  function notifyStatus(message: string) {
    toast.success(message);
  }

  function notifyError(message: string) {
    toast.error(message);
  }

  async function refresh(focusSectionId = state.focusSectionId ?? undefined) {
    const next = await getApi().getState(focusSectionId);
    setState(next);
    queryClient.setQueryData(queryKeys.workspaceState, next);
    if (!selection && next.focusSectionId) {
      setSelection({ type: 'node', id: next.focusSectionId });
    } else if (selection?.type === 'edge' && !next.edges.some((edge) => edge.id === selection.id)) {
      setSelection(next.focusSectionId ? { type: 'node', id: next.focusSectionId } : null);
    } else if (selection?.type === 'node' && !next.nodes.some((node) => node.id === selection.id)) {
      setSelection(next.focusSectionId ? { type: 'node', id: next.focusSectionId } : null);
    }
  }

  async function refreshRecentWorkspaces() {
    try {
      await queryClient.invalidateQueries({ queryKey: queryKeys.recentWorkspaces });
      await queryClient.refetchQueries({ queryKey: queryKeys.recentWorkspaces });
    } catch (caught) {
      notifyError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function run(action: () => Promise<FocusedWorkspaceState | void>, message?: string) {
    await workspaceMutation.mutateAsync({ action, message }).catch(() => undefined);
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
  const nodeTypes = useMemo<NodeTypes>(() => ({ paper: PaperFlowNode }), []);

  useEffect(() => {
    setFlowNodes((current) => reconcileNodes(graph.nodes, current));
  }, [graph.nodes]);

  function onNodesChange(changes: NodeChange[]) {
    setFlowNodes((current) => applyNodeChanges(changes, current));
  }

  function persistNodeLayoutFromNode(node: Node) {
    const data = node.data as PaperNodeData;
    if (data.virtual) {
      return;
    }
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

  async function createOrOpenWorkspace(mode: 'create' | 'open', pathOverride?: string) {
    const targetPath = pathOverride ?? workspacePath;
    if (!targetPath.trim()) {
      notifyError('Workspace path is required.');
      return;
    }
    try {
      const summary =
        mode === 'create'
          ? await getApi().createWorkspace(targetPath.trim())
          : await getApi().openWorkspace(targetPath.trim());
      const next = await getApi().getState(summary.rootNodeId);
      setSelection({ type: 'node', id: summary.rootNodeId });
      setState(next);
      setWorkspacePath(summary.path);
      setActivePageState('workspace');
      setWorkspaceChooserOpen(false);
      await refreshRecentWorkspaces();
      notifyStatus(mode === 'create' ? 'Workspace created.' : 'Workspace opened.');
    } catch (caught) {
      notifyError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function pickWorkspaceFolder() {
    try {
      const pickedPath = await getApi().pickWorkspaceFolder();
      if (!pickedPath) {
        return;
      }
      setWorkspacePath(pickedPath);
      await createOrOpenWorkspace('open', pickedPath);
    } catch (caught) {
      notifyError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function pickNewWorkspacePath() {
    try {
      const pickedPath = await getApi().pickNewWorkspacePath();
      if (!pickedPath) {
        return;
      }
      setWorkspacePath(pickedPath);
      await createOrOpenWorkspace('create', pickedPath);
    } catch (caught) {
      notifyError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function focusSectionById(sectionId: string) {
    await run(async () => getApi().getState(sectionId));
    setSelection({ type: 'node', id: sectionId });
    if (writingSectionId) {
      setWritingSectionId(sectionId);
    }
  }

  function openWritingView(section: SectionNodeRecord) {
    setSelection({ type: 'node', id: section.id });
    setWritingSectionId(section.id);
  }

  async function closeWritingView(section: SectionNodeRecord) {
    await run(async () => getApi().getState(section.id));
    setWritingSectionId(null);
    setSelection({ type: 'node', id: section.id });
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
    const payload = {
      kind: 'content' as const,
      parentId: sectionId,
      title: 'Main draft',
      content: 'Write confirmed Markdown text here.',
      isMain: true,
      isLlm: false
    };

    await run(async () => {
      const next = await getApi().createNode(payload);
      const created = next.nodes.find((node) => !existingIds.has(node.id) && node.kind === 'content');
      if (created) {
        setSelection({ type: 'node', id: created.id });
      }
      return next;
    }, 'Main content created.');
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
        title: 'Main draft',
        content: 'Write confirmed Markdown text here.',
        isMain: preset === 'main',
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
      retrievedSources: [],
      excludedKnowledgeItemIds: [],
      excludedKnowledgeChunkIds: [],
      content: '',
      status: 'idle'
    });
  }

  async function startLlmGeneration(prompt: string, sectionId: string, contextNodeIds: string[]) {
    const runId = globalThis.crypto.randomUUID();
    let prefetchedKnowledgeSources: RetrievedKnowledgeSource[] | undefined;
    const previewSources = await getApi().searchKnowledge({
      query: prompt,
      sectionId,
      focusSectionId: state.focusSectionId ?? sectionId,
      contextNodeIds,
      excludedItemIds: llmDraft.excludedKnowledgeItemIds,
      excludedChunkIds: llmDraft.excludedKnowledgeChunkIds,
      maxChunks: 10
    })
      .then((sources) => {
        prefetchedKnowledgeSources = sources;
        return sources;
      })
      .catch(() => []);
    setLlmDraft({
      open: true,
      runId,
      targetSectionId: sectionId,
      prompt,
      contextNodeIds,
      retrievedSources: previewSources,
      excludedKnowledgeItemIds: llmDraft.excludedKnowledgeItemIds,
      excludedKnowledgeChunkIds: llmDraft.excludedKnowledgeChunkIds,
      content: '',
      status: 'running'
    });

    try {
      await getApi().generateWithLlm({
        runId,
        sectionId,
        focusSectionId: state.focusSectionId ?? sectionId,
        prompt,
        contextNodeIds,
        prefetchedKnowledgeSources,
        excludedKnowledgeItemIds: llmDraft.excludedKnowledgeItemIds,
        excludedKnowledgeChunkIds: llmDraft.excludedKnowledgeChunkIds,
        maxKnowledgeChunks: 10,
        requireInlineCitations: true
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

    await run(async () => {
      const next = await getApi().saveLlmGeneration({
        sectionId: llmDraft.targetSectionId!,
        focusSectionId: state.focusSectionId ?? llmDraft.targetSectionId,
        prompt: llmDraft.prompt,
        content: llmDraft.content,
        contextNodeIds: llmDraft.contextNodeIds,
        retrievedSources: llmDraft.retrievedSources,
        contextRelationType: DEFAULT_EDGE_KIND
      });
      setSelection({ type: 'node', id: llmDraft.targetSectionId! });
      setLlmDraft(emptyLlmDraft);
      return next;
    }, 'LLM generation applied.');
  }

  async function createKnowledgeItem(title: string, content: string) {
    await run(
      async () => {
        await getApi().createKnowledgeItem({ title, content });
        return getApi().getState(state.focusSectionId ?? undefined);
      },
      'Knowledge source saved.'
    );
  }

  async function importKnowledgeFiles() {
    try {
      const filePaths = await getApi().pickKnowledgeFiles();
      if (filePaths.length === 0) {
        return;
      }
      await run(
        async () => {
          await getApi().enqueueKnowledgeFiles({ filePaths });
          return getApi().getState(state.focusSectionId ?? undefined);
        },
        `${filePaths.length} knowledge file${filePaths.length === 1 ? '' : 's'} queued.`
      );
    } catch (caught) {
      notifyError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function retryKnowledgeIngestJob(jobId: string) {
    await run(
      async () => {
        await getApi().retryKnowledgeIngestJob(jobId);
        return getApi().getState(state.focusSectionId ?? undefined);
      },
      'Knowledge import queued.'
    );
  }

  async function updateKnowledgeItem(itemId: string, title: string, content: string) {
    await run(
      async () => {
        await getApi().updateKnowledgeItem(itemId, { title, content });
        return getApi().getState(state.focusSectionId ?? undefined);
      },
      'Knowledge source updated.'
    );
  }

  async function deleteKnowledgeIngestJob(jobId: string) {
    await run(
      async () => {
        await getApi().deleteKnowledgeIngestJob(jobId);
        return getApi().getState(state.focusSectionId ?? undefined);
      },
      'Knowledge import deleted.'
    );
  }

  async function deleteKnowledgeItem(itemId: string) {
    await run(
      async () => {
        await getApi().deleteKnowledgeItem(itemId);
        return getApi().getState(state.focusSectionId ?? undefined);
      },
      'Knowledge source deleted.'
    );
  }

  async function reindexKnowledgeItem(itemId: string) {
    await run(
      async () => {
        await getApi().reindexKnowledgeItem(itemId);
        return getApi().getState(state.focusSectionId ?? undefined);
      },
      'Knowledge source reindexed.'
    );
  }

  function excludeKnowledgeSource(itemId: string, chunkId: string) {
    setLlmDraft((current) => ({
      ...current,
      retrievedSources: current.retrievedSources.filter((source) => source.chunkId !== chunkId),
      excludedKnowledgeItemIds: current.excludedKnowledgeItemIds,
      excludedKnowledgeChunkIds: [...new Set([...current.excludedKnowledgeChunkIds, chunkId])]
    }));
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

  async function createGitCheckpoint() {
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 850));
      const checkpoint = await getApi().createGitCheckpoint();
      if (checkpoint) {
        notifyStatus(`Checkpoint ${checkpoint.shortHash} created.`);
      } else {
        notifyStatus('No Markdown changes to checkpoint.');
      }
    } catch (caught) {
      notifyError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return {
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
  };
}
