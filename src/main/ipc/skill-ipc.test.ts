import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import { registerSkillIpc } from './skill-ipc'

const operationId = '11111111-1111-4111-8111-111111111111'
const snapshot = { available: [], installed: [], revision: 1 }
const inspection = {
  inspectionId: operationId,
  repository: 'owner/repo',
  directory: '.',
  commit: 'a'.repeat(40),
  name: 'writing',
  description: 'Writing guidance',
  disableModelInvocation: false,
  license: 'MIT',
  licenseStatus: 'declared',
  fileCount: 1,
  totalBytes: 10,
  files: ['SKILL.md']
}
const channels = [
  IPC_CHANNELS.skillsSnapshot,
  IPC_CHANNELS.skillsInspectGithub,
  IPC_CHANNELS.skillsInstall,
  IPC_CHANNELS.skillsSetEnabled,
  IPC_CHANNELS.skillsCheckUpdate,
  IPC_CHANNELS.skillsUpdate,
  IPC_CHANNELS.skillsUninstall,
  IPC_CHANNELS.skillsCancelOperation
]

function harness() {
  const handlers = new Map<string, (...args: never[]) => unknown>()
  const listeners = new Map<string, (event: IpcMainEvent) => void>()
  let publish!: (revision: number) => void
  const unsubscribeService = vi.fn()
  const service = {
    subscribe: vi.fn((listener: typeof publish) => {
      publish = listener
      return unsubscribeService
    }),
    snapshot: vi.fn(() => snapshot),
    inspectGithub: vi.fn(async () => inspection),
    installCurated: vi.fn(async () => snapshot),
    installInspected: vi.fn(async () => snapshot),
    setEnabled: vi.fn(() => snapshot),
    checkUpdate: vi.fn(async () => ({
      skillId: 'writing',
      available: false,
      kind: null,
      currentCommit: 'a'.repeat(40),
      nextCommit: null
    })),
    update: vi.fn(async () => snapshot),
    uninstall: vi.fn(async () => snapshot),
    cancelOperation: vi.fn()
  }
  const ipc = {
    handle: (channel: string, listener: (...args: never[]) => unknown) =>
      handlers.set(channel, listener),
    removeHandler: vi.fn((channel: string) => handlers.delete(channel)),
    on: (channel: string, listener: (event: IpcMainEvent) => void) =>
      listeners.set(channel, listener),
    removeListener: vi.fn((channel: string) => listeners.delete(channel))
  }
  const unregister = registerSkillIpc({
    service: service as never,
    logger: pino({ level: 'silent' }),
    developmentUrl: 'http://localhost:5173',
    ipc: ipc as never
  })
  const sender = { id: 7, send: vi.fn(), isDestroyed: vi.fn(() => false) }
  const event = {
    senderFrame: { url: 'http://localhost:5173/' },
    sender
  } as unknown as IpcMainInvokeEvent & IpcMainEvent
  const invoke = (channel: string, input?: unknown, source = event) =>
    handlers.get(channel)?.(source as never, input as never)
  return {
    invoke,
    listeners,
    service,
    sender,
    event,
    unregister,
    ipc,
    publish: (revision: number) => publish(revision),
    unsubscribeService
  }
}

