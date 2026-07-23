import { dialog, ipcMain, type BrowserWindow, type IpcMain, type WebContents } from 'electron'
import { basename, join } from 'node:path'
import type { Logger } from 'pino'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import {
  projectCreateInputSchema,
  projectLifecycleEventSchema,
  projectLifecycleSnapshotSchema,
  projectRecoveryActionInputSchema,
  recentProjectOpenInputSchema,
  recentProjectsSchema,
  projectSelectionResultSchema,
  projectSessionInputSchema,
  type ProjectSessionId
} from '../../shared/contracts/projects'
import type { RecentProjectsRepository } from '../app-db/repositories/recent-projects'
import type { ProjectManager } from '../project/project-manager'
import { authorizeSender } from './authorize-sender'
import { withIpcLogContext } from '../observability/ipc-context'

export interface ProjectIpcMain extends Pick<IpcMain, 'handle' | 'removeHandler'> {}

export interface ProjectDialog {
  showOpenDialog(
    window: BrowserWindow,
    options: Electron.OpenDialogOptions
  ): Promise<Electron.OpenDialogReturnValue>
  showOpenDialog(options: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue>
  showSaveDialog?(
    window: BrowserWindow,
    options: Electron.SaveDialogOptions
  ): Promise<Electron.SaveDialogReturnValue>
  showSaveDialog?(options: Electron.SaveDialogOptions): Promise<Electron.SaveDialogReturnValue>
}

export interface RegisterProjectIpcOptions {
  manager: ProjectManager
  recentProjects: Pick<RecentProjectsRepository, 'find' | 'list'>
  getWindow: () => BrowserWindow | null
  logger: Pick<Logger, 'info' | 'warn' | 'error'>
  developmentUrl?: string
  ipc?: ProjectIpcMain
  projectDialog?: ProjectDialog
  selectProjectFolderForTest?: () => Promise<string | null>
  selectSnapshotDestinationForTest?: () => Promise<string | null>
  selectRestoreSourceForTest?: () => Promise<string | null>
  selectRestoreDestinationParentForTest?: () => Promise<string | null>
}

const operationError = (message: string): Error => new Error(message)

export function registerProjectIpc(options: RegisterProjectIpcOptions): () => void {
  const ipc = options.ipc ?? ipcMainAdapter
  const projectDialog = options.projectDialog ?? dialog
  const subscriptions = new Map<
    number,
    { sender: WebContents; projectSessionId: ProjectSessionId }
  >()
  let projectDialogOpen = false
  const handle = (
    channel: string,
    handler: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
  ): void => {
    ipc.handle(channel, (event, ...args) =>
      withIpcLogContext(event, args[0], () => handler(event, ...args))
    )
  }

  const selectFolder = async (purpose: 'create' | 'open'): Promise<string | null> => {
    if (projectDialogOpen) throw new Error('A project folder dialog is already open')
    projectDialogOpen = true
    try {
      if (options.selectProjectFolderForTest) return await options.selectProjectFolderForTest()

      const owner = options.getWindow()
      const dialogOptions: Electron.OpenDialogOptions = {
        properties: purpose === 'create' ? ['openDirectory', 'createDirectory'] : ['openDirectory']
      }
      const result =
        owner === null
          ? await projectDialog.showOpenDialog(dialogOptions)
          : await projectDialog.showOpenDialog(owner, dialogOptions)
      if (result.canceled || result.filePaths.length === 0) return null
      return result.filePaths[0] ?? null
    } finally {
      projectDialogOpen = false
    }
  }

  const selectSnapshotDestination = async (): Promise<string | null> => {
    if (options.selectSnapshotDestinationForTest) {
      return options.selectSnapshotDestinationForTest()
    }
    if (projectDialog.showSaveDialog === undefined) return selectFolder('open')
    const owner = options.getWindow()
    const dialogOptions: Electron.SaveDialogOptions = {
      defaultPath: 'WriteLLM Snapshot',
      properties: ['createDirectory']
    }
    const result =
      owner === null
        ? await projectDialog.showSaveDialog(dialogOptions)
        : await projectDialog.showSaveDialog(owner, dialogOptions)
    return result.canceled ? null : (result.filePath ?? null)
  }

  const selectRestoreSource = async (): Promise<string | null> => {
    if (options.selectRestoreSourceForTest) return options.selectRestoreSourceForTest()
    return selectFolder('open')
  }

  const selectRestoreDestinationParent = async (): Promise<string | null> => {
    if (options.selectRestoreDestinationParentForTest) {
      return options.selectRestoreDestinationParentForTest()
    }
    return selectFolder('open')
  }

  const assertClosedBeforeSelection = (): void => {
    if (options.manager.snapshot().state !== 'closed') {
      throw new Error('Project selection is unavailable in the current state')
    }
  }

  const revokeSession = (projectSessionId: ProjectSessionId): void => {
    for (const [senderId, subscription] of subscriptions) {
      if (subscription.projectSessionId === projectSessionId) subscriptions.delete(senderId)
    }
  }

  const sendCurrent = (sender: WebContents, projectSessionId: ProjectSessionId): void => {
    options.manager.assertActiveSession(projectSessionId)
    const event = projectLifecycleEventSchema.parse({
      projectSessionId,
      snapshot: options.manager.snapshot()
    })
    options.manager.assertActiveSession(projectSessionId)
    sender.send(IPC_CHANNELS.projectLifecycleEvent, event)
  }

  handle(IPC_CHANNELS.projectGetLifecycle, (event) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    return projectLifecycleSnapshotSchema.parse(options.manager.snapshot())
  })

