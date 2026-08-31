import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  Download,
  FolderOpen,
  MapPin,
  Plus,
  RefreshCcw,
  RotateCcw,
  Settings2,
  Trash2,
  TriangleAlert,
  XCircle
} from 'lucide-react'
import type {
  ManuscriptExportKind,
  ManuscriptExportResult
} from '../../shared/contracts/manuscript-export'
import type {
  ProjectLifecycleSnapshot,
  ProjectLifecycleState,
  ProjectSelectionResult,
  RecentProjects,
  VersionHistoryState
} from '../../shared/contracts/projects'
import type {
  ProjectTemplateExtractionPreview,
  ProjectTemplateSummary
} from '../../shared/contracts/project-templates'
import type { OnboardingState } from '../../shared/contracts/app'
import { projectNameSchema } from '../../shared/contracts/projects'
import { AppMenubar } from '@/components/app-menubar'
import { SettingsCommand } from '@/components/settings-command'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { InputGroup, InputGroupInput } from '@/components/ui/input-group'
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle
} from '@/components/ui/item'
import { Spinner } from '@/components/ui/spinner'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { WritingWorkspace } from '@/features/manuscript/writing-workspace'
import { OnboardingFlow } from '@/features/onboarding/onboarding-flow'
import { ProjectCreationFields } from '@/features/project/project-creation-fields'
import { ProjectOpeningIndicator } from '@/features/project/project-opening-indicator'
import {
  ProjectVersionHistory,
  type VersionHistoryView
} from '@/features/project/project-version-history'
import { notifyActionError } from '@/lib/notifications'

const closedSnapshot: ProjectLifecycleSnapshot = {
  state: 'closed',
  activeProject: null
}

type ProjectAction =
  | 'create'
  | 'open'
  | 'openRecent'
  | 'close'
  | 'switch'
  | 'clone'
  | 'recovery'
  | 'snapshot'
  | 'export'
  | 'history'
  | 'template'

const actionErrorMessages: Record<
  ProjectAction | 'load' | 'recent' | 'subscribe' | 'diagnostics' | 'onboarding',
  string
> = {
  load: 'WriteLLM could not load the current project. Please try again.',
  recent: 'WriteLLM could not load recent projects. You can still open a project manually.',
  subscribe: 'Project updates are unavailable. Refresh the project state to continue.',
  create: 'WriteLLM could not create the project. Choose another folder and try again.',
  open: 'WriteLLM could not open the project. Check that it is available and try again.',
  openRecent: 'WriteLLM could not open the recent project. Check that it is still available.',
  close: 'WriteLLM could not close the project. Please try again.',
  switch: 'WriteLLM could not switch projects. Check the project state and try again.',
  clone:
    'WriteLLM could not create an independent project copy. Choose another destination and try again.',
  diagnostics: 'WriteLLM could not complete the diagnostics action. Please try again.',
  onboarding: 'WriteLLM could not save onboarding progress. You can keep using the application.',
  recovery: 'WriteLLM could not complete that recovery action. Check diagnostics and try again.',
  snapshot: 'WriteLLM could not complete the snapshot action. Please try again.',
  export: 'WriteLLM could not export the manuscript. Choose another destination and try again.',
  history: 'WriteLLM could not complete the version history action. Please try again.',
  template: 'WriteLLM could not complete the project template action. Please try again.'
}

const stateLabels: Record<ProjectLifecycleState, string> = {
  closed: 'Closed',
  creating: 'Creating project',
  opening: 'Opening project',
  open: 'Open',
  closing: 'Closing project',
  'recovery-required': 'Recovery required'
}

