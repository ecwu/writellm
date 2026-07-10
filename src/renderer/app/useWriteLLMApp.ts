import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { getApi } from '../api';
import { emptyState } from './constants';
import type { AppPage, ChildViewMode, Selection } from './types';
import type {
  ContentNodeRecord,
  FocusedWorkspaceState,
  KnowledgeSourceTarget,
  PublicLlmSettings,
  RecentWorkspace,
  SectionNodeRecord,
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workspaceChooserOpen, setWorkspaceChooserOpen] = useState(true);
  const [currentChildViewMode, setCurrentChildViewMode] = useState<ChildViewMode>('list');
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
    void queryClient.cancelQueries({ queryKey: queryKeys.llmSettings });
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
  function setFocusedChildViewMode(mode: ChildViewMode) {
    setCurrentChildViewMode(mode);
  }

  function setActivePage(page: AppPage) {
    setActivePageState(page);
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
    const unsubscribeKnowledgeIngest = getApi().onKnowledgeIngestUpdated(() => {
      void refresh();
    });
    return () => {
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
    if (selection.type === 'node' && !state.nodes.some((node) => node.id === selection.id)) {
      setSelection({ type: 'node', id: state.focusSectionId });
    }
  }, [selection, state.focusSectionId, state.nodes]);

  const notifyStatus = useCallback((message: string) => {
    toast.success(message);
  }, []);

  const notifyError = useCallback((message: string) => {
    toast.error(message);
  }, []);

  async function refresh(focusSectionId = state.focusSectionId ?? undefined) {
    const next = await getApi().getState(focusSectionId);
    setState(next);
    queryClient.setQueryData(queryKeys.workspaceState, next);
    if (!selection && next.focusSectionId) {
      setSelection({ type: 'node', id: next.focusSectionId });
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
    await workspaceMutation.mutateAsync({ action, message });
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
  }

  async function openWritingView(section: SectionNodeRecord) {
    setSelection({ type: 'node', id: section.id });
    if (state.focusSectionId !== section.id) {
      await run(async () => getApi().getState(section.id));
    }
    setCurrentChildViewMode('markdown');
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
  };
}
