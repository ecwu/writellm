import type { IpcMainInvokeEvent, OpenDialogReturnValue, SaveDialogReturnValue } from 'electron'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import type { RecentProjectPointer } from '../app-db/repositories/recent-projects'
import { registerProjectIpc, type ProjectIpcMain } from './project-ipc'

const sessionId = '11111111-1111-4111-8111-111111111111'
const projectId = '22222222-2222-4222-8222-222222222222'
const openSnapshot = {
  state: 'open' as const,
  activeProject: {
    projectId,
    projectSessionId: sessionId,
    displayName: 'Safe project',
    indexRebuildRequired: false
  }
}
const closedSnapshot = { state: 'closed' as const, activeProject: null }
const publicationOptions = {
  schemaVersion: 1 as const,
  pageSize: 'A4' as const,
  marginsMm: { top: 25, right: 25, bottom: 25, left: 25 },
  template: 'academic' as const,
  includeTableOfContents: true,
  includeReferences: true,
  mermaidFallback: 'rendered' as const
}

function harness(snapshot = closedSnapshot as typeof closedSnapshot | typeof openSnapshot) {
  const handlers = new Map<string, (...args: never[]) => unknown>()
  const ipc: ProjectIpcMain = {
    handle: vi.fn((channel, handler) => {
      handlers.set(channel, handler as (...args: never[]) => unknown)
    }),
    removeHandler: vi.fn()
  }
  const manager = {
    snapshot: vi.fn(() => snapshot),
    create: vi.fn(async () => openSnapshot),
    open: vi.fn(async () => openSnapshot),
    recoverStaleLockAndRetryOpen: vi.fn(async () => openSnapshot),
    close: vi.fn(async () => closedSnapshot),
    switch: vi.fn(async () => openSnapshot),
    cloneProject: vi.fn(async () => openSnapshot),
    cancelProjectClone: vi.fn(() => ({ cancelled: true })),
    applyTemplate: vi.fn(async () => openSnapshot),
    previewTemplateExtraction: vi.fn(async () => ({
      briefFields: ['language'],
      outlineTitles: ['Opening'],
      writingRuleCount: 1,
      publicationPresetId: 'builtin:academic-a4',
      excluded: ['Manuscript bodies']
    })),
    extractTemplate: vi.fn(async () => ({ templateId: 'template' })),
    assertActiveSession: vi.fn((value: string) => {
      if (value !== sessionId || snapshot.state !== 'open') throw new Error('stale')
      return { manifest: { projectId }, displayName: 'Safe project' }
    }),
    versionHistoryState: vi.fn(async () => 'ready' as const),
    enableVersionHistory: vi.fn(),
    reinitializeVersionHistory: vi.fn(),
    createCheckpoint: vi.fn(async () => ({
      oid: 'a'.repeat(40),
      name: 'Milestone',
      createdAt: '2026-07-29T00:00:00.000Z',
      parentOid: null,
      stateSha256: 'b'.repeat(64),
      fileCount: 2,
      totalBytes: 10
    })),
    listCheckpoints: vi.fn(async () => ({ checkpoints: [], nextCursor: null })),
    compareCheckpointState: vi.fn(async () => ({
      status: 'up-to-date' as const,
      headOid: 'a'.repeat(40)
    })),
    restoreCheckpoint: vi.fn(),
    exportManuscript: vi.fn(async (_sessionId: string, _destination: string, kind: string) => ({
      packageName: 'Safe project export',
      manifest: {
        content: { sha256: 'c'.repeat(64) },
        assetCount: 0
      },
      ...(kind === 'native' ? {} : { lossReport: { formatVersion: 1, losses: [] } })
    })),
    cancelManuscriptExport: vi.fn(() => ({ cancelled: true }))
  }
  const recentProjects = {
    list: vi.fn(async (): Promise<RecentProjectPointer[]> => []),
    find: vi.fn(async (): Promise<RecentProjectPointer | null> => null)
  }
  const projectTemplates = {
    list: vi.fn(async () => []),
    resolve: vi.fn(),
    create: vi.fn(async () => []),
    delete: vi.fn(async () => []),
    mintId: vi.fn(() => '33333333-3333-4333-8333-333333333333')
  }
  const projectDialog = {
    showOpenDialog: vi.fn(
      async (): Promise<OpenDialogReturnValue> => ({
        canceled: true,
        filePaths: []
      })
    ),
    showSaveDialog: vi.fn(
      async (): Promise<SaveDialogReturnValue> => ({
        canceled: true,
        filePath: ''
      })
    )
  }
  const window = {
    isDestroyed: vi.fn(() => false),
    maximize: vi.fn(),
    unmaximize: vi.fn()
  }
  registerProjectIpc({
    manager: manager as never,
    recentProjects,
    publicationPresets: {
      resolve: vi.fn(() => publicationOptions),
      snapshot: vi.fn(() => ({ defaultPresetId: 'builtin:academic-a4' }))
    } as never,
    projectTemplates,
    getWindow: () => window as never,
    logger: pino({ level: 'silent' }),
    developmentUrl: 'http://localhost:5173',
    ipc,
    projectDialog
  })
  const sender = { id: 4, send: vi.fn() }
  const event = {
    sender,
    senderFrame: { url: 'http://localhost:5173/' }
  } as unknown as IpcMainInvokeEvent
  const invoke = (channel: string, input?: unknown) =>
    handlers.get(channel)?.(event as never, input as never)
  return { invoke, manager, projectDialog, projectTemplates, recentProjects, sender, window }
}

