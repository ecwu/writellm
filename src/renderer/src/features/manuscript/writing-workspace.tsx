import type {
  BlockNoteDocument,
  ManuscriptReferenceEntry,
  ManuscriptReferenceIndex,
  ManuscriptWorkspace,
  SectionRevision,
  SectionStatus,
  UpdateManuscriptBriefInput
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
import type { ReviewIssueRecord } from '../../../../shared/contracts/review'
import type { PublicationPreview } from '../../../../shared/contracts/publication'
import type { AnnotationRecord } from '../../../../shared/contracts/annotations'
import {
  buildReferenceIndexFromOccurrences,
  findDocumentCitationOccurrences,
  referenceNumberMap
} from '../../../../shared/readable-citation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileCheck2,
  FileSearch,
  FileText,
  FolderOpen,
  MoreHorizontal,
  MessageSquarePlus,
  Upload
} from 'lucide-react'
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
import {
  AgentPanel,
  type AgentPanelQuickActionRequest,
  type AgentPanelSelection
} from '@/features/agent/agent-panel'
import {
  CitationCandidatePicker,
  ExpandedCitationPreview
} from '@/features/knowledge/citation-preview'
import { KnowledgeManager } from '@/features/knowledge/knowledge-manager'
import { KnowledgeCitationCoverageWorkspace } from '@/features/checks/knowledge-citation-coverage-workspace'
import { ReviewCenterPanel } from '@/features/review/review-center-panel'
import { WritingRulesPanel } from '@/features/review/writing-rules-panel'
import { AnnotationCreateDialog } from '@/features/review/annotation-create-dialog'
import { ManuscriptBriefDialog } from './manuscript-brief-dialog'
import { OutlineEditPanel } from './outline-edit-panel'
import { AssetWorkspace } from './asset-workspace'
import { adjacentSectionAfterDelete } from './outline-tree'
import { ManuscriptPreview } from './manuscript-preview'
import { ManuscriptImportDialog } from './manuscript-import-dialog'
import { ManuscriptFindPanel, type ManuscriptFindScope } from './manuscript-find-panel'
import {
  SectionEditor,
  type EditorExactSelectionSnapshot,
  type SectionEditorHandle,
  type SaveState
} from './section-editor'

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
  const [previewOpen, setPreviewOpen] = useState(false)
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
  const [activeWorkspace, setActiveWorkspace] = useState<
    | 'manuscript'
    | 'knowledge'
    | 'checks'
    | 'assets'
    | 'references'
    | 'find'
    | 'issues'
    | 'writing_rules'
  >('manuscript')
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
    setActiveWorkspace('find')
  }, [props.onAgentOpenChange])
  const closeFind = useCallback((): void => {
    editorRef.current?.clearSearchTarget()
    setSelectedFindMatchId(null)
    setPendingSearchTarget(null)
    setReplaceOpen(false)
    invalidateReplacementReview()
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

  const openChecksFromManuscript = async (): Promise<void> => {
    if (!(await flushCurrent())) return
    props.onAgentOpenChange(false)
    setActiveWorkspace('checks')
  }

  if (activeWorkspace === 'knowledge') {
    return (
      <KnowledgeManager
        projectSessionId={props.projectSessionId}
        projectName={props.projectName}
        onOpenManuscript={closeFind}
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

  if (activeWorkspace === 'assets') {
    return (
      <AssetWorkspace
        projectSessionId={props.projectSessionId}
        projectName={props.projectName}
        workspace={workspace}
        onOpenKnowledge={() => setActiveWorkspace('knowledge')}
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
    return (
      <KnowledgeCitationCoverageWorkspace
        projectSessionId={props.projectSessionId}
        projectName={props.projectName}
        onOpenManuscript={() => setActiveWorkspace('manuscript')}
        onOpenKnowledge={() => setActiveWorkspace('knowledge')}
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
        reviewCount={openAnnotationsQuery.data?.total ?? 0}
        onSelectSection={(sectionId) => void selectSection(sectionId)}
        onOpenBrief={() => setBriefOpen(true)}
        onOpenOutlineEditor={() => void openOutlineEditor()}
        onOpenKnowledge={() => {
          props.onAgentOpenChange(false)
          setActiveWorkspace('knowledge')
        }}
        onOpenChecks={() => void openChecksFromManuscript()}
        onOpenAssets={() => {
          props.onAgentOpenChange(false)
          setActiveWorkspace('assets')
        }}
        onOpenReferences={() => {
          props.onAgentOpenChange(false)
          setActiveWorkspace('references')
        }}
        onOpenIssues={() => {
          props.onAgentOpenChange(false)
          setActiveWorkspace('issues')
        }}
        onOpenWritingRules={() => {
          props.onAgentOpenChange(false)
          setActiveWorkspace('writing_rules')
        }}
        onOpenFind={openFind}
        onCloseFind={closeFind}
        onOpenReference={openReference}
        onOpenManuscript={() => {
          editorRef.current?.clearSearchTarget()
          setSelectedFindMatchId(null)
          setActiveWorkspace('manuscript')
        }}
        onOpenSettings={props.onOpenSettings}
        findPanel={
          <ManuscriptFindPanel
            query={findQuery}
            onQueryChange={changeFindQuery}
            caseSensitive={findCaseSensitive}
            onCaseSensitiveChange={changeFindCaseSensitive}
            scope={findScope}
            onScopeChange={changeFindScope}
            statuses={findStatuses}
            onStatusesChange={changeFindStatuses}
            result={findResult}
            loading={findLoading}
            loadingMore={findLoadingMore}
            error={findError}
            selectedMatchId={selectedFindMatchId}
            onActivate={(hit) => void activateFindHit(hit)}
            onLoadMore={() => {
              if (findResult?.nextCursor) void runFind(findResult.nextCursor)
            }}
            replaceOpen={replaceOpen}
            onReplaceOpenChange={changeReplaceOpen}
            replacement={replacement}
            onReplacementChange={changeReplacement}
            replacementPlan={replacementPlan}
            replacementCandidates={replacementCandidates}
            selectedCandidateIds={selectedReplacementIds}
            onCandidatesChecked={(candidateIds, checked) =>
              setSelectedReplacementIds((current) => {
                const next = new Set(current)
                for (const candidateId of candidateIds) {
                  if (checked) next.add(candidateId)
                  else next.delete(candidateId)
                }
                return next
              })
            }
            onReviewReplacements={() => void reviewReplacements()}
            onLoadMoreReplacements={() => void loadMoreReplacements()}
            onApplyReplacements={() => void applyReplacements()}
            onUndoReplacement={() => void undoReplacement()}
            canUndoReplacement={replacementUndoCapabilities.length > 0}
            checkpointAvailable={versionHistoryStatusQuery.data?.state === 'ready'}
            createCheckpoint={createReplacementCheckpoint}
            onCreateCheckpointChange={setCreateReplacementCheckpoint}
            replacementLoading={replacementLoading}
            replacementLoadingMore={replacementLoadingMore}
            replacementApplying={replacementApplying}
            replacementMessage={replacementMessage}
          />
        }
        issuesPanel={
          <ReviewCenterPanel
            projectSessionId={props.projectSessionId}
            workspace={workspace}
            onError={props.onError}
            onNavigateIssue={(issue: ReviewIssueRecord) => {
              if (issue.anchor === null || issue.anchorStatus !== 'current') return
              setActiveWorkspace('manuscript')
              void selectSection(issue.anchor.sectionId).then((selected) => {
                if (!selected || issue.anchor?.blockId === null) return
                requestAnimationFrame(() =>
                  editorRef.current?.revealBlock(issue.anchor?.blockId ?? '')
                )
              })
            }}
            onNavigateAnnotation={(annotation) => {
              if (annotation.anchorStatus !== 'current') return
              setActiveWorkspace('manuscript')
              void selectSection(annotation.sectionId).then((selected) => {
                if (!selected) return
                requestAnimationFrame(() => editorRef.current?.revealBlock(annotation.blockId))
              })
            }}
            onIncludeAnnotations={(annotations) => {
              setIncludedAnnotations(annotations.slice(0, 10))
              props.onAgentOpenChange(true)
            }}
          />
        }
        writingRulesPanel={
          <WritingRulesPanel
            projectSessionId={props.projectSessionId}
            workspace={workspace}
            onWorkspace={(next) => queryClient.setQueryData(workspaceKey, next)}
            onError={props.onError}
          />
        }
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
                      ref={sectionTitleRef}
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
                            <DropdownMenuItem onSelect={() => void openPublicationPreflight()}>
                              <FileCheck2 /> Publication preflight
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => void openManuscriptImport()}>
                              <Upload /> Import manuscript
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() => void openManuscriptImport('directory')}
                            >
                              <FolderOpen /> Import LaTeX project folder
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={selectionContext?.activeBlockId == null}
                              onSelect={() =>
                                void flushCurrent().then(
                                  (saved) => saved && setAnnotationCreateOpen(true)
                                )
                              }
                            >
                              <MessageSquarePlus /> Add note or TODO
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
                    onQuickActionRequest={(request, selection) => {
                      void startQuickAction(request, selection)
                    }}
                    onQuickActionError={props.onError}
                    onSearchTargetInvalidated={() => setSelectedFindMatchId(null)}
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
                <span>⌘/Ctrl+S save · ⇧⌘/Ctrl+K quick actions · ⌘/Ctrl+Alt+↑/↓ navigate</span>
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
                quickActionRequest={quickActionRequest}
                includedAnnotations={includedAnnotations}
                onClearIncludedAnnotations={() => setIncludedAnnotations([])}
                onQuickActionHandled={(requestId) => {
                  setQuickActionRequest((current) =>
                    current?.requestId === requestId ? null : current
                  )
                }}
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
          focusTarget={outlineSearchFocus}
          onFocusTargetConsumed={() => setOutlineSearchFocus(null)}
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

      <PublicationPreflightDialog
        open={publicationOpen}
        preview={publicationQuery.data}
        pending={publicationQuery.isPending || publicationQuery.isFetching}
        error={publicationQuery.isError}
        onOpenChange={setPublicationOpen}
        onRetry={() => void publicationQuery.refetch()}
        onNavigate={(target) => {
          setPublicationOpen(false)
          void selectSection(target.sectionId).then((selected) => {
            if (!selected || target.blockId === null) return
            requestAnimationFrame(() => editorRef.current?.revealBlock(target.blockId ?? ''))
          })
        }}
      />

      <ManuscriptImportDialog
        key={importPlan?.planId ?? 'empty-import-plan'}
        open={importOpen}
        plan={importPlan}
        loading={importLoading}
        applying={importApplying}
        error={importError}
        onOpenChange={(open) => {
          if (open) setImportOpen(true)
          else void cancelManuscriptImport()
        }}
        onApply={applyManuscriptImport}
        onCancel={cancelManuscriptImport}
      />

      <AnnotationCreateDialog
        open={annotationCreateOpen}
        projectSessionId={props.projectSessionId}
        sectionId={activeSectionId}
        blockId={selectionContext?.activeBlockId ?? null}
        textAnchor={selectionContext?.selectedText ?? null}
        onOpenChange={setAnnotationCreateOpen}
        onCreated={() => {
          void queryClient.invalidateQueries({ queryKey: ['annotations', props.projectSessionId] })
          setActiveWorkspace('issues')
        }}
        onError={props.onError}
      />

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

function PublicationPreflightDialog(props: {
  open: boolean
  preview: PublicationPreview | undefined
  pending: boolean
  error: boolean
  onOpenChange(open: boolean): void
  onRetry(): void
  onNavigate(target: NonNullable<PublicationPreview['findings'][number]['target']>): void
}): React.JSX.Element {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>Publication preflight</DialogTitle>
          <DialogDescription>
            One captured publication model drives DOCX, LaTeX, and PDF output.
          </DialogDescription>
        </DialogHeader>
        {props.pending ? (
          <div className='flex min-h-40 items-center justify-center gap-2 text-muted-foreground'>
            <Spinner /> Verifying manuscript and assets…
          </div>
        ) : props.error || props.preview === undefined ? (
          <Alert variant='destructive'>
            <AlertCircle />
            <AlertTitle>Preflight unavailable</AlertTitle>
            <AlertDescription className='flex items-center justify-between gap-3'>
              The current publication state could not be captured.
              <Button size='sm' variant='outline' onClick={props.onRetry}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <div className='grid gap-4'>
            <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
              <PreflightMetric label='Nodes' value={props.preview.nodeCount} />
              <PreflightMetric label='Figures' value={props.preview.figureCount} />
              <PreflightMetric label='References' value={props.preview.referenceCount} />
              <PreflightMetric
                label='Findings'
                value={props.preview.errorCount + props.preview.warningCount}
              />
            </div>
            <Alert variant={props.preview.ready ? 'default' : 'destructive'}>
              {props.preview.ready ? <CheckCircle2 /> : <AlertCircle />}
              <AlertTitle>
                {props.preview.ready ? 'Ready to publish' : 'Resolve publication errors'}
              </AlertTitle>
              <AlertDescription>
                {props.preview.errorCount} errors · {props.preview.warningCount} warnings · source{' '}
                {props.preview.sourceHash.slice(0, 12)}
              </AlertDescription>
            </Alert>
            <div className='grid gap-4 rounded-md border p-4 sm:grid-cols-[minmax(0,1fr)_12rem]'>
              <div className='grid content-start gap-2 text-sm'>
                <p className='font-medium'>Print layout</p>
                <p className='text-muted-foreground'>
                  {props.preview.options.pageSize === 'A4'
                    ? 'A4 · 210 × 297 mm'
                    : 'Letter · 8.5 × 11 in'}
                </p>
                <p className='text-muted-foreground'>
                  Margins {props.preview.options.marginsMm.top} /{' '}
                  {props.preview.options.marginsMm.right} / {props.preview.options.marginsMm.bottom}{' '}
                  / {props.preview.options.marginsMm.left} mm
                </p>
                <div className='flex flex-wrap gap-2 pt-1'>
                  <Badge variant='outline'>{props.preview.options.template}</Badge>
                  <Badge variant='outline'>Page numbers</Badge>
                  {props.preview.options.includeTableOfContents ? (
                    <Badge variant='outline'>Table of contents</Badge>
                  ) : null}
                  {props.preview.options.includeReferences ? (
                    <Badge variant='outline'>References</Badge>
                  ) : null}
                </div>
              </div>
              <div
                className={`mx-auto flex w-32 flex-col border bg-background p-3 shadow-sm ${
                  props.preview.options.pageSize === 'A4' ? 'aspect-[210/297]' : 'aspect-[8.5/11]'
                }`}
                role='img'
                aria-label={`${props.preview.options.pageSize} print page preview`}
              >
                <div className='mt-3 h-2 w-3/4 rounded-sm bg-foreground/70' />
                <div className='mt-4 h-1 w-full rounded-sm bg-muted-foreground/30' />
                <div className='mt-1 h-1 w-11/12 rounded-sm bg-muted-foreground/30' />
                <div className='mt-1 h-1 w-4/5 rounded-sm bg-muted-foreground/30' />
                <div className='mt-auto text-center text-[8px] text-muted-foreground'>1</div>
              </div>
            </div>
            {props.preview.findings.length === 0 ? (
              <p className='rounded-md border p-4 text-sm text-muted-foreground'>
                No publication losses or blocking issues were found.
              </p>
            ) : (
              <div className='grid gap-2'>
                {props.preview.findings.map((finding) => (
                  <button
                    key={finding.findingId}
                    type='button'
                    className='flex w-full items-start gap-3 rounded-md border p-3 text-left hover:bg-muted/50 disabled:cursor-default'
                    disabled={finding.target === null}
                    onClick={() => finding.target && props.onNavigate(finding.target)}
                  >
                    <Badge variant={finding.severity === 'error' ? 'destructive' : 'secondary'}>
                      {finding.severity}
                    </Badge>
                    <span className='min-w-0 flex-1 text-sm'>{finding.message}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function PreflightMetric(props: { label: string; value: number }): React.JSX.Element {
  return (
    <div className='rounded-md border p-3'>
      <p className='text-xs text-muted-foreground'>{props.label}</p>
      <p className='mt-1 text-lg font-semibold tabular-nums'>{props.value}</p>
    </div>
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

declare global {
  interface WindowEventMap {
    'writellm:save': Event
    'writellm:find': Event
  }
}
