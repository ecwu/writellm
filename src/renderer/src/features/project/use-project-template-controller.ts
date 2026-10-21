import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ProjectTemplateExtractionPreview,
  ProjectTemplateSummary
} from '../../../../shared/contracts/project-templates'
import { reportRendererOperationError } from '../../diagnostics'
import { notifyActionError } from '@/lib/notifications'
import { useProjectSessionGeneration, type ProjectActionChange } from './project-session-generation'

const templateErrorMessage =
  'WriteLLM could not complete the project template action. Please try again.'

export interface ProjectTemplateControllerOptions {
  projectSessionId: string | undefined
  onActionChange: (change: ProjectActionChange<'template'>) => void
}

export interface ProjectTemplateController {
  projectTemplates: ProjectTemplateSummary[]
  selectedTemplateId: string
  templateDialogOpen: boolean
  templatePreview: ProjectTemplateExtractionPreview | null
  templateName: string
  templateDescription: string
  includeTemplatePreset: boolean
  replaceTemplates: (templates: ProjectTemplateSummary[]) => void
  setSelectedTemplateId: (templateId: string) => void
  setTemplateDialogOpen: (open: boolean) => void
  setTemplateName: (name: string) => void
  setTemplateDescription: (description: string) => void
  setIncludeTemplatePreset: (include: boolean) => void
  openTemplateDialog: () => Promise<void>
  saveTemplate: () => Promise<void>
  deleteSelectedTemplate: () => Promise<void>
}

export function useProjectTemplateController({
  projectSessionId,
  onActionChange
}: ProjectTemplateControllerOptions): ProjectTemplateController {
  const [projectTemplates, setProjectTemplates] = useState<ProjectTemplateSummary[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState('blank')
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false)
  const [templatePreview, setTemplatePreview] = useState<ProjectTemplateExtractionPreview | null>(
    null
  )
  const [templateName, setTemplateName] = useState('')
  const [templateDescription, setTemplateDescription] = useState('')
  const [includeTemplatePreset, setIncludeTemplatePreset] = useState(true)
  const [templateDialogSessionId, setTemplateDialogSessionId] = useState<string | undefined>()
  const { begin, isCurrent } = useProjectSessionGeneration(projectSessionId)
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
    setTemplateDialogOpen(false)
    setTemplatePreview(null)
    setTemplateDialogSessionId(undefined)
    setTemplateName('')
    setTemplateDescription('')
    setIncludeTemplatePreset(true)
    const token = actionTokenRef.current
    if (token !== null) releaseAction(token)
  }, [projectSessionId, releaseAction])

  const replaceTemplates = useCallback((templates: ProjectTemplateSummary[]) => {
    setProjectTemplates(templates)
  }, [])

  const openTemplateDialog = useCallback(async (): Promise<void> => {
    if (!projectSessionId) return
    const operation = begin()
    const token = Symbol('project-template')
    actionTokenRef.current = token
    onActionChange({ action: 'template', token })
    try {
      const preview = await window.desktop.projects.previewTemplate({ projectSessionId })
      if (!isCurrent(operation)) return
      setTemplatePreview(preview)
      setTemplateDialogSessionId(projectSessionId)
      setTemplateName('')
      setTemplateDescription('')
      setIncludeTemplatePreset(true)
      setTemplateDialogOpen(true)
    } catch (err) {
      reportRendererOperationError(err, 'App.project-template-preview')
      if (isCurrent(operation)) notifyActionError(templateErrorMessage)
    } finally {
      if (isCurrent(operation)) releaseAction(token)
    }
  }, [begin, isCurrent, onActionChange, projectSessionId, releaseAction])

  const saveTemplate = useCallback(async (): Promise<void> => {
    if (!projectSessionId || templateName.trim().length === 0) return
    const operation = begin()
    const token = Symbol('project-template')
    actionTokenRef.current = token
    onActionChange({ action: 'template', token })
    try {
      const templates = await window.desktop.projects.saveTemplate({
        projectSessionId,
        name: templateName,
        description: templateDescription,
        includePublicationPreset: includeTemplatePreset
      })
      if (!isCurrent(operation)) return
      setProjectTemplates(templates)
      setTemplateDialogOpen(false)
    } catch (err) {
      reportRendererOperationError(err, 'App.project-template-save')
      if (isCurrent(operation)) notifyActionError(templateErrorMessage)
    } finally {
      if (isCurrent(operation)) releaseAction(token)
    }
  }, [
    begin,
    includeTemplatePreset,
    isCurrent,
    onActionChange,
    projectSessionId,
    releaseAction,
    templateDescription,
    templateName
  ])

  const deleteSelectedTemplate = useCallback(async (): Promise<void> => {
    if (selectedTemplateId === 'blank') return
    const selected = projectTemplates.find((template) => template.templateId === selectedTemplateId)
    if (selected?.origin !== 'user') return
    try {
      setProjectTemplates(
        await window.desktop.projects.deleteTemplate({ templateId: selectedTemplateId })
      )
      setSelectedTemplateId('blank')
    } catch (err) {
      reportRendererOperationError(err, 'App.project-template-delete')
      notifyActionError(templateErrorMessage)
    }
  }, [projectTemplates, selectedTemplateId])

  return {
    projectTemplates,
    selectedTemplateId,
    templateDialogOpen: templateDialogSessionId === projectSessionId ? templateDialogOpen : false,
    templatePreview: templateDialogSessionId === projectSessionId ? templatePreview : null,
    templateName,
    templateDescription,
    includeTemplatePreset,
    replaceTemplates,
    setSelectedTemplateId,
    setTemplateDialogOpen,
    setTemplateName,
    setTemplateDescription,
    setIncludeTemplatePreset,
    openTemplateDialog,
    saveTemplate,
    deleteSelectedTemplate
  }
}
