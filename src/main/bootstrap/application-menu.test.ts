import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import type { BrowserWindow, IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApplicationMenu } from './application-menu'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import {
  menuStateSchema,
  menuCommandSchema,
  menuCommandEnabled,
  type MenuState
} from '../../shared/contracts/application-menu'
import type { ProjectLifecycleSnapshot } from '../../shared/contracts/projects'

const electron = vi.hoisted(() => ({ template: [] as MenuItemConstructorOptions[], quit: vi.fn() }))
vi.mock('electron', () => ({
  app: { quit: electron.quit },
  Menu: {
    buildFromTemplate: (items: MenuItemConstructorOptions[]) => {
      electron.template = items
      return items
    },
    setApplicationMenu: vi.fn()
  }
}))
const closedState: MenuState = {
  projectSessionId: null,
  ready: true,
  busy: false,
  modal: false,
  projectSelectionDisabled: false,
  hasProject: false,
  canRestoreSnapshot: true,
  versionHistoryState: null,
  layout: null
}
function harness() {
  let snapshot = { state: 'closed', activeProject: null } as ProjectLifecycleSnapshot
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const windows: ReturnType<typeof fakeWindow>[] = []
  function fakeWindow() {
    const frame = { url: 'writellm://bundle/' }
    const webContents = Object.assign(new EventEmitter(), {
      mainFrame: frame,
      send: vi.fn(),
      isDestroyed: () => false
    })
    return Object.assign(new EventEmitter(), {
      webContents,
      setTitle: vi.fn(),
      isDestroyed: () => false
    })
  }
  const menu = new ApplicationMenu({
    ipc: {
      handle: (channel, fn) => {
        handlers.set(channel, fn)
      },
      removeHandler: (channel) => {
        handlers.delete(channel)
      }
    },
    logger,
    snapshot: () => snapshot,
    createWindow: () => {
      const w = fakeWindow()
      windows.push(w)
      return w as unknown as BrowserWindow
    }
  })
  const window = fakeWindow()
  menu.attach(window as unknown as BrowserWindow)
  const update = (
    state = closedState,
    sender: unknown = window.webContents,
    frame: unknown = window.webContents.mainFrame
  ) =>
    handlers.get(IPC_CHANNELS.menuUpdate)?.(
      { sender, senderFrame: frame } as IpcMainInvokeEvent,
      state
    )
  const item = (id: string) =>
    electron.template
      .flatMap((group) => (group.submenu ?? []) as MenuItemConstructorOptions[])
      .find((item) => item.id === id)
  const click = (id: string) => {
    const entry = item(id)
    if (!entry) throw new Error(`Missing menu item ${id}`)
    ;(entry.click as () => void)()
  }
  return {
    menu,
    window,
    windows,
    update,
    item,
    click,
    logger,
    handlers,
    setSnapshot: (value: ProjectLifecycleSnapshot) => {
      snapshot = value
    }
  }
}

