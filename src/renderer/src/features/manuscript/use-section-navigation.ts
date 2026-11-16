import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { SectionRevision } from '../../../../shared/contracts/manuscript'
import type { ManuscriptSearchTargetContract } from '../../../../shared/contracts/manuscript-search'
import { reportRendererOperationError } from '../../diagnostics'
import type { SectionEditorHandle } from './section-editor'

export function useSectionNavigation({
  activeSectionId,
  activeSectionIdRef,
  editorRevision,
  editorRef,
  enqueue,
  flushCurrent,
  activateSection,
  showSectionTab,
  setOutlineEditOpen,
  onError
}: {
  activeSectionId: string | null
  activeSectionIdRef: RefObject<string | null>
  editorRevision: Pick<SectionRevision, 'sectionId' | 'sectionRevisionId'> | undefined
  editorRef: RefObject<SectionEditorHandle | null>
  enqueue(operation: () => Promise<boolean>): Promise<boolean | undefined>
  flushCurrent(): Promise<boolean>
  activateSection(sectionId: string): Promise<void>
  showSectionTab(sectionId: string): void
  setOutlineEditOpen(open: boolean): void
  onError(message: string): void
}) {
  const [editorAutoFocus, setEditorAutoFocus] = useState(true)
  const [outlineSearchFocus, setOutlineSearchFocus] = useState<{
    sectionId: string
    field: 'objective'
    from: number
    to: number
  } | null>(null)
  const [pendingSearchTarget, setPendingSearchTarget] = useState<{
    target: ManuscriptSearchTargetContract
    revisionId: string | null
  } | null>(null)
  const sectionTitleRef = useRef<HTMLTextAreaElement>(null)
  const manuscriptScrollRef = useRef<HTMLElement>(null)
  const pendingScrollSectionId = useRef<string | null>(null)

  const navigateSection = useCallback(
    async (sectionId: string, source: 'user' | 'agent' | 'find'): Promise<boolean> => {
      const switched = await enqueue(async () => {
        if (sectionId === activeSectionIdRef.current) {
          showSectionTab(sectionId)
          return true
        }
        if (!(await flushCurrent())) return false
        try {
          setEditorAutoFocus(source === 'user')
          pendingScrollSectionId.current = source === 'agent' ? sectionId : null
          await activateSection(sectionId)
          return true
        } catch (err) {
          reportRendererOperationError(err, 'use-writing-workspace-controller')
          if (pendingScrollSectionId.current === sectionId) pendingScrollSectionId.current = null
          onError('The selected section could not be activated.')
          return false
        }
      })
      return switched ?? false
    },
    [activateSection, activeSectionIdRef, enqueue, flushCurrent, onError, showSectionTab]
  )

  const selectSection = useCallback(
    (sectionId: string) => navigateSection(sectionId, 'user'),
    [navigateSection]
  )
  const followAgentSection = useCallback(
    (sectionId: string) => navigateSection(sectionId, 'agent'),
    [navigateSection]
  )
  const navigateToHit = useCallback(
    async (
      sectionId: string,
      target: ManuscriptSearchTargetContract,
      revisionId: string | null
    ) => {
      if (!(await navigateSection(sectionId, 'find'))) return false
      setPendingSearchTarget({ target, revisionId })
      return true
    },
    [navigateSection]
  )
  const clearSearchTarget = useCallback(() => {
    editorRef.current?.clearSearchTarget()
    setPendingSearchTarget(null)
  }, [editorRef])

  useEffect(() => {
    if (
      pendingSearchTarget === null ||
      activeSectionId !== pendingSearchTarget.target.sectionId ||
      editorRevision === undefined ||
      (pendingSearchTarget.revisionId !== null &&
        editorRevision.sectionRevisionId !== pendingSearchTarget.revisionId)
    ) {
      return
    }
    const { target } = pendingSearchTarget
    const frame = window.requestAnimationFrame(() => {
      if (target.kind === 'section_title') {
        sectionTitleRef.current?.scrollIntoView({ block: 'center', behavior: 'auto' })
      } else if (target.kind === 'section_objective') {
        setOutlineSearchFocus({
          sectionId: target.sectionId,
          field: 'objective',
          from: target.range.from,
          to: target.range.to
        })
        setOutlineEditOpen(true)
      } else if (!editorRef.current?.revealSearchTarget(target)) {
        onError('The validated result could not be revealed in the current editor.')
      }
      setPendingSearchTarget(null)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeSectionId, editorRef, editorRevision, onError, pendingSearchTarget, setOutlineEditOpen])

  useEffect(() => {
    if (
      activeSectionId === null ||
      pendingScrollSectionId.current !== activeSectionId ||
      editorRevision?.sectionId !== activeSectionId
    ) {
      return
    }
    pendingScrollSectionId.current = null
    const frame = window.requestAnimationFrame(() => {
      manuscriptScrollRef.current?.scrollTo({ top: 0, behavior: 'auto' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activeSectionId, editorRevision])

  return {
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
  }
}
