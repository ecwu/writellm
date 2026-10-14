import { useState } from 'react'
import type { ManuscriptImportPlan } from '../../../../shared/contracts/manuscript-import'
import { reportWorkbenchError } from '../workbench/use-workbench'

export function useManuscriptImport(options: {
  projectSessionId: string
  getActiveSectionId(): string | null
  flushCurrent(): Promise<boolean>
  refreshAfterImport(): Promise<void>
  onError(message: string): void
}) {
  const [importOpen, setImportOpen] = useState(false)
  const [importPlan, setImportPlan] = useState<ManuscriptImportPlan | null>(null)
  const [importLoading, setImportLoading] = useState(false)
  const [importApplying, setImportApplying] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const openManuscriptImport = async (selection: 'file' | 'directory' = 'file'): Promise<void> => {
    if (!(await options.flushCurrent())) return
    const sectionId = options.getActiveSectionId()
    if (sectionId === null) return
    setImportOpen(true)
    setImportPlan(null)
    setImportError(null)
    setImportLoading(true)
    try {
      const result = await window.desktop.editor.createImportPlan({
        projectSessionId: options.projectSessionId,
        activeSectionId: sectionId,
        selection
      })
      if (result.status === 'cancelled') {
        setImportOpen(false)
        return
      }
      setImportPlan(result.plan)
    } catch (err) {
      reportWorkbenchError(err, 'manuscript.import')
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
        projectSessionId: options.projectSessionId,
        planId: plan.planId
      })
    } catch (err) {
      reportWorkbenchError(err, 'manuscript.import')
      options.onError('Import staging cleanup will be retried when the project is reopened.')
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
        projectSessionId: options.projectSessionId,
        planId: importPlan.planId,
        mode
      })
      setImportOpen(false)
      setImportPlan(null)
      await options.refreshAfterImport()
    } catch (err) {
      reportWorkbenchError(err, 'manuscript.import')
      setImportError('The manuscript changed or the reviewed import could not be applied.')
    } finally {
      setImportApplying(false)
    }
  }

  const changeOpen = (open: boolean): void => {
    if (open) setImportOpen(true)
    else void cancelManuscriptImport()
  }
  return {
    importOpen,
    importPlan,
    importLoading,
    importApplying,
    importError,
    openManuscriptImport,
    cancelManuscriptImport,
    applyManuscriptImport,
    changeOpen
  }
}
export type ManuscriptImportController = ReturnType<typeof useManuscriptImport>
