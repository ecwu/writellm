import { manuscriptFailureMessage, reportRendererOperationError } from '../../diagnostics'
import { useManuscriptReferences } from './use-manuscript-references'
import { useManuscriptImport } from './use-manuscript-import'
import { useManuscriptFind } from './use-manuscript-find'
import { useWorkspaceFinalFlush } from './use-workspace-final-flush'
import { useSectionTitleDraft } from './use-section-title-draft'
import { useSectionNavigation } from './use-section-navigation'
import {
  useWorkbench,
  tabId,
  reportWorkbenchError,
  type WorkbenchActions
} from '../workbench/use-workbench'
import { matchesShortcut } from '@/lib/keyboard-shortcuts'
import type {
  ManuscriptWorkspace,
  SectionRevision,
  SectionStatus
} from '../../../../shared/contracts/manuscript'
import type { AgentQuickActionRequest } from '../../../../shared/contracts/agent-quick-actions'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { WorkspaceKind } from '@/components/app-sidebar'
import type {
  AgentPanelQuickActionRequest,
  AgentPanelSelection
} from '@/features/agent/agent-panel'
import { KnowledgeManager } from '@/features/knowledge/knowledge-manager'
import { NotebookWorkspace } from '@/features/notebook/notebook-workspace'
import { KnowledgeCitationCoverageWorkspace } from '@/features/checks/knowledge-citation-coverage-workspace'
import { AssetWorkspace } from './asset-workspace'
import { adjacentSectionAfterDelete } from './outline-tree'
import { ManuscriptPreviewWorkspace } from './manuscript-preview'
import type { EditorExactSelectionSnapshot, SectionEditorHandle, SaveState } from './section-editor'
import type { WritingWorkspaceProps } from './writing-workspace'

function sameExactSelection(
  before: EditorExactSelectionSnapshot,
  after: EditorExactSelectionSnapshot
): boolean {
  return (
    before.activeBlockId === after.activeBlockId &&
    before.selectedText === after.selectedText &&
    before.selectedBlockIds.length === after.selectedBlockIds.length &&
    before.selectedBlockIds.every((blockId, index) => blockId === after.selectedBlockIds[index])
  )
}

