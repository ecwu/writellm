import { reportRendererOperationError } from './diagnostics'
import { matchesShortcut } from '@/lib/keyboard-shortcuts'
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
  X,
  XCircle
} from 'lucide-react'
import type {
  ActiveProject,
  ProjectLifecycleEvent,
  ProjectLifecycleSnapshot,
  ProjectSelectionResult,
  RecentProjects,
  VersionHistoryState
} from '../../shared/contracts/projects'
import type { OnboardingState } from '../../shared/contracts/app'
import { projectNameSchema } from '../../shared/contracts/projects'
import { LayoutControlsProvider, useLayoutControls } from '@/features/workbench/layout-controls'
import { AppMenubar } from '@/components/app-menubar'
import { SettingsCommand } from '@/components/settings-command'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Item, ItemGroup, ItemMedia } from '@/components/ui/item'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { Spinner } from '@/components/ui/spinner'
import { WritingWorkspace } from '@/features/manuscript/writing-workspace'
import { OnboardingFlow } from '@/features/onboarding/onboarding-flow'
import { ProjectCreationFields } from '@/features/project/project-creation-fields'
import { ProjectOpeningIndicator } from '@/features/project/project-opening-indicator'
import {
  ProjectVersionHistory,
  type VersionHistoryView
} from '@/features/project/project-version-history'
import { ProjectTemplateDialog } from '@/features/project/project-template-dialog'
import { useProjectTemplateController } from '@/features/project/use-project-template-controller'
import { ManuscriptExportDialogs } from '@/features/project/manuscript-export-dialogs'
import { useManuscriptExportController } from '@/features/project/use-manuscript-export-controller'
import type { ProjectActionChange } from '@/features/project/project-session-generation'
import { notifyActionError } from '@/lib/notifications'
import { useDesktopSubscription } from '@/hooks/use-desktop-subscription'

const closedSnapshot: ProjectLifecycleSnapshot = {
  state: 'closed',
  activeProject: null
}

type ProjectAction =
  | 'create'
  | 'open'
  | 'openRecent'
  | 'close'
  | 'quit'
  | 'removeRecent'
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
  quit: 'WriteLLM could not exit. Resolve the project close issue and try again.',
  removeRecent: 'WriteLLM could not remove the project from the list. Please try again.',
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

