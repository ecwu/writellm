import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ManuscriptExportKind,
  ManuscriptExportResult
} from '../../../../shared/contracts/manuscript-export'
import { reportRendererOperationError } from '../../diagnostics'
import { notifyActionError } from '@/lib/notifications'
import {
  useProjectSessionGeneration,
  type ProjectActionChange,
  type ProjectSessionOperation
} from './project-session-generation'

const exportErrorMessage =
  'WriteLLM could not export the manuscript. Choose another destination and try again.'

export interface ManuscriptExportControllerOptions {
  projectSessionId: string | undefined
  onActionChange: (change: ProjectActionChange<'export'>) => void
}

export interface ManuscriptExportController {
  exportResult: Extract<ManuscriptExportResult, { created: true }> | undefined
  exportCancelling: boolean
  exportActive: boolean
  exportManuscript: (kind: ManuscriptExportKind) => Promise<void>
  cancelManuscriptExport: () => Promise<void>
  setExportResult: (result: Extract<ManuscriptExportResult, { created: true }> | undefined) => void
}

export function useManuscriptExportController({
  projectSessionId,
  onActionChange
}: ManuscriptExportControllerOptions): ManuscriptExportController {
  const [exportResult, setExportResult] = useState<
    Extract<ManuscriptExportResult, { created: true }> | undefined
  >()
  const [exportResultSessionId, setExportResultSessionId] = useState<string | undefined>()
  const exportCancellationRequested = useRef(false)
  const [exportCancelling, setExportCancelling] = useState(false)
  const [exportActive, setExportActive] = useState(false)
  const [exportSessionId, setExportSessionId] = useState<string | undefined>()
  const { begin, isCurrent } = useProjectSessionGeneration(projectSessionId)
  const activeOperationRef = useRef<ProjectSessionOperation | null>(null)
  const actionTokenRef = useRef<symbol | null>(null)
  const previousSessionRef = useRef(projectSessionId)

  const releaseAction = useCallback(
    (token: symbol): void => {
      if (actionTokenRef.current !== token) return
      actionTokenRef.current = null
      onActionChange({ action: null, token })
    },
    [onActionChange]
  )

  useEffect(() => {
    if (previousSessionRef.current === projectSessionId) return
    previousSessionRef.current = projectSessionId
    setExportResult(undefined)
    setExportResultSessionId(undefined)
    setExportCancelling(false)
    setExportActive(false)
    setExportSessionId(undefined)
    exportCancellationRequested.current = false
    activeOperationRef.current = null
    const token = actionTokenRef.current
    if (token !== null) releaseAction(token)
  }, [projectSessionId, releaseAction])

  const exportManuscript = useCallback(
    async (kind: ManuscriptExportKind): Promise<void> => {
      if (projectSessionId === undefined) return
      const operation = begin()
      const token = Symbol('manuscript-export')
      activeOperationRef.current = operation
      actionTokenRef.current = token
      exportCancellationRequested.current = false
      setExportActive(true)
      setExportSessionId(projectSessionId)
      setExportCancelling(false)
      setExportResult(undefined)
      setExportResultSessionId(undefined)
      onActionChange({ action: 'export', token })
      try {
        const result = await window.desktop.projects.exportManuscript({ projectSessionId, kind })
        if (isCurrent(operation) && result.created) {
          setExportResult(result)
          setExportResultSessionId(projectSessionId)
        }
      } catch (err) {
        reportRendererOperationError(err, 'App.manuscript-export')
        if (isCurrent(operation) && !exportCancellationRequested.current) {
          notifyActionError(exportErrorMessage)
        }
      } finally {
        if (isCurrent(operation)) {
          activeOperationRef.current = null
          setExportActive(false)
          setExportSessionId(undefined)
          setExportCancelling(false)
          releaseAction(token)
        }
      }
    },
    [begin, isCurrent, onActionChange, projectSessionId, releaseAction]
  )

  const cancelManuscriptExport = useCallback(async (): Promise<void> => {
    const operation = activeOperationRef.current
    if (
      projectSessionId === undefined ||
      exportCancelling ||
      operation === null ||
      !isCurrent(operation)
    ) {
      return
    }
    exportCancellationRequested.current = true
    setExportCancelling(true)
    try {
      const result = await window.desktop.projects.cancelManuscriptExport({ projectSessionId })
      if (activeOperationRef.current !== operation || !isCurrent(operation)) return
      if (!result.cancelled) {
        exportCancellationRequested.current = false
        setExportCancelling(false)
      }
    } catch (err) {
      reportRendererOperationError(err, 'App.manuscript-export-cancel')
      if (activeOperationRef.current !== operation || !isCurrent(operation)) return
      exportCancellationRequested.current = false
      setExportCancelling(false)
      notifyActionError(exportErrorMessage)
    }
  }, [exportCancelling, isCurrent, projectSessionId])

  const setVisibleExportResult = useCallback(
    (result: Extract<ManuscriptExportResult, { created: true }> | undefined): void => {
      setExportResult(result)
      setExportResultSessionId(result === undefined ? undefined : projectSessionId)
    },
    [projectSessionId]
  )

  return {
    exportResult: exportResultSessionId === projectSessionId ? exportResult : undefined,
    exportCancelling,
    exportActive: exportSessionId === projectSessionId && exportActive,
    exportManuscript,
    cancelManuscriptExport,
    setExportResult: setVisibleExportResult
  }
}