describe('project IPC', () => {
  it('validates checkpoint input and never accepts renderer paths', async () => {
    const { invoke, manager } = harness(openSnapshot)
    await expect(
      invoke(IPC_CHANNELS.projectHistoryCreateCheckpoint, {
        projectSessionId: sessionId,
        name: ' Milestone '
      })
    ).resolves.toMatchObject({ checkpoint: { name: 'Milestone' } })
    expect(manager.createCheckpoint).toHaveBeenCalledWith(sessionId, { name: 'Milestone' })
    await expect(
      invoke(IPC_CHANNELS.projectHistoryCreateCheckpoint, {
        projectSessionId: sessionId,
        name: 'Bad',
        gitdir: '/private/history.git'
      })
    ).rejects.toThrow()
  })

  it('authorizes before opening a native dialog', async () => {
    const { invoke, projectDialog } = harness()
    const unauthorized = {
      sender: { id: 9 },
      senderFrame: { url: 'https://attacker.invalid/' }
    } as unknown as IpcMainInvokeEvent
    const handlers = new Map<string, (...args: never[]) => unknown>()
    registerProjectIpc({
      manager: {} as never,
      recentProjects: {
        list: vi.fn(async (): Promise<RecentProjectPointer[]> => []),
        find: vi.fn(async (): Promise<RecentProjectPointer | null> => null)
      },
      publicationPresets: {
        resolve: vi.fn(() => publicationOptions),
        snapshot: vi.fn(() => ({ defaultPresetId: 'builtin:academic-a4' }))
      } as never,
      projectTemplates: {
        list: vi.fn(async () => []),
        resolve: vi.fn(),
        create: vi.fn(async () => []),
        delete: vi.fn(async () => []),
        mintId: vi.fn()
      },
      getWindow: () => null,
      logger: pino({ level: 'silent' }),
      developmentUrl: 'http://localhost:5173',
      ipc: {
        handle: (channel, handler) => handlers.set(channel, handler as never),
        removeHandler: vi.fn()
      },
      projectDialog
    })

    await expect(
      Promise.resolve(handlers.get(IPC_CHANNELS.projectOpen)?.(unauthorized as never))
    ).rejects.toThrow('Unauthorized IPC sender')
    expect(projectDialog.showOpenDialog).not.toHaveBeenCalled()
    expect(invoke).toBeTypeOf('function')
  })

  it('treats picker cancellation as a path-free unchanged snapshot', async () => {
    const { invoke, manager } = harness()
    const result = await invoke(IPC_CHANNELS.projectCreate, { name: 'Canceled project' })

    expect(result).toEqual({ project: null })
    expect(manager.create).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toMatch(/[/\\]Users[/\\]/)
  })

  it('passes a validated name and Main-selected parent to the manager', async () => {
    const { invoke, manager, projectDialog } = harness()
    projectDialog.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/private/non-empty-parent']
    })

    await invoke(IPC_CHANNELS.projectCreate, { name: ' Named project ' })

    expect(manager.create).toHaveBeenCalledWith({
      parentDirectory: '/private/non-empty-parent',
      name: 'Named project'
    })
  })

  it('rejects an invalid project name before opening a native dialog', async () => {
    const { invoke, manager, projectDialog } = harness()

    await expect(invoke(IPC_CHANNELS.projectCreate, { name: '../escape' })).rejects.toThrow()
    expect(projectDialog.showOpenDialog).not.toHaveBeenCalled()
    expect(manager.create).not.toHaveBeenCalled()
  })

  it('passes a selected folder only from Main dialog to the manager', async () => {
    const { invoke, manager, projectDialog, window } = harness()
    projectDialog.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/private/renderer-must-not-see']
    })

    const result = await invoke(IPC_CHANNELS.projectOpen)

    expect(manager.open).toHaveBeenCalledWith('/private/renderer-must-not-see')
    expect(JSON.stringify(result)).not.toContain('/private/renderer-must-not-see')
    expect(window.maximize).not.toHaveBeenCalled()
    expect(window.unmaximize).not.toHaveBeenCalled()
  })

  it('keeps whole-manuscript destinations in Main and returns bounded completion metadata', async () => {
    const { invoke, manager, projectDialog } = harness(openSnapshot)
    projectDialog.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: '/private/renderer-must-not-receive/export'
    })

    const result = await invoke(IPC_CHANNELS.projectManuscriptExport, {
      projectSessionId: sessionId,
      kind: 'markdown'
    })

    expect(manager.exportManuscript).toHaveBeenCalledWith(
      sessionId,
      '/private/renderer-must-not-receive/export',
      'markdown',
      undefined
    )
    expect(result).toEqual({
      created: true,
      kind: 'markdown',
      packageName: 'Safe project export',
      contentSha256: 'c'.repeat(64),
      assetCount: 0,
      lossReport: { formatVersion: 1, losses: [] }
    })
    expect(JSON.stringify(result)).not.toContain('/private/')
  })

  it('treats whole-manuscript picker cancellation as a no-op', async () => {
    const { invoke, manager } = harness(openSnapshot)
    await expect(
      invoke(IPC_CHANNELS.projectManuscriptExport, {
        projectSessionId: sessionId,
        kind: 'native'
      })
    ).resolves.toEqual({ created: false, kind: 'native' })
    expect(manager.exportManuscript).not.toHaveBeenCalled()
  })

  it('routes Word exports through a Main-owned destination and returns only safe metadata', async () => {
    const { invoke, manager, projectDialog } = harness(openSnapshot)
    projectDialog.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: '/private/renderer-must-not-receive/word-export'
    })

    const result = await invoke(IPC_CHANNELS.projectManuscriptExport, {
      projectSessionId: sessionId,
      kind: 'docx'
    })

    expect(manager.exportManuscript).toHaveBeenCalledWith(
      sessionId,
      '/private/renderer-must-not-receive/word-export',
      'docx',
      publicationOptions
    )
    expect(result).toMatchObject({ created: true, kind: 'docx', assetCount: 0 })
    expect(JSON.stringify(result)).not.toContain('/private/')
  })

  it('routes LaTeX exports without exposing the selected destination', async () => {
    const { invoke, manager, projectDialog } = harness(openSnapshot)
    projectDialog.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: '/private/renderer-must-not-receive/latex-export'
    })

    const result = await invoke(IPC_CHANNELS.projectManuscriptExport, {
      projectSessionId: sessionId,
      kind: 'latex'
    })

    expect(manager.exportManuscript).toHaveBeenCalledWith(
      sessionId,
      '/private/renderer-must-not-receive/latex-export',
      'latex',
      publicationOptions
    )
    expect(result).toMatchObject({ created: true, kind: 'latex', assetCount: 0 })
    expect(JSON.stringify(result)).not.toContain('/private/')
  })

  it('routes PDF exports without exposing the selected destination', async () => {
    const { invoke, manager, projectDialog } = harness(openSnapshot)
    projectDialog.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: '/private/renderer-must-not-receive/pdf-export'
    })

    const result = await invoke(IPC_CHANNELS.projectManuscriptExport, {
      projectSessionId: sessionId,
      kind: 'pdf'
    })

    expect(manager.exportManuscript).toHaveBeenCalledWith(
      sessionId,
      '/private/renderer-must-not-receive/pdf-export',
      'pdf',
      publicationOptions
    )
    expect(result).toMatchObject({ created: true, kind: 'pdf', assetCount: 0 })
    expect(JSON.stringify(result)).not.toContain('/private/')
  })

  it('authorizes and routes manuscript export cancellation to the active session', async () => {
    const { invoke, manager } = harness(openSnapshot)

    expect(
      invoke(IPC_CHANNELS.projectManuscriptExportCancel, { projectSessionId: sessionId })
    ).toEqual({ cancelled: true })
    expect(manager.cancelManuscriptExport).toHaveBeenCalledWith(sessionId)
  })

  it('selects clone destinations in Main, switches only after publication, and routes cancellation', async () => {
    const { invoke, manager, projectDialog } = harness(openSnapshot)
    projectDialog.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: '/private/Safe project copy'
    })

    await expect(
      invoke(IPC_CHANNELS.projectClone, { projectSessionId: sessionId })
    ).resolves.toEqual({ project: openSnapshot.activeProject })
    expect(manager.cloneProject).toHaveBeenCalledWith(
      sessionId,
      '/private/Safe project copy.writellm'
    )
    expect(invoke(IPC_CHANNELS.projectCloneCancel, { projectSessionId: sessionId })).toEqual({
      cancelled: true
    })
    expect(manager.cancelProjectClone).toHaveBeenCalledWith(sessionId)
  })

  it('resolves built-ins before creation and keeps user-template extraction path-free', async () => {
    const { invoke, manager, projectDialog, projectTemplates } = harness()
    const templateId = '44444444-4444-4444-8444-444444444444'
    const template = { templateId }
    projectTemplates.resolve.mockResolvedValue(template as never)
    projectDialog.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/private/template-projects']
    })

    await invoke(IPC_CHANNELS.projectCreate, { name: 'Templated', templateId })
    expect(projectTemplates.resolve).toHaveBeenCalledWith(templateId)
    expect(manager.applyTemplate).toHaveBeenCalledWith(sessionId, template)

    const active = harness(openSnapshot)
    await expect(
      active.invoke(IPC_CHANNELS.projectTemplatePreview, { projectSessionId: sessionId })
    ).resolves.toMatchObject({ outlineTitles: ['Opening'] })
    await expect(
      active.invoke(IPC_CHANNELS.projectTemplateSave, {
        projectSessionId: sessionId,
        name: 'Reusable',
        description: '',
        includePublicationPreset: false
      })
    ).resolves.toEqual([])
    expect(active.manager.extractTemplate).toHaveBeenCalledWith(
      sessionId,
      expect.objectContaining({ publicationPresetId: null })
    )
    expect(JSON.stringify(active.manager.extractTemplate.mock.calls)).not.toContain('/private/')
  })

  it('does not override window state during project lifecycle transitions', async () => {
    const creating = harness()
    creating.projectDialog.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/private/create-parent']
    })

    await creating.invoke(IPC_CHANNELS.projectCreate, { name: 'Created project' })

    const switching = harness(openSnapshot)
    switching.projectDialog.showOpenDialog.mockResolvedValue({
      canceled: false,
      filePaths: ['/private/switch-target']
    })
    await switching.invoke(IPC_CHANNELS.projectSwitch, { projectSessionId: sessionId })

    const closing = harness(openSnapshot)
    await closing.invoke(IPC_CHANNELS.projectClose, { projectSessionId: sessionId })

    for (const window of [creating.window, switching.window, closing.window]) {
      expect(window.maximize).not.toHaveBeenCalled()
      expect(window.unmaximize).not.toHaveBeenCalled()
    }
  })

  it('returns at most five recent projects', async () => {
    const { invoke, recentProjects } = harness()
    recentProjects.list.mockResolvedValue(
      Array.from({ length: 6 }, (_, index) => ({
        projectId: `22222222-2222-4222-8222-22222222222${index}`,
        projectPath: `/private/project-${index}`,
        displayName: `Project ${index}`,
        lastOpenedAt: `2026-07-14T1${index}:00:00.000Z`
      }))
    )

    const result = await invoke(IPC_CHANNELS.projectGetRecent)

    expect(result).toHaveLength(5)
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ projectId: '22222222-2222-4222-8222-222222222220' })
      ])
    )
  })

  it('opens a recent project by stable project ID through Main-owned path lookup', async () => {
    const { invoke, manager, recentProjects } = harness()
    recentProjects.find.mockResolvedValue({
      projectId,
      projectPath: '/private/recent-project',
      displayName: 'Recent project',
      lastOpenedAt: '2026-07-14T12:00:00.000Z'
    })

    const result = await invoke(IPC_CHANNELS.projectOpenRecent, { projectId })

    expect(recentProjects.find).toHaveBeenCalledWith(projectId)
    expect(manager.open).toHaveBeenCalledWith('/private/recent-project')
    expect(result).toEqual({ project: openSnapshot.activeProject })
    expect(JSON.stringify(result)).not.toContain('/private/recent-project')
  })

  it('rejects a missing recent project without opening it', async () => {
    const { invoke, manager } = harness()

    await expect(invoke(IPC_CHANNELS.projectOpenRecent, { projectId })).rejects.toThrow(
      'recent project'
    )
    expect(manager.open).not.toHaveBeenCalled()
  })

  it('exposes stale-lock recovery without accepting a path or owner token', async () => {
    const { invoke, manager } = harness()

    const result = await invoke(IPC_CHANNELS.projectRecoveryStaleLock, {})

    expect(manager.recoverStaleLockAndRetryOpen).toHaveBeenCalledOnce()
    expect(result).toEqual(openSnapshot)
    await expect(
      invoke(IPC_CHANNELS.projectRecoveryStaleLock, {
        projectRoot: '/private/project',
        ownerToken: projectId
      })
    ).rejects.toThrow()
  })

  it('rejects create and open before showing a dialog unless the manager is closed', async () => {
    const { invoke, manager, projectDialog } = harness(openSnapshot)

    await expect(invoke(IPC_CHANNELS.projectCreate, { name: 'Blocked' })).rejects.toThrow(
      'unavailable'
    )
    await expect(invoke(IPC_CHANNELS.projectOpen)).rejects.toThrow('unavailable')
    expect(projectDialog.showOpenDialog).not.toHaveBeenCalled()
    expect(manager.create).not.toHaveBeenCalled()
    expect(manager.open).not.toHaveBeenCalled()
  })

  it('allows only one project folder dialog at a time', async () => {
    const { invoke, projectDialog } = harness()
    let resolveDialog: ((value: OpenDialogReturnValue) => void) | undefined
    projectDialog.showOpenDialog.mockImplementation(
      () =>
        new Promise<OpenDialogReturnValue>((resolve) => {
          resolveDialog = resolve
        })
    )

    const first = invoke(IPC_CHANNELS.projectOpen)
    await expect(invoke(IPC_CHANNELS.projectOpen)).rejects.toThrow('already open')
    resolveDialog?.({ canceled: true, filePaths: [] })
    await expect(first).resolves.toEqual({ project: null })
  })

  it('validates sessions for close and switch before state changes', async () => {
    const { invoke, manager, projectDialog } = harness(openSnapshot)

    await expect(
      invoke(IPC_CHANNELS.projectClose, { projectSessionId: projectId })
    ).rejects.toThrow('stale')
    expect(manager.close).not.toHaveBeenCalled()
    expect(projectDialog.showOpenDialog).not.toHaveBeenCalled()
  })

  it('registers lifecycle subscriptions by session and revokes them on close', async () => {
    const { invoke, manager, sender } = harness(openSnapshot)
    await invoke(IPC_CHANNELS.projectSubscribeLifecycle, { projectSessionId: sessionId })

    expect(sender.send).toHaveBeenCalledWith(
      IPC_CHANNELS.projectLifecycleEvent,
      expect.objectContaining({ projectSessionId: sessionId, snapshot: openSnapshot })
    )
    sender.send.mockClear()
    await invoke(IPC_CHANNELS.projectClose, { projectSessionId: sessionId })
    expect(manager.close).toHaveBeenCalled()
    expect(sender.send).not.toHaveBeenCalled()
  })

  it('rejects stale subscriptions without emitting an event', async () => {
    const { invoke, sender } = harness(openSnapshot)
    expect(() =>
      invoke(IPC_CHANNELS.projectSubscribeLifecycle, { projectSessionId: projectId })
    ).toThrow('stale')
    expect(sender.send).not.toHaveBeenCalled()
  })
})