describe('Writing skill IPC', () => {
  it.each(channels)(
    'rejects an unauthorized sender on %s before calling the service',
    async (channel) => {
      const fixture = harness()
      await expect(async () =>
        fixture.invoke(channel, {}, {
          ...fixture.event,
          senderFrame: { url: 'https://attacker.invalid/' }
        } as never)
      ).rejects.toThrow('Unauthorized IPC sender')
      for (const [name, method] of Object.entries(fixture.service))
        if (name !== 'subscribe') expect(method).not.toHaveBeenCalled()
    }
  )

  it.each(channels.slice(1))(
    'rejects invalid input on %s without a service action',
    async (channel) => {
      const fixture = harness()
      await expect(async () =>
        fixture.invoke(channel, { operationId: 'invalid', path: '/private/file' })
      ).rejects.toThrow()
      for (const [name, method] of Object.entries(fixture.service))
        if (name !== 'subscribe') expect(method).not.toHaveBeenCalled()
    }
  )

  it('routes validated installation and management commands and returns bounded results', async () => {
    const { invoke, service } = harness()
    expect(invoke(IPC_CHANNELS.skillsSnapshot)).toEqual(snapshot)
    await expect(
      invoke(IPC_CHANNELS.skillsInspectGithub, {
        repository: 'owner/repo',
        directory: '.',
        operationId
      })
    ).resolves.toEqual(inspection)
    await expect(
      invoke(IPC_CHANNELS.skillsInstall, { source: 'curated', skillId: 'writing', operationId })
    ).resolves.toEqual({ snapshot })
    expect(service.installCurated).toHaveBeenCalledWith('writing', operationId)
    await expect(
      invoke(IPC_CHANNELS.skillsInstall, {
        source: 'github',
        inspectionId: operationId,
        operationId
      })
    ).resolves.toEqual({ snapshot })
    expect(service.installInspected).toHaveBeenCalledWith(operationId)
    expect(invoke(IPC_CHANNELS.skillsSetEnabled, { skillId: 'writing', enabled: false })).toEqual({
      snapshot
    })
    expect(service.setEnabled).toHaveBeenCalledWith('writing', false, false)
    await expect(
      invoke(IPC_CHANNELS.skillsCheckUpdate, { skillId: 'writing', operationId })
    ).resolves.toMatchObject({ available: false })
    await expect(
      invoke(IPC_CHANNELS.skillsUpdate, {
        skillId: 'writing',
        confirmUnreviewed: true,
        operationId
      })
    ).resolves.toEqual({ snapshot })
    expect(service.update).toHaveBeenCalledWith('writing', true, operationId)
    await expect(
      invoke(IPC_CHANNELS.skillsUninstall, { skillId: 'writing', cascade: true })
    ).resolves.toEqual({ snapshot })
    expect(service.uninstall).toHaveBeenCalledWith('writing', true)
    invoke(IPC_CHANNELS.skillsCancelOperation, { operationId })
    expect(service.cancelOperation).toHaveBeenCalledWith(operationId)
  })

  it('rejects invalid service output at the renderer boundary', () => {
    const { invoke, service } = harness()
    service.snapshot.mockReturnValueOnce({ ...snapshot, revision: -1 })
    expect(() => invoke(IPC_CHANNELS.skillsSnapshot)).toThrow()
  })

  it('publishes only to authorized live subscribers and stops delivery after unsubscribe or teardown', () => {
    const fixture = harness()
    const subscribe = fixture.listeners.get(IPC_CHANNELS.skillsSubscribeChanges)
    const unsubscribe = fixture.listeners.get(IPC_CHANNELS.skillsUnsubscribeChanges)
    const untrusted = {
      ...fixture.event,
      senderFrame: { url: 'https://attacker.invalid/' }
    } as never
    expect(() => subscribe?.(untrusted)).toThrow('Unauthorized IPC sender')
    expect(() => unsubscribe?.(untrusted)).toThrow('Unauthorized IPC sender')
    fixture.publish(2)
    expect(fixture.sender.send).not.toHaveBeenCalled()
    subscribe?.(fixture.event)
    fixture.publish(3)
    expect(fixture.sender.send).toHaveBeenCalledExactlyOnceWith(IPC_CHANNELS.skillsChanged, {
      revision: 3
    })
    unsubscribe?.(fixture.event)
    fixture.publish(4)
    expect(fixture.sender.send).toHaveBeenCalledOnce()
    subscribe?.(fixture.event)
    fixture.sender.isDestroyed.mockReturnValue(true)
    fixture.publish(5)
    fixture.sender.isDestroyed.mockReturnValue(false)
    fixture.publish(6)
    expect(fixture.sender.send).toHaveBeenCalledOnce()
    subscribe?.(fixture.event)
    fixture.unregister()
    fixture.publish(7)
    expect(fixture.sender.send).toHaveBeenCalledOnce()
    expect(fixture.unsubscribeService).toHaveBeenCalledOnce()
    expect(fixture.ipc.removeHandler.mock.calls.map(([channel]) => channel)).toEqual(channels)
    expect(fixture.listeners.size).toBe(0)
  })
})
