import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  BlockNoteDocument,
  ManuscriptReferenceEntry,
  ManuscriptReferenceIndex,
  ManuscriptWorkspace
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
import { reportWorkbenchError } from '../workbench/use-workbench'

const REFERENCE_PREVIEW_CONCURRENCY = 4

export async function resolveReadableCitationOccurrences(
  occurrences: ManuscriptReferenceEntry['occurrences'],
  resolveOccurrence: (
    occurrence: ManuscriptReferenceEntry['occurrences'][number]
  ) => Promise<ReadableCitationResolutionResult>,
  isCurrent: () => boolean
): Promise<ReadableCitationResolutionResult | null> {
  const unavailableReasons = new Set<
    Extract<ReadableCitationResolutionResult, { status: 'unavailable' }>['reason']
  >()
  for (let offset = 0; offset < occurrences.length; offset += REFERENCE_PREVIEW_CONCURRENCY) {
    if (!isCurrent()) return null
    const batch = occurrences.slice(offset, offset + REFERENCE_PREVIEW_CONCURRENCY)
    const results = await Promise.all(batch.map(resolveOccurrence))
    if (!isCurrent()) return null
    const available = results.find(
      (result) => result.status === 'resolved' || result.status === 'ambiguous'
    )
    if (available !== undefined) return available
    for (const result of results) {
      if (result.status === 'unavailable') unavailableReasons.add(result.reason)
    }
  }
  const reason =
    (['index_unavailable', 'resolution_limit', 'source_missing', 'unlinked'] as const).find(
      (candidate) => unavailableReasons.has(candidate)
    ) ?? 'unlinked'
  return { status: 'unavailable', reason }
}

export type ReferenceDialogState =
  | { phase: 'loading'; entry: ManuscriptReferenceEntry }
  | { phase: 'resolved'; entry: ManuscriptReferenceEntry; citation: ExpandedCitation }
  | { phase: 'ambiguous'; entry: ManuscriptReferenceEntry; citations: ExpandedCitation[] }
  | {
      phase: 'unavailable'
      entry: ManuscriptReferenceEntry
      reason: Extract<ReadableCitationResolutionResult, { status: 'unavailable' }>['reason']
    }
  | { phase: 'error'; entry: ManuscriptReferenceEntry }

export function useManuscriptReferences(options: {
  projectSessionId: string
  workspace: ManuscriptWorkspace | undefined
  storedIndex: ManuscriptReferenceIndex | undefined
}) {
  const [citationDraft, setCitationDraft] = useState<{
    sectionId: string
    sectionRevisionId: string
    content: BlockNoteDocument
  } | null>(null)
  const [referenceDialog, setReferenceDialog] = useState<ReferenceDialogState | null>(null)
  const referenceRequestSequenceRef = useRef(0)
  const workspace = options.workspace
  const effectiveReferenceIndex = useMemo<ManuscriptReferenceIndex>(() => {
    const stored = options.storedIndex
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
  }, [citationDraft, options.storedIndex, workspace])
  const citationNumberByTitle = useMemo(
    () => referenceNumberMap(effectiveReferenceIndex),
    [effectiveReferenceIndex]
  )

  const openReference = useCallback(
    (entry: ManuscriptReferenceEntry): void => {
      const sequence = ++referenceRequestSequenceRef.current
      setReferenceDialog({ phase: 'loading', entry })
      void (async () => {
        const result = await resolveReadableCitationOccurrences(
          entry.occurrences,
          (occurrence) =>
            window.desktop.knowledge.resolveReadableCitation({
              projectSessionId: options.projectSessionId,
              sectionRevisionId: occurrence.sectionRevisionId,
              blockId: occurrence.blockId,
              title: occurrence.title,
              ...(occurrence.pageIndex === undefined ? {} : { pageIndex: occurrence.pageIndex })
            }),
          () => referenceRequestSequenceRef.current === sequence
        )
        if (result === null) return
        if (result.status === 'resolved') {
          setReferenceDialog({ phase: 'resolved', entry, citation: result.citation })
        } else if (result.status === 'ambiguous') {
          setReferenceDialog({ phase: 'ambiguous', entry, citations: result.citations })
        } else {
          setReferenceDialog({ phase: 'unavailable', entry, reason: result.reason })
        }
      })().catch((err) => {
        reportWorkbenchError(err, 'manuscript.references')
        if (referenceRequestSequenceRef.current === sequence) {
          setReferenceDialog({ phase: 'error', entry })
        }
      })
    },
    [options.projectSessionId]
  )

  const closeReference = useCallback(() => {
    referenceRequestSequenceRef.current += 1
    setReferenceDialog(null)
  }, [])
  const selectReference = useCallback(
    (entry: ManuscriptReferenceEntry, citation: ExpandedCitation) => {
      referenceRequestSequenceRef.current += 1
      setReferenceDialog({ phase: 'resolved', entry, citation })
    },
    []
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: Project capability changes invalidate pending previews.
  useEffect(
    () => () => {
      referenceRequestSequenceRef.current += 1
    },
    [options.projectSessionId]
  )
  return {
    effectiveReferenceIndex,
    citationNumberByTitle,
    openReference,
    referenceDialog,
    changeCitationDraft: setCitationDraft,
    closeReference,
    selectReference
  }
}
export type ManuscriptReferencesController = ReturnType<typeof useManuscriptReferences>
