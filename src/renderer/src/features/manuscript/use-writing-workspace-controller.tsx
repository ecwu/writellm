import { useManuscriptReferences } from './use-manuscript-references'
export { resolveReadableCitationOccurrences } from './use-manuscript-references'
import { useManuscriptImport } from './use-manuscript-import'
import { useManuscriptFind } from './use-manuscript-find'
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
import type { ManuscriptSearchTargetContract } from '../../../../shared/contracts/manuscript-search'
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
  const [metadataTitle, setMetadataTitle] = useState('')
  const [metadataError, setMetadataError] = useState(false)
  const [outlineEditOpen, setOutlineEditOpen] = useState(false)
  const [outlineSearchFocus, setOutlineSearchFocus] = useState<{
    sectionId: string
    field: 'objective'
    from: number
    to: number
  } | null>(null)
  const [editorAutoFocus, setEditorAutoFocus] = useState(true)
  const editorRef = useRef<SectionEditorHandle>(null)
  const [pendingCitationInsert, setPendingCitationInsert] = useState<{
    citationKey: string
    sectionId: string
  } | null>(null)
  const manuscriptScrollRef = useRef<HTMLElement>(null)
  const activeSectionIdRef = useRef<string | null>(null)
  const pendingScrollSectionIdRef = useRef<string | null>(null)
  const metadataDraftSectionIdRef = useRef<string | null>(null)
  const metadataCanonicalUpdatedAtRef = useRef<string | null>(null)
  const metadataCanonicalTitleRef = useRef<string | null>(null)
  const metadataSaveRef = useRef<Promise<boolean> | null>(null)
  const outlineMutationLockRef = useRef<Promise<void>>(Promise.resolve())
  const metadataDraftRef = useRef({ title: '' })
  const [selectionContext, setSelectionContext] = useState<AgentPanelSelection | null>(null)
  const [quickActionRequest, setQuickActionRequest] = useState<AgentPanelQuickActionRequest | null>(
    null
  )
  const [pendingSearchTarget, setPendingSearchTarget] = useState<{
    target: ManuscriptSearchTargetContract
    revisionId: string | null
  } | null>(null)
  const sectionTitleRef = useRef<HTMLTextAreaElement>(null)

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

  const activateSection = useCallback(
    async (sectionId: string): Promise<void> => {
      await window.desktop.editor.setActiveSection({
        projectSessionId: props.projectSessionId,
        sectionId
      })
      const target = queryClient
        .getQueryData<ManuscriptWorkspace>(workspaceKey)
        ?.sections.find((item) => item.section.sectionId === sectionId)
      if (target) {
        setMetadataTitle(target.section.title)
        metadataDraftRef.current = { title: target.section.title }
        metadataDraftSectionIdRef.current = sectionId
        metadataCanonicalUpdatedAtRef.current = target.section.updatedAt
        metadataCanonicalTitleRef.current = target.section.title
        setMetadataError(false)
      }
      activeSectionIdRef.current = sectionId
      references.changeCitationDraft(null)
      setSelectionContext(null)
      setActiveSectionId(sectionId)
      workbench.didActivateSection(sectionId)
    },
    [
      props.projectSessionId,
      queryClient,
      workspaceKey,
      workbench.didActivateSection,
      references.changeCitationDraft
    ]
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

  const activeSummary = workspace?.sections.find(
    (item) => item.section.sectionId === activeSectionId
  )
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

  useEffect(() => {
    if (!activeSummary) return
    const sectionChanged = metadataDraftSectionIdRef.current !== activeSummary.section.sectionId
    const canonicalChanged =
      metadataCanonicalUpdatedAtRef.current !== activeSummary.section.updatedAt
    const draft = metadataDraftRef.current
    const draftDirty = draft.title !== metadataCanonicalTitleRef.current
    const draftMatchesCanonical = draft.title === activeSummary.section.title
    if (
      !sectionChanged &&
      (!canonicalChanged || (draftDirty && !draftMatchesCanonical) || metadataError)
    )
      return
    setMetadataTitle(activeSummary.section.title)
    metadataDraftRef.current = { title: activeSummary.section.title }
    metadataDraftSectionIdRef.current = activeSummary.section.sectionId
    metadataCanonicalUpdatedAtRef.current = activeSummary.section.updatedAt
    metadataCanonicalTitleRef.current = activeSummary.section.title
    setMetadataError(false)
  }, [activeSummary, metadataError])

  const runMutation = useCallback(
    async (operation: () => Promise<ManuscriptWorkspace>): Promise<ManuscriptWorkspace | null> => {
      try {
        return await mutation.mutateAsync(operation)
      } catch {
        props.onError('The manuscript changed or the requested update could not be applied.')
        return null
      }
    },
    [mutation, props]
  )

  const saveMetadata = useCallback(async (): Promise<boolean> => {
    if (metadataSaveRef.current !== null) return metadataSaveRef.current
    const operation = (async (): Promise<boolean> => {
      if (!activeSummary) return true
      const draft = metadataDraftRef.current
      if (draft.title === activeSummary.section.title) return true
      if (draft.title.trim().length === 0) {
        props.onError('Section titles cannot be empty.')
        return false
      }
      const current = queryClient.getQueryData<ManuscriptWorkspace>(workspaceKey)
      const currentSummary = current?.sections.find(
        (item) => item.section.sectionId === activeSummary.section.sectionId
      )
      if (!current || !currentSummary) return false
      const result = await runMutation(() =>
        window.desktop.manuscript.updateSection({
          projectSessionId: props.projectSessionId,
          update: {
            baseOutlineVersion: current.outlineVersion,
            sectionId: activeSummary.section.sectionId,
            title: draft.title.trim()
          }
        })
      )
      setMetadataError(result === null)
      return result !== null
    })()
    metadataSaveRef.current = operation
    try {
      return await operation
    } finally {
      if (metadataSaveRef.current === operation) metadataSaveRef.current = null
    }
  }, [activeSummary, props, queryClient, runMutation, workspaceKey])
  const saveMetadataRef = useRef(saveMetadata)
  saveMetadataRef.current = saveMetadata

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
    activateSection,
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

  const switchSection = useCallback(
    async (sectionId: string, source: 'user' | 'agent' | 'find'): Promise<boolean> => {
      if (sectionId === activeSectionIdRef.current) {
        workbench.didActivateSection(sectionId)
        return true
      }
      if (!(await flushCurrent())) return false
      try {
        setEditorAutoFocus(source === 'user')
        pendingScrollSectionIdRef.current = source === 'agent' ? sectionId : null
        await activateSection(sectionId)
        return true
      } catch {
        if (pendingScrollSectionIdRef.current === sectionId) {
          pendingScrollSectionIdRef.current = null
        }
        props.onError('The selected section could not be activated.')
        return false
      }
    },
    [activateSection, flushCurrent, props, workbench.didActivateSection]
  )

  const enqueueSectionSwitch = useCallback(
    (sectionId: string, source: 'user' | 'agent' | 'find'): Promise<boolean> => {
      return workbench
        .enqueue(() => switchSection(sectionId, source))
        .then((result) => result ?? false)
    },
    [switchSection, workbench.enqueue]
  )

  const selectSection = useCallback(
    (sectionId: string): Promise<boolean> => enqueueSectionSwitch(sectionId, 'user'),
    [enqueueSectionSwitch]
  )

  const followAgentSection = useCallback(
    (sectionId: string): Promise<boolean> => enqueueSectionSwitch(sectionId, 'agent'),
    [enqueueSectionSwitch]
  )

  const getActiveSectionId = useCallback(() => activeSectionIdRef.current, [])
  const releaseMutationBarrier = useCallback(() => editorRef.current?.releaseMutationBarrier(), [])
  const clearSearchTarget = useCallback(() => {
    editorRef.current?.clearSearchTarget()
    setPendingSearchTarget(null)
  }, [])
  const navigateToHit = useCallback(
    async (
      sectionId: string,
      target: ManuscriptSearchTargetContract,
      revisionId: string | null
    ) => {
      if (!(await enqueueSectionSwitch(sectionId, 'find'))) return false
      setPendingSearchTarget({ target, revisionId })
      return true
    },
    [enqueueSectionSwitch]
  )
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

  useEffect(() => {
    if (
      pendingSearchTarget === null ||
      activeSectionId !== pendingSearchTarget.target.sectionId ||
      editorQuery.data === undefined ||
      (pendingSearchTarget.revisionId !== null &&
        editorQuery.data.revision.sectionRevisionId !== pendingSearchTarget.revisionId)
    ) {
      return
    }
    const pending = pendingSearchTarget
    const frame = window.requestAnimationFrame(() => {
      if (pending.target.kind === 'section_title') {
        const input = sectionTitleRef.current
        input?.scrollIntoView({ block: 'center', behavior: 'auto' })
      } else if (pending.target.kind === 'section_objective') {
        setOutlineSearchFocus({
          sectionId: pending.target.sectionId,
          field: 'objective',
          from: pending.target.range.from,
          to: pending.target.range.to
        })
        setOutlineEditOpen(true)
      } else if (!editorRef.current?.revealSearchTarget(pending.target)) {
        props.onError('The validated result could not be revealed in the current editor.')
      }
      setPendingSearchTarget(null)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeSectionId, editorQuery.data, pendingSearchTarget, props])

  useEffect(() => {
    if (
      activeSectionId === null ||
      pendingScrollSectionIdRef.current !== activeSectionId ||
      editorQuery.data?.revision.sectionId !== activeSectionId
    ) {
      return
    }
    pendingScrollSectionIdRef.current = null
    const frame = window.requestAnimationFrame(() => {
      manuscriptScrollRef.current?.scrollTo({ top: 0, behavior: 'auto' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeSectionId, editorQuery.data])

  useEffect(() => {
    let disposed = false
    let unsubscribe: (() => void) | undefined
    void window.desktop.editor
      .subscribeFlush({ projectSessionId: props.projectSessionId }, (request) => {
        if (disposed) return
        void (async () => {
          await workbench.save(request.closingToken)
          if (request.purpose === 'mutation') {
            if (!(await saveMetadataRef.current())) throw new Error('Section metadata flush failed')
            if (!request.bodyRequired) {
              if (request.sectionId === undefined || request.sectionRevisionId === undefined) {
                throw new Error('Metadata-only flush is missing its active revision')
              }
              await window.desktop.editor.acknowledgeFlush({
                ...request,
                sectionId: request.sectionId,
                sectionRevisionId: request.sectionRevisionId
              })
              return
            }
          }
          if (
            editorRef.current &&
            editorRef.current.hasActiveEditor?.(request.sectionId) !== false
          ) {
            await editorRef.current.finalFlush(request)
            return
          }
          if (request.sectionId !== undefined && request.sectionRevisionId !== undefined) {
            await window.desktop.editor.acknowledgeFlush({
              ...request,
              sectionId: request.sectionId,
              sectionRevisionId: request.sectionRevisionId
            })
            return
          }
          const currentWorkspace =
            queryClient.getQueryData<ManuscriptWorkspace>(workspaceKey) ??
            (await window.desktop.manuscript.workspace({
              projectSessionId: props.projectSessionId
            }))
          const sectionId =
            activeSectionIdRef.current ?? currentWorkspace.sections[0]?.section.sectionId
          if (sectionId === undefined) throw new Error('No section is available for final flush')
          const current = await window.desktop.editor.loadSection({
            projectSessionId: props.projectSessionId,
            sectionId
          })
          await window.desktop.editor.acknowledgeFlush({
            ...request,
            sectionId,
            sectionRevisionId: current.revision.sectionRevisionId
          })
        })().catch((err: unknown) => {
          const error = err instanceof Error ? err : new Error(String(err))
          window.desktop.diagnostics.reportRendererError({
            event: 'renderer.unhandled_rejection',
            message: error.message,
            ...(error.stack === undefined ? {} : { stack: error.stack }),
            source: 'writing-workspace.final-flush'
          })
          setEditorSaveState('failed')
        })
      })
      .then((release) => {
        if (disposed) release()
        else unsubscribe = release
      })
      .catch(() => setEditorSaveState('failed'))
    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [props.projectSessionId, queryClient, workspaceKey, workbench.save])

  useEffect(() => {
    let disposed = false
    let unsubscribe: (() => void) | undefined
    void window.desktop.agent
      .subscribeMutations({ projectSessionId: props.projectSessionId }, () => {
        void (async () => {
          const nextWorkspace = await window.desktop.manuscript.workspace({
            projectSessionId: props.projectSessionId
          })
          queryClient.setQueryData(workspaceKey, nextWorkspace)
          void queryClient.invalidateQueries({
            queryKey: ['manuscript-references', props.projectSessionId]
          })
          let activeSectionId = activeSectionIdRef.current
          if (
            activeSectionId === null ||
            !nextWorkspace.sections.some((item) => item.section.sectionId === activeSectionId)
          ) {
            const fallback = nextWorkspace.sections[0]?.section.sectionId
            if (fallback === undefined) return
            await activateSection(fallback)
            activeSectionId = fallback
          }
          const current = await window.desktop.editor.loadSection({
            projectSessionId: props.projectSessionId,
            sectionId: activeSectionId
          })
          if (disposed || activeSectionId !== activeSectionIdRef.current) return
          queryClient.setQueryData(
            ['manuscript-section', props.projectSessionId, activeSectionId],
            current
          )
          editorRef.current?.releaseMutationBarrier()
        })().catch(() => {
          editorRef.current?.releaseMutationBarrier()
          props.onError('The applied Agent section change could not be reloaded.')
        })
      })
      .then((release) => {
        if (disposed) release()
        else unsubscribe = release
      })
      .catch(() => {
        props.onError('Agent section change notifications are unavailable.')
      })
    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [activateSection, props.onError, props.projectSessionId, queryClient, workspaceKey])

  useEffect(() => {
    let disposed = false
    let unsubscribe: (() => void) | undefined
    void window.desktop.manuscript
      .subscribeReplacementChanges({ projectSessionId: props.projectSessionId }, () => {
        void (async () => {
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: workspaceKey }),
            queryClient.invalidateQueries({
              queryKey: ['manuscript-references', props.projectSessionId]
            })
          ])
          const sectionId = activeSectionIdRef.current
          if (sectionId !== null) {
            const current = await window.desktop.editor.loadSection({
              projectSessionId: props.projectSessionId,
              sectionId
            })
            if (!disposed && sectionId === activeSectionIdRef.current) {
              queryClient.setQueryData(
                ['manuscript-section', props.projectSessionId, sectionId],
                current
              )
            }
          }
          editorRef.current?.releaseMutationBarrier()
        })().catch(() => {
          editorRef.current?.releaseMutationBarrier()
          props.onError('The replacement was committed, but the editor could not refresh it.')
        })
      })
      .then((release) => {
        if (disposed) release()
        else unsubscribe = release
      })
      .catch(() => props.onError('Replacement change notifications are unavailable.'))
    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [props.onError, props.projectSessionId, queryClient, workspaceKey])

  const refreshAfterAgentMutation = useCallback(async (): Promise<void> => {
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: workspaceKey }),
        queryClient.invalidateQueries({
          queryKey: ['manuscript-references', props.projectSessionId]
        })
      ])
    } catch {
      props.onError('The applied Agent change could not be refreshed.')
    }
  }, [props.onError, props.projectSessionId, queryClient, workspaceKey])

  const orderedIds = workspace?.sections.map((item) => item.section.sectionId) ?? []
  const activeIndex = activeSectionId === null ? -1 : orderedIds.indexOf(activeSectionId)
  const openFind = useCallback((): void => {
    setEditorAutoFocus(false)
    setActiveWorkspace('find')
  }, [setActiveWorkspace])
  const closeFind = useCallback((): void => {
    workbench.requestTool('find', false)
    editorRef.current?.clearSearchTarget()
    find.closeReview()
    setPendingSearchTarget(null)
    setEditorAutoFocus(true)
    if (workbench.activeId?.startsWith('section:')) setActiveWorkspaceRaw('manuscript')
    else setActiveWorkspace('manuscript')
  }, [find.closeReview, setActiveWorkspace, workbench.activeId, workbench.requestTool])

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

  const refreshOutlineAfterFailure = async (): Promise<void> => {
    await workspaceQuery.refetch()
  }

  const updateOutlineSection = (
    sectionId: string,
    update: { title?: string; objective?: string | null; status?: SectionStatus }
  ): Promise<boolean> =>
    enqueueOutlineMutation(async () => {
      const current = queryClient.getQueryData<ManuscriptWorkspace>(workspaceKey)
      if (!current) return false
      const result = await runMutation(() =>
        window.desktop.manuscript.updateSection({
          projectSessionId: props.projectSessionId,
          update: {
            baseOutlineVersion: current.outlineVersion,
            sectionId,
            ...update
          }
        })
      )
      if (result !== null) return true
      await refreshOutlineAfterFailure()
      return false
    })

  const moveOutlineSection = (
    sectionId: string,
    parentSectionId: string | null,
    position: number
  ): Promise<boolean> =>
    enqueueOutlineMutation(async () => {
      const current = queryClient.getQueryData<ManuscriptWorkspace>(workspaceKey)
      if (!current) return false
      const result = await runMutation(() =>
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
      if (result !== null) return true
      await refreshOutlineAfterFailure()
      return false
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
      const result = await runMutation(() =>
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
      if (result === null) {
        await refreshOutlineAfterFailure()
        return null
      }
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
      const result = await runMutation(() =>
        window.desktop.manuscript.deleteSection({
          projectSessionId: props.projectSessionId,
          delete: {
            baseOutlineVersion: current.outlineVersion,
            sectionId
          }
        })
      )
      if (result === null) {
        await refreshOutlineAfterFailure()
        return false
      }
      if (sectionId === activeSectionId && fallbackId !== null) {
        try {
          await activateSection(fallbackId)
        } catch {
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
    } catch {
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
    } catch {
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
  const changeMetadataTitle = useCallback((title: string) => {
    metadataDraftRef.current.title = title
    setMetadataTitle(title)
  }, [])
  const editorActions = useMemo(
    () => ({
      captureSelection: () => editorRef.current?.captureSelection(),
      focus: () => editorRef.current?.focus(),
      revealComment: (threadId: string) => editorRef.current?.revealComment(threadId),
      revealBlock: (blockId: string) => editorRef.current?.revealBlock(blockId),
      clearSearchTarget: () => editorRef.current?.clearSearchTarget(),
      releaseMutationBarrier: () => editorRef.current?.releaseMutationBarrier()
    }),
    []
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
    setMetadataError,
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
    refreshAfterAgentMutation,
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
