import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkspaceKind } from '@/components/app-sidebar'
import type { SectionStatus } from '../../../../shared/contracts/manuscript'
import type {
  ManuscriptSearchHit,
  ManuscriptSearchResult,
  ManuscriptSearchTargetContract
} from '../../../../shared/contracts/manuscript-search'
import type {
  ManuscriptReplacementCandidate,
  ManuscriptReplacementPlanResult
} from '../../../../shared/contracts/manuscript-replacement'
import { reportWorkbenchError } from '../workbench/use-workbench'
import type { ManuscriptFindScope } from './manuscript-find-panel'

export function useManuscriptFind(options: {
  projectSessionId: string
  activeWorkspace: WorkspaceKind
  workspaceSearchVersion: string | undefined
  getActiveSectionId(): string | null
  flushCurrent(): Promise<boolean>
  releaseMutationBarrier(): void
  clearSearchTarget(): void
  navigateToHit(
    sectionId: string,
    target: ManuscriptSearchTargetContract,
    revisionId: string | null
  ): Promise<boolean>
  onError(message: string): void
}) {
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
  const findRequestRef = useRef(0)
  const replacementRequestRef = useRef(0)
  const replacementPageRequestRef = useRef(0)
  const replacementPagePendingRef = useRef(false)
  const workspaceSearchVersionRef = useRef(options.workspaceSearchVersion)
  const currentFindScope = useCallback(() => {
    const sectionId = options.getActiveSectionId()
    if (sectionId === null || findScope === 'manuscript') {
      return { type: 'manuscript' as const }
    }
    return findScope === 'section'
      ? { type: 'sections' as const, sectionIds: [sectionId] }
      : { type: 'subtree' as const, rootSectionId: sectionId }
  }, [findScope, options.getActiveSectionId])

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
          projectSessionId: options.projectSessionId,
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
      } catch (err) {
        reportWorkbenchError(err, 'manuscript.find')
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
    [currentFindScope, findCaseSensitive, findQuery, findStatuses, options.projectSessionId]
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
        projectSessionId: options.projectSessionId,
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
              projectSessionId: options.projectSessionId,
              planId: plan.planId
            })
            .catch((err) => {
              reportWorkbenchError(err, 'manuscript.find.dismiss')
              options.onError('The superseded replacement review could not be dismissed.')
            })
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
    } catch (err) {
      reportWorkbenchError(err, 'manuscript.find')
      if (replacementRequestRef.current === sequence) {
        setReplacementMessage('Replacement review could not be created. Retry after saving.')
      }
    } finally {
      options.releaseMutationBarrier()
      if (replacementRequestRef.current === sequence) setReplacementLoading(false)
    }
  }, [
    currentFindScope,
    findCaseSensitive,
    findQuery,
    findStatuses,
    options.onError,
    options.projectSessionId,
    replacement,
    options.releaseMutationBarrier
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
        projectSessionId: options.projectSessionId,
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
    } catch (err) {
      reportWorkbenchError(err, 'manuscript.find')
      if (replacementPageRequestRef.current === pageSequence) {
        setReplacementMessage('More replacement candidates could not be loaded.')
      }
    } finally {
      if (replacementPageRequestRef.current === pageSequence) {
        replacementPagePendingRef.current = false
        setReplacementLoadingMore(false)
      }
    }
  }, [options.projectSessionId, replacementPlan])

  const applyReplacements = useCallback(async (): Promise<void> => {
    if (replacementPlan?.status !== 'ready' || selectedReplacementIds.size === 0) return
    replacementPageRequestRef.current += 1
    replacementPagePendingRef.current = false
    setReplacementLoadingMore(false)
    setReplacementApplying(true)
    setReplacementMessage(null)
    try {
      const result = await window.desktop.manuscript.applyReplacement({
        projectSessionId: options.projectSessionId,
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
    } catch (err) {
      reportWorkbenchError(err, 'manuscript.find')
      setReplacementMessage(
        'Replacement could not be applied. No partial canonical batch was reported.'
      )
    } finally {
      options.releaseMutationBarrier()
      setReplacementApplying(false)
    }
  }, [
    createReplacementCheckpoint,
    options.projectSessionId,
    replacementPlan,
    selectedReplacementIds,
    options.releaseMutationBarrier
  ])

  const undoReplacement = useCallback(async (): Promise<void> => {
    const capability = replacementUndoCapabilities[0]
    if (capability === undefined) return
    try {
      const result = await window.desktop.manuscript.undoReplacement({
        projectSessionId: options.projectSessionId,
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
    } catch (err) {
      reportWorkbenchError(err, 'manuscript.find')
      setReplacementMessage('Replacement Undo could not be completed.')
    } finally {
      options.releaseMutationBarrier()
    }
  }, [options.projectSessionId, replacementUndoCapabilities, options.releaseMutationBarrier])

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
      .dismissReplacementPlan({ projectSessionId: options.projectSessionId, planId })
      .catch((err) => {
        reportWorkbenchError(err, 'manuscript.find.dismiss')
        options.onError('The previous replacement review could not be dismissed.')
      })
  }, [options.onError, options.projectSessionId, replacementPlan])

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
    if (options.activeWorkspace !== 'find') return
    options.clearSearchTarget()
    setSelectedFindMatchId(null)
    const timer = window.setTimeout(() => void runFind(), 200)
    return () => window.clearTimeout(timer)
  }, [options.activeWorkspace, runFind, options.clearSearchTarget])

  useEffect(() => {
    if (workspaceSearchVersionRef.current === options.workspaceSearchVersion) return
    workspaceSearchVersionRef.current = options.workspaceSearchVersion
    if (!findQuery.trim()) return
    const timer = window.setTimeout(() => void runFind(), 200)
    return () => window.clearTimeout(timer)
  }, [findQuery, runFind, options.workspaceSearchVersion])

  const activateFindHit = useCallback(
    async (hit: ManuscriptSearchHit): Promise<void> => {
      if (!(await options.flushCurrent())) return
      setFindError(null)
      try {
        const validated = await window.desktop.manuscript.revalidateSearch({
          projectSessionId: options.projectSessionId,
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
        const switched = await options.navigateToHit(
          validated.sectionId,
          validated.target,
          validated.revisionId
        )
        if (!switched) return
        setSelectedFindMatchId(hit.matchId)
      } catch (err) {
        reportWorkbenchError(err, 'manuscript.find')
        setFindError('This result could not be validated. Refresh the search and try again.')
      }
    },
    [
      options.navigateToHit,
      findCaseSensitive,
      findQuery,
      options.flushCurrent,
      options.projectSessionId,
      runFind
    ]
  )

  const changeCandidates = useCallback((candidateIds: string[], checked: boolean): void => {
    setSelectedReplacementIds((current) => {
      const next = new Set(current)
      for (const id of candidateIds) checked ? next.add(id) : next.delete(id)
      return next
    })
  }, [])
  const closeReview = useCallback((): void => {
    setSelectedFindMatchId(null)
    setReplaceOpen(false)
    invalidateReplacementReview()
  }, [invalidateReplacementReview])
  const clearSelection = useCallback(() => setSelectedFindMatchId(null), [])
  return {
    clearSelection,
    findQuery,
    findCaseSensitive,
    findScope,
    findStatuses,
    findResult,
    findLoading,
    findLoadingMore,
    findError,
    selectedFindMatchId,
    replaceOpen,
    replacement,
    replacementPlan,
    replacementCandidates,
    selectedReplacementIds,
    replacementLoading,
    replacementLoadingMore,
    replacementApplying,
    replacementMessage,
    replacementUndoCapabilities,
    createReplacementCheckpoint,
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
    changeCandidates,
    changeCheckpoint: setCreateReplacementCheckpoint,
    closeReview
  }
}
export type ManuscriptFindController = ReturnType<typeof useManuscriptFind>