function App(): React.JSX.Element {
  const { controls: layoutControls } = useLayoutControls()
  const [snapshot, setSnapshot] = useState<ProjectLifecycleSnapshot>(closedSnapshot)
  const [recentProjects, setRecentProjects] = useState<RecentProjects>([])
  const [initialLoading, setInitialLoading] = useState(true)
  const [onboardingState, setOnboardingState] = useState<OnboardingState | null>(null)
  const [activeAction, setActiveAction] = useState<ProjectAction | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState<'general' | 'skills' | 'default-models'>(
    'general'
  )
  useEffect(() => {
    const open = () => {
      setSettingsSection('default-models')
      setSettingsOpen(true)
    }
    window.addEventListener('writellm:open-autocomplete-settings', open)
    return () => window.removeEventListener('writellm:open-autocomplete-settings', open)
  }, [])
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [projectNameError, setProjectNameError] = useState<string | null>(null)
  const [agentPanelState, setAgentPanelState] = useState<{
    projectSessionId: string | null
    open: boolean
  }>({ projectSessionId: null, open: false })
  const [versionHistoryState, setVersionHistoryState] = useState<VersionHistoryState | null>(null)
  const [versionHistoryView, setVersionHistoryView] = useState<VersionHistoryView>(null)
  const projectSessionId = snapshot.activeProject?.projectSessionId
  const currentProjectSessionRef = useRef<string | undefined>(projectSessionId)
  currentProjectSessionRef.current = projectSessionId
  const currentSnapshotRef = useRef(snapshot)
  currentSnapshotRef.current = snapshot
  const [versionHistorySessionId, setVersionHistorySessionId] = useState<string | undefined>()
  const actionLeaseRef = useRef<{
    action: 'template' | 'export' | 'history'
    token: symbol
  } | null>(null)
  const historyActionTokenRef = useRef<{ projectSessionId: string; token: symbol } | null>(null)
  const applyTemplateAction = useCallback((change: ProjectActionChange<'template'>): void => {
    if (change.action === 'template') {
      actionLeaseRef.current = change
      setActiveAction('template')
      return
    }
    if (
      actionLeaseRef.current?.action !== 'template' ||
      actionLeaseRef.current.token !== change.token
    ) {
      return
    }
    actionLeaseRef.current = null
    setActiveAction((current) => (current === 'template' ? null : current))
  }, [])
  const applyExportAction = useCallback((change: ProjectActionChange<'export'>): void => {
    if (change.action === 'export') {
      actionLeaseRef.current = change
      setActiveAction('export')
      return
    }
    if (
      actionLeaseRef.current?.action !== 'export' ||
      actionLeaseRef.current.token !== change.token
    ) {
      return
    }
    actionLeaseRef.current = null
    setActiveAction((current) => (current === 'export' ? null : current))
  }, [])
  const templateController = useProjectTemplateController({
    projectSessionId,
    onActionChange: applyTemplateAction
  })
  const exportController = useManuscriptExportController({
    projectSessionId,
    onActionChange: applyExportAction
  })
  const {
    projectTemplates,
    selectedTemplateId,
    templateDialogOpen,
    templatePreview,
    templateName,
    templateDescription,
    includeTemplatePreset,
    setSelectedTemplateId,
    setTemplateDialogOpen,
    setTemplateName,
    setTemplateDescription,
    setIncludeTemplatePreset,
    openTemplateDialog,
    saveTemplate,
    deleteSelectedTemplate
  } = templateController
  const {
    exportResult,
    exportCancelling,
    exportActive,
    exportManuscript,
    cancelManuscriptExport,
    setExportResult
  } = exportController
  useEffect(() => {
    const historyAction = historyActionTokenRef.current
    if (historyAction !== null && historyAction.projectSessionId !== projectSessionId) {
      historyActionTokenRef.current = null
      if (actionLeaseRef.current?.token === historyAction.token) {
        actionLeaseRef.current = null
        setActiveAction((current) => (current === 'history' ? null : current))
      }
    }
    setVersionHistorySessionId(projectSessionId)
    setVersionHistoryState(null)
    setVersionHistoryView(null)
  }, [projectSessionId])
  const currentVersionHistoryState =
    versionHistorySessionId === projectSessionId ? versionHistoryState : null
  const currentVersionHistoryView =
    versionHistorySessionId === projectSessionId ? versionHistoryView : null

  const refreshLifecycle = useCallback(async (): Promise<void> => {
    try {
      const nextSnapshot = await window.desktop.projects.lifecycle()
      setSnapshot(nextSnapshot)
    } catch (err) {
      reportRendererOperationError(err, 'App')
      notifyActionError(actionErrorMessages.load)
    }
  }, [])

  const refreshRecentProjects = useCallback(async (): Promise<void> => {
    try {
      setRecentProjects(await window.desktop.projects.recent())
    } catch (err) {
      reportRendererOperationError(err, 'App')
      notifyActionError(actionErrorMessages.recent)
    }
  }, [])

  const persistOnboardingState = useCallback(async (state: OnboardingState): Promise<void> => {
    setOnboardingState(state)
    try {
      setOnboardingState(await window.desktop.app.setOnboardingState({ state }))
    } catch (error) {
      reportRendererOperationError(error, 'App.onboarding-state-persistence')
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
        reportRendererOperationError(lifecycleResult.reason, 'App.initial.lifecycle')
        notifyActionError(actionErrorMessages.load)
      }
      if (recentResult.status === 'fulfilled') {
        setRecentProjects(recentResult.value)
      } else {
        reportRendererOperationError(recentResult.reason, 'App.initial.recent')
        notifyActionError(actionErrorMessages.recent)
      }
      if (templateResult.status === 'fulfilled') {
        templateController.replaceTemplates(templateResult.value)
      } else {
        reportRendererOperationError(templateResult.reason, 'App.initial.templates')
        notifyActionError(actionErrorMessages.template)
      }
      if (onboardingResult.status === 'fulfilled') {
        setOnboardingState(onboardingResult.value)
      } else {
        reportRendererOperationError(onboardingResult.reason, 'App.initial.onboarding')
        setOnboardingState({ schemaVersion: 1, status: 'pending', step: 'welcome' })
        notifyActionError(actionErrorMessages.onboarding)
      }
      setInitialLoading(false)
    })()

    return () => {
      current = false
    }
  }, [templateController.replaceTemplates])
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
    const sourceSessionId = projectSessionId
    const actionToken = Symbol('version-history')
    const historyAction = { projectSessionId: sourceSessionId, token: actionToken }
    historyActionTokenRef.current = historyAction
    actionLeaseRef.current = { action: 'history', token: actionToken }
    setActiveAction('history')
    try {
      await window.desktop.projects.enableVersionHistory({ projectSessionId: sourceSessionId })
      if (
        currentProjectSessionRef.current !== sourceSessionId ||
        historyActionTokenRef.current !== historyAction
      ) {
        return
      }
      setVersionHistorySessionId(sourceSessionId)
      setVersionHistoryState('ready')
    } catch (err) {
      reportRendererOperationError(err, 'App')
      if (
        currentProjectSessionRef.current === sourceSessionId &&
        historyActionTokenRef.current === historyAction
      ) {
        notifyActionError(actionErrorMessages.history)
      }
    } finally {
      if (historyActionTokenRef.current === historyAction) {
        historyActionTokenRef.current = null
        if (actionLeaseRef.current?.token === actionToken) {
          actionLeaseRef.current = null
          setActiveAction((current) => (current === 'history' ? null : current))
        }
      }
    }
  }, [projectSessionId])

  const handleVersionHistoryStateChange = useCallback(
    (state: VersionHistoryState): void => {
      if (currentProjectSessionRef.current !== projectSessionId) return
      setVersionHistorySessionId(projectSessionId)
      setVersionHistoryState(state)
    },
    [projectSessionId]
  )

  const handleVersionHistoryViewChange = useCallback(
    (view: VersionHistoryView): void => {
      if (currentProjectSessionRef.current !== projectSessionId) return
      setVersionHistorySessionId(projectSessionId)
      setVersionHistoryView(view)
    },
    [projectSessionId]
  )

  const handleProjectRestored = useCallback(
    (project: ActiveProject): void => {
      const currentSessionId = currentProjectSessionRef.current
      const sourceSessionId = projectSessionId
      if (
        currentSessionId !== undefined &&
        currentSessionId !== sourceSessionId &&
        currentSessionId !== project.projectSessionId
      ) {
        return
      }
      if (currentSessionId === undefined && currentSnapshotRef.current.state !== 'opening') {
        return
      }
      setSnapshot({ state: 'open', activeProject: project })
    },
    [projectSessionId]
  )

  useDesktopSubscription<ProjectLifecycleEvent>(
    (listener) => {
      if (!projectSessionId) return Promise.reject(new Error('Project session is unavailable'))
      return window.desktop.projects.subscribe({ projectSessionId }, listener)
    },
    (event) => setSnapshot(event.snapshot),
    {
      enabled: projectSessionId !== undefined,
      source: 'App.project-subscription',
      dependencies: [projectSessionId],
      onError: () => {
        notifyActionError(actionErrorMessages.subscribe)
        void refreshLifecycle()
      }
    }
  )

  const openProject = useCallback(async (): Promise<void> => {
    setActiveAction('open')
    try {
      const result = await window.desktop.projects.open()
      if (result.project) setSnapshot({ state: 'open', activeProject: result.project })
      else await refreshLifecycle()
    } catch (err) {
      reportRendererOperationError(err, 'App')
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
      } catch (err) {
        reportRendererOperationError(err, 'App')
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
    } catch (err) {
      reportRendererOperationError(err, 'App')
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
    } catch (err) {
      reportRendererOperationError(err, 'App')
      notifyActionError(actionErrorMessages.close)
      await refreshLifecycle()
    } finally {
      setActiveAction(null)
    }
  }, [projectSessionId, refreshLifecycle, refreshRecentProjects])

  const quitApp = useCallback(async (): Promise<void> => {
    setActiveAction('quit')
    try {
      await window.desktop.app.quit()
    } catch (err) {
      reportRendererOperationError(err, 'App')
      notifyActionError(actionErrorMessages.quit)
      await refreshLifecycle()
    } finally {
      setActiveAction(null)
    }
  }, [refreshLifecycle])

  const removeRecentProject = useCallback(async (projectId: string): Promise<void> => {
    setActiveAction('removeRecent')
    try {
      setRecentProjects(await window.desktop.projects.removeRecent({ projectId }))
    } catch (err) {
      reportRendererOperationError(err, 'App')
      notifyActionError(actionErrorMessages.removeRecent)
    } finally {
      setActiveAction(null)
    }
  }, [])

  const createSnapshot = useCallback(async (): Promise<void> => {
    if (!projectSessionId) return
    setActiveAction('snapshot')
    try {
      await window.desktop.projects.createSnapshot({ projectSessionId })
    } catch (err) {
      reportRendererOperationError(err, 'App')
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
    } catch (err) {
      reportRendererOperationError(err, 'App')
      notifyActionError(actionErrorMessages.clone)
      await refreshLifecycle()
    } finally {
      setActiveAction(null)
    }
  }, [projectSessionId, refreshLifecycle, refreshRecentProjects])

  const restoreSnapshot = useCallback(async (): Promise<void> => {
    setActiveAction('snapshot')
    try {
      const result = await window.desktop.projects.restoreSnapshot()
      if (result.project) setSnapshot({ state: 'open', activeProject: result.project })
      else await refreshLifecycle()
    } catch (err) {
      reportRendererOperationError(err, 'App')
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
      } catch (err) {
        reportRendererOperationError(err, 'App')
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
    } catch (err) {
      reportRendererOperationError(err, 'App')
      notifyActionError(actionErrorMessages.recovery)
    } finally {
      setActiveAction(null)
    }
  }, [])

  const runDiagnostics = useCallback(async (action: () => Promise<unknown>): Promise<void> => {
    try {
      await action()
    } catch (err) {
      reportRendererOperationError(err, 'App')
      notifyActionError(actionErrorMessages.diagnostics)
    }
  }, [])

  const lifecycleBusy = ['creating', 'opening', 'closing'].includes(snapshot.state)
  const isBusy = initialLoading || activeAction !== null || lifecycleBusy
  const projectOpening =
    snapshot.state === 'opening' || activeAction === 'open' || activeAction === 'openRecent'
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
      if (window.desktop.menu.native) return
      if (matchesShortcut(event, 'settings')) {
        event.preventDefault()
        setSettingsSection('general')
        setSettingsOpen(true)
      } else if (matchesShortcut(event, 'newProject') && !isBusy && !projectSelectionDisabled) {
        event.preventDefault()
        setProjectNameError(null)
        setCreateDialogOpen(true)
      } else if (matchesShortcut(event, 'openProject') && !isBusy && !projectSelectionDisabled) {
        event.preventDefault()
        void openProject()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isBusy, openProject, projectSelectionDisabled])

  const formatRecentProjectTimestamp = (lastOpenedAt: string): string => {
    const date = new Date(lastOpenedAt)
    if (Number.isNaN(date.getTime())) return 'Recently'
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(date)
  }

  return (
    <div className='flex h-svh min-w-80 flex-col overflow-hidden bg-background'>
      <AppMenubar
        projectSessionId={projectSessionId ?? null}
        ready={!initialLoading}
        layoutControls={
          layoutControls?.projectSessionId === projectSessionId &&
          snapshot.state === 'open' &&
          !projectOpening
            ? layoutControls
            : null
        }
        busy={isBusy}
        projectSelectionDisabled={projectSelectionDisabled}
        hasProject={Boolean(activeProject)}
        agentOpen={agentOpen}
        onCreate={() => {
          setProjectNameError(null)
          setCreateDialogOpen(true)
        }}
        onOpen={() => void openProject()}
        onQuit={() => void quitApp()}
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
        versionHistoryState={currentVersionHistoryState}
        onEnableVersionHistory={() => void enableVersionHistory()}
        onCreateCheckpoint={() => handleVersionHistoryViewChange('create')}
        onOpenVersionHistory={() => handleVersionHistoryViewChange('history')}
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
          view={currentVersionHistoryView}
          onViewChange={handleVersionHistoryViewChange}
          onStateChange={handleVersionHistoryStateChange}
          onProjectRestored={handleProjectRestored}
          onError={notifyActionError}
        />
      ) : null}

      <div className='relative flex min-h-0 min-w-0 flex-1'>
        <div
          className='flex min-h-0 min-w-0 flex-1'
          aria-hidden={projectOpening || undefined}
          inert={projectOpening || undefined}
        >
          {activeProject && projectSessionId ? (
            <WritingWorkspace
              key={projectSessionId}
              projectSessionId={projectSessionId}
              projectName={activeProject.displayName}
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
            <main className='flex min-h-0 flex-1 overflow-auto p-6 lg:p-10' aria-busy={isBusy}>
              <div className='m-auto flex w-full max-w-6xl flex-col gap-6'>
                <header className='flex items-start justify-between gap-8'>
                  <div className='flex max-w-2xl flex-col gap-2'>
                    <h1 className='text-2xl font-semibold tracking-tight'>
                      {initialLoading ? 'Loading project' : 'Open a workspace'}
                    </h1>
                  </div>
                  {initialLoading ? <Spinner className='mt-1 text-muted-foreground' /> : null}
                </header>

                {snapshot.state === 'recovery-required' && !initialLoading ? (
                  <Alert variant='destructive' role='status'>
                    <AlertCircle />
                    <AlertTitle>Recovery required</AlertTitle>
                    <AlertDescription>
                      {recoveryIsLockContended
                        ? 'Another WriteLLM process still holds this project lock. Close that process and retry. If it ended unexpectedly, wait one minute, then recover the stale lock.'
                        : 'Choose a recovery action below. WriteLLM keeps the project closed until the selected transition is verified.'}
                    </AlertDescription>
                    <div className='col-start-2 grid min-w-0 grid-cols-2 gap-2 border-t pt-4'>
                      {showOpenRecovery && (
                        <Button
                          variant='outline'
                          disabled={isBusy}
                          onClick={() => void runRecovery(window.desktop.projects.retryOpen)}
                        >
                          <RefreshCcw /> Retry open
                        </Button>
                      )}
                      {recoveryIsLockContended && (
                        <Button
                          variant='outline'
                          disabled={isBusy}
                          onClick={() => void runRecovery(window.desktop.projects.recoverStaleLock)}
                        >
                          <RotateCcw /> Recover stale lock
                        </Button>
                      )}
                      {showCloseRecovery && (
                        <Button
                          variant='outline'
                          disabled={isBusy}
                          onClick={() => void runRecovery(window.desktop.projects.retryClose)}
                        >
                          <RotateCcw /> Retry close
                        </Button>
                      )}
                      {showCreateRecovery && (
                        <Button
                          variant='outline'
                          disabled={isBusy}
                          onClick={() =>
                            void runRecovery(window.desktop.projects.discardIncompleteCreate)
                          }
                        >
                          <Trash2 /> Discard incomplete create
                        </Button>
                      )}
                      {showOpenRecovery && (
                        <Button
                          variant='outline'
                          disabled={isBusy}
                          onClick={() => void runRecovery(window.desktop.projects.locateMoved)}
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
                          onClick={() => void runRecovery(window.desktop.projects.returnToClosed)}
                        >
                          <XCircle /> Return to closed
                        </Button>
                      )}
                    </div>
                  </Alert>
                ) : null}

                {initialLoading ? (
                  <div className='grid min-h-80 place-items-center rounded-xl border bg-card'>
                    <div className='flex items-center gap-3 text-sm text-muted-foreground'>
                      <Spinner /> Checking your workspace…
                    </div>
                  </div>
                ) : (
                  <section
                    className='grid min-h-[30rem] grid-cols-[17rem_minmax(0,1fr)] overflow-hidden rounded-xl border bg-card'
                    aria-label='Workspace launcher'
                  >
                    <aside className='flex flex-col border-r bg-muted/30 p-6'>
                      <div className='flex flex-col gap-2'>
                        <Button
                          className='h-auto justify-start py-3'
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
                          className='h-auto justify-start py-3'
                          variant='outline'
                          disabled={isBusy || projectSelectionDisabled}
                          onClick={() => void openProject()}
                        >
                          <FolderOpen />
                          Open project
                        </Button>
                      </div>
                      <Button
                        className='mt-auto justify-start'
                        variant='ghost'
                        onClick={() => {
                          setSettingsSection('general')
                          setSettingsOpen(true)
                        }}
                      >
                        <Settings2 /> Settings
                      </Button>
                    </aside>

                    <div className='min-w-0 p-6'>
                      <div className='mb-5 flex items-end justify-between gap-6'>
                        <div className='flex flex-col gap-1'>
                          <h2 className='font-semibold'>Recent projects</h2>
                        </div>
                        {recentProjects.length > 0 ? (
                          <span className='shrink-0 text-xs tabular-nums text-muted-foreground'>
                            {recentProjects.length} recent
                          </span>
                        ) : null}
                      </div>

                      {recentProjects.length > 0 ? (
                        <TooltipProvider>
                          <div className='grid grid-cols-[minmax(11rem,1fr)_minmax(0,1.25fr)_auto] gap-4 border-b px-3 pb-2 pr-12 text-xs font-medium text-muted-foreground'>
                            <span>Project</span>
                            <span>Location</span>
                            <span>Last opened</span>
                          </div>
                          <ItemGroup className='divide-y'>
                            {recentProjects.map((recentProject) => (
                              <Item
                                key={recentProject.projectId}
                                size='sm'
                                className='flex-nowrap gap-1 rounded-none p-0'
                              >
                                <Button
                                  className='grid h-auto min-w-0 flex-1 grid-cols-[minmax(11rem,1fr)_minmax(0,1.25fr)_auto] justify-normal gap-4 whitespace-normal px-3 py-3 text-left'
                                  variant='ghost'
                                  disabled={isBusy || projectSelectionDisabled}
                                  aria-label={`Open ${recentProject.displayName}`}
                                  onClick={() => void openRecentProject(recentProject.projectId)}
                                >
                                  <span className='flex min-w-0 items-center gap-3'>
                                    <ItemMedia variant='icon'>
                                      <FolderOpen />
                                    </ItemMedia>
                                    <span className='truncate font-medium'>
                                      {recentProject.displayName}
                                    </span>
                                  </span>
                                  <span
                                    className='truncate text-sm text-muted-foreground'
                                    title={recentProject.projectPath}
                                  >
                                    {recentProject.projectPath}
                                  </span>
                                  <span className='shrink-0 text-xs tabular-nums text-muted-foreground'>
                                    {formatRecentProjectTimestamp(recentProject.lastOpenedAt)}
                                  </span>
                                </Button>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant='ghost'
                                      size='icon-sm'
                                      disabled={isBusy || projectSelectionDisabled}
                                      aria-label={`Remove ${recentProject.displayName} from recent projects`}
                                      onClick={() =>
                                        void removeRecentProject(recentProject.projectId)
                                      }
                                    >
                                      <X />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    Remove from list. Project files stay on disk.
                                  </TooltipContent>
                                </Tooltip>
                              </Item>
                            ))}
                          </ItemGroup>
                        </TooltipProvider>
                      ) : (
                        <div className='grid min-h-72 place-items-center border-y'>
                          <div className='flex max-w-sm flex-col items-center gap-3 text-center'>
                            <ItemMedia variant='icon' className='size-10'>
                              <FolderOpen />
                            </ItemMedia>
                            <div className='flex flex-col gap-1'>
                              <p className='text-sm font-medium'>No recent projects</p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </section>
                )}
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
      <ProjectTemplateDialog
        open={templateDialogOpen}
        preview={templatePreview}
        name={templateName}
        description={templateDescription}
        includePublicationPreset={includeTemplatePreset}
        saving={activeAction === 'template'}
        onOpenChange={setTemplateDialogOpen}
        onNameChange={setTemplateName}
        onDescriptionChange={setTemplateDescription}
        onIncludePublicationPresetChange={setIncludeTemplatePreset}
        onSave={() => void saveTemplate()}
      />
      <ManuscriptExportDialogs
        active={exportActive}
        result={exportResult}
        cancelling={exportCancelling}
        onCancel={() => void cancelManuscriptExport()}
        onResultChange={(open) => {
          if (!open) setExportResult(undefined)
        }}
      />
    </div>
  )
}

export default function AppWithLayoutControls(): React.JSX.Element {
  return (
    <LayoutControlsProvider>
      <App />
    </LayoutControlsProvider>
  )
}
