import { dialog, ipcMain, type BrowserWindow, type IpcMain, type WebContents } from 'electron'
import type { Logger } from 'pino'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import {
  projectCreateInputSchema,
  projectLifecycleEventSchema,
  projectLifecycleSnapshotSchema,
  recentProjectOpenInputSchema,
  recentProjectsSchema,
  projectSelectionResultSchema,
  projectSessionInputSchema,
  type ProjectSessionId
} from '../../shared/contracts/projects'
import type { RecentProjectsRepository } from '../app-db/repositories/recent-projects'
import type { ProjectManager } from '../project/project-manager'
import { authorizeSender } from './authorize-sender'

export interface ProjectIpcMain extends Pick<IpcMain, 'handle' | 'removeHandler'> {}

export interface ProjectDialog {
  showOpenDialog(
    window: BrowserWindow,
    options: Electron.OpenDialogOptions
  ): Promise<Electron.OpenDialogReturnValue>
  showOpenDialog(options: Electron.OpenDialogOptions): Promise<Electron.OpenDialogReturnValue>
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

  const setProjectMaximized = (maximized: boolean): void => {
    const window = options.getWindow()
    if (window === null || window.isDestroyed()) return

    try {
      if (maximized) window.maximize()
      else window.unmaximize()
      options.logger.info(
        {
          event: maximized ? 'project_window.maximized' : 'project_window.unmaximized'
        },
        maximized ? 'Maximized project window' : 'Restored project window'
      )
    } catch (err) {
      options.logger.warn(
        { event: 'project_window.maximize.failed', err, maximized },
        'Could not update project window state; keeping the current window state'
      )
    }
  }

  ipc.handle(IPC_CHANNELS.projectGetLifecycle, (event) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    return projectLifecycleSnapshotSchema.parse(options.manager.snapshot())
  })

  ipc.handle(IPC_CHANNELS.projectGetRecent, async (event) => {
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

  ipc.handle(IPC_CHANNELS.projectCreate, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const { name } = projectCreateInputSchema.parse(input)
    assertClosedBeforeSelection()
    const parentDirectory = await selectFolder('create')
    if (parentDirectory === null) return projectSelectionResultSchema.parse({ project: null })
    try {
      const snapshot = projectLifecycleSnapshotSchema.parse(
        await options.manager.create({ parentDirectory, name })
      )
      setProjectMaximized(true)
      return projectSelectionResultSchema.parse({ project: snapshot.activeProject })
    } catch (err) {
      options.logger.error(
        { event: 'ipc.project_create.failed', err },
        'Project create request failed'
      )
      throw operationError('Unable to create the project')
    }
  })

  ipc.handle(IPC_CHANNELS.projectOpen, async (event) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    assertClosedBeforeSelection()
    const selectedRoot = await selectFolder('open')
    if (selectedRoot === null) return projectSelectionResultSchema.parse({ project: null })
    try {
      const snapshot = projectLifecycleSnapshotSchema.parse(
        await options.manager.open(selectedRoot)
      )
      setProjectMaximized(true)
      return projectSelectionResultSchema.parse({ project: snapshot.activeProject })
    } catch (err) {
      options.logger.error({ event: 'ipc.project_open.failed', err }, 'Project open request failed')
      throw operationError('Unable to open the project')
    }
  })

  ipc.handle(IPC_CHANNELS.projectOpenRecent, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const { projectId } = recentProjectOpenInputSchema.parse(input)
    assertClosedBeforeSelection()
    try {
      const recentProject = await options.recentProjects.find(projectId)
      if (recentProject === null) throw new Error('Recent project was not found')
      const snapshot = projectLifecycleSnapshotSchema.parse(
        await options.manager.open(recentProject.projectPath)
      )
      setProjectMaximized(true)
      return projectSelectionResultSchema.parse({ project: snapshot.activeProject })
    } catch (err) {
      options.logger.error(
        { event: 'ipc.project_open_recent.failed', err, projectId },
        'Recent project open request failed'
      )
      throw operationError('Unable to open the recent project')
    }
  })

  ipc.handle(IPC_CHANNELS.projectSwitch, async (event, input: unknown) => {
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
      setProjectMaximized(true)
      return projectSelectionResultSchema.parse({ project: snapshot.activeProject })
    } catch (err) {
      options.logger.error(
        { event: 'ipc.project_switch.failed', err, projectSessionId },
        'Project switch request failed'
      )
      throw operationError('Unable to switch projects')
    }
  })

  ipc.handle(IPC_CHANNELS.projectClose, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const { projectSessionId } = projectSessionInputSchema.parse(input)
    options.manager.assertActiveSession(projectSessionId)
    revokeSession(projectSessionId)
    try {
      const snapshot = projectLifecycleSnapshotSchema.parse(await options.manager.close())
      setProjectMaximized(false)
      return snapshot
    } catch (err) {
      options.logger.error(
        { event: 'ipc.project_close.failed', err, projectSessionId },
        'Project close request failed'
      )
      throw operationError('Unable to close the project')
    }
  })

  ipc.handle(IPC_CHANNELS.projectSubscribeLifecycle, (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const { projectSessionId } = projectSessionInputSchema.parse(input)
    options.manager.assertActiveSession(projectSessionId)
    subscriptions.set(event.sender.id, { sender: event.sender, projectSessionId })
    sendCurrent(event.sender, projectSessionId)
  })

  ipc.handle(IPC_CHANNELS.projectUnsubscribeLifecycle, (event, input: unknown) => {
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
      IPC_CHANNELS.projectSubscribeLifecycle,
      IPC_CHANNELS.projectUnsubscribeLifecycle
    ]) {
      ipc.removeHandler(channel)
    }
  }
}

const ipcMainAdapter: ProjectIpcMain = ipcMain
