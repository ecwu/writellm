import { useCallback, useEffect, useMemo, useState } from 'react';
import { applyNodeChanges, type Connection, type Node, type NodeChange, type NodeTypes } from '@xyflow/react';
import { toast } from 'sonner';
import { getApi } from '../api';
import { emptyLlmDraft, emptyState, DEFAULT_EDGE_KIND } from './constants';
import type { ChildViewMode, ContentPreset, PaperNodeData, Selection } from './types';
import { PaperFlowNode } from '../features/canvas/PaperFlowNode';
import { buildGraph, reconcileNodes } from '../features/canvas/graph';
import type {
  ContentNodeRecord,
  EdgeKind,
  FocusedWorkspaceState,
  PublicLlmSettings,
  RecentWorkspace,
  SectionNodeRecord,
  UpdateNodeLayoutPayload
} from '../../shared/types';

export function usePaperLabApp() {
  const [state, setState] = useState<FocusedWorkspaceState>(emptyState);
  const [workspacePath, setWorkspacePath] = useState(
    '/Users/zhenghaowu/Developer/llm-write-canvas/my-paper.paperlab'
  );
  const [selection, setSelection] = useState<Selection>(null);
  const [flowNodes, setFlowNodes] = useState<Node[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workspaceChooserOpen, setWorkspaceChooserOpen] = useState(true);
  const [recentWorkspaces, setRecentWorkspaces] = useState<RecentWorkspace[]>([]);
  const [llmSettings, setLlmSettings] = useState<PublicLlmSettings | null>(null);
  const [llmDraft, setLlmDraft] = useState(emptyLlmDraft);
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
    void refreshRecentWorkspaces();
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

  async function refreshRecentWorkspaces() {
    try {
      setRecentWorkspaces(await getApi().listRecentWorkspaces());
    } catch (caught) {
      notifyError(caught instanceof Error ? caught.message : String(caught));
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
  const nodeTypes = useMemo<NodeTypes>(() => ({ paper: PaperFlowNode }), []);

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
    llmSettings,
    setLlmSettings,
    llmDraft,
    setLlmDraft,
    focusSection,
    selectedSection,
    selectedContent,
    writingContent,
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
    exportLatex,
    setFocusedChildViewMode,
    onNodesChange,
    persistNodeLayoutFromNode
  };
}
