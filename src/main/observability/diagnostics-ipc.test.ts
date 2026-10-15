import { dialog, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import { registerDiagnosticsIpc } from './diagnostics-ipc'
import { LogRingBuffer } from './log-ring-buffer'

vi.mock('electron', () => ({
  ipcMain: {},
  dialog: { showSaveDialog: vi.fn() },
  shell: { openPath: vi.fn() }
}))
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
const channels = [
  IPC_CHANNELS.diagnosticsSnapshot,
  IPC_CHANNELS.diagnosticsSetLevel,
  IPC_CHANNELS.diagnosticsOpenLogs,
  IPC_CHANNELS.diagnosticsExport
]
function harness() {
  const handlers = new Map<string, (...args: never[]) => unknown>()
  const listeners = new Map<string, (event: IpcMainEvent, input: unknown) => void>()
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const ringBuffer = new LogRingBuffer()
  const system = {
    createModuleLogger: () => log,
    ringBuffer,
    logDirectory: '/private/logs',
    setSubsystemLevel: vi.fn()
  }
  const window = { isDestroyed: vi.fn(() => false), webContents: { send: vi.fn() } }
  const unregister = registerDiagnosticsIpc(
    system as never,
    () => window as never,
    'http://localhost:5173',
    {
      handle: (channel, listener) => handlers.set(channel, listener as never),
      removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
      on: (channel: string, listener: (event: IpcMainEvent, input: unknown) => void) => {
        listeners.set(channel, listener)
        return {} as never
      },
      removeAllListeners: vi.fn((channel: string) => {
        listeners.delete(channel)
        return {} as never
      })
    }
  )
  const event = { senderFrame: { url: 'http://localhost:5173/' } } as IpcMainInvokeEvent &
    IpcMainEvent
  const invoke = (channel: string, input?: unknown, source = event) =>
    handlers.get(channel)?.(source as never, input as never)
  return { handlers, listeners, log, ringBuffer, system, window, unregister, event, invoke }
}

describe('Diagnostics IPC', () => {
  it.each(channels)(
    'rejects unauthorized senders on %s before privileged actions',
    async (channel) => {
      const fixture = harness()
      vi.mocked(shell.openPath).mockClear()
      vi.mocked(dialog.showSaveDialog).mockClear()
      await expect(async () =>
        fixture.invoke(channel, {}, {
          ...fixture.event,
          senderFrame: { url: 'https://attacker.invalid/' }
        } as never)
      ).rejects.toThrow('Unauthorized IPC sender')
      expect(fixture.system.setSubsystemLevel).not.toHaveBeenCalled()
      expect(shell.openPath).not.toHaveBeenCalled()
      expect(dialog.showSaveDialog).not.toHaveBeenCalled()
    }
  )

  it('returns the current ring snapshot and applies only valid log levels', () => {
    const fixture = harness()
    fixture.ringBuffer.push({ event: 'app.ready' })
    expect(fixture.invoke(IPC_CHANNELS.diagnosticsSnapshot)).toEqual([{ event: 'app.ready' }])
    fixture.invoke(IPC_CHANNELS.diagnosticsSetLevel, {
      subsystem: 'ipc',
      level: 'debug',
      durationMs: 1_000
    })
    expect(fixture.system.setSubsystemLevel).toHaveBeenCalledExactlyOnceWith('ipc', 'debug', 1_000)
    expect(() =>
      fixture.invoke(IPC_CHANNELS.diagnosticsSetLevel, { subsystem: 'unknown', level: 'debug' })
    ).toThrow()
    expect(() =>
      fixture.invoke(IPC_CHANNELS.diagnosticsSetLevel, {
        subsystem: 'ipc',
        level: 'debug',
        durationMs: 0
      })
    ).toThrow()
    expect(fixture.system.setSubsystemLevel).toHaveBeenCalledOnce()
  })

  it('logs bounded renderer errors with their stack and rejects untrusted or malformed reports', () => {
    const fixture = harness()
    const report = fixture.listeners.get(IPC_CHANNELS.diagnosticsReportRendererError)
    report?.(fixture.event, {
      event: 'renderer.error',
      message: 'Rendering failed',
      stack: 'original renderer stack',
      source: 'editor',
      line: 2,
      column: 3
    })
    expect(fixture.log.error).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        event: 'renderer.error',
        err: expect.objectContaining({
          message: 'Rendering failed',
          stack: 'original renderer stack'
        }),
        source: 'editor',
        line: 2,
        column: 3
      }),
      expect.any(String)
    )
    report?.({ ...fixture.event, senderFrame: { url: 'https://attacker.invalid/' } } as never, {
      event: 'renderer.error',
      message: 'untrusted'
    })
    report?.(fixture.event, { event: 'renderer.error', message: 'x'.repeat(4_097) })
    report?.(fixture.event, { event: 'app.authorized', message: 'spoofed event' })
    expect(fixture.log.error).toHaveBeenCalledOnce()
    expect(fixture.log.warn).toHaveBeenCalledTimes(3)
    for (const [fields] of fixture.log.warn.mock.calls)
      expect(fields).toMatchObject({
        event: 'ipc.renderer_error_report.rejected',
        err: expect.any(Error)
      })
  })

  it('reconstructs a renderer diagnostic with its cause chain', () => {
    const fixture = harness()
    fixture.listeners.get(IPC_CHANNELS.diagnosticsReportRendererError)?.(fixture.event, {
      event: 'renderer.unhandled_rejection',
      message: 'Fallback',
      diagnostic: {
        schemaVersion: 1,
        stage: 'renderer',
        name: 'TypeError',
        message: 'Rendering failed',
        causes: [{ name: 'Error', message: 'Cause retained' }]
      }
    })
    expect(fixture.log.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.objectContaining({
          name: 'TypeError',
          message: 'Rendering failed',
          cause: expect.objectContaining({ message: 'Cause retained' })
        })
      }),
      expect.any(String)
    )
  })

  it('opens logs and reports the original native failure', async () => {
    const fixture = harness()
    vi.mocked(shell.openPath).mockResolvedValueOnce('')
    await fixture.invoke(IPC_CHANNELS.diagnosticsOpenLogs)
    expect(shell.openPath).toHaveBeenCalledWith('/private/logs')
    vi.mocked(shell.openPath).mockResolvedValueOnce('Directory unavailable')
    await expect(fixture.invoke(IPC_CHANNELS.diagnosticsOpenLogs)).rejects.toThrow(
      'Directory unavailable'
    )
    expect(fixture.log.error).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        event: 'app.logs_directory.open_failed',
        err: expect.objectContaining({ message: 'Directory unavailable' })
      }),
      expect.any(String)
    )
  })

  it('exports the ring snapshot to a private JSON file and respects native cancellation', async () => {
    const fixture = harness()
    const root = await mkdtemp(join(tmpdir(), 'writellm-diagnostics-'))
    roots.push(root)
    const path = join(root, 'bundle.json')
    fixture.ringBuffer.push({ event: 'app.ready' })
    vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({ canceled: true, filePath: '' })
    await expect(fixture.invoke(IPC_CHANNELS.diagnosticsExport)).resolves.toEqual({
      exported: false
    })
    vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({ canceled: false, filePath: path })
    await expect(fixture.invoke(IPC_CHANNELS.diagnosticsExport)).resolves.toEqual({
      exported: true
    })
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({
      exportedAt: expect.any(String),
      logs: [{ event: 'app.ready' }]
    })
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o777).toBe(0o600)
  })

  it('retains a filesystem failure as the export error cause', async () => {
    const fixture = harness()
    const root = await mkdtemp(join(tmpdir(), 'writellm-diagnostics-failed-'))
    roots.push(root)
    vi.mocked(dialog.showSaveDialog).mockResolvedValueOnce({
      canceled: false,
      filePath: join(root, 'missing', 'bundle.json')
    })
    await expect(fixture.invoke(IPC_CHANNELS.diagnosticsExport)).rejects.toMatchObject({
      message: 'Failed to export diagnostics',
      cause: { code: 'ENOENT' }
    })
    expect(fixture.log.error).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        event: 'app.diagnostics_export.failed',
        err: expect.objectContaining({ code: 'ENOENT' })
      }),
      expect.any(String)
    )
  })

  it('stops forwarding ring entries after a send failure or unregister', () => {
    const fixture = harness()
    fixture.ringBuffer.push({ event: 'first' })
    expect(fixture.window.webContents.send).toHaveBeenCalledWith(IPC_CHANNELS.diagnosticsEvent, {
      event: 'first'
    })
    const cause = new Error('Window closed')
    fixture.window.webContents.send.mockImplementationOnce(() => {
      throw cause
    })
    fixture.ringBuffer.push({ event: 'second' })
    fixture.ringBuffer.push({ event: 'third' })
    expect(fixture.window.webContents.send).toHaveBeenCalledTimes(2)
    expect(fixture.log.warn).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ event: 'ipc.diagnostics_subscription.failed', err: cause }),
      expect.any(String)
    )
    fixture.unregister()
    expect(fixture.handlers.size).toBe(0)
    expect(fixture.listeners.size).toBe(0)
    const normal = harness()
    normal.unregister()
    normal.ringBuffer.push({ event: 'after teardown' })
    expect(normal.window.webContents.send).not.toHaveBeenCalled()
  })
})