describe('native application menu', () => {
  beforeEach(() => vi.clearAllMocks())
  it('rejects unknown commands, unbounded projections and arbitrary templates', () => {
    expect(
      menuCommandSchema.safeParse({ kind: 'action', action: 'executeJavaScript' }).success
    ).toBe(false)
    expect(menuStateSchema.safeParse({ ...closedState, template: [] }).success).toBe(false)
    expect(
      menuStateSchema.safeParse({ ...closedState, projectSessionId: '/private/project' }).success
    ).toBe(false)
  })
  it('renders fixed menus and gates project, modal and busy actions', () => {
    const h = harness()
    expect(electron.template.map((item) => item.label ?? item.role)).toEqual([
      'WriteLLM',
      'Project',
      'Edit',
      'Layout',
      'Tools',
      'windowMenu'
    ])
    expect(h.item('onOpen')?.enabled).toBe(false)
    h.update()
    expect(h.item('onOpen')?.enabled).toBe(true)
    expect(h.item('onSave')?.enabled).toBe(false)
    h.update({ ...closedState, modal: true })
    h.click('onOpen')
    expect(h.window.webContents.send).not.toHaveBeenCalled()
    h.update({ ...closedState, busy: true })
    expect(h.item('onOpen')?.enabled).toBe(false)
    expect(h.item('onOpenSettings')?.enabled).toBe(true)
  })
  it('rejects other origins, windows and child frames and logs the original error', () => {
    const h = harness()
    expect(() => h.update(closedState, h.window.webContents, { url: 'https://evil.test' })).toThrow(
      'Application menu update failed'
    )
    expect(() => h.update(closedState, {})).toThrow()
    expect(() =>
      h.update(closedState, h.window.webContents, { url: 'writellm://bundle/' })
    ).toThrow()
    expect(h.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.any(String)
    )
  })
  it('rejects expired sessions at update and at click, and titles from Main authority', () => {
    const h = harness()
    const id = randomUUID()
    h.setSnapshot({
      state: 'open',
      activeProject: { projectSessionId: id, displayName: 'Main project' }
    } as ProjectLifecycleSnapshot)
    expect(h.update()).toEqual({ accepted: false })
    h.update({
      ...closedState,
      projectSessionId: id,
      hasProject: true,
      projectSelectionDisabled: true
    })
    expect(h.window.setTitle).toHaveBeenLastCalledWith('Main project')
    h.click('onSave')
    expect(h.window.webContents.send).toHaveBeenCalledWith(
      IPC_CHANNELS.menuCommand,
      expect.objectContaining({
        projectSessionId: id,
        operationId: expect.any(String),
        command: { kind: 'action', action: 'onSave' }
      })
    )
    h.window.webContents.send.mockClear()
    h.setSnapshot({ state: 'closed', activeProject: null })
    h.click('onSave')
    expect(h.window.webContents.send).not.toHaveBeenCalled()
  })
  it('projects layout checks and history visibility without accepting action code', () => {
    const h = harness()
    h.update({
      ...closedState,
      hasProject: true,
      versionHistoryState: 'ready',
      layout: { tools: ['agent'], pages: ['knowledge'], canCreateNotebook: false }
    })
    expect(h.item('tool:agent')?.checked).toBe(true)
    expect(h.item('page:knowledge')?.checked).toBe(true)
    expect(h.item('onCreateCheckpoint')).toBeDefined()
    expect(h.item('onEnableVersionHistory')).toBeUndefined()
    expect(h.item('newNotebook')?.enabled).toBe(false)
  })
  it('invalidates state on reload/crash, restores a windowless command once, and unsubscribes', () => {
    const h = harness()
    h.update()
    h.window.webContents.emit('did-start-navigation', {}, 'writellm://bundle/', false, true)
    expect(h.item('onOpen')?.enabled).toBe(false)
    h.update()
    h.window.webContents.emit('render-process-gone')
    expect(h.item('onOpen')?.enabled).toBe(false)
    Object.defineProperty(h.window, 'webContents', {
      get() {
        throw new Error('Object has been destroyed')
      }
    })
    h.window.emit('closed')
    expect(h.window.listenerCount('page-title-updated')).toBe(0)
    h.click('onOpen')
    expect(h.windows).toHaveLength(1)
    const newWindow = h.windows[0]
    h.update(
      { ...closedState, ready: false },
      newWindow.webContents,
      newWindow.webContents.mainFrame
    )
    expect(newWindow.webContents.send).not.toHaveBeenCalled()
    h.update(closedState, newWindow.webContents, newWindow.webContents.mainFrame)
    h.update(closedState, newWindow.webContents, newWindow.webContents.mainFrame)
    expect(newWindow.webContents.send).toHaveBeenCalledTimes(1)
    h.menu.dispose()
    expect(h.handlers.size).toBe(0)
    expect(newWindow.listenerCount('closed')).toBe(0)
  })
  it('dispatches exact Command shortcuts once and suppresses repeats and composition', () => {
    const h = harness()
    h.update()
    const event = { preventDefault: vi.fn() }
    const key = {
      type: 'keyDown',
      key: 'n',
      meta: true,
      control: false,
      alt: false,
      shift: false,
      isAutoRepeat: false,
      isComposing: false
    }
    h.window.webContents.emit('before-input-event', event, key)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(h.window.webContents.send).toHaveBeenCalledOnce()
    for (const extra of [
      { shift: true },
      { alt: true },
      { control: true },
      { meta: false },
      { isComposing: true },
      { isAutoRepeat: true }
    ]) {
      h.window.webContents.emit('before-input-event', event, { ...key, ...extra })
    }
    expect(h.window.webContents.send).toHaveBeenCalledOnce()
  })
  it('allows windowless quit through the application shutdown path', () => {
    const h = harness()
    h.window.emit('closed')
    h.click('onQuit')
    expect(electron.quit).toHaveBeenCalledOnce()
  })
  it('requires a live layout for toggles and retains recovery restore', () => {
    expect(menuCommandEnabled({ kind: 'tool', tool: 'agent' }, closedState)).toBe(false)
    expect(menuCommandEnabled({ kind: 'action', action: 'onRestoreSnapshot' }, closedState)).toBe(
      true
    )
    expect(
      menuCommandEnabled(
        { kind: 'action', action: 'onRestoreSnapshot' },
        { ...closedState, busy: true }
      )
    ).toBe(false)
  })
})
