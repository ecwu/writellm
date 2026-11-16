import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ManuscriptWorkspace, Section } from '../../../../shared/contracts/manuscript'

export function useSectionTitleDraft({
  section,
  projectSessionId,
  workspaceKey,
  runMutation,
  onError
}: {
  section: Section | undefined
  projectSessionId: string
  workspaceKey: QueryKey
  runMutation(operation: () => Promise<ManuscriptWorkspace>): Promise<ManuscriptWorkspace | null>
  onError(message: string): void
}) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [saveFailed, setSaveFailed] = useState(false)
  const draft = useRef('')
  const canonical = useRef<Section | null>(null)
  const pendingSave = useRef<Promise<boolean> | null>(null)

  const reset = useCallback((next: Section) => {
    draft.current = next.title
    canonical.current = next
    setTitle(next.title)
    setSaveFailed(false)
  }, [])

  useEffect(() => {
    if (!section) return
    const previous = canonical.current
    const sectionChanged = previous?.sectionId !== section.sectionId
    const canonicalChanged = previous?.updatedAt !== section.updatedAt
    const draftDirty = draft.current !== previous?.title
    const draftMatchesCanonical = draft.current === section.title
    if (
      !sectionChanged &&
      (!canonicalChanged || (draftDirty && !draftMatchesCanonical) || saveFailed)
    ) {
      return
    }
    reset(section)
  }, [section, saveFailed, reset])

  const change = useCallback((next: string) => {
    draft.current = next
    setTitle(next)
    setSaveFailed(false)
  }, [])

  const save = useCallback(async (): Promise<boolean> => {
    if (pendingSave.current !== null) return pendingSave.current
    const operation = (async (): Promise<boolean> => {
      if (!section || draft.current === section.title) return true
      const nextTitle = draft.current.trim()
      if (nextTitle.length === 0) {
        onError('Section titles cannot be empty.')
        return false
      }
      const workspace = queryClient.getQueryData<ManuscriptWorkspace>(workspaceKey)
      if (!workspace?.sections.some((item) => item.section.sectionId === section.sectionId))
        return false
      const result = await runMutation(() =>
        window.desktop.manuscript.updateSection({
          projectSessionId,
          update: {
            baseOutlineVersion: workspace.outlineVersion,
            sectionId: section.sectionId,
            title: nextTitle
          }
        })
      )
      setSaveFailed(result === null)
      return result !== null
    })()
    pendingSave.current = operation
    try {
      return await operation
    } finally {
      if (pendingSave.current === operation) pendingSave.current = null
    }
  }, [section, onError, projectSessionId, queryClient, runMutation, workspaceKey])

  return { title, saveFailed, change, reset, save }
}
