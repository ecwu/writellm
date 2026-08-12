import type {
  BlockNoteDocument,
  ManuscriptReferenceEntry,
  ManuscriptReferenceIndex,
  ManuscriptWorkspace,
  SectionRevision,
  SectionStatus,
  UpdateManuscriptBriefInput
} from '../../../../shared/contracts/manuscript'
import type {
  ExpandedCitation,
  ReadableCitationResolutionResult
} from '../../../../shared/contracts/search'
import {
  buildReferenceIndexFromOccurrences,
  findDocumentCitationOccurrences,
  referenceNumberMap
} from '../../../../shared/readable-citation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Download, FileSearch, FileText, MoreHorizontal, Upload } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useGroupRef } from 'react-resizable-panels'
import { AppSidebar } from '@/components/app-sidebar'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { AgentPanel, type AgentPanelSelection } from '@/features/agent/agent-panel'
import {
  CitationCandidatePicker,
  ExpandedCitationPreview
} from '@/features/knowledge/citation-preview'
import { KnowledgeManager } from '@/features/knowledge/knowledge-manager'
import { ManuscriptBriefDialog } from './manuscript-brief-dialog'
import { OutlineEditPanel } from './outline-edit-panel'
import { adjacentSectionAfterDelete } from './outline-tree'
import { ManuscriptPreview } from './manuscript-preview'
import { SectionEditor, type SectionEditorHandle, type SaveState } from './section-editor'

const editorSaveStateLabels: Record<SaveState, string> = {
  clean: 'Unsaved body',
  saving: 'Saving body',
  saved: 'Saved',
  'mirror-pending': 'Saved, mirror pending',
  conflict: 'Conflict',
  failed: 'Save failed'
}

const SECTION_TITLE_MAX_LENGTH = 500
const REFERENCE_PREVIEW_OCCURRENCE_LIMIT = 20

type ReferenceDialogState =
  | { phase: 'loading'; entry: ManuscriptReferenceEntry }
  | { phase: 'resolved'; entry: ManuscriptReferenceEntry; citation: ExpandedCitation }
  | { phase: 'ambiguous'; entry: ManuscriptReferenceEntry; citations: ExpandedCitation[] }
  | {
      phase: 'unavailable'
      entry: ManuscriptReferenceEntry
      reason: Extract<ReadableCitationResolutionResult, { status: 'unavailable' }>['reason']
    }
  | { phase: 'error'; entry: ManuscriptReferenceEntry }

