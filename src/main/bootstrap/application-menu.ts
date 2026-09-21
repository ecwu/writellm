import { randomUUID } from 'node:crypto'
import { app, Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import type { Logger } from 'pino'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import {
  layoutPages,
  layoutTools,
  menuActions,
  menuActionVisible,
  menuCommandEnabled,
  menuCommandEventSchema,
  menuCommandId,
  menuStateSchema,
  type MenuAction,
  type MenuCommand,
  type MenuState
} from '../../shared/contracts/application-menu'
import type { ProjectLifecycleSnapshot } from '../../shared/contracts/projects'
import { authorizeSender } from '../ipc/authorize-sender'
import type { IpcMainHandleCarrier } from '../observability/ipc-context'
import { withLogContext } from '../observability/log-context'

interface Options {
  ipc: IpcMainHandleCarrier
  logger: Pick<Logger, 'info' | 'warn' | 'error'>
  developmentUrl?: string
  snapshot(): ProjectLifecycleSnapshot
  createWindow(): BrowserWindow
}

/** Main owns every template and validates the projection against the current window/session. */
export class ApplicationMenu {
  private window: BrowserWindow | null = null
  private state: MenuState | null = null
  private pending: MenuCommand | null = null
  private detach: (() => void) | null = null

  constructor(private readonly options: Options) {
    options.ipc.handle(IPC_CHANNELS.menuUpdate, (event, input) => {
      try {
        authorizeSender(event.senderFrame, options.developmentUrl)
        const window = this.window
        if (
          !window ||
          window.isDestroyed() ||
          event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame
        ) {
          throw new Error('Unauthorized menu sender')
        }
        const state = menuStateSchema.parse(input)
        const snapshot = options.snapshot()
        if (state.projectSessionId !== (snapshot.activeProject?.projectSessionId ?? null)) {
          return { accepted: false }
        }
        this.state = state
        this.updateTitle()
        this.render()
        if (this.pending && state.ready && !state.busy) {
          const command = this.pending
          this.pending = null
          this.dispatch(command)
        }
        return { accepted: true }
      } catch (err) {
        options.logger.error(
          { event: 'application_menu.update.failed', err },
          'Application menu update failed'
        )
        throw new Error('Application menu update failed', { cause: err })
      }
    })
    this.render()
    options.logger.info(
      { event: 'application_menu.installed' },
      'Installed native application menu'
    )
  }

  attach(window: BrowserWindow): void {
    this.detach?.()
    this.window = window
    const contents = window.webContents
    this.state = null
    const reset = () => {
      this.state = null
      this.render()
    }
    const navigating = (_event: unknown, _url: string, inPlace: boolean, mainFrame: boolean) => {
      if (mainFrame && !inPlace) reset()
    }
    const title = (event: Electron.Event) => {
      event.preventDefault()
      this.updateTitle()
    }
    const closed = () => {
      this.detach?.()
      this.detach = null
      this.window = null
      this.pending = null
      reset()
    }
    // Prevent Electron from dispatching the matching accelerator a second time. This also
    // handles keyboard input delivered directly to WebContents (including accessibility tools).
    const keyboard = (event: Electron.Event, input: Electron.Input) => {
      if (
        input.type !== 'keyDown' ||
        !input.meta ||
        input.control ||
        input.alt ||
        input.shift ||
        input.isComposing
      )
        return
      const shortcuts: Record<string, MenuAction> = {
        n: 'onCreate',
        o: 'onOpen',
        s: 'onSave',
        f: 'onOpenFind',
        ',': 'onOpenSettings',
        q: 'onQuit'
      }
      const action = shortcuts[input.key.toLowerCase()]
      if (!action) return
      event.preventDefault()
      if (!input.isAutoRepeat) this.dispatch({ kind: 'action', action })
    }
    contents.on('before-input-event', keyboard)
    contents.on('did-start-navigation', navigating)
    contents.on('render-process-gone', reset)
    window.on('page-title-updated', title)
    window.on('closed', closed)
    this.detach = () => {
      if (!contents.isDestroyed()) {
        contents.removeListener('before-input-event', keyboard)
        contents.removeListener('did-start-navigation', navigating)
        contents.removeListener('render-process-gone', reset)
      }
      window.removeListener('page-title-updated', title)
      window.removeListener('closed', closed)
    }
    this.updateTitle()
    this.render()
  }

  dispose(): void {
    this.detach?.()
    this.detach = null
    this.pending = null
    this.state = null
    this.options.ipc.removeHandler(IPC_CHANNELS.menuUpdate)
  }

  private updateTitle(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.setTitle(this.options.snapshot().activeProject?.displayName ?? 'WriteLLM')
    }
  }

  private dispatch(command: MenuCommand): void {
    const operationId = randomUUID()
    withLogContext({ operationId }, () => {
      try {
        if (!this.window || this.window.isDestroyed()) {
          if (command.kind === 'action' && command.action === 'onQuit') {
            app.quit()
            return
          }
          if (
            command.kind !== 'action' ||
            !['onCreate', 'onOpen', 'onOpenSettings'].includes(command.action)
          )
            return
          this.pending = command
          this.attach(this.options.createWindow())
          return
        }
        const state = this.state
        const snapshot = this.options.snapshot()
        if (
          !state ||
          !menuCommandEnabled(command, state) ||
          state.projectSessionId !== (snapshot.activeProject?.projectSessionId ?? null)
        )
          return
        // The projection is presentation state, never authority to operate on a closing project.
        if (state.hasProject && snapshot.state !== 'open' && command.kind !== 'action') return
        const event = menuCommandEventSchema.parse({
          command,
          projectSessionId: state.projectSessionId,
          operationId
        })
        this.options.logger.info(
          { event: 'application_menu.command.dispatched', commandId: menuCommandId(command) },
          'Dispatched native menu command'
        )
        this.window.webContents.send(IPC_CHANNELS.menuCommand, event)
      } catch (err) {
        this.options.logger.error(
          { event: 'application_menu.command.failed', err, commandId: menuCommandId(command) },
          'Native menu command failed'
        )
      }
    })
  }

  private render(): void {
    const state = this.state
    const windowless = !this.window || this.window.isDestroyed()
    const item = (
      command: MenuCommand,
      label: string,
      accelerator?: string
    ): MenuItemConstructorOptions => ({
      id: menuCommandId(command),
      label,
      ...(accelerator ? { accelerator } : {}),
      enabled: windowless
        ? command.kind === 'action' &&
          ['onCreate', 'onOpen', 'onOpenSettings', 'onQuit'].includes(command.action)
        : !!state && menuCommandEnabled(command, state),
      click: () => this.dispatch(command)
    })
    const action = (id: MenuAction): MenuItemConstructorOptions => {
      const definition = menuActions[id]
      return item(
        { kind: 'action', action: id },
        id === 'onOpenVersionHistory' && state?.versionHistoryState === 'damaged'
          ? 'Version history unavailable…'
          : definition.label,
        'accelerator' in definition ? definition.accelerator : undefined
      )
    }
    const projectActions = (Object.keys(menuActions) as MenuAction[]).filter(
      (id) =>
        ![
          'onQuit',
          'onOpenSettings',
          'onOpenLogs',
          'onOpenFind',
          'newNotebook',
          'resetLayout'
        ].includes(id) &&
        (state
          ? menuActionVisible(id, state)
          : !['onEnableVersionHistory', 'onCreateCheckpoint', 'onOpenVersionHistory'].includes(id))
    )
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: 'WriteLLM',
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            action('onOpenSettings'),
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            action('onQuit')
          ]
        },
        { label: 'Project', submenu: projectActions.map(action) },
        {
          label: 'Edit',
          submenu: [
            { role: 'undo' },
            { role: 'redo' },
            { type: 'separator' },
            { role: 'cut' },
            { role: 'copy' },
            { role: 'paste' },
            { role: 'pasteAndMatchStyle' },
            { role: 'delete' },
            { role: 'selectAll' },
            { type: 'separator' },
            action('onOpenFind')
          ]
        },
        {
          label: 'Layout',
          submenu: [
            ...Object.entries(layoutTools).map(([tool, label]) => ({
              ...item({ kind: 'tool', tool: tool as keyof typeof layoutTools }, label),
              type: 'checkbox' as const,
              checked: state?.layout?.tools.includes(tool as keyof typeof layoutTools) ?? false
            })),
            { type: 'separator' },
            ...Object.entries(layoutPages).map(([page, label]) => ({
              ...item({ kind: 'page', page: page as keyof typeof layoutPages }, label),
              type: 'checkbox' as const,
              checked: state?.layout?.pages.includes(page as keyof typeof layoutPages) ?? false
            })),
            action('newNotebook'),
            { type: 'separator' },
            action('resetLayout')
          ]
        },
        { label: 'Tools', submenu: [action('onOpenLogs')] },
        { role: 'windowMenu' }
      ])
    )
  }
}