  handle(IPC_CHANNELS.projectGetRecent, async (event) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    try {
      const recentProjects = await options.recentProjects.list()
      return recentProjectsSchema.parse(recentProjects.slice(0, 5))
    } catch (err) {
      options.logger.error(
        { event: 'ipc.project_recent_list.failed', err },
        'Failed to load recent projects'
      )
      throw operationError('Unable to load recent projects')
    }
  })

  handle(IPC_CHANNELS.projectCreate, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const { name } = projectCreateInputSchema.parse(input)
    assertClosedBeforeSelection()
    const parentDirectory = await selectFolder('create')
    if (parentDirectory === null) return projectSelectionResultSchema.parse({ project: null })
    try {
      const snapshot = projectLifecycleSnapshotSchema.parse(
        await options.manager.create({ parentDirectory, name })
      )
      return projectSelectionResultSchema.parse({ project: snapshot.activeProject })
    } catch (err) {
      options.logger.error(
        { event: 'ipc.project_create.failed', err },
        'Project create request failed'
      )
      throw operationError('Unable to create the project')
    }
  })

  handle(IPC_CHANNELS.projectOpen, async (event) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    assertClosedBeforeSelection()
    const selectedRoot = await selectFolder('open')
    if (selectedRoot === null) return projectSelectionResultSchema.parse({ project: null })
    try {
      const snapshot = projectLifecycleSnapshotSchema.parse(
        await options.manager.open(selectedRoot)
      )
      return projectSelectionResultSchema.parse({ project: snapshot.activeProject })
    } catch (err) {
      options.logger.error({ event: 'ipc.project_open.failed', err }, 'Project open request failed')
      throw operationError('Unable to open the project')
    }
  })

  handle(IPC_CHANNELS.projectOpenRecent, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const { projectId } = recentProjectOpenInputSchema.parse(input)
    assertClosedBeforeSelection()
    try {
      const recentProject = await options.recentProjects.find(projectId)
      if (recentProject === null) throw new Error('Recent project was not found')
      const snapshot = projectLifecycleSnapshotSchema.parse(
        await options.manager.open(recentProject.projectPath)
      )
      return projectSelectionResultSchema.parse({ project: snapshot.activeProject })
    } catch (err) {
      options.logger.error(
        { event: 'ipc.project_open_recent.failed', err, projectId },
        'Recent project open request failed'
      )
      throw operationError('Unable to open the recent project')
    }
  })

  handle(IPC_CHANNELS.projectSwitch, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const { projectSessionId } = projectSessionInputSchema.parse(input)
    options.manager.assertActiveSession(projectSessionId)
    const selectedRoot = await selectFolder('open')
    options.manager.assertActiveSession(projectSessionId)
    if (selectedRoot === null) return projectSelectionResultSchema.parse({ project: null })
    revokeSession(projectSessionId)
    try {
      const snapshot = projectLifecycleSnapshotSchema.parse(
        await options.manager.switch(selectedRoot)
      )
      return projectSelectionResultSchema.parse({ project: snapshot.activeProject })
    } catch (err) {
      options.logger.error(
        { event: 'ipc.project_switch.failed', err, projectSessionId },
        'Project switch request failed'
      )
      throw operationError('Unable to switch projects')
    }
  })

  handle(IPC_CHANNELS.projectClose, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const { projectSessionId } = projectSessionInputSchema.parse(input)
    options.manager.assertActiveSession(projectSessionId)
    revokeSession(projectSessionId)
    try {
      const snapshot = projectLifecycleSnapshotSchema.parse(await options.manager.close())
      return snapshot
    } catch (err) {
      options.logger.error(
        { event: 'ipc.project_close.failed', err, projectSessionId },
        'Project close request failed'
      )
      throw operationError('Unable to close the project')
    }
  })

  handle(IPC_CHANNELS.projectRecoveryRetryOpen, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    projectRecoveryActionInputSchema.parse(input)
    try {
      return projectLifecycleSnapshotSchema.parse(await options.manager.retryOpen())
    } catch (err) {
      options.logger.error(
        { event: 'ipc.project_recovery.retry_open.failed', err },
        'Project open retry failed'
      )
      throw operationError('Unable to retry opening the project')
    }
  })

  handle(IPC_CHANNELS.projectRecoveryStaleLock, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    projectRecoveryActionInputSchema.parse(input)
    try {
      return projectLifecycleSnapshotSchema.parse(
        await options.manager.recoverStaleLockAndRetryOpen()
      )
    } catch (err) {
      options.logger.error(
        { event: 'ipc.project_recovery.stale_lock.failed', err },
        'Stale project lock recovery failed'
      )
      throw operationError('Unable to recover the stale project lock')
    }
  })

  handle(IPC_CHANNELS.projectRecoveryRetryClose, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    projectRecoveryActionInputSchema.parse(input)
    try {
      return projectLifecycleSnapshotSchema.parse(await options.manager.retryClose())
    } catch (err) {
      options.logger.error(
        { event: 'ipc.project_recovery.retry_close.failed', err },
        'Project close retry failed'
      )
      throw operationError('Unable to retry closing the project')
    }
  })

  handle(IPC_CHANNELS.projectRecoveryDiscardIncompleteCreate, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    projectRecoveryActionInputSchema.parse(input)
    try {
      return projectLifecycleSnapshotSchema.parse(await options.manager.discardIncompleteCreate())
    } catch (err) {
      options.logger.error(
        { event: 'ipc.project_recovery.discard_create.failed', err },
        'Incomplete project discard failed'
      )
      throw operationError('Unable to discard the incomplete project')
    }
  })

  handle(IPC_CHANNELS.projectRecoveryLocateMoved, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    projectRecoveryActionInputSchema.parse(input)
    const selectedRoot = await selectRestoreSource()
    if (selectedRoot === null) return projectSelectionResultSchema.parse({ project: null })
    try {
      const snapshot = await options.manager.locateMovedProject(selectedRoot)
      return projectSelectionResultSchema.parse({ project: snapshot.activeProject })
    } catch (err) {
      options.logger.error(
        { event: 'ipc.project_recovery.locate_moved.failed', err },
        'Moved project recovery failed'
      )
      throw operationError('Unable to open the located project')
    }
  })

  handle(IPC_CHANNELS.projectRecoveryExportDiagnostics, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    projectRecoveryActionInputSchema.parse(input)
    try {
      return await options.manager.exportDiagnostics()
    } catch (err) {
      options.logger.error(
        { event: 'ipc.project_recovery.export_diagnostics.failed', err },
        'Recovery diagnostics export failed'
      )
      throw operationError('Unable to export recovery diagnostics')
    }
  })

  handle(IPC_CHANNELS.projectRecoveryReturnToClosed, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    projectRecoveryActionInputSchema.parse(input)
    try {
      return projectLifecycleSnapshotSchema.parse(await options.manager.returnToClosed())
    } catch (err) {
      options.logger.error(
        { event: 'ipc.project_recovery.return_closed.failed', err },
        'Recovery return-to-closed failed'
      )
      throw operationError('Unable to return to the closed state')
    }
  })

  handle(IPC_CHANNELS.projectSnapshotCreate, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const { projectSessionId } = projectSessionInputSchema.parse(input)
    options.manager.assertActiveSession(projectSessionId)
    const destination = await selectSnapshotDestination()
    if (destination === null) return { created: false }
    try {
      await options.manager.createSnapshot(projectSessionId, destination)
      return { created: true }
    } catch (err) {
      options.logger.error(
        { event: 'ipc.project_snapshot.create.failed', err, projectSessionId },
        'Project snapshot creation failed'
      )
      throw operationError('Unable to create the project snapshot')
    }
  })

  handle(IPC_CHANNELS.projectSnapshotRestore, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    projectRecoveryActionInputSchema.parse(input)
    const source = await selectRestoreSource()
    if (source === null) return projectSelectionResultSchema.parse({ project: null })
    const parent = await selectRestoreDestinationParent()
    if (parent === null) return projectSelectionResultSchema.parse({ project: null })
    try {
      const destination = join(parent, `${basename(source)}.writellm`)
      const snapshot = await options.manager.restoreSnapshot({ snapshotRoot: source, destination })
      return projectSelectionResultSchema.parse({ project: snapshot.activeProject })
    } catch (err) {
      options.logger.error(
        { event: 'ipc.project_snapshot.restore.failed', err },
        'Project snapshot restore failed'
      )
      throw operationError('Unable to restore the project snapshot')
    }
  })

  handle(IPC_CHANNELS.projectSubscribeLifecycle, (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const { projectSessionId } = projectSessionInputSchema.parse(input)
    options.manager.assertActiveSession(projectSessionId)
    subscriptions.set(event.sender.id, { sender: event.sender, projectSessionId })
    sendCurrent(event.sender, projectSessionId)
  })

  handle(IPC_CHANNELS.projectUnsubscribeLifecycle, (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const { projectSessionId } = projectSessionInputSchema.parse(input)
    const subscription = subscriptions.get(event.sender.id)
    if (subscription?.projectSessionId === projectSessionId) subscriptions.delete(event.sender.id)
  })

  return () => {
    subscriptions.clear()
    for (const channel of [
      IPC_CHANNELS.projectGetLifecycle,
      IPC_CHANNELS.projectGetRecent,
      IPC_CHANNELS.projectCreate,
      IPC_CHANNELS.projectOpen,
      IPC_CHANNELS.projectOpenRecent,
      IPC_CHANNELS.projectSwitch,
      IPC_CHANNELS.projectClose,
      IPC_CHANNELS.projectRecoveryRetryOpen,
      IPC_CHANNELS.projectRecoveryStaleLock,
      IPC_CHANNELS.projectRecoveryRetryClose,
      IPC_CHANNELS.projectRecoveryDiscardIncompleteCreate,
      IPC_CHANNELS.projectRecoveryLocateMoved,
      IPC_CHANNELS.projectRecoveryExportDiagnostics,
      IPC_CHANNELS.projectRecoveryReturnToClosed,
      IPC_CHANNELS.projectSnapshotCreate,
      IPC_CHANNELS.projectSnapshotRestore,
      IPC_CHANNELS.projectSubscribeLifecycle,
      IPC_CHANNELS.projectUnsubscribeLifecycle
    ]) {
      ipc.removeHandler(channel)
    }
  }
}

const ipcMainAdapter: ProjectIpcMain = ipcMain
