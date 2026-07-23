import { useCallback, useEffect, useState } from 'react'
import {
  AlertCircle,
  Download,
  FolderOpen,
  LoaderCircle,
  MapPin,
  Plus,
  RefreshCcw,
  RotateCcw,
  Settings2,
  Trash2,
  XCircle
} from 'lucide-react'
import type {
  ProjectLifecycleSnapshot,
  ProjectLifecycleState,
  ProjectSelectionResult,
  RecentProjects
} from '../../shared/contracts/projects'
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
import { Input } from '@/components/ui/input'
import { WritingWorkspace } from '@/features/manuscript/writing-workspace'
import { ProjectOpeningIndicator } from '@/features/project/project-opening-indicator'

const closedSnapshot: ProjectLifecycleSnapshot = {
  state: 'closed',
  activeProject: null
}

type ProjectAction = 'create' | 'open' | 'openRecent' | 'close' | 'switch' | 'recovery' | 'snapshot'

const actionErrorMessages: Record<
  ProjectAction | 'load' | 'recent' | 'subscribe' | 'diagnostics',
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
  diagnostics: 'WriteLLM could not complete the diagnostics action. Please try again.',
  recovery: 'WriteLLM could not complete that recovery action. Check diagnostics and try again.',
  snapshot: 'WriteLLM could not complete the snapshot action. Please try again.'
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
  const [activeAction, setActiveAction] = useState<ProjectAction | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [projectNameError, setProjectNameError] = useState<string | null>(null)
  const [agentPanelState, setAgentPanelState] = useState<{
    projectSessionId: string | null
    open: boolean
  }>({ projectSessionId: null, open: false })

  const refreshLifecycle = useCallback(async (): Promise<void> => {
    try {
      const nextSnapshot = await window.desktop.projects.lifecycle()
      setSnapshot(nextSnapshot)
    } catch {
      setErrorMessage(actionErrorMessages.load)
    }
  }, [])

  const refreshRecentProjects = useCallback(async (): Promise<void> => {
    try {
      setRecentProjects(await window.desktop.projects.recent())
    } catch {
      setErrorMessage(actionErrorMessages.recent)
    }
  }, [])

  useEffect(() => {
    let current = true

    void (async () => {
      const [lifecycleResult, recentResult] = await Promise.allSettled([
        window.desktop.projects.lifecycle(),
        window.desktop.projects.recent()
      ])
      if (!current) return

      if (lifecycleResult.status === 'fulfilled') {
        setSnapshot(lifecycleResult.value)
      } else {
        setErrorMessage(actionErrorMessages.load)
      }
      if (recentResult.status === 'fulfilled') {
        setRecentProjects(recentResult.value)
      } else {
        setErrorMessage(actionErrorMessages.recent)
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
          setErrorMessage(actionErrorMessages.subscribe)
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
    setErrorMessage(null)
    try {
      const result = await window.desktop.projects.open()
      if (result.project) setSnapshot({ state: 'open', activeProject: result.project })
      else await refreshLifecycle()
    } catch {
      setErrorMessage(actionErrorMessages.open)
      await refreshLifecycle()
    } finally {
      setActiveAction(null)
    }
  }, [refreshLifecycle])

  const openRecentProject = useCallback(
    async (projectId: string): Promise<void> => {
      setActiveAction('openRecent')
      setErrorMessage(null)
      try {
        const result = await window.desktop.projects.openRecent({ projectId })
        if (result.project) setSnapshot({ state: 'open', activeProject: result.project })
        else await refreshLifecycle()
      } catch {
        setErrorMessage(actionErrorMessages.openRecent)
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
    setErrorMessage(null)
    try {
      const result = await window.desktop.projects.create({ name: parsedName.data })
      if (result.project) {
        setSnapshot({ state: 'open', activeProject: result.project })
        setProjectName('')
      } else {
        await refreshLifecycle()
      }
    } catch {
      setErrorMessage(actionErrorMessages.create)
      await refreshLifecycle()
    } finally {
      setActiveAction(null)
    }
  }, [projectName, refreshLifecycle])

  const closeProject = useCallback(async (): Promise<void> => {
    if (!projectSessionId) return
    setActiveAction('close')
    setErrorMessage(null)
    try {
      setSnapshot((current) => ({ ...current, state: 'closing' }))
      setSnapshot(await window.desktop.projects.close({ projectSessionId }))
      await refreshRecentProjects()
    } catch {
      setErrorMessage(actionErrorMessages.close)
      await refreshLifecycle()
    } finally {
      setActiveAction(null)
    }
  }, [projectSessionId, refreshLifecycle, refreshRecentProjects])

  const switchProject = useCallback(async (): Promise<void> => {
    if (!projectSessionId) return
    setActiveAction('switch')
    setErrorMessage(null)
    try {
      const result = await window.desktop.projects.switch({ projectSessionId })
      if (result.project) setSnapshot({ state: 'open', activeProject: result.project })
      else await refreshLifecycle()
    } catch {
      setErrorMessage(actionErrorMessages.switch)
      await refreshLifecycle()
    } finally {
      setActiveAction(null)
    }
  }, [projectSessionId, refreshLifecycle])

  const createSnapshot = useCallback(async (): Promise<void> => {
    if (!projectSessionId) return
    setActiveAction('snapshot')
    setErrorMessage(null)
    try {
      await window.desktop.projects.createSnapshot({ projectSessionId })
    } catch {
      setErrorMessage(actionErrorMessages.snapshot)
    } finally {
      setActiveAction(null)
    }
  }, [projectSessionId])

  const restoreSnapshot = useCallback(async (): Promise<void> => {
    setActiveAction('snapshot')
    setErrorMessage(null)
    try {
      const result = await window.desktop.projects.restoreSnapshot()
      if (result.project) setSnapshot({ state: 'open', activeProject: result.project })
      else await refreshLifecycle()
    } catch {
      setErrorMessage(actionErrorMessages.snapshot)
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
      setErrorMessage(null)
      try {
        const result = await action()
        if ('project' in result) {
          if (result.project) setSnapshot({ state: 'open', activeProject: result.project })
          else await refreshLifecycle()
        } else {
          setSnapshot(result)
        }
      } catch {
        setErrorMessage(actionErrorMessages.recovery)
        await refreshLifecycle()
      } finally {
        setActiveAction(null)
      }
    },
    [refreshLifecycle]
  )

  const exportRecoveryDiagnostics = useCallback(async (): Promise<void> => {
    setActiveAction('recovery')
    setErrorMessage(null)
    try {
      await window.desktop.projects.exportRecoveryDiagnostics()
    } catch {
      setErrorMessage(actionErrorMessages.recovery)
    } finally {
      setActiveAction(null)
    }
  }, [])

  const runDiagnostics = useCallback(async (action: () => Promise<unknown>): Promise<void> => {
    try {
      await action()
    } catch {
      setErrorMessage(actionErrorMessages.diagnostics)
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
  const recoveryKind = snapshot.recovery?.kind
  const recoveryIsLockContended =
    snapshot.recovery?.kind === 'open' && snapshot.recovery.reason === 'lock-contended'
  const showOpenRecovery = recoveryKind === undefined || recoveryKind === 'open'
  const showCloseRecovery = recoveryKind === undefined || recoveryKind === 'close'
  const showCreateRecovery = recoveryKind === undefined || recoveryKind === 'create'

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey)) return

      if (event.key === ',') {
        event.preventDefault()
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

  const errorAlert = errorMessage ? (
    <Alert variant='destructive' role='alert'>
      <AlertCircle />
      <AlertTitle>Action failed</AlertTitle>
      <AlertDescription className='flex items-center justify-between gap-4'>
        <span>{errorMessage}</span>
        <Button variant='outline' size='sm' onClick={() => setErrorMessage(null)}>
          Dismiss
        </Button>
      </AlertDescription>
    </Alert>
  ) : null

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
        onCreateSnapshot={() => void createSnapshot()}
        onRestoreSnapshot={() => void restoreSnapshot()}
        canRestoreSnapshot={snapshot.state === 'closed' || snapshot.state === 'recovery-required'}
        onClose={() => void closeProject()}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenLogs={() => void runDiagnostics(window.desktop.diagnostics.openLogsDirectory)}
        onToggleAgent={() => setAgentOpen(!agentOpen)}
      />

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
              globalAlert={errorAlert}
              agentOpen={agentOpen}
              onAgentOpenChange={setAgentOpen}
              onOpenSettings={() => setSettingsOpen(true)}
              onError={setErrorMessage}
            />
          ) : (
            <main className='flex min-h-0 flex-1 overflow-auto p-4 md:p-8' aria-busy={isBusy}>
              <div className='m-auto flex w-full max-w-xl flex-col gap-4'>
                {errorAlert}
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
                        <LoaderCircle className='size-5 animate-spin text-muted-foreground' />
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
                          <div className='mb-3 space-y-1'>
                            <h2 className='font-medium'>Recent projects</h2>
                            <p className='text-sm text-muted-foreground'>
                              Open one of your five most recently opened projects.
                            </p>
                          </div>
                          <div className='grid gap-2'>
                            {recentProjects.map((recentProject) => (
                              <Button
                                key={recentProject.projectId}
                                className='h-auto min-w-0 justify-start gap-3 px-3 py-3 text-left'
                                variant='ghost'
                                disabled={isBusy || projectSelectionDisabled}
                                aria-label={`Open ${recentProject.displayName}`}
                                onClick={() => void openRecentProject(recentProject.projectId)}
                              >
                                <FolderOpen className='size-4 shrink-0 text-muted-foreground' />
                                <span className='min-w-0 flex-1'>
                                  <span className='block truncate font-medium'>
                                    {recentProject.displayName}
                                  </span>
                                  <span
                                    className='block truncate text-xs text-muted-foreground'
                                    title={recentProject.projectPath}
                                  >
                                    {recentProject.projectPath}
                                  </span>
                                  <span className='block text-xs text-muted-foreground'>
                                    {formatRecentProjectDate(recentProject.lastOpenedAt)}
                                  </span>
                                </span>
                              </Button>
                            ))}
                          </div>
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
                            <LoaderCircle className='animate-spin' />
                          ) : (
                            <Plus />
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
                          onClick={() => setSettingsOpen(true)}
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
        onOpenChange={setSettingsOpen}
        onOpenLogs={() => void runDiagnostics(window.desktop.diagnostics.openLogsDirectory)}
        onExportDiagnostics={() => void runDiagnostics(window.desktop.diagnostics.exportBundle)}
        onError={setErrorMessage}
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
            className='grid gap-4'
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
            <div className='grid gap-2'>
              <label className='text-sm font-medium' htmlFor='project-name'>
                Project name
              </label>
              <div className='flex items-center gap-2'>
                <Input
                  id='project-name'
                  autoFocus
                  autoComplete='off'
                  value={projectName}
                  aria-invalid={projectNameError !== null}
                  aria-describedby={projectNameError ? 'project-name-error' : 'project-name-hint'}
                  onChange={(event) => {
                    setProjectName(event.target.value)
                    setProjectNameError(null)
                  }}
                  placeholder='My project'
                />
                <span className='shrink-0 text-sm text-muted-foreground'>.writellm</span>
              </div>
              <p
                id={projectNameError ? 'project-name-error' : 'project-name-hint'}
                className={
                  projectNameError ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'
                }
              >
                {projectNameError ?? 'WriteLLM creates a new folder with this name.'}
              </p>
            </div>
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
    </div>
  )
}

export default App