function App(): React.JSX.Element {
  const [snapshot, setSnapshot] = useState<ProjectLifecycleSnapshot>(closedSnapshot)
  const [recentProjects, setRecentProjects] = useState<RecentProjects>([])
  const [initialLoading, setInitialLoading] = useState(true)
  const [onboardingState, setOnboardingState] = useState<OnboardingState | null>(null)
  const [activeAction, setActiveAction] = useState<ProjectAction | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState<'general' | 'skills'>('general')
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [projectNameError, setProjectNameError] = useState<string | null>(null)
  const [projectTemplates, setProjectTemplates] = useState<ProjectTemplateSummary[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState('blank')
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false)
  const [templatePreview, setTemplatePreview] = useState<ProjectTemplateExtractionPreview | null>(
    null
  )
  const [templateName, setTemplateName] = useState('')
  const [templateDescription, setTemplateDescription] = useState('')
  const [includeTemplatePreset, setIncludeTemplatePreset] = useState(true)
  const [agentPanelState, setAgentPanelState] = useState<{
    projectSessionId: string | null
    open: boolean
  }>({ projectSessionId: null, open: false })
  const [versionHistoryState, setVersionHistoryState] = useState<VersionHistoryState | null>(null)
  const [versionHistoryView, setVersionHistoryView] = useState<VersionHistoryView>(null)
  const [exportResult, setExportResult] = useState<
    Extract<ManuscriptExportResult, { created: true }> | undefined
  >()
  const exportCancellationRequested = useRef(false)
  const [exportCancelling, setExportCancelling] = useState(false)

  const refreshLifecycle = useCallback(async (): Promise<void> => {
    try {
      const nextSnapshot = await window.desktop.projects.lifecycle()
      setSnapshot(nextSnapshot)
    } catch {
      notifyActionError(actionErrorMessages.load)
    }
  }, [])

  const refreshRecentProjects = useCallback(async (): Promise<void> => {
    try {
      setRecentProjects(await window.desktop.projects.recent())
    } catch {
      notifyActionError(actionErrorMessages.recent)
    }
  }, [])

  const persistOnboardingState = useCallback(async (state: OnboardingState): Promise<void> => {
    setOnboardingState(state)
    try {
      setOnboardingState(await window.desktop.app.setOnboardingState({ state }))
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error))
      window.desktop.diagnostics.reportRendererError({
        event: 'renderer.error',
        message: normalized.message,
        stack: normalized.stack,
        source: 'onboarding state persistence'
      })
      notifyActionError(actionErrorMessages.onboarding)
    }
  }, [])

  useEffect(() => {
    let current = true

    void (async () => {
      const [lifecycleResult, recentResult, templateResult, onboardingResult] =
        await Promise.allSettled([
          window.desktop.projects.lifecycle(),
          window.desktop.projects.recent(),
          window.desktop.projects.templates(),
          window.desktop.app.getOnboardingState()
        ])
      if (!current) return

      if (lifecycleResult.status === 'fulfilled') {
        setSnapshot(lifecycleResult.value)
      } else {
        notifyActionError(actionErrorMessages.load)
      }
      if (recentResult.status === 'fulfilled') {
        setRecentProjects(recentResult.value)
      } else {
        notifyActionError(actionErrorMessages.recent)
      }
      if (templateResult.status === 'fulfilled') {
        setProjectTemplates(templateResult.value)
      } else {
        notifyActionError(actionErrorMessages.template)
      }
      if (onboardingResult.status === 'fulfilled') {
        setOnboardingState(onboardingResult.value)
      } else {
        setOnboardingState({ schemaVersion: 1, status: 'pending', step: 'welcome' })
        notifyActionError(actionErrorMessages.onboarding)
      }
      setInitialLoading(false)
    })()

    return () => {
      current = false
    }
  }, [])

  const projectSessionId = snapshot.activeProject?.projectSessionId
  const agentOpen =
    projectSessionId !== undefined &&
    agentPanelState.projectSessionId === projectSessionId &&
    agentPanelState.open
  const setAgentOpen = useCallback(
    (open: boolean) => setAgentPanelState({ projectSessionId: projectSessionId ?? null, open }),
    [projectSessionId]
  )

  const enableVersionHistory = useCallback(async (): Promise<void> => {
    if (!projectSessionId) return
    setActiveAction('history')
    try {
      await window.desktop.projects.enableVersionHistory({ projectSessionId })
      setVersionHistoryState('ready')
    } catch {
      notifyActionError(actionErrorMessages.history)
    } finally {
      setActiveAction(null)
    }
  }, [projectSessionId])

  useEffect(() => {
    if (!projectSessionId) return

    let disposed = false
    let unsubscribe: (() => void) | undefined

    void window.desktop.projects
      .subscribe({ projectSessionId }, (event) => {
        if (!disposed) setSnapshot(event.snapshot)
      })
      .then((release) => {
        if (disposed) release()
        else unsubscribe = release
      })
      .catch(() => {
        if (!disposed) {
          notifyActionError(actionErrorMessages.subscribe)
          void refreshLifecycle()
        }
      })

    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [projectSessionId, refreshLifecycle])

  const openProject = useCallback(async (): Promise<void> => {
    setActiveAction('open')
    try {
      const result = await window.desktop.projects.open()
      if (result.project) setSnapshot({ state: 'open', activeProject: result.project })
      else await refreshLifecycle()
    } catch {
      notifyActionError(actionErrorMessages.open)
      await refreshLifecycle()
    } finally {
      setActiveAction(null)
    }
  }, [refreshLifecycle])

  const openRecentProject = useCallback(
    async (projectId: string): Promise<void> => {
      setActiveAction('openRecent')
      try {
        const result = await window.desktop.projects.openRecent({ projectId })
        if (result.project) setSnapshot({ state: 'open', activeProject: result.project })
        else await refreshLifecycle()
      } catch {
        notifyActionError(actionErrorMessages.openRecent)
        await refreshLifecycle()
      } finally {
        setActiveAction(null)
      }
    },
    [refreshLifecycle]
  )

  const createProject = useCallback(async (): Promise<void> => {
    const parsedName = projectNameSchema.safeParse(projectName)
    if (!parsedName.success) {
      setProjectNameError(parsedName.error.issues[0]?.message ?? 'Enter a valid project name')
      return
    }

    setCreateDialogOpen(false)
    setActiveAction('create')
    try {
      const result = await window.desktop.projects.create({
        name: parsedName.data,
        ...(selectedTemplateId === 'blank' ? {} : { templateId: selectedTemplateId })
      })
      if (result.project) {
        setSnapshot({ state: 'open', activeProject: result.project })
        setProjectName('')
      } else {
        await refreshLifecycle()
      }
    } catch {
      notifyActionError(actionErrorMessages.create)
      await refreshLifecycle()
    } finally {
      setActiveAction(null)
    }
  }, [projectName, refreshLifecycle, selectedTemplateId])

  const closeProject = useCallback(async (): Promise<void> => {
    if (!projectSessionId) return
    setActiveAction('close')
    try {
      setSnapshot((current) => ({ ...current, state: 'closing' }))
      setSnapshot(await window.desktop.projects.close({ projectSessionId }))
      await refreshRecentProjects()
    } catch {
      notifyActionError(actionErrorMessages.close)
      await refreshLifecycle()
    } finally {
      setActiveAction(null)
    }
  }, [projectSessionId, refreshLifecycle, refreshRecentProjects])

  const switchProject = useCallback(async (): Promise<void> => {
    if (!projectSessionId) return
    setActiveAction('switch')
    try {
      const result = await window.desktop.projects.switch({ projectSessionId })
      if (result.project) setSnapshot({ state: 'open', activeProject: result.project })
      else await refreshLifecycle()
    } catch {
      notifyActionError(actionErrorMessages.switch)
      await refreshLifecycle()
    } finally {
      setActiveAction(null)
    }
  }, [projectSessionId, refreshLifecycle])

  const createSnapshot = useCallback(async (): Promise<void> => {
    if (!projectSessionId) return
    setActiveAction('snapshot')
    try {
      await window.desktop.projects.createSnapshot({ projectSessionId })
    } catch {
      notifyActionError(actionErrorMessages.snapshot)
    } finally {
      setActiveAction(null)
    }
  }, [projectSessionId])

  const cloneProject = useCallback(async (): Promise<void> => {
    if (!projectSessionId) return
    setActiveAction('clone')
    try {
      const result = await window.desktop.projects.clone({ projectSessionId })
      if (result.project) {
        setSnapshot({ state: 'open', activeProject: result.project })
        await refreshRecentProjects()
      } else {
        await refreshLifecycle()
      }
    } catch {
      notifyActionError(actionErrorMessages.clone)
      await refreshLifecycle()
    } finally {
      setActiveAction(null)
    }
  }, [projectSessionId, refreshLifecycle, refreshRecentProjects])

  const openTemplateDialog = useCallback(async (): Promise<void> => {
    if (!projectSessionId) return
    setActiveAction('template')
    try {
      setTemplatePreview(await window.desktop.projects.previewTemplate({ projectSessionId }))
      setTemplateName('')
      setTemplateDescription('')
      setIncludeTemplatePreset(true)
      setTemplateDialogOpen(true)
    } catch {
      notifyActionError(actionErrorMessages.template)
    } finally {
      setActiveAction(null)
    }
  }, [projectSessionId])

  const saveTemplate = useCallback(async (): Promise<void> => {
    if (!projectSessionId || templateName.trim().length === 0) return
    setActiveAction('template')
    try {
      setProjectTemplates(
        await window.desktop.projects.saveTemplate({
          projectSessionId,
          name: templateName,
          description: templateDescription,
          includePublicationPreset: includeTemplatePreset
        })
      )
      setTemplateDialogOpen(false)
    } catch {
      notifyActionError(actionErrorMessages.template)
    } finally {
      setActiveAction(null)
    }
  }, [includeTemplatePreset, projectSessionId, templateDescription, templateName])

  const deleteSelectedTemplate = useCallback(async (): Promise<void> => {
    if (selectedTemplateId === 'blank') return
    const selected = projectTemplates.find((template) => template.templateId === selectedTemplateId)
    if (selected?.origin !== 'user') return
    try {
      setProjectTemplates(
        await window.desktop.projects.deleteTemplate({ templateId: selectedTemplateId })
      )
      setSelectedTemplateId('blank')
    } catch {
      notifyActionError(actionErrorMessages.template)
    }
  }, [projectTemplates, selectedTemplateId])

  const exportManuscript = useCallback(
    async (kind: ManuscriptExportKind): Promise<void> => {
      if (projectSessionId === undefined) return
      exportCancellationRequested.current = false
      setExportCancelling(false)
      setActiveAction('export')
      try {
        const result = await window.desktop.projects.exportManuscript({
          projectSessionId,
          kind
        })
        if (result.created) setExportResult(result)
      } catch {
        if (!exportCancellationRequested.current) notifyActionError(actionErrorMessages.export)
      } finally {
        setActiveAction(null)
        setExportCancelling(false)
      }
    },
    [projectSessionId]
  )

  const cancelManuscriptExport = useCallback(async (): Promise<void> => {
    if (projectSessionId === undefined || exportCancelling) return
    exportCancellationRequested.current = true
    setExportCancelling(true)
    try {
      const result = await window.desktop.projects.cancelManuscriptExport({ projectSessionId })
      if (!result.cancelled) {
        exportCancellationRequested.current = false
        setExportCancelling(false)
      }
    } catch {
      exportCancellationRequested.current = false
      setExportCancelling(false)
      notifyActionError(actionErrorMessages.export)
    }
  }, [exportCancelling, projectSessionId])

  const restoreSnapshot = useCallback(async (): Promise<void> => {
    setActiveAction('snapshot')
    try {
      const result = await window.desktop.projects.restoreSnapshot()
      if (result.project) setSnapshot({ state: 'open', activeProject: result.project })
      else await refreshLifecycle()
    } catch {
      notifyActionError(actionErrorMessages.snapshot)
      await refreshLifecycle()
    } finally {
      setActiveAction(null)
    }
  }, [refreshLifecycle])

  const runRecovery = useCallback(
    async (
      action: () => Promise<ProjectLifecycleSnapshot | ProjectSelectionResult>
    ): Promise<void> => {
      setActiveAction('recovery')
      try {
        const result = await action()
        if ('project' in result) {
          if (result.project) setSnapshot({ state: 'open', activeProject: result.project })
          else await refreshLifecycle()
        } else {
          setSnapshot(result)
        }
      } catch {
        notifyActionError(actionErrorMessages.recovery)
        await refreshLifecycle()
      } finally {
        setActiveAction(null)
      }
    },
    [refreshLifecycle]
  )

  const exportRecoveryDiagnostics = useCallback(async (): Promise<void> => {
    setActiveAction('recovery')
    try {
      await window.desktop.projects.exportRecoveryDiagnostics()
    } catch {
      notifyActionError(actionErrorMessages.recovery)
    } finally {
      setActiveAction(null)
    }
  }, [])

  const runDiagnostics = useCallback(async (action: () => Promise<unknown>): Promise<void> => {
    try {
      await action()
    } catch {
      notifyActionError(actionErrorMessages.diagnostics)
    }
  }, [])

  const lifecycleBusy = ['creating', 'opening', 'closing'].includes(snapshot.state)
  const isBusy = initialLoading || activeAction !== null || lifecycleBusy
  const projectOpening =
    snapshot.state === 'opening' ||
    activeAction === 'open' ||
    activeAction === 'openRecent' ||
    activeAction === 'switch'
  const projectSelectionDisabled = snapshot.state !== 'closed'
  const activeProject = snapshot.activeProject
  const onboardingPending = onboardingState?.status === 'pending'
  const recoveryKind = snapshot.recovery?.kind
  const recoveryIsLockContended =
    snapshot.recovery?.kind === 'open' && snapshot.recovery.reason === 'lock-contended'
  const showOpenRecovery = recoveryKind === undefined || recoveryKind === 'open'
  const showCloseRecovery = recoveryKind === undefined || recoveryKind === 'close'
  const showCreateRecovery = recoveryKind === undefined || recoveryKind === 'create'

  useEffect(() => {
    if (!activeProject || !onboardingPending) return
    void persistOnboardingState({ schemaVersion: 1, status: 'completed' })
  }, [activeProject, onboardingPending, persistOnboardingState])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey)) return

      if (event.key === ',') {
        event.preventDefault()
        setSettingsSection('general')
        setSettingsOpen(true)
      } else if (event.key.toLowerCase() === 'n' && !isBusy && !projectSelectionDisabled) {
        event.preventDefault()
        setProjectNameError(null)
        setCreateDialogOpen(true)
      } else if (event.key.toLowerCase() === 'o' && !isBusy && !projectSelectionDisabled) {
        event.preventDefault()
        void openProject()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isBusy, openProject, projectSelectionDisabled])

  const formatRecentProjectDate = (lastOpenedAt: string): string => {
    const date = new Date(lastOpenedAt)
    if (Number.isNaN(date.getTime())) return 'Recently opened'
    return `Opened ${new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date)}`
  }

  return (
    <div className='flex h-svh min-w-80 flex-col overflow-hidden bg-background'>
      <AppMenubar
        busy={isBusy}
        projectSelectionDisabled={projectSelectionDisabled}
        hasProject={Boolean(activeProject)}
        agentOpen={agentOpen}
        onCreate={() => {
          setProjectNameError(null)
          setCreateDialogOpen(true)
        }}
        onOpen={() => void openProject()}
        onSwitch={() => void switchProject()}
        onSave={() => window.dispatchEvent(new Event('writellm:save'))}
        onClone={() => void cloneProject()}
        onSaveTemplate={() => void openTemplateDialog()}
        onExportNative={() => void exportManuscript('native')}
        onExportMarkdown={() => void exportManuscript('markdown')}
        onExportPandoc={() => void exportManuscript('pandoc')}
        onExportDocx={() => void exportManuscript('docx')}
        onExportLatex={() => void exportManuscript('latex')}
        onExportPdf={() => void exportManuscript('pdf')}
        onCreateSnapshot={() => void createSnapshot()}
        onRestoreSnapshot={() => void restoreSnapshot()}
        versionHistoryState={versionHistoryState}
        onEnableVersionHistory={() => void enableVersionHistory()}
        onCreateCheckpoint={() => setVersionHistoryView('create')}
        onOpenVersionHistory={() => setVersionHistoryView('history')}
        canRestoreSnapshot={snapshot.state === 'closed' || snapshot.state === 'recovery-required'}
        onClose={() => void closeProject()}
        onOpenSettings={() => {
          setSettingsSection('general')
          setSettingsOpen(true)
        }}
        onOpenLogs={() => void runDiagnostics(window.desktop.diagnostics.openLogsDirectory)}
        onToggleAgent={() => setAgentOpen(!agentOpen)}
        onOpenFind={() => window.dispatchEvent(new Event('writellm:find'))}
      />
      {projectSessionId ? (
        <ProjectVersionHistory
          key={projectSessionId}
          projectSessionId={projectSessionId}
          view={versionHistoryView}
          onViewChange={setVersionHistoryView}
          onStateChange={setVersionHistoryState}
          onProjectRestored={(project) => setSnapshot({ state: 'open', activeProject: project })}
          onError={notifyActionError}
        />
      ) : null}

      <div className='relative flex min-h-0 flex-1'>
        <div
          className='flex min-h-0 flex-1'
          aria-hidden={projectOpening || undefined}
          inert={projectOpening || undefined}
        >
          {activeProject && projectSessionId ? (
            <WritingWorkspace
              projectSessionId={projectSessionId}
              projectName={activeProject.displayName}
              lifecycleState={stateLabels[snapshot.state]}
              agentOpen={agentOpen}
              onAgentOpenChange={setAgentOpen}
              onOpenSettings={() => {
                setSettingsSection('general')
                setSettingsOpen(true)
              }}
              onError={notifyActionError}
            />
          ) : onboardingState?.status === 'pending' &&
            snapshot.state === 'closed' &&
            !initialLoading ? (
            <OnboardingFlow
              state={onboardingState}
              projectName={projectName}
              projectNameError={projectNameError}
              projectTemplates={projectTemplates}
              selectedTemplateId={selectedTemplateId}
              creatingProject={activeAction === 'create'}
              onStateChange={persistOnboardingState}
              onProjectNameChange={(name) => {
                setProjectName(name)
                setProjectNameError(null)
              }}
              onTemplateChange={setSelectedTemplateId}
              onDeleteSelectedTemplate={() => void deleteSelectedTemplate()}
              onCreateProject={createProject}
              onOpenProject={openProject}
              onError={notifyActionError}
            />
          ) : (
            <main className='flex min-h-0 flex-1 overflow-auto p-4 md:p-8' aria-busy={isBusy}>
              <div className='m-auto flex w-full max-w-xl flex-col gap-4'>
                <Card>
                  <CardHeader>
                    <CardTitle>
                      <h1>{initialLoading ? 'Loading project' : 'Open a workspace'}</h1>
                    </CardTitle>
                    <CardDescription>
                      {initialLoading
                        ? 'Checking the current project state.'
                        : 'Create a self-contained WriteLLM project or open an existing project folder.'}
                    </CardDescription>
                    <CardAction>
                      {initialLoading ? (
                        <Spinner className='text-muted-foreground' />
                      ) : (
                        <Badge variant='secondary'>{stateLabels[snapshot.state]}</Badge>
                      )}
                    </CardAction>
                  </CardHeader>
                  {!initialLoading && (
                    <>
                      <CardContent>
                        {snapshot.state === 'recovery-required' && (
                          <Alert variant='destructive' role='status'>
                            <AlertCircle />
                            <AlertTitle>Recovery required</AlertTitle>
                            <AlertDescription>
                              {recoveryIsLockContended
                                ? 'Another WriteLLM process still holds this project lock. Close that process and retry. If it ended unexpectedly, wait one minute, then recover the stale lock.'
                                : 'Choose a recovery action below. WriteLLM keeps the project closed until the selected transition is verified.'}
                            </AlertDescription>
                            <div className='col-start-2 grid min-w-0 gap-2 border-t pt-4 sm:grid-cols-2'>
                              {showOpenRecovery && (
                                <Button
                                  variant='outline'
                                  disabled={isBusy}
                                  onClick={() =>
                                    void runRecovery(window.desktop.projects.retryOpen)
                                  }
                                >
                                  <RefreshCcw /> Retry open
                                </Button>
                              )}
                              {recoveryIsLockContended && (
                                <Button
                                  variant='outline'
                                  disabled={isBusy}
                                  onClick={() =>
                                    void runRecovery(window.desktop.projects.recoverStaleLock)
                                  }
                                >
                                  <RotateCcw /> Recover stale lock
                                </Button>
                              )}
                              {showCloseRecovery && (
                                <Button
                                  variant='outline'
                                  disabled={isBusy}
                                  onClick={() =>
                                    void runRecovery(window.desktop.projects.retryClose)
                                  }
                                >
                                  <RotateCcw /> Retry close
                                </Button>
                              )}
                              {showCreateRecovery && (
                                <Button
                                  variant='outline'
                                  disabled={isBusy}
                                  onClick={() =>
                                    void runRecovery(
                                      window.desktop.projects.discardIncompleteCreate
                                    )
                                  }
                                >
                                  <Trash2 /> Discard incomplete create
                                </Button>
                              )}
                              {showOpenRecovery && (
                                <Button
                                  variant='outline'
                                  disabled={isBusy}
                                  onClick={() =>
                                    void runRecovery(window.desktop.projects.locateMoved)
                                  }
                                >
                                  <MapPin /> Locate moved project
                                </Button>
                              )}
                              <Button
                                variant='outline'
                                disabled={isBusy}
                                onClick={() => void exportRecoveryDiagnostics()}
                              >
                                <Download /> Export diagnostics
                              </Button>
                              {showOpenRecovery && (
                                <Button
                                  variant='outline'
                                  disabled={isBusy}
                                  onClick={() =>
                                    void runRecovery(window.desktop.projects.returnToClosed)
                                  }
                                >
                                  <XCircle /> Return to closed
                                </Button>
                              )}
                            </div>
                          </Alert>
                        )}
                      </CardContent>
                      {recentProjects.length > 0 && (
                        <CardContent className='border-t pt-4'>
                          <div className='mb-3 flex flex-col gap-1'>
                            <h2 className='font-medium'>Recent projects</h2>
                            <p className='text-sm text-muted-foreground'>
                              Open one of your five most recently opened projects.
                            </p>
                          </div>
                          <ItemGroup className='gap-2'>
                            {recentProjects.map((recentProject) => (
                              <Item key={recentProject.projectId} size='sm' className='p-0'>
                                <Button
                                  className='h-auto w-full min-w-0 justify-start gap-3 px-3 py-3 text-left'
                                  variant='ghost'
                                  disabled={isBusy || projectSelectionDisabled}
                                  aria-label={`Open ${recentProject.displayName}`}
                                  onClick={() => void openRecentProject(recentProject.projectId)}
                                >
                                  <ItemMedia variant='icon'>
                                    <FolderOpen />
                                  </ItemMedia>
                                  <ItemContent className='min-w-0'>
                                    <ItemTitle className='block w-full truncate'>
                                      {recentProject.displayName}
                                    </ItemTitle>
                                    <ItemDescription className='block truncate text-left'>
                                      <span title={recentProject.projectPath}>
                                        {recentProject.projectPath}
                                      </span>
                                      <span className='block'>
                                        {formatRecentProjectDate(recentProject.lastOpenedAt)}
                                      </span>
                                    </ItemDescription>
                                  </ItemContent>
                                </Button>
                              </Item>
                            ))}
                          </ItemGroup>
                        </CardContent>
                      )}
                      <CardFooter className='flex-col gap-2 border-t sm:flex-row'>
                        <Button
                          className='w-full sm:w-auto'
                          disabled={isBusy || projectSelectionDisabled}
                          onClick={() => {
                            setProjectNameError(null)
                            setCreateDialogOpen(true)
                          }}
                        >
                          {activeAction === 'create' ? (
                            <Spinner data-icon='inline-start' />
                          ) : (
                            <Plus data-icon='inline-start' />
                          )}
                          {activeAction === 'create' ? 'Creating…' : 'Create project'}
                        </Button>
                        <Button
                          className='w-full sm:w-auto'
                          variant='outline'
                          disabled={isBusy || projectSelectionDisabled}
                          onClick={() => void openProject()}
                        >
                          <FolderOpen />
                          Open project
                        </Button>
                        <Button
                          className='w-full sm:ml-auto sm:w-auto'
                          variant='ghost'
                          onClick={() => {
                            setSettingsSection('general')
                            setSettingsOpen(true)
                          }}
                        >
                          <Settings2 /> Settings
                        </Button>
                      </CardFooter>
                    </>
                  )}
                </Card>
              </div>
            </main>
          )}
        </div>
        {projectOpening ? <ProjectOpeningIndicator /> : null}
      </div>

      <SettingsCommand
        open={settingsOpen}
        initialSection={settingsSection}
        onOpenChange={setSettingsOpen}
        onOpenLogs={() => void runDiagnostics(window.desktop.diagnostics.openLogsDirectory)}
        onExportDiagnostics={() => void runDiagnostics(window.desktop.diagnostics.exportBundle)}
        onError={notifyActionError}
      />
      <Dialog
        open={createDialogOpen}
        onOpenChange={(open) => {
          setCreateDialogOpen(open)
          if (!open) setProjectNameError(null)
        }}
      >
        <DialogContent>
          <form
            className='flex flex-col gap-4'
            onSubmit={(event) => {
              event.preventDefault()
              void createProject()
            }}
          >
            <DialogHeader>
              <DialogTitle>Create project</DialogTitle>
              <DialogDescription>
                Choose a name first, then select where to create the project folder.
              </DialogDescription>
            </DialogHeader>
            <ProjectCreationFields
              idPrefix='dialog'
              projectName={projectName}
              projectNameError={projectNameError}
              projectTemplates={projectTemplates}
              selectedTemplateId={selectedTemplateId}
              autoFocus
              onProjectNameChange={(name) => {
                setProjectName(name)
                setProjectNameError(null)
              }}
              onTemplateChange={setSelectedTemplateId}
              onDeleteSelectedTemplate={() => void deleteSelectedTemplate()}
            />
            <DialogFooter>
              <DialogClose asChild>
                <Button type='button' variant='outline'>
                  Cancel
                </Button>
              </DialogClose>
              <Button type='submit'>Choose location</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={templateDialogOpen} onOpenChange={setTemplateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save reusable project template</DialogTitle>
            <DialogDescription>
              Review exactly what will be reusable. Project content and identity stay excluded.
            </DialogDescription>
          </DialogHeader>
          <div className='grid gap-4'>
            <Field>
              <FieldLabel htmlFor='template-name'>Template name</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  id='template-name'
                  value={templateName}
                  onChange={(event) => setTemplateName(event.target.value)}
                />
              </InputGroup>
            </Field>
            <Field>
              <FieldLabel htmlFor='template-description'>Description</FieldLabel>
              <Textarea
                id='template-description'
                value={templateDescription}
                maxLength={1_000}
                onChange={(event) => setTemplateDescription(event.target.value)}
              />
            </Field>
            {templatePreview ? (
              <div className='grid gap-3 rounded-md border p-3 text-sm'>
                <div>
                  <p className='font-medium'>Included</p>
                  <p className='text-muted-foreground'>
                    {templatePreview.outlineTitles.length} outline sections,{' '}
                    {templatePreview.briefFields.length} populated Brief fields, and{' '}
                    {templatePreview.writingRuleCount} writing rules.
                  </p>
                </div>
                <div>
                  <p className='font-medium'>Excluded</p>
                  <ul className='list-disc pl-5 text-muted-foreground'>
                    {templatePreview.excluded.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                <label htmlFor='template-publication-preset' className='flex items-center gap-2'>
                  <Checkbox
                    id='template-publication-preset'
                    checked={includeTemplatePreset}
                    onCheckedChange={(checked) => setIncludeTemplatePreset(checked === true)}
                  />
                  Include the current default publication preset reference
                </label>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button type='button' variant='outline' onClick={() => setTemplateDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              type='button'
              disabled={templateName.trim().length === 0 || activeAction === 'template'}
              onClick={() => void saveTemplate()}
            >
              Save template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={activeAction === 'export'} onOpenChange={() => undefined}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Publishing manuscript</DialogTitle>
            <DialogDescription>
              WriteLLM is capturing the current manuscript, verifying assets, and building the
              selected format.
            </DialogDescription>
          </DialogHeader>
          <div className='flex items-center gap-3 text-sm text-muted-foreground' role='status'>
            <Spinner />
            {exportCancelling ? 'Cancelling…' : 'Publication is in progress…'}
          </div>
          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              disabled={exportCancelling}
              onClick={() => void cancelManuscriptExport()}
            >
              {exportCancelling ? 'Cancelling…' : 'Cancel export'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={exportResult !== undefined}
        onOpenChange={(open) => {
          if (!open) setExportResult(undefined)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manuscript exported</DialogTitle>
            <DialogDescription>
              {exportResult?.packageName} contains the complete current manuscript and{' '}
              {exportResult?.assetCount ?? 0} referenced asset
              {(exportResult?.assetCount ?? 0) === 1 ? '' : 's'}.
            </DialogDescription>
          </DialogHeader>
          {exportResult?.lossReport && exportResult.lossReport.losses.length > 0 ? (
            <Alert>
              <TriangleAlert />
              <AlertTitle>Publication limitations</AlertTitle>
              <AlertDescription>
                <p>
                  {exportResult.lossReport.losses.length} formatting detail
                  {exportResult.lossReport.losses.length === 1 ? ' was' : 's were'} recorded in{' '}
                  writellm.loss-report.json.
                </p>
                <ul className='list-disc pl-4'>
                  {exportResult.lossReport.losses.slice(0, 5).map((loss) => (
                    <li key={`${loss.sectionId}:${loss.blockId}:${loss.code}`}>{loss.message}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button>Done</Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default App
