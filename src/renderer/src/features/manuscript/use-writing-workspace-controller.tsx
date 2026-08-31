import type {
  BlockNoteDocument,
  ManuscriptReferenceEntry,
  ManuscriptReferenceIndex,
  ManuscriptWorkspace,
  SectionRevision,
  SectionStatus
} from '../../../../shared/contracts/manuscript'
import type { ManuscriptImportPlan } from '../../../../shared/contracts/manuscript-import'
import type {
  ExpandedCitation,
  ReadableCitationResolutionResult
} from '../../../../shared/contracts/search'
import type {
  ManuscriptSearchHit,
  ManuscriptSearchResult,
  ManuscriptSearchTargetContract
} from '../../../../shared/contracts/manuscript-search'
import type {
  ManuscriptReplacementCandidate,
  ManuscriptReplacementPlanResult
} from '../../../../shared/contracts/manuscript-replacement'
import type { AgentQuickActionRequest } from '../../../../shared/contracts/agent-quick-actions'
import type { AnnotationRecord } from '../../../../shared/contracts/annotations'
import {
  buildReferenceIndexFromOccurrences,
  findDocumentCitationOccurrences,
  referenceNumberMap
} from '../../../../shared/readable-citation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useGroupRef } from 'react-resizable-panels'
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
import type { ManuscriptFindScope } from './manuscript-find-panel'
import type { EditorExactSelectionSnapshot, SectionEditorHandle, SaveState } from './section-editor'
import type { WritingWorkspaceProps } from './writing-workspace'

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
  const [importOpen, setImportOpen] = useState(false)
  const [importPlan, setImportPlan] = useState<ManuscriptImportPlan | null>(null)
  const [importLoading, setImportLoading] = useState(false)
  const [importApplying, setImportApplying] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const publicationQuery = useQuery({
    queryKey: ['publication-preview', props.projectSessionId],
    queryFn: () =>
      window.desktop.manuscript.publicationPreview({ projectSessionId: props.projectSessionId }),
    enabled: publicationOpen
  })
  const wideAgentLayout = useMediaQuery('(min-width: 1280px)')
  const sideChatGroupRef = useGroupRef()
  const sideChatGroupElementRef = useRef<HTMLDivElement>(null)
  const [activeWorkspace, setActiveWorkspace] = useState<WorkspaceKind>('manuscript')
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
  const [outlineSearchFocus, setOutlineSearchFocus] = useState<{
    sectionId: string
    field: 'objective'
    from: number
    to: number
  } | null>(null)
  const [editorAutoFocus, setEditorAutoFocus] = useState(true)
  const editorRef = useRef<SectionEditorHandle>(null)
  const [pendingCitationInsert, setPendingCitationInsert] = useState<string | null>(null)
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
  const [annotationCreateOpen, setAnnotationCreateOpen] = useState(false)
  const [includedAnnotations, setIncludedAnnotations] = useState<AnnotationRecord[]>([])
  const openAnnotationsQuery = useQuery({
    queryKey: ['annotations', props.projectSessionId, 'open-count'],
    queryFn: () =>
      window.desktop.annotations.list({
        projectSessionId: props.projectSessionId,
        statuses: ['open'],
        kinds: [],
        limit: 1
      })
  })
  const [quickActionRequest, setQuickActionRequest] = useState<AgentPanelQuickActionRequest | null>(
    null
  )
  const [findQuery, setFindQuery] = useState('')
  const [findCaseSensitive, setFindCaseSensitive] = useState(false)
  const [findScope, setFindScope] = useState<ManuscriptFindScope>('manuscript')
  const [findStatuses, setFindStatuses] = useState<SectionStatus[]>([])
  const [findResult, setFindResult] = useState<ManuscriptSearchResult | null>(null)
  const [findLoading, setFindLoading] = useState(false)
  const [findLoadingMore, setFindLoadingMore] = useState(false)
  const [findError, setFindError] = useState<string | null>(null)
  const [selectedFindMatchId, setSelectedFindMatchId] = useState<string | null>(null)
  const [replaceOpen, setReplaceOpen] = useState(false)
  const [replacement, setReplacement] = useState('')
  const [replacementPlan, setReplacementPlan] = useState<ManuscriptReplacementPlanResult | null>(
    null
  )
  const [replacementCandidates, setReplacementCandidates] = useState<
    ManuscriptReplacementCandidate[]
  >([])
  const [selectedReplacementIds, setSelectedReplacementIds] = useState<Set<string>>(new Set())
  const [replacementLoading, setReplacementLoading] = useState(false)
  const [replacementLoadingMore, setReplacementLoadingMore] = useState(false)
  const [replacementApplying, setReplacementApplying] = useState(false)
  const [replacementMessage, setReplacementMessage] = useState<string | null>(null)
  const [replacementUndoCapabilities, setReplacementUndoCapabilities] = useState<string[]>([])
  const [createReplacementCheckpoint, setCreateReplacementCheckpoint] = useState(false)
  const [pendingSearchTarget, setPendingSearchTarget] = useState<{
    target: ManuscriptSearchTargetContract
    revisionId: string | null
  } | null>(null)
  const findRequestRef = useRef(0)
  const replacementRequestRef = useRef(0)
  const replacementPageRequestRef = useRef(0)
  const replacementPagePendingRef = useRef(false)
  const workspaceSearchVersionRef = useRef(workspaceSearchVersion)
  const sectionTitleRef = useRef<HTMLTextAreaElement>(null)

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
  const saveMetadataRef = useRef(saveMetadata)
  saveMetadataRef.current = saveMetadata

  const flushCurrent = useCallback(async (): Promise<boolean> => {
    try {
      await editorRef.current?.flush()
      return await saveMetadata()
    } catch {
      props.onError('Save the current section before leaving it. Your local edits are preserved.')
      return false
    }
  }, [props, saveMetadata])

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
    (sectionId: string, source: 'user' | 'agent' | 'find'): Promise<boolean> => {
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

  const currentFindScope = useCallback(() => {
    if (activeSectionIdRef.current === null || findScope === 'manuscript') {
      return { type: 'manuscript' as const }
    }
    return findScope === 'section'
      ? { type: 'sections' as const, sectionIds: [activeSectionIdRef.current] }
      : { type: 'subtree' as const, rootSectionId: activeSectionIdRef.current }
  }, [findScope])

  const runFind = useCallback(
    async (cursor?: string): Promise<void> => {
      const query = findQuery
      if (query.length === 0) {
        setFindResult(null)
        setFindError(null)
        return
      }
      const sequence = ++findRequestRef.current
      cursor === undefined ? setFindLoading(true) : setFindLoadingMore(true)
      setFindError(null)
      try {
        const next = await window.desktop.manuscript.search({
          projectSessionId: props.projectSessionId,
          query,
          caseSensitive: findCaseSensitive,
          scope: currentFindScope(),
          statuses: findStatuses,
          ...(cursor === undefined ? {} : { cursor }),
          limit: 25
        })
        if (findRequestRef.current !== sequence) return
        setFindResult((current) =>
          cursor === undefined || current === null
            ? next
            : { ...next, hits: [...current.hits, ...next.hits] }
        )
      } catch {
        if (findRequestRef.current === sequence) {
          setFindError('Find could not scan the current manuscript. Retry or narrow the scope.')
        }
      } finally {
        if (findRequestRef.current === sequence) {
          setFindLoading(false)
          setFindLoadingMore(false)
        }
      }
    },
    [currentFindScope, findCaseSensitive, findQuery, findStatuses, props.projectSessionId]
  )

  const reviewReplacements = useCallback(async (): Promise<void> => {
    if (findQuery.length === 0) return
    replacementPageRequestRef.current += 1
    replacementPagePendingRef.current = false
    setReplacementLoadingMore(false)
    const sequence = ++replacementRequestRef.current
    setReplacementLoading(true)
    setReplacementMessage(null)
    setSelectedReplacementIds(new Set())
    try {
      const plan = await window.desktop.manuscript.createReplacementPlan({
        projectSessionId: props.projectSessionId,
        query: findQuery,
        caseSensitive: findCaseSensitive,
        scope: currentFindScope(),
        statuses: findStatuses,
        replacement
      })
      if (replacementRequestRef.current !== sequence) {
        if (plan.status === 'ready') {
          void window.desktop.manuscript
            .dismissReplacementPlan({
              projectSessionId: props.projectSessionId,
              planId: plan.planId
            })
            .catch(() => props.onError('The superseded replacement review could not be dismissed.'))
        }
        return
      }
      setReplacementPlan(plan)
      setReplacementCandidates(plan.status === 'ready' ? plan.candidates : [])
      if (plan.status === 'unavailable') {
        setReplacementMessage(
          plan.reason === 'result_limit'
            ? 'Too many matches for a complete review. Narrow the scope.'
            : plan.reason === 'plan_size'
              ? 'This review is too large. Narrow the scope.'
              : 'Planning exceeded its safe scan budget. Narrow the scope and retry.'
        )
      }
    } catch {
      if (replacementRequestRef.current === sequence) {
        setReplacementMessage('Replacement review could not be created. Retry after saving.')
      }
    } finally {
      editorRef.current?.releaseMutationBarrier()
      if (replacementRequestRef.current === sequence) setReplacementLoading(false)
    }
  }, [
    currentFindScope,
    findCaseSensitive,
    findQuery,
    findStatuses,
    props.onError,
    props.projectSessionId,
    replacement
  ])

  const loadMoreReplacements = useCallback(async (): Promise<void> => {
    if (
      replacementPlan?.status !== 'ready' ||
      replacementPlan.nextCursor === null ||
      replacementPagePendingRef.current
    ) {
      return
    }
    const planId = replacementPlan.planId
    const cursor = replacementPlan.nextCursor
    const reviewSequence = replacementRequestRef.current
    const pageSequence = ++replacementPageRequestRef.current
    replacementPagePendingRef.current = true
    setReplacementLoadingMore(true)
    try {
      const page = await window.desktop.manuscript.replacementPage({
        projectSessionId: props.projectSessionId,
        planId,
        cursor,
        limit: 50
      })
      if (
        replacementRequestRef.current !== reviewSequence ||
        replacementPageRequestRef.current !== pageSequence
      ) {
        return
      }
      if (page.status !== 'ready') {
        setReplacementPlan(null)
        setReplacementMessage('This replacement review expired. Create a fresh review.')
        return
      }
      setReplacementCandidates((current) => [...current, ...page.candidates])
      setReplacementPlan(page)
    } catch {
      if (replacementPageRequestRef.current === pageSequence) {
        setReplacementMessage('More replacement candidates could not be loaded.')
      }
    } finally {
      if (replacementPageRequestRef.current === pageSequence) {
        replacementPagePendingRef.current = false
        setReplacementLoadingMore(false)
      }
    }
  }, [props.projectSessionId, replacementPlan])

  const applyReplacements = useCallback(async (): Promise<void> => {
    if (replacementPlan?.status !== 'ready' || selectedReplacementIds.size === 0) return
    replacementPageRequestRef.current += 1
    replacementPagePendingRef.current = false
    setReplacementLoadingMore(false)
    setReplacementApplying(true)
    setReplacementMessage(null)
    try {
      const result = await window.desktop.manuscript.applyReplacement({
        projectSessionId: props.projectSessionId,
        planId: replacementPlan.planId,
        candidateIds: [...selectedReplacementIds],
        commandId: crypto.randomUUID(),
        createCheckpoint: createReplacementCheckpoint
      })
      if (result.status === 'applied' || result.status === 'already_applied') {
        setReplacementUndoCapabilities(
          result.affectedSections.map((section) => section.undoCapability)
        )
        setReplacementMessage(
          result.pendingRepairSectionIds.length > 0
            ? `Applied ${result.selectedCount} replacements. ${result.pendingRepairSectionIds.length} section mirrors will be repaired automatically.`
            : `Applied ${result.selectedCount} replacements in ${result.affectedSections.length} sections.`
        )
        setReplacementPlan(null)
        setReplacementCandidates([])
        setSelectedReplacementIds(new Set())
      } else if (result.status === 'conflict') {
        setReplacementMessage(
          'Manuscript changed — review refreshed. Create a new review before applying.'
        )
        setReplacementPlan(null)
      } else {
        setReplacementMessage('This replacement review is no longer valid. Create a fresh review.')
        setReplacementPlan(null)
      }
    } catch {
      setReplacementMessage(
        'Replacement could not be applied. No partial canonical batch was reported.'
      )
    } finally {
      editorRef.current?.releaseMutationBarrier()
      setReplacementApplying(false)
    }
  }, [createReplacementCheckpoint, props.projectSessionId, replacementPlan, selectedReplacementIds])

  const undoReplacement = useCallback(async (): Promise<void> => {
    const capability = replacementUndoCapabilities[0]
    if (capability === undefined) return
    try {
      const result = await window.desktop.manuscript.undoReplacement({
        projectSessionId: props.projectSessionId,
        undoCapability: capability
      })
      setReplacementUndoCapabilities((current) => current.slice(1))
      setReplacementMessage(
        result.status === 'undone'
          ? 'Replacement was undone for one section.'
          : result.status === 'stale'
            ? 'This section changed later, so Undo was not applied.'
            : 'This Undo is no longer available.'
      )
    } catch {
      setReplacementMessage('Replacement Undo could not be completed.')
    } finally {
      editorRef.current?.releaseMutationBarrier()
    }
  }, [props.projectSessionId, replacementUndoCapabilities])

  const invalidateReplacementReview = useCallback((): void => {
    replacementRequestRef.current += 1
    replacementPageRequestRef.current += 1
    replacementPagePendingRef.current = false
    const planId = replacementPlan?.status === 'ready' ? replacementPlan.planId : null
    setReplacementPlan(null)
    setReplacementCandidates([])
    setSelectedReplacementIds(new Set())
    setReplacementMessage(null)
    setReplacementLoading(false)
    setReplacementLoadingMore(false)
    if (planId === null) return
    void window.desktop.manuscript
      .dismissReplacementPlan({ projectSessionId: props.projectSessionId, planId })
      .catch(() => props.onError('The previous replacement review could not be dismissed.'))
  }, [props.onError, props.projectSessionId, replacementPlan])

  const changeFindQuery = useCallback(
    (query: string): void => {
      invalidateReplacementReview()
      setFindQuery(query)
    },
    [invalidateReplacementReview]
  )

  const changeFindCaseSensitive = useCallback(
    (value: boolean): void => {
      invalidateReplacementReview()
      setFindCaseSensitive(value)
    },
    [invalidateReplacementReview]
  )

  const changeFindScope = useCallback(
    (scope: ManuscriptFindScope): void => {
      invalidateReplacementReview()
      setFindScope(scope)
    },
    [invalidateReplacementReview]
  )

  const changeFindStatuses = useCallback(
    (statuses: SectionStatus[]): void => {
      invalidateReplacementReview()
      setFindStatuses(statuses)
    },
    [invalidateReplacementReview]
  )

  const changeReplacement = useCallback(
    (value: string): void => {
      invalidateReplacementReview()
      setReplacement(value)
    },
    [invalidateReplacementReview]
  )

  const changeReplaceOpen = useCallback(
    (open: boolean): void => {
      setReplaceOpen(open)
      if (!open) invalidateReplacementReview()
    },
    [invalidateReplacementReview]
  )

  useEffect(() => {
    if (activeWorkspace !== 'find') return
    editorRef.current?.clearSearchTarget()
    setSelectedFindMatchId(null)
    setPendingSearchTarget(null)
    const timer = window.setTimeout(() => void runFind(), 200)
    return () => window.clearTimeout(timer)
  }, [activeWorkspace, runFind])

  useEffect(() => {
    if (workspaceSearchVersionRef.current === workspaceSearchVersion) return
    workspaceSearchVersionRef.current = workspaceSearchVersion
    if (activeWorkspace !== 'find') return
    const timer = window.setTimeout(() => void runFind(), 200)
    return () => window.clearTimeout(timer)
  }, [activeWorkspace, runFind, workspaceSearchVersion])

  const activateFindHit = useCallback(
    async (hit: ManuscriptSearchHit): Promise<void> => {
      if (!(await flushCurrent())) return
      setFindError(null)
      try {
        const validated = await window.desktop.manuscript.revalidateSearch({
          projectSessionId: props.projectSessionId,
          query: findQuery,
          caseSensitive: findCaseSensitive,
          matchId: hit.matchId,
          sourceSliceHash: hit.sourceSliceHash,
          target: hit.target
        })
        if (validated.status === 'stale') {
          setFindError('The manuscript changed at this result. Results were refreshed.')
          await runFind()
          return
        }
        const switched = await enqueueSectionSwitch(validated.sectionId, 'find')
        if (!switched) return
        setSelectedFindMatchId(hit.matchId)
        setPendingSearchTarget({ target: validated.target, revisionId: validated.revisionId })
      } catch {
        setFindError('This result could not be validated. Refresh the search and try again.')
      }
    },
    [
      enqueueSectionSwitch,
      findCaseSensitive,
      findQuery,
      flushCurrent,
      props.projectSessionId,
      runFind
    ]
  )

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
    props.onAgentOpenChange(false)
    setEditorAutoFocus(false)
    setActiveWorkspace('find')
  }, [props.onAgentOpenChange])
  const closeFind = useCallback((): void => {
    editorRef.current?.clearSearchTarget()
    setSelectedFindMatchId(null)
    setPendingSearchTarget(null)
    setReplaceOpen(false)
    invalidateReplacementReview()
    setEditorAutoFocus(true)
    setActiveWorkspace('manuscript')
  }, [invalidateReplacementReview])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && activeWorkspace === 'find') {
        if (replaceOpen) {
          event.preventDefault()
          event.stopImmediatePropagation()
          changeReplaceOpen(false)
        } else closeFind()
        return
      }
      const modifier = event.metaKey || event.ctrlKey
      if (!modifier) return
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault()
        openFind()
      } else if (event.key.toLowerCase() === 'j') {
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
    props.agentOpen,
    props.onAgentOpenChange,
    selectSection,
    closeFind,
    changeReplaceOpen,
    openFind,
    replaceOpen
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

  const openPreviewWorkspace = async (): Promise<void> => {
    if (!(await flushCurrent())) return
    props.onAgentOpenChange(false)
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

  const openManuscriptImport = async (selection: 'file' | 'directory' = 'file'): Promise<void> => {
    if (!(await flushCurrent())) return
    const sectionId = activeSectionIdRef.current
    if (sectionId === null) return
    setImportOpen(true)
    setImportPlan(null)
    setImportError(null)
    setImportLoading(true)
    try {
      const result = await window.desktop.editor.createImportPlan({
        projectSessionId: props.projectSessionId,
        activeSectionId: sectionId,
        selection
      })
      if (result.status === 'cancelled') {
        setImportOpen(false)
        return
      }
      setImportPlan(result.plan)
    } catch {
      setImportError('The selected manuscript could not be captured and mapped safely.')
    } finally {
      setImportLoading(false)
    }
  }

  const cancelManuscriptImport = async (): Promise<void> => {
    const plan = importPlan
    setImportOpen(false)
    setImportPlan(null)
    setImportError(null)
    if (plan === null) return
    try {
      await window.desktop.editor.cancelImportPlan({
        projectSessionId: props.projectSessionId,
        planId: plan.planId
      })
    } catch {
      props.onError('Import staging cleanup will be retried when the project is reopened.')
    }
  }

  const applyManuscriptImport = async (
    mode: 'create_sections' | 'replace_active_section'
  ): Promise<void> => {
    if (importPlan === null) return
    setImportApplying(true)
    setImportError(null)
    try {
      await window.desktop.editor.applyImportPlan({
        projectSessionId: props.projectSessionId,
        planId: importPlan.planId,
        mode
      })
      setImportOpen(false)
      setImportPlan(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: workspaceKey }),
        queryClient.invalidateQueries({
          queryKey: ['manuscript-section', props.projectSessionId, activeSectionIdRef.current]
        }),
        queryClient.invalidateQueries({
          queryKey: ['manuscript-references', props.projectSessionId]
        })
      ])
    } catch {
      setImportError('The manuscript changed or the reviewed import could not be applied.')
    } finally {
      setImportApplying(false)
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
    props.onAgentOpenChange(false)
    setActiveWorkspace('checks')
  }

  useEffect(() => {
    if (
      activeWorkspace !== 'manuscript' ||
      pendingCitationInsert === null ||
      editorQuery.data === undefined
    ) {
      return
    }
    const frame = requestAnimationFrame(() => {
      const editor = editorRef.current
      if (editor === null) {
        props.onError('The active manuscript section is not ready for citation insertion.')
        setPendingCitationInsert(null)
        return
      }
      editor.insertText(`[@${pendingCitationInsert}]`)
      setPendingCitationInsert(null)
    })
    return () => cancelAnimationFrame(frame)
  }, [activeWorkspace, editorQuery.data, pendingCitationInsert, props])

  let alternateWorkspace: React.JSX.Element | null = null
  if (activeWorkspace === 'knowledge') {
    alternateWorkspace = (
      <KnowledgeManager
        projectSessionId={props.projectSessionId}
        projectName={props.projectName}
        onOpenManuscript={closeFind}
        onInsertCitation={(citationKey) => {
          setPendingCitationInsert(citationKey)
          setActiveWorkspace('manuscript')
        }}
        onOpenNotebook={() => setActiveWorkspace('notebook')}
        onOpenPreview={() => setActiveWorkspace('preview')}
        onOpenAssets={() => setActiveWorkspace('assets')}
        onOpenChecks={() => setActiveWorkspace('checks')}
        onOpenReferences={() => setActiveWorkspace('references')}
        onOpenIssues={() => setActiveWorkspace('issues')}
        onOpenWritingRules={() => setActiveWorkspace('writing_rules')}
        onOpenFind={openFind}
        onOpenSettings={props.onOpenSettings}
        onError={props.onError}
      />
    )
  }

  if (activeWorkspace === 'notebook') {
    alternateWorkspace = (
      <NotebookWorkspace
        projectSessionId={props.projectSessionId}
        projectName={props.projectName}
        onOpenManuscript={closeFind}
        onOpenPreview={() => setActiveWorkspace('preview')}
        onOpenKnowledge={() => setActiveWorkspace('knowledge')}
        onOpenChecks={() => setActiveWorkspace('checks')}
        onOpenAssets={() => setActiveWorkspace('assets')}
        onOpenReferences={() => setActiveWorkspace('references')}
        onOpenIssues={() => setActiveWorkspace('issues')}
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
        onOpenIssues={() => setActiveWorkspace('issues')}
        onOpenWritingRules={() => setActiveWorkspace('writing_rules')}
        onOpenFind={openFind}
        onOpenSettings={props.onOpenSettings}
        onError={props.onError}
        onNavigate={(sectionId, blockId) => {
          setActiveWorkspace('manuscript')
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
        onOpenIssues={() => setActiveWorkspace('issues')}
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
        onOpenIssues={() => setActiveWorkspace('issues')}
        onOpenWritingRules={() => setActiveWorkspace('writing_rules')}
        onOpenFind={openFind}
        onOpenSettings={props.onOpenSettings}
      />
    )
  }

  return {
    alternateWorkspace,
    queryClient,
    workspaceKey,
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
    importOpen,
    setImportOpen,
    importPlan,
    importLoading,
    importApplying,
    importError,
    publicationQuery,
    wideAgentLayout,
    sideChatGroupRef,
    sideChatGroupElementRef,
    activeWorkspace,
    setActiveWorkspace,
    setCitationDraft,
    referenceDialog,
    setReferenceDialog,
    referenceRequestSequenceRef,
    editorSaveState,
    setEditorSaveState,
    metadataTitle,
    setMetadataTitle,
    metadataError,
    setMetadataError,
    outlineEditOpen,
    setOutlineEditOpen,
    outlineSearchFocus,
    setOutlineSearchFocus,
    editorAutoFocus,
    editorRef,
    manuscriptScrollRef,
    metadataDraftRef,
    selectionContext,
    setSelectionContext,
    annotationCreateOpen,
    setAnnotationCreateOpen,
    includedAnnotations,
    setIncludedAnnotations,
    openAnnotationsQuery,
    quickActionRequest,
    setQuickActionRequest,
    findQuery,
    findCaseSensitive,
    findScope,
    findStatuses,
    findResult,
    findLoading,
    findLoadingMore,
    findError,
    selectedFindMatchId,
    setSelectedFindMatchId,
    replaceOpen,
    replacement,
    replacementPlan,
    replacementCandidates,
    selectedReplacementIds,
    setSelectedReplacementIds,
    replacementLoading,
    replacementLoadingMore,
    replacementApplying,
    replacementMessage,
    replacementUndoCapabilities,
    createReplacementCheckpoint,
    setCreateReplacementCheckpoint,
    sectionTitleRef,
    effectiveReferenceIndex,
    citationNumberByTitle,
    openReference,
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
    runFind,
    reviewReplacements,
    loadMoreReplacements,
    applyReplacements,
    undoReplacement,
    changeFindQuery,
    changeFindCaseSensitive,
    changeFindScope,
    changeFindStatuses,
    changeReplacement,
    changeReplaceOpen,
    activateFindHit,
    refreshAfterAgentMutation,
    openFind,
    closeFind,
    updateRevision,
    updateOutlineSection,
    moveOutlineSection,
    createOutlineSection,
    deleteOutlineSection,
    openPreviewWorkspace,
    openManuscriptImport,
    cancelManuscriptImport,
    applyManuscriptImport,
    exportNativeJsonForActiveSection,
    exportMarkdownForActiveSection,
    openPublicationPreflight,
    openOutlineEditor,
    openChecksFromManuscript
  }
}

export type WritingWorkspaceController = ReturnType<typeof useWritingWorkspaceController>