export function WritingWorkspace(props: {
  projectSessionId: string
  projectName: string
  lifecycleState: string
  agentOpen: boolean
  onAgentOpenChange(open: boolean): void
  onOpenSettings(): void
  onOpenSkillSettings(): void
  onError(message: string): void
}): React.JSX.Element {
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
  const workspace = workspaceQuery.data
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null)
  const [briefOpen, setBriefOpen] = useState(false)
  const [briefError, setBriefError] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const wideAgentLayout = useMediaQuery('(min-width: 1280px)')
  const sideChatGroupRef = useGroupRef()
  const sideChatGroupElementRef = useRef<HTMLDivElement>(null)
  const [activeWorkspace, setActiveWorkspace] = useState<'manuscript' | 'knowledge' | 'references'>(
    'manuscript'
  )
  const [citationDraft, setCitationDraft] = useState<{
    sectionId: string
    sectionRevisionId: string
    content: BlockNoteDocument
  } | null>(null)
  const [referenceDialog, setReferenceDialog] = useState<ReferenceDialogState | null>(null)
  const referenceRequestSequenceRef = useRef(0)
  const [editorSaveState, setEditorSaveState] = useState<SaveState>('saved')
  const [metadataTitle, setMetadataTitle] = useState('')
  const [metadataError, setMetadataError] = useState(false)
  const [outlineEditOpen, setOutlineEditOpen] = useState(false)
  const [editorAutoFocus, setEditorAutoFocus] = useState(true)
  const editorRef = useRef<SectionEditorHandle>(null)
  const manuscriptScrollRef = useRef<HTMLElement>(null)
  const activeSectionIdRef = useRef<string | null>(null)
  const pendingScrollSectionIdRef = useRef<string | null>(null)
  const sectionSwitchLockRef = useRef<Promise<void>>(Promise.resolve())
  const metadataDraftSectionIdRef = useRef<string | null>(null)
  const metadataCanonicalUpdatedAtRef = useRef<string | null>(null)
  const metadataCanonicalTitleRef = useRef<string | null>(null)
  const metadataSaveRef = useRef<Promise<boolean> | null>(null)
  const outlineMutationLockRef = useRef<Promise<void>>(Promise.resolve())
  const metadataDraftRef = useRef({ title: '' })
  const [selectionContext, setSelectionContext] = useState<AgentPanelSelection | null>(null)

  const effectiveReferenceIndex = useMemo<ManuscriptReferenceIndex>(() => {
    const stored = referencesQuery.data
    if (stored === undefined) return { outlineVersion: workspace?.outlineVersion ?? 1, entries: [] }
    if (citationDraft === null || workspace === undefined) return stored
    const sectionOrder = new Map(
      workspace.sections.map((item, index) => [item.section.sectionId, index] as const)
    )
    const occurrences = stored.entries
      .flatMap((entry) => entry.occurrences)
      .filter((occurrence) => occurrence.sectionId !== citationDraft.sectionId)
    occurrences.push(...findDocumentCitationOccurrences(citationDraft))
    occurrences.sort((left, right) => {
      const sectionDelta =
        (sectionOrder.get(left.sectionId) ?? Number.MAX_SAFE_INTEGER) -
        (sectionOrder.get(right.sectionId) ?? Number.MAX_SAFE_INTEGER)
      return sectionDelta === 0 ? left.ordinal - right.ordinal : sectionDelta
    })
    return {
      outlineVersion: workspace.outlineVersion,
      entries: buildReferenceIndexFromOccurrences(occurrences).entries
    }
  }, [citationDraft, referencesQuery.data, workspace])
  const citationNumberByTitle = useMemo(
    () => referenceNumberMap(effectiveReferenceIndex),
    [effectiveReferenceIndex]
  )

  const openReference = useCallback(
    (entry: ManuscriptReferenceEntry): void => {
      const sequence = ++referenceRequestSequenceRef.current
      setReferenceDialog({ phase: 'loading', entry })
      void (async () => {
        let unavailableReason: Extract<
          ReadableCitationResolutionResult,
          { status: 'unavailable' }
        >['reason'] = 'unlinked'
        const occurrences = entry.occurrences.slice(0, REFERENCE_PREVIEW_OCCURRENCE_LIMIT)
        for (const occurrence of occurrences) {
          const result = await window.desktop.knowledge.resolveReadableCitation({
            projectSessionId: props.projectSessionId,
            sectionRevisionId: occurrence.sectionRevisionId,
            blockId: occurrence.blockId,
            title: occurrence.title,
            ...(occurrence.pageIndex === undefined ? {} : { pageIndex: occurrence.pageIndex })
          })
          if (referenceRequestSequenceRef.current !== sequence) return
          if (result.status === 'resolved') {
            setReferenceDialog({ phase: 'resolved', entry, citation: result.citation })
            return
          }
          if (result.status === 'ambiguous') {
            setReferenceDialog({ phase: 'ambiguous', entry, citations: result.citations })
            return
          }
          unavailableReason = result.reason
        }
        if (entry.occurrences.length > occurrences.length) unavailableReason = 'resolution_limit'
        setReferenceDialog({ phase: 'unavailable', entry, reason: unavailableReason })
      })().catch(() => {
        if (referenceRequestSequenceRef.current === sequence) {
          setReferenceDialog({ phase: 'error', entry })
        }
      })
    },
    [props.projectSessionId]
  )

  useEffect(() => {
    if (!props.agentOpen) return
    const frame = window.requestAnimationFrame(() => {
      const group = sideChatGroupRef.current
      const width = sideChatGroupElementRef.current?.getBoundingClientRect().width ?? 0
      if (group === null || width <= 0) return
      if (!wideAgentLayout) {
        group.setLayout({ manuscript: 0, agent: 100 })
        return
      }
      const agentPercent = Math.min(60, Math.max(20, (480 / width) * 100))
      group.setLayout({ manuscript: 100 - agentPercent, agent: agentPercent })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [props.agentOpen, sideChatGroupRef, wideAgentLayout])

  useEffect(() => {
    if (props.agentOpen) setActiveWorkspace('manuscript')
  }, [props.agentOpen])

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
    enabled: previewOpen,
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
      setCitationDraft(null)
      setSelectionContext(null)
      setActiveSectionId(sectionId)
    },
    [props.projectSessionId, queryClient, workspaceKey]
  )

  useEffect(() => {
    if (!workspace) return
    if (workspace.sections.length === 0) {
      activeSectionIdRef.current = null
      setActiveSectionId(null)
      return
    }
    if (!workspace.sections.some((item) => item.section.sectionId === activeSectionId)) {
      const fallback = workspace.sections[0]?.section.sectionId
      if (fallback !== undefined) {
        void activateSection(fallback).catch(() =>
          props.onError('The initial manuscript section could not be activated.')
        )
      }
    }
  }, [activateSection, activeSectionId, props, workspace])

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

  const flushCurrent = useCallback(async (): Promise<boolean> => {
    try {
      await editorRef.current?.flush()
      return await saveMetadata()
    } catch {
      props.onError('Save the current section before leaving it. Your local edits are preserved.')
      return false
    }
  }, [props, saveMetadata])

  const switchSection = useCallback(
    async (sectionId: string, source: 'user' | 'agent'): Promise<boolean> => {
      if (sectionId === activeSectionIdRef.current) return true
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
    [activateSection, flushCurrent, props]
  )

  const enqueueSectionSwitch = useCallback(
    (sectionId: string, source: 'user' | 'agent'): Promise<boolean> => {
      const operation = sectionSwitchLockRef.current.then(() => switchSection(sectionId, source))
      sectionSwitchLockRef.current = operation.then(
        () => undefined,
        () => undefined
      )
      return operation
    },
    [switchSection]
  )

  const selectSection = useCallback(
    (sectionId: string): Promise<boolean> => enqueueSectionSwitch(sectionId, 'user'),
    [enqueueSectionSwitch]
  )

  const followAgentSection = useCallback(
    (sectionId: string): Promise<boolean> => enqueueSectionSwitch(sectionId, 'agent'),
    [enqueueSectionSwitch]
  )

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
          if (editorRef.current) {
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
  }, [props.projectSessionId, queryClient, workspaceKey])

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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const modifier = event.metaKey || event.ctrlKey
      if (!modifier) return
      if (event.key.toLowerCase() === 'j') {
        event.preventDefault()
        props.onAgentOpenChange(!props.agentOpen)
      } else if (event.key.toLowerCase() === 's') {
        event.preventDefault()
        void flushCurrent()
      } else if (event.altKey && event.key === 'ArrowUp' && activeIndex > 0) {
        event.preventDefault()
        void selectSection(orderedIds[activeIndex - 1] as string)
      } else if (event.altKey && event.key === 'ArrowDown' && activeIndex < orderedIds.length - 1) {
        event.preventDefault()
        void selectSection(orderedIds[activeIndex + 1] as string)
      }
    }
    const handleSave = (): void => void flushCurrent()
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('writellm:save', handleSave)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('writellm:save', handleSave)
    }
  }, [
    activeIndex,
    flushCurrent,
    orderedIds,
    props.agentOpen,
    props.onAgentOpenChange,
    selectSection
  ])

  const updateRevision = (revision: SectionRevision): void => {
    setCitationDraft({
      sectionId: revision.sectionId,
      sectionRevisionId: revision.sectionRevisionId,
      content: revision.content
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

  const openPreview = async (): Promise<void> => {
    if (!(await flushCurrent())) return
    setPreviewOpen(true)
    await queryClient.invalidateQueries({
      queryKey: ['manuscript-preview', props.projectSessionId]
    })
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

  const importMarkdownForActiveSection = (): Promise<void> =>
    runActiveEditorAction(async () => {
      await editorRef.current?.importMarkdown()
    }, 'Markdown could not be imported into the current section.')

  const exportNativeJsonForActiveSection = (): Promise<void> =>
    runActiveEditorAction(async () => {
      await editorRef.current?.exportNativeJson()
    }, 'The native section document could not be exported.')

  const exportMarkdownForActiveSection = (): Promise<void> =>
    runActiveEditorAction(async () => {
      await editorRef.current?.exportMarkdown()
    }, 'The Markdown section export could not be created.')

  const previewFromPanel = async (): Promise<void> => {
    try {
      await openPreview()
    } catch {
      props.onError('The manuscript preview could not be loaded.')
    }
  }

  const openOutlineEditor = async (): Promise<void> => {
    if (await flushCurrent()) setOutlineEditOpen(true)
  }

  if (activeWorkspace === 'knowledge') {
    return (
      <KnowledgeManager
        projectSessionId={props.projectSessionId}
        projectName={props.projectName}
        onOpenManuscript={() => setActiveWorkspace('manuscript')}
        onOpenReferences={() => setActiveWorkspace('references')}
        onOpenSettings={props.onOpenSettings}
        onError={props.onError}
      />
    )
  }

  return (
    <SidebarProvider
      className='min-h-0 flex-1'
      style={{ '--sidebar-width': '360px' } as React.CSSProperties}
    >
      <AppSidebar
        projectName={props.projectName}
        workspace={workspace}
        references={effectiveReferenceIndex}
        referencesLoading={referencesQuery.isPending}
        referencesError={referencesQuery.isError}
        activeWorkspace={activeWorkspace}
        activeSectionId={activeSectionId}
        onSelectSection={(sectionId) => void selectSection(sectionId)}
        onOpenBrief={() => setBriefOpen(true)}
        onOpenOutlineEditor={() => void openOutlineEditor()}
        onOpenKnowledge={() => {
          props.onAgentOpenChange(false)
          setActiveWorkspace('knowledge')
        }}
        onOpenReferences={() => {
          props.onAgentOpenChange(false)
          setActiveWorkspace('references')
        }}
        onOpenReference={openReference}
        onOpenManuscript={() => setActiveWorkspace('manuscript')}
        onOpenSettings={props.onOpenSettings}
      />
      <ResizablePanelGroup
        orientation='horizontal'
        className='min-w-0 flex-1'
        disabled={!wideAgentLayout}
        groupRef={sideChatGroupRef}
        elementRef={sideChatGroupElementRef}
      >
        <ResizablePanel
          id='manuscript'
          className={props.agentOpen ? 'overflow-hidden max-xl:hidden' : 'overflow-hidden'}
          defaultSize={props.agentOpen && !wideAgentLayout ? '0' : undefined}
          minSize={props.agentOpen && wideAgentLayout ? 520 : 0}
          collapsible={props.agentOpen}
        >
          <SidebarInset ref={manuscriptScrollRef} className='size-full min-h-0 overflow-auto'>
            <header className='sticky top-0 z-20 flex shrink-0 items-center gap-2 border-b bg-background p-4'>
              <SidebarTrigger className='-ml-1' />
              <Badge className='ml-auto' variant='secondary'>
                {props.lifecycleState}
              </Badge>
            </header>
            <main className='mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-4 md:px-12 md:py-10 lg:px-20'>
              {workspaceQuery.isError ? (
                <Alert variant='destructive'>
                  <AlertCircle />
                  <AlertTitle>Workspace unavailable</AlertTitle>
                  <AlertDescription>
                    The manuscript workspace could not be loaded. Retry before editing.
                  </AlertDescription>
                </Alert>
              ) : null}
              {workspaceQuery.isPending || editorQuery.isPending ? (
                <div className='flex min-h-96 items-center justify-center gap-2 text-muted-foreground'>
                  <Spinner /> Loading writing workspace…
                </div>
              ) : editorQuery.data && activeSummary ? (
                <section className='flex flex-col gap-2'>
                  <div className='flex min-w-0 items-start gap-2'>
                    <Textarea
                      id='section-title'
                      aria-label='Section title'
                      rows={1}
                      maxLength={SECTION_TITLE_MAX_LENGTH}
                      value={metadataTitle}
                      onBlur={() => void saveMetadata()}
                      onChange={(event) => {
                        const title = normalizeSectionTitleDraft(event.target.value)
                        metadataDraftRef.current.title = title
                        setMetadataError(false)
                        setMetadataTitle(title)
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                        event.preventDefault()
                        void saveMetadata().then((saved) => {
                          if (saved) editorRef.current?.focus()
                        })
                      }}
                      className='h-auto min-h-0 min-w-0 flex-1 resize-none overflow-hidden border-0 bg-transparent px-0 py-0 text-4xl font-semibold tracking-tight shadow-none [field-sizing:content] focus-visible:ring-2 focus-visible:ring-ring max-md:pl-[54px] md:text-5xl'
                    />
                    <div className='flex shrink-0 items-center gap-2 pt-1'>
                      <Badge variant='outline' className='max-md:hidden'>
                        {editorSaveStateLabels[editorSaveState]}
                      </Badge>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant='outline' size='icon-sm' aria-label='Section actions'>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align='end'>
                          <DropdownMenuLabel>Section actions</DropdownMenuLabel>
                          <DropdownMenuGroup>
                            <DropdownMenuItem
                              onSelect={() => void importMarkdownForActiveSection()}
                            >
                              <Upload /> Import Markdown
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => void exportNativeJsonForActiveSection()}
                            >
                              <Download /> Export Native JSON
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => void exportMarkdownForActiveSection()}
                            >
                              <Download /> Export Markdown
                            </DropdownMenuItem>
                          </DropdownMenuGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  {metadataError ? (
                    <p className='text-sm text-destructive' role='alert'>
                      The title could not be saved. Press ⌘/Ctrl+S to retry.
                    </p>
                  ) : null}
                  <SectionEditor
                    ref={editorRef}
                    key={`${props.projectSessionId}:${activeSummary.section.sectionId}:${editorQuery.data.revision.sectionRevisionId}`}
                    projectSessionId={props.projectSessionId}
                    revision={editorQuery.data.revision}
                    citationNumberByTitle={citationNumberByTitle}
                    autoFocus={editorAutoFocus}
                    onRevision={updateRevision}
                    onCitationDocumentChange={(content) => {
                      setCitationDraft({
                        sectionId: editorQuery.data.revision.sectionId,
                        sectionRevisionId: editorQuery.data.revision.sectionRevisionId,
                        content
                      })
                    }}
                    onSaveStateChange={setEditorSaveState}
                    onSelectionContextChange={(context) => {
                      setSelectionContext({
                        sectionId: activeSummary.section.sectionId,
                        ...context
                      })
                    }}
                  />
                </section>
              ) : (
                <div className='flex min-h-96 items-center justify-center rounded-lg border border-dashed text-center'>
                  <div className='flex flex-col gap-3'>
                    <FileText className='mx-auto size-8 text-muted-foreground' />
                    <p className='font-medium'>No section is available</p>
                    <Button onClick={() => void openOutlineEditor()}>Open outline editor</Button>
                  </div>
                </div>
              )}
              <div className='flex items-center justify-between text-xs text-muted-foreground'>
                <span>⌘/Ctrl+S save · ⌘/Ctrl+Alt+↑/↓ navigate</span>
                <span>⌘/Ctrl+J toggles the agent panel</span>
              </div>
            </main>
          </SidebarInset>
        </ResizablePanel>
        {props.agentOpen ? (
          <>
            <ResizableHandle
              withHandle
              className={wideAgentLayout ? undefined : 'hidden'}
              data-testid='agent-panel-resize-handle'
            />
            <ResizablePanel
              id='agent'
              className='overflow-hidden'
              defaultSize={wideAgentLayout ? 480 : '100'}
              minSize={wideAgentLayout ? 360 : 0}
              maxSize={wideAgentLayout ? 640 : '100%'}
              groupResizeBehavior='preserve-pixel-size'
              disabled={!wideAgentLayout}
            >
              <AgentPanel
                open
                onOpenChange={props.onAgentOpenChange}
                onOpenSettings={props.onOpenSettings}
                onOpenSkillSettings={props.onOpenSkillSettings}
                projectSessionId={props.projectSessionId}
                activeSectionId={activeSectionId}
                sectionTitles={sectionTitles}
                currentRevisionIds={currentRevisionIds}
                selection={selectionContext}
                onFollowSection={followAgentSection}
                flushCurrent={flushCurrent}
                refreshManuscript={refreshAfterAgentMutation}
                onError={props.onError}
              />
            </ResizablePanel>
          </>
        ) : null}
      </ResizablePanelGroup>

      {workspace ? (
        <OutlineEditPanel
          open={outlineEditOpen}
          workspace={workspace}
          activeSectionId={activeSectionId}
          onRequestClose={() => setOutlineEditOpen(false)}
          onUpdateSection={updateOutlineSection}
          onMoveSection={moveOutlineSection}
          onCreateSection={createOutlineSection}
          onDeleteSection={deleteOutlineSection}
          onOpenSection={selectSection}
          onPreviewAll={previewFromPanel}
        />
      ) : null}

      {workspace ? (
        <ManuscriptBriefDialog
          open={briefOpen}
          brief={workspace.brief}
          saving={mutation.isPending}
          error={briefError}
          onOpenChange={setBriefOpen}
          onReload={() => {
            void workspaceQuery.refetch().then(() => {
              setBriefError(null)
            })
          }}
          onSave={async (fields) => {
            setBriefError(null)
            const update: UpdateManuscriptBriefInput = {
              ...fields,
              baseVersion: workspace.brief.version
            }
            const result = await runMutation(() =>
              window.desktop.manuscript.updateBrief({
                projectSessionId: props.projectSessionId,
                update
              })
            )
            if (result === null) setBriefError('The brief changed or could not be saved.')
          }}
        />
      ) : null}

      <ManuscriptPreview
        projectSessionId={props.projectSessionId}
        open={previewOpen}
        assembly={previewQuery.data}
        loading={previewQuery.isPending || previewQuery.isFetching}
        error={previewQuery.isError}
        onOpenChange={setPreviewOpen}
      />
      <ReferenceSourceDialog
        projectSessionId={props.projectSessionId}
        state={referenceDialog}
        onOpenChange={(open) => {
          if (open) return
          referenceRequestSequenceRef.current += 1
          setReferenceDialog(null)
        }}
        onRetry={openReference}
        onSelect={(entry, citation) => {
          setReferenceDialog({ phase: 'resolved', entry, citation })
        }}
      />
    </SidebarProvider>
  )
}

function ReferenceSourceDialog(props: {
  projectSessionId: string
  state: ReferenceDialogState | null
  onOpenChange(open: boolean): void
  onRetry(entry: ManuscriptReferenceEntry): void
  onSelect(entry: ManuscriptReferenceEntry, citation: ExpandedCitation): void
}): React.JSX.Element {
  const state = props.state
  const title =
    state?.phase === 'resolved'
      ? state.citation.title
      : state?.phase === 'ambiguous'
        ? 'Choose source evidence'
        : state?.phase === 'loading'
          ? `Resolving [${state.entry.number}]`
          : state?.phase === 'error'
            ? 'Source preview unavailable'
            : 'Source link unavailable'
  const description =
    state?.phase === 'resolved'
      ? `${state.citation.headingPath.join(' / ') || 'Normalized source chunk'}${
          state.citation.page === undefined ? '' : ` · Page ${state.citation.page + 1}`
        }`
      : state?.phase === 'ambiguous'
        ? 'This reference matches more than one evidence chunk. Choose the one to preview.'
        : state?.phase === 'loading'
          ? `Checking occurrences of ${state.entry.title} in manuscript order.`
          : state?.phase === 'error'
            ? 'The citation resolver failed unexpectedly. Retry without leaving the manuscript.'
            : referenceUnavailableMessage(
                state?.phase === 'unavailable' ? state.reason : 'unlinked'
              )
  return (
    <Dialog open={state !== null} onOpenChange={props.onOpenChange}>
      <DialogContent className='max-h-[85vh] max-w-3xl! overflow-y-auto'>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {state?.phase === 'loading' ? (
          <div
            className='flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground'
            role='status'
          >
            <Spinner /> Resolving source link…
          </div>
        ) : null}
        {state?.phase === 'resolved' ? (
          <ExpandedCitationPreview
            projectSessionId={props.projectSessionId}
            citation={state.citation}
          />
        ) : null}
        {state?.phase === 'ambiguous' ? (
          <CitationCandidatePicker
            citations={state.citations}
            onSelect={(citation) => props.onSelect(state.entry, citation)}
          />
        ) : null}
        {state?.phase === 'unavailable' ? (
          <div className='flex gap-3 rounded-md bg-muted/50 px-4 py-3 text-sm' role='status'>
            <FileSearch className='mt-0.5 size-4 shrink-0 text-muted-foreground' />
            <p>{referenceUnavailableMessage(state.reason)}</p>
          </div>
        ) : null}
        {state?.phase === 'error' ? (
          <div className='flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted/50 px-4 py-3 text-sm'>
            <p>The source preview could not be loaded. The reference index is unchanged.</p>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() => props.onRetry(state.entry)}
            >
              Retry
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function referenceUnavailableMessage(
  reason: Extract<ReadableCitationResolutionResult, { status: 'unavailable' }>['reason']
): string {
  switch (reason) {
    case 'unlinked':
      return 'No verifiable source association was found for any occurrence of this reference.'
    case 'source_missing':
      return 'The linked source is no longer available in the active knowledge index.'
    case 'index_unavailable':
      return 'The knowledge index is still preparing. Try this reference again when indexing is complete.'
    case 'resolution_limit':
      return 'The reference is older than the bounded provenance history available for interactive preview.'
  }
}

function normalizeSectionTitleDraft(value: string): string {
  return value.replace(/[\r\n]+/g, ' ')
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const media = window.matchMedia(query)
    const update = (): void => setMatches(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [query])
  return matches
}

declare global {
  interface WindowEventMap {
    'writellm:save': Event
  }
}