export function useWritingWorkspaceController(props: WritingWorkspaceProps) {
  const queryClient = useQueryClient()
  const workspaceKey = useMemo(
    () => ['manuscript-workspace', props.projectSessionId] as const,
    [props.projectSessionId]
  )
  const workspaceQuery = useQuery({
    queryKey: workspaceKey,
    queryFn: () => window.desktop.manuscript.workspace({ projectSessionId: props.projectSessionId })
  })
  const referencesQuery = useQuery({
    queryKey: ['manuscript-references', props.projectSessionId],
    queryFn: () =>
      window.desktop.manuscript.references({ projectSessionId: props.projectSessionId })
  })
  const versionHistoryStatusQuery = useQuery({
    queryKey: ['project-version-history-status', props.projectSessionId],
    queryFn: () =>
      window.desktop.projects.versionHistoryStatus({ projectSessionId: props.projectSessionId })
  })
  const workspace = workspaceQuery.data
  const workspaceSearchVersion = workspace?.sections
    .map((entry) => `${entry.section.updatedAt}:${entry.section.currentRevisionId}`)
    .join('|')
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null)
  const [briefOpen, setBriefOpen] = useState(false)
  const [briefError, setBriefError] = useState<string | null>(null)
  const [publicationOpen, setPublicationOpen] = useState(false)
  const publicationQuery = useQuery({
    queryKey: ['publication-preview', props.projectSessionId],
    queryFn: () =>
      window.desktop.manuscript.publicationPreview({ projectSessionId: props.projectSessionId }),
    enabled: publicationOpen
  })
  const [activeWorkspace, setActiveWorkspaceRaw] = useState<WorkspaceKind>('manuscript')
  const workbenchActions = useRef<WorkbenchActions>({
    flush: async () => true,
    activateSection: async () => {},
    setWorkspace: () => {},
    clearSelection: () => {}
  })
  const workbench = useWorkbench(props.projectSessionId, workbenchActions, props.onError)
  const setActiveWorkspace = useCallback(
    (kind: WorkspaceKind): void => {
      if (kind === 'notebook') {
        void workbench.openNotebook()
        return
      }
      if (kind === 'knowledge' || kind === 'preview' || kind === 'assets' || kind === 'checks') {
        void workbench.open({ kind })
        return
      }
      if (kind === 'manuscript') {
        void workbench.openRecentSection()
        return
      }
      if (
        kind === 'find' ||
        kind === 'references' ||
        kind === 'writing_rules' ||
        kind === 'comments'
      )
        workbench.requestTool(kind)
      setActiveWorkspaceRaw(kind)
    },
    [workbench.open, workbench.openNotebook, workbench.openRecentSection, workbench.requestTool]
  )
  const references = useManuscriptReferences({
    projectSessionId: props.projectSessionId,
    workspace,
    storedIndex: referencesQuery.data
  })
  const [editorSaveState, setEditorSaveState] = useState<SaveState>('saved')
  const [outlineEditOpen, setOutlineEditOpen] = useState(false)
  const editorRef = useRef<SectionEditorHandle>(null)
  const [pendingCitationInsert, setPendingCitationInsert] = useState<{
    citationKey: string
    sectionId: string
  } | null>(null)
  const activeSectionIdRef = useRef<string | null>(null)
  const outlineMutationLockRef = useRef<Promise<void>>(Promise.resolve())
  const [selectionContext, setSelectionContext] = useState<AgentPanelSelection | null>(null)
  const [quickActionRequest, setQuickActionRequest] = useState<AgentPanelQuickActionRequest | null>(
    null
  )

  const editorQuery = useQuery({
    queryKey: ['manuscript-section', props.projectSessionId, activeSectionId],
    queryFn: () =>
      window.desktop.editor.loadSection({
        projectSessionId: props.projectSessionId,
        sectionId: activeSectionId as string
      }),
    enabled: activeSectionId !== null
  })

  const previewQuery = useQuery({
    queryKey: ['manuscript-preview', props.projectSessionId],
    queryFn: () => window.desktop.manuscript.preview({ projectSessionId: props.projectSessionId }),
    enabled: activeWorkspace === 'preview',
    staleTime: 0
  })

  const mutation = useMutation({
    mutationFn: (operation: () => Promise<ManuscriptWorkspace>) => operation(),
    onSuccess: (next) => {
      queryClient.setQueryData(workspaceKey, next)
      void queryClient.invalidateQueries({
        queryKey: ['manuscript-references', props.projectSessionId]
      })
    }
  })

  const activeSummary = workspace?.sections.find(
    (item) => item.section.sectionId === activeSectionId
  )

  const runMutation = useCallback(
    async (operation: () => Promise<ManuscriptWorkspace>): Promise<ManuscriptWorkspace | null> => {
      try {
        return await mutation.mutateAsync(operation)
      } catch (err) {
        reportRendererOperationError(err, 'use-writing-workspace-controller')
        props.onError(
          manuscriptFailureMessage(
            err,
            'The requested manuscript update failed. Try again or open Diagnostics.'
          )
        )
        return null
      }
    },
    [mutation, props]
  )

  const {
    title: metadataTitle,
    saveFailed: metadataError,
    change: changeMetadataTitle,
    reset: resetMetadataTitle,
    save: saveMetadata
  } = useSectionTitleDraft({
    section: activeSummary?.section,
    projectSessionId: props.projectSessionId,
    workspaceKey,
    runMutation,
    onError: props.onError
  })

  const activateEditorSection = useCallback(
    async (sectionId: string): Promise<void> => {
      await window.desktop.editor.setActiveSection({
        projectSessionId: props.projectSessionId,
        sectionId
      })
      const target = queryClient
        .getQueryData<ManuscriptWorkspace>(workspaceKey)
        ?.sections.find((item) => item.section.sectionId === sectionId)
      if (target) resetMetadataTitle(target.section)
      activeSectionIdRef.current = sectionId
      references.changeCitationDraft(null)
      setSelectionContext(null)
      setActiveSectionId(sectionId)
    },
    [
      props.projectSessionId,
      queryClient,
      workspaceKey,
      references.changeCitationDraft,
      resetMetadataTitle
    ]
  )
  const activateSection = useCallback(
    async (sectionId: string): Promise<void> => {
      await activateEditorSection(sectionId)
      workbench.didActivateSection(sectionId)
    },
    [activateEditorSection, workbench.didActivateSection]
  )

  const initialTabActivated = useRef(false)
  useEffect(() => {
    if (!workspace || !workbench.ready) return
    workbench.reconcileSections(new Set(workspace.sections.map((item) => item.section.sectionId)))
    if (!initialTabActivated.current) {
      initialTabActivated.current = true
      const restored = workbench.tabs.find(
        (tab) =>
          (tab.kind !== 'section' ||
            workspace.sections.some((item) => item.section.sectionId === tab.sectionId)) &&
          tabId(tab) === workbench.activeId
      )
      if (restored) {
        void workbench.open(restored)
        return
      }
      if (workbench.initialLayout !== null) return
      const first = workspace.sections[0]?.section.sectionId
      if (first) void workbench.open({ kind: 'section', sectionId: first })
    }
  }, [
    workspace,
    workbench.ready,
    workbench.tabs,
    workbench.activeId,
    workbench.initialLayout,
    workbench.open,
    workbench.reconcileSections
  ])

  const currentRevisionIds = useMemo(
    () =>
      Object.fromEntries(
        (workspace?.sections ?? []).map((item) => [
          item.section.sectionId,
          item.section.currentRevisionId
        ])
      ),
    [workspace]
  )
  const sectionTitles = useMemo(
    () =>
      Object.fromEntries(
        (workspace?.sections ?? []).map((item) => [item.section.sectionId, item.section.title])
      ),
    [workspace]
  )

  const flushCurrent = useCallback(async (): Promise<boolean> => {
    try {
      await editorRef.current?.flush()
      return await saveMetadata()
    } catch (err) {
      reportWorkbenchError(err, 'workbench.section.flush')
      editorRef.current?.focus()
      props.onError('Save the current section before leaving it. Your local edits are preserved.')
      return false
    }
  }, [props, saveMetadata])

  workbenchActions.current = {
    flush: flushCurrent,
    activateSection: activateEditorSection,
    setWorkspace: (kind) => setActiveWorkspaceRaw(kind === 'section' ? 'manuscript' : kind),
    clearSelection: () => setSelectionContext(null)
  }

  const startQuickAction = useCallback(
    async (
      quickAction: AgentQuickActionRequest,
      before: EditorExactSelectionSnapshot
    ): Promise<void> => {
      const sectionId = activeSectionIdRef.current
      const editor = editorRef.current
      if (sectionId === null || editor === null) {
        props.onError('Select text in an active manuscript section first.')
        return
      }
      if (!(await flushCurrent())) return
      const after = editor.captureSelection()
      if (after === null || !sameExactSelection(before, after)) {
        props.onError('The selected text changed while saving. Select it again and retry.')
        return
      }
      const selection: AgentPanelSelection = { sectionId, ...after }
      setSelectionContext(selection)
      setQuickActionRequest({ requestId: crypto.randomUUID(), quickAction, selection })
      props.onAgentOpenChange(true)
    },
    [flushCurrent, props]
  )

  const {
    editorAutoFocus,
    setEditorAutoFocus,
    outlineSearchFocus,
    setOutlineSearchFocus,
    sectionTitleRef,
    manuscriptScrollRef,
    selectSection,
    followAgentSection,
    navigateToHit,
    clearSearchTarget
  } = useSectionNavigation({
    activeSectionId,
    activeSectionIdRef,
    editorRevision: editorQuery.data?.revision,
    editorRef,
    enqueue: workbench.enqueue,
    flushCurrent,
    activateSection,
    showSectionTab: workbench.didActivateSection,
    setOutlineEditOpen,
    onError: props.onError
  })

  const getActiveSectionId = useCallback(() => activeSectionIdRef.current, [])
  const releaseMutationBarrier = useCallback(() => editorRef.current?.releaseMutationBarrier(), [])
  const find = useManuscriptFind({
    projectSessionId: props.projectSessionId,
    activeWorkspace,
    workspaceSearchVersion,
    getActiveSectionId,
    flushCurrent,
    releaseMutationBarrier,
    clearSearchTarget,
    navigateToHit,
    onError: props.onError
  })

  const refreshAfterImport = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: workspaceKey }),
      queryClient.invalidateQueries({
        queryKey: ['manuscript-section', props.projectSessionId, activeSectionIdRef.current]
      }),
      queryClient.invalidateQueries({ queryKey: ['manuscript-references', props.projectSessionId] })
    ])
  }, [props.projectSessionId, queryClient, workspaceKey])
  const manuscriptImport = useManuscriptImport({
    projectSessionId: props.projectSessionId,
    getActiveSectionId,
    flushCurrent,
    refreshAfterImport,
    onError: props.onError
  })

  useWorkspaceFinalFlush({
    projectSessionId: props.projectSessionId,
    workspaceKey,
    editorRef,
    activeSectionIdRef,
    saveLayout: workbench.save,
    saveMetadata,
    onFailure: () => setEditorSaveState('failed')
  })

  useEffect(() => {
    let disposed = false
    const releases: Array<() => void> = []
    const input = { projectSessionId: props.projectSessionId }

    const refresh = async (selectFallback: boolean): Promise<void> => {
      const nextWorkspace = await window.desktop.manuscript.workspace(input)
      if (disposed) return
      queryClient.setQueryData(workspaceKey, nextWorkspace)
      void queryClient.invalidateQueries({
        queryKey: ['manuscript-references', input.projectSessionId]
      })
      let sectionId = activeSectionIdRef.current
      if (
        selectFallback &&
        !nextWorkspace.sections.some((item) => item.section.sectionId === sectionId)
      ) {
        sectionId = nextWorkspace.sections[0]?.section.sectionId ?? null
        if (sectionId !== null) await activateSection(sectionId)
      }
      if (disposed || sectionId === null) return
      const current = await window.desktop.editor.loadSection({ ...input, sectionId })
      if (disposed || sectionId !== activeSectionIdRef.current) return
      queryClient.setQueryData(['manuscript-section', input.projectSessionId, sectionId], current)
    }

    const watch = (
      subscribe: (listener: () => void) => Promise<() => void>,
      source: 'agent-mutation' | 'replacement',
      refreshFailure: string,
      subscriptionFailure: string
    ): void => {
      void subscribe(() => {
        if (disposed) return
        void refresh(source === 'agent-mutation')
          .catch((err) => {
            reportRendererOperationError(err, `writing-workspace.${source}-refresh`)
            if (!disposed) props.onError(refreshFailure)
          })
          .finally(() => {
            if (!disposed) releaseMutationBarrier()
          })
      })
        .then((release) => {
          if (disposed) release()
          else releases.push(release)
        })
        .catch((err) => {
          reportRendererOperationError(err, `writing-workspace.${source}-subscription`)
          if (!disposed) props.onError(subscriptionFailure)
        })
    }

    watch(
      (listener) => window.desktop.agent.subscribeMutations(input, listener),
      'agent-mutation',
      'The applied Agent section change could not be reloaded.',
      'Agent section change notifications are unavailable.'
    )
    watch(
      (listener) => window.desktop.manuscript.subscribeReplacementChanges(input, listener),
      'replacement',
      'The replacement was committed, but the editor could not refresh it.',
      'Replacement change notifications are unavailable.'
    )
    return () => {
      disposed = true
      for (const release of releases) release()
    }
  }, [
    activateSection,
    props.onError,
    props.projectSessionId,
    queryClient,
    releaseMutationBarrier,
    workspaceKey
  ])

  const orderedIds = workspace?.sections.map((item) => item.section.sectionId) ?? []
  const activeIndex = activeSectionId === null ? -1 : orderedIds.indexOf(activeSectionId)
  const openFind = useCallback((): void => {
    setEditorAutoFocus(false)
    setActiveWorkspace('find')
  }, [setActiveWorkspace, setEditorAutoFocus])
  const closeFind = useCallback((): void => {
    workbench.requestTool('find', false)
    clearSearchTarget()
    find.closeReview()
    setEditorAutoFocus(true)
    if (workbench.activeId?.startsWith('section:')) setActiveWorkspaceRaw('manuscript')
    else setActiveWorkspace('manuscript')
  }, [
    clearSearchTarget,
    find.closeReview,
    setActiveWorkspace,
    setEditorAutoFocus,
    workbench.activeId,
    workbench.requestTool
  ])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && activeWorkspace === 'find') {
        if (find.replaceOpen) {
          event.preventDefault()
          event.stopImmediatePropagation()
          find.changeReplaceOpen(false)
        } else closeFind()
        return
      }
      if (!window.desktop.menu.native && matchesShortcut(event, 'find')) {
        event.preventDefault()
        openFind()
      } else if (!window.desktop.menu.native && matchesShortcut(event, 'save')) {
        event.preventDefault()
        void flushCurrent()
      } else if (matchesShortcut(event, 'previousSection') && activeIndex > 0) {
        event.preventDefault()
        void selectSection(orderedIds[activeIndex - 1] as string)
      } else if (matchesShortcut(event, 'nextSection') && activeIndex < orderedIds.length - 1) {
        event.preventDefault()
        void selectSection(orderedIds[activeIndex + 1] as string)
      }
    }
    const handleSave = (): void => void flushCurrent()
    const handleFind = (): void => openFind()
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    window.addEventListener('writellm:save', handleSave)
    window.addEventListener('writellm:find', handleFind)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true })
      window.removeEventListener('writellm:save', handleSave)
      window.removeEventListener('writellm:find', handleFind)
    }
  }, [
    activeIndex,
    activeWorkspace,
    flushCurrent,
    orderedIds,
    selectSection,
    closeFind,
    openFind,
    find.replaceOpen,
    find.changeReplaceOpen
  ])

  const updateRevision = (revision: SectionRevision, document = revision.content): void => {
    references.changeCitationDraft({
      sectionId: revision.sectionId,
      sectionRevisionId: revision.sectionRevisionId,
      content: document
    })
    queryClient.setQueryData<ManuscriptWorkspace>(workspaceKey, (current) => {
      if (!current) return current
      const sections = current.sections.map((item) => {
        if (item.section.sectionId !== revision.sectionId) return item
        const { content: _content, ...summary } = revision
        return {
          section: { ...item.section, currentRevisionId: revision.sectionRevisionId },
          revision: summary
        }
      })
      return {
        ...current,
        sections,
        wordCount: sections.reduce((total, item) => total + item.revision.wordCount, 0),
        characterCount: sections.reduce((total, item) => total + item.revision.characterCount, 0)
      }
    })
    queryClient.setQueryData(
      ['manuscript-section', props.projectSessionId, revision.sectionId],
      (current: Awaited<ReturnType<typeof window.desktop.editor.loadSection>> | undefined) =>
        current ? { ...current, revision } : current
    )
    void queryClient.invalidateQueries({
      queryKey: ['manuscript-references', props.projectSessionId]
    })
  }

  const enqueueOutlineMutation = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const result = outlineMutationLockRef.current.then(operation)
    outlineMutationLockRef.current = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }, [])

  const runOutlineMutation = async (
    operation: () => Promise<ManuscriptWorkspace>
  ): Promise<ManuscriptWorkspace | null> => {
    const result = await runMutation(operation)
    if (result === null) await workspaceQuery.refetch()
    return result
  }

  const updateOutlineSection = (
    sectionId: string,
    update: { title?: string; objective?: string | null; status?: SectionStatus },
    baseOutlineVersion?: number
  ): Promise<boolean> =>
    enqueueOutlineMutation(async () => {
      const current = queryClient.getQueryData<ManuscriptWorkspace>(workspaceKey)
      if (!current) return false
      const result = await runOutlineMutation(() =>
        window.desktop.manuscript.updateSection({
          projectSessionId: props.projectSessionId,
          update: {
            baseOutlineVersion: baseOutlineVersion ?? current.outlineVersion,
            sectionId,
            ...update
          }
        })
      )
      return result !== null
    })

  const moveOutlineSection = (
    sectionId: string,
    parentSectionId: string | null,
    position: number
  ): Promise<boolean> =>
    enqueueOutlineMutation(async () => {
      const current = queryClient.getQueryData<ManuscriptWorkspace>(workspaceKey)
      if (!current) return false
      const result = await runOutlineMutation(() =>
        window.desktop.manuscript.moveSection({
          projectSessionId: props.projectSessionId,
          move: {
            baseOutlineVersion: current.outlineVersion,
            sectionId,
            parentSectionId,
            position
          }
        })
      )
      return result !== null
    })

  const createOutlineSection = (
    parentSectionId: string | null,
    title: string
  ): Promise<string | null> =>
    enqueueOutlineMutation(async () => {
      const current = queryClient.getQueryData<ManuscriptWorkspace>(workspaceKey)
      if (!current) return null
      const priorSectionIds = new Set(current.sections.map((item) => item.section.sectionId))
      const position = current.sections.filter(
        (item) => item.section.parentSectionId === parentSectionId
      ).length
      const result = await runOutlineMutation(() =>
        window.desktop.manuscript.createSection({
          projectSessionId: props.projectSessionId,
          create: {
            baseOutlineVersion: current.outlineVersion,
            parentSectionId,
            position,
            title,
            objective: null,
            status: 'planned'
          }
        })
      )
      if (result === null) return null
      return (
        result.sections.find((item) => !priorSectionIds.has(item.section.sectionId))?.section
          .sectionId ?? null
      )
    })

  const deleteOutlineSection = (sectionId: string): Promise<boolean> =>
    enqueueOutlineMutation(async () => {
      if (sectionId === activeSectionId && !(await flushCurrent())) return false
      const current = queryClient.getQueryData<ManuscriptWorkspace>(workspaceKey)
      if (!current) return false
      const fallbackId = adjacentSectionAfterDelete(
        current.sections.map((item) => item.section),
        sectionId
      )
      const result = await runOutlineMutation(() =>
        window.desktop.manuscript.deleteSection({
          projectSessionId: props.projectSessionId,
          delete: {
            baseOutlineVersion: current.outlineVersion,
            sectionId
          }
        })
      )
      if (result === null) return false
      if (sectionId === activeSectionId && fallbackId !== null) {
        try {
          await activateSection(fallbackId)
        } catch (err) {
          reportRendererOperationError(err, 'use-writing-workspace-controller')
          props.onError('The remaining section could not be activated.')
        }
      }
      return true
    })

  const openPreviewWorkspace = async (): Promise<void> => {
    if (!(await flushCurrent())) return
    setActiveWorkspace('preview')
    try {
      await queryClient.invalidateQueries({
        queryKey: ['manuscript-preview', props.projectSessionId]
      })
    } catch (err) {
      reportRendererOperationError(err, 'use-writing-workspace-controller')
      props.onError('The manuscript preview could not be refreshed.')
    }
  }

  const runActiveEditorAction = async (
    action: () => Promise<void>,
    failureMessage: string
  ): Promise<void> => {
    if (!(await flushCurrent())) return
    try {
      await action()
    } catch (err) {
      reportRendererOperationError(err, 'use-writing-workspace-controller')
      props.onError(failureMessage)
    }
  }

  const exportNativeJsonForActiveSection = (): Promise<void> =>
    runActiveEditorAction(async () => {
      await editorRef.current?.exportNativeJson()
    }, 'The native section document could not be exported.')

  const exportMarkdownForActiveSection = (): Promise<void> =>
    runActiveEditorAction(async () => {
      await editorRef.current?.exportMarkdown()
    }, 'The Markdown section export could not be created.')

  const openPublicationPreflight = async (): Promise<void> => {
    if (!(await flushCurrent())) return
    setPublicationOpen(true)
    await publicationQuery.refetch()
  }

  const openOutlineEditor = async (): Promise<void> => {
    if (await flushCurrent()) setOutlineEditOpen(true)
  }

  const openChecksFromManuscript = async (): Promise<void> => {
    if (!(await flushCurrent())) return
    setActiveWorkspace('checks')
  }

  useEffect(() => {
    if (pendingCitationInsert === null) return
    if (workbench.activeId !== `section:${pendingCitationInsert.sectionId}`) {
      setPendingCitationInsert(null)
      return
    }
    if (
      activeWorkspace !== 'manuscript' ||
      editorQuery.data?.revision.sectionId !== pendingCitationInsert.sectionId
    )
      return
    const frame = requestAnimationFrame(() => {
      const editor = editorRef.current
      if (editor === null) {
        props.onError('The active manuscript section is not ready for citation insertion.')
        setPendingCitationInsert(null)
        return
      }
      editor.insertText(`[@${pendingCitationInsert.citationKey}]`)
      setPendingCitationInsert(null)
    })
    return () => cancelAnimationFrame(frame)
  }, [activeWorkspace, editorQuery.data, pendingCitationInsert, props, workbench.activeId])

  let alternateWorkspace: React.JSX.Element | null = null
  if (activeWorkspace === 'knowledge') {
    alternateWorkspace = (
      <KnowledgeManager
        key={props.projectSessionId}
        projectSessionId={props.projectSessionId}
        projectName={props.projectName}
        onOpenManuscript={closeFind}
        onInsertCitation={async (citationKey) => {
          setPendingCitationInsert(null)
          const result = await workbench.openRecentSection()
          if (result?.status === 'activated') {
            setPendingCitationInsert({ citationKey, sectionId: result.sectionId })
          } else if (result?.status === 'missing') {
            props.onError('Choose a section from Outline before inserting a reference.')
          }
        }}
        onOpenNotebook={() => setActiveWorkspace('notebook')}
        onOpenPreview={() => setActiveWorkspace('preview')}
        onOpenAssets={() => setActiveWorkspace('assets')}
        onOpenChecks={() => setActiveWorkspace('checks')}
        onOpenReferences={() => setActiveWorkspace('references')}
        onOpenWritingRules={() => setActiveWorkspace('writing_rules')}
        onOpenFind={openFind}
        onOpenSettings={props.onOpenSettings}
        onError={props.onError}
      />
    )
  }

  const activeNotebook = workbench.tabs.find(
    (tab) => tab.kind === 'notebook' && tabId(tab) === workbench.activeId
  )
  if (activeWorkspace === 'notebook' && activeNotebook?.kind === 'notebook') {
    alternateWorkspace = (
      <NotebookWorkspace
        notebookId={activeNotebook.notebookId}
        onState={(snapshot, draft) => {
          workbench.updateNotebook(activeNotebook.notebookId, snapshot, draft)
        }}
        projectSessionId={props.projectSessionId}
        projectName={props.projectName}
        onOpenManuscript={closeFind}
        onOpenPreview={() => setActiveWorkspace('preview')}
        onOpenKnowledge={() => setActiveWorkspace('knowledge')}
        onOpenChecks={() => setActiveWorkspace('checks')}
        onOpenAssets={() => setActiveWorkspace('assets')}
        onOpenReferences={() => setActiveWorkspace('references')}
        onOpenWritingRules={() => setActiveWorkspace('writing_rules')}
        onOpenFind={openFind}
        onOpenSettings={props.onOpenSettings}
        onError={props.onError}
      />
    )
  }

  if (activeWorkspace === 'assets') {
    alternateWorkspace = (
      <AssetWorkspace
        projectSessionId={props.projectSessionId}
        projectName={props.projectName}
        workspace={workspace}
        onOpenKnowledge={() => setActiveWorkspace('knowledge')}
        onOpenNotebook={() => setActiveWorkspace('notebook')}
        onOpenPreview={() => setActiveWorkspace('preview')}
        onOpenChecks={() => setActiveWorkspace('checks')}
        onOpenManuscript={() => setActiveWorkspace('manuscript')}
        onOpenReferences={() => setActiveWorkspace('references')}
        onOpenWritingRules={() => setActiveWorkspace('writing_rules')}
        onOpenFind={openFind}
        onOpenSettings={props.onOpenSettings}
        onError={props.onError}
        onNavigate={(sectionId, blockId) => {
          void selectSection(sectionId).then((selected) => {
            if (!selected) return
            requestAnimationFrame(() => editorRef.current?.revealBlock(blockId))
          })
        }}
      />
    )
  }

  if (activeWorkspace === 'checks') {
    alternateWorkspace = (
      <KnowledgeCitationCoverageWorkspace
        projectSessionId={props.projectSessionId}
        projectName={props.projectName}
        onOpenManuscript={() => setActiveWorkspace('manuscript')}
        onOpenPreview={() => setActiveWorkspace('preview')}
        onOpenKnowledge={() => setActiveWorkspace('knowledge')}
        onOpenNotebook={() => setActiveWorkspace('notebook')}
        onOpenAssets={() => setActiveWorkspace('assets')}
        onOpenReferences={() => setActiveWorkspace('references')}
        onOpenWritingRules={() => setActiveWorkspace('writing_rules')}
        onOpenFind={openFind}
        onOpenSettings={props.onOpenSettings}
        onError={props.onError}
      />
    )
  }

  if (activeWorkspace === 'preview') {
    alternateWorkspace = (
      <ManuscriptPreviewWorkspace
        projectSessionId={props.projectSessionId}
        projectName={props.projectName}
        assembly={previewQuery.data}
        loading={previewQuery.isPending || previewQuery.isFetching}
        error={previewQuery.isError}
        onRetry={() => void previewQuery.refetch()}
        onOpenManuscript={closeFind}
        onOpenKnowledge={() => setActiveWorkspace('knowledge')}
        onOpenNotebook={() => setActiveWorkspace('notebook')}
        onOpenChecks={() => setActiveWorkspace('checks')}
        onOpenAssets={() => setActiveWorkspace('assets')}
        onOpenReferences={() => setActiveWorkspace('references')}
        onOpenWritingRules={() => setActiveWorkspace('writing_rules')}
        onOpenFind={openFind}
        onOpenSettings={props.onOpenSettings}
      />
    )
  }

  const acceptWorkspace = useCallback(
    (next: ManuscriptWorkspace) => queryClient.setQueryData(workspaceKey, next),
    [queryClient, workspaceKey]
  )
  const editorActions = useMemo(
    () => ({
      captureSelection: () => editorRef.current?.captureSelection(),
      focus: () => editorRef.current?.focus(),
      revealComment: (threadId: string) => editorRef.current?.revealComment(threadId),
      revealBlock: (blockId: string) => editorRef.current?.revealBlock(blockId),
      clearSearchTarget,
      releaseMutationBarrier: () => editorRef.current?.releaseMutationBarrier()
    }),
    [clearSearchTarget]
  )
  return {
    workbench,
    acceptWorkspace,
    changeMetadataTitle,
    editorActions,
    find,
    manuscriptImport,
    references,
    alternateWorkspace,
    workspaceQuery,
    referencesQuery,
    versionHistoryStatusQuery,
    workspace,
    activeSectionId,
    briefOpen,
    setBriefOpen,
    briefError,
    setBriefError,
    publicationOpen,
    setPublicationOpen,
    publicationQuery,
    activeWorkspace,
    setActiveWorkspace,
    editorSaveState,
    setEditorSaveState,
    metadataTitle,
    metadataError,
    outlineEditOpen,
    setOutlineEditOpen,
    outlineSearchFocus,
    setOutlineSearchFocus,
    editorAutoFocus,
    editorRef,
    manuscriptScrollRef,
    selectionContext,
    setSelectionContext,
    quickActionRequest,
    setQuickActionRequest,
    sectionTitleRef,
    editorQuery,
    mutation,
    activeSummary,
    currentRevisionIds,
    sectionTitles,
    runMutation,
    saveMetadata,
    flushCurrent,
    startQuickAction,
    selectSection,
    followAgentSection,
    openFind,
    closeFind,
    updateRevision,
    updateOutlineSection,
    moveOutlineSection,
    createOutlineSection,
    deleteOutlineSection,
    openPreviewWorkspace,
    exportNativeJsonForActiveSection,
    exportMarkdownForActiveSection,
    openPublicationPreflight,
    openOutlineEditor,
    openChecksFromManuscript
  }
}

export type WritingWorkspaceController = ReturnType<typeof useWritingWorkspaceController>
