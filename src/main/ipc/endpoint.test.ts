import type { IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { describe, expect, it, vi } from 'vitest'
import { appIpcEndpoints, defineIpcEndpoint } from '../../shared/contracts/ipc-endpoints'
import { agentIpcEndpoints } from '../../shared/contracts/ipc-endpoints-agent'
import { editorIpcEndpoints } from '../../shared/contracts/ipc-endpoints-editor'
import { knowledgeIpcEndpoints } from '../../shared/contracts/ipc-endpoints-knowledge'
import { manuscriptIpcEndpoints } from '../../shared/contracts/ipc-endpoints-manuscript'
import { projectIpcEndpoints } from '../../shared/contracts/ipc-endpoints-project'
import { createEndpointRegistrar, registerIpcEndpoint, type TypedIpcMain } from './endpoint'

function harness() {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
  const ipc: TypedIpcMain = {
    handle(channel, listener) {
      handlers.set(channel, listener)
    },
    removeHandler(channel) {
      handlers.delete(channel)
    }
  }
  const event = {
    senderFrame: { url: 'http://localhost:5173/' }
  } as unknown as IpcMainInvokeEvent
  return { event, handlers, ipc }
}

const projectSessionId = '00000000-0000-4000-8000-000000000001'

describe('typed IPC endpoint registration', () => {
  it('authorizes, parses, and validates a request and response asynchronously', async () => {
    const { event, handlers, ipc } = harness()
    const endpoint = defineIpcEndpoint({
      channel: 'test:typed',
      input: z.object({ value: z.number().int() }).strict(),
      output: z.object({ doubled: z.number().int() }).strict(),
      session: 'none'
    })
    const handle = vi.fn(({ value }: { value: number }) => ({ doubled: value * 2 }))

    const unregister = registerIpcEndpoint(ipc, endpoint, {
      developmentUrl: 'http://localhost:5173',
      handle
    })

    const pending = handlers.get(endpoint.channel)?.(event, { value: 4 })
    expect(pending).toBeInstanceOf(Promise)
    await expect(pending).resolves.toEqual({ doubled: 8 })
    expect(handle).toHaveBeenCalledWith({ value: 4 }, undefined, event)

    await expect(handlers.get(endpoint.channel)?.(event, { value: '4' })).rejects.toThrow()
    expect(handle).toHaveBeenCalledOnce()
    unregister()
    expect(handlers.has(endpoint.channel)).toBe(false)
  })

  it('rejects handler output that does not match the declared schema', async () => {
    const { event, handlers, ipc } = harness()
    const endpoint = defineIpcEndpoint({
      channel: 'test:output',
      input: z.undefined(),
      output: z.object({ accepted: z.literal(true) }).strict(),
      session: 'none'
    })
    registerIpcEndpoint(ipc, endpoint, {
      developmentUrl: 'http://localhost:5173',
      handle: () => ({ accepted: false }) as never
    })

    await expect(handlers.get(endpoint.channel)?.(event)).rejects.toThrow()
  })

  it('rejects an untrusted sender before the handler runs', async () => {
    const { handlers, ipc } = harness()
    const endpoint = defineIpcEndpoint({
      channel: 'test:sender',
      input: z.undefined(),
      output: z.object({ accepted: z.literal(true) }).strict(),
      session: 'none'
    })
    const handle = vi.fn(() => ({ accepted: true as const }))
    registerIpcEndpoint(ipc, endpoint, {
      developmentUrl: 'http://localhost:5173',
      handle
    })

    const untrusted = {
      senderFrame: { url: 'https://attacker.invalid/' }
    } as unknown as IpcMainInvokeEvent
    await expect(handlers.get(endpoint.channel)?.(untrusted)).rejects.toThrow(
      'Unauthorized IPC sender'
    )
    expect(handle).not.toHaveBeenCalled()
  })

  it('passes the context returned by the declared session check to the handler', async () => {
    const { event, handlers, ipc } = harness()
    const endpoint = defineIpcEndpoint({
      channel: 'test:mutation',
      input: z.object({ projectSessionId: z.uuid(), value: z.string() }).strict(),
      output: z.object({ accepted: z.literal(true) }).strict(),
      session: 'mutation'
    })
    const context = { projectSessionId }
    const manager = {
      assertActiveSession: vi.fn(() => context),
      assertMutationSession: vi.fn(() => context)
    }
    const handle = vi.fn(() => ({ accepted: true as const }))
    registerIpcEndpoint(ipc, endpoint, {
      developmentUrl: 'http://localhost:5173',
      manager,
      handle
    })

    await expect(
      handlers.get(endpoint.channel)?.(event, { projectSessionId, value: 'ok' })
    ).resolves.toEqual({ accepted: true })
    expect(manager.assertMutationSession).toHaveBeenCalledOnce()
    expect(manager.assertMutationSession).toHaveBeenCalledWith(projectSessionId)
    expect(manager.assertActiveSession).not.toHaveBeenCalled()
    expect(handle).toHaveBeenCalledWith({ projectSessionId, value: 'ok' }, context, event)
  })

  it('runs session rejection inside the around wrapper so domains can report it', async () => {
    const { event, handlers, ipc } = harness()
    const endpoint = defineIpcEndpoint({
      channel: 'test:around',
      input: z.object({ projectSessionId: z.uuid() }).strict(),
      output: z.undefined(),
      session: 'active'
    })
    const rejection = new Error('stale session')
    const failures: unknown[] = []
    const handle = vi.fn()
    registerIpcEndpoint(ipc, endpoint, {
      developmentUrl: 'http://localhost:5173',
      manager: {
        assertActiveSession: () => {
          throw rejection
        },
        assertMutationSession: () => {
          throw rejection
        }
      },
      around: async (_input, run) => {
        try {
          return await run()
        } catch (err) {
          failures.push(err)
          throw err
        }
      },
      handle
    })

    await expect(handlers.get(endpoint.channel)?.(event, { projectSessionId })).rejects.toBe(
      rejection
    )
    expect(failures).toEqual([rejection])
    expect(handle).not.toHaveBeenCalled()
  })

  it('applies a registrar safe error boundary with the endpoint channel', async () => {
    const { event, handlers, ipc } = harness()
    const endpoint = defineIpcEndpoint({
      channel: 'test:safe-error',
      input: z.undefined(),
      output: z.undefined(),
      session: 'none'
    })
    const onError = vi.fn((channel: string, err: unknown): never => {
      throw new Error(`safe ${channel}`, { cause: err })
    })
    const handle = createEndpointRegistrar(ipc, {
      developmentUrl: 'http://localhost:5173',
      onError
    })
    handle(endpoint, () => {
      throw new Error('private detail')
    })

    await expect(handlers.get(endpoint.channel)?.(event)).rejects.toThrow('safe test:safe-error')
    expect(onError).toHaveBeenCalledWith('test:safe-error', expect.any(Error))
  })
})

/**
 * Project-scoped endpoints normally declare their session requirement so the shared boundary
 * checks it. Each exception here owns a different, documented authorization path.
 */
const projectScopedWithoutSessionCheck: Record<string, string> = {
  'editor:final-flush-save': 'closing-token authorization while the project is closing',
  'editor:flush-ack': 'closing-token authorization while the project is closing',
  'editor:resolve-asset': 'returns a typed session-revoked result',
  'editor:unsubscribe-flush': 'sender-owned lease release must work after revocation',
  'manuscript:replacement-unsubscribe': 'sender-owned lease release must work after revocation',
  'project:unsubscribe-lifecycle': 'sender-owned lease release must work after revocation',
  'reference:apply-legacy-conversion': 'consumes the one-shot plan before its logged check',
  'project:template-preview': 'ProjectManager authorizes inside the failure boundary',
  'project:template-save': 'ProjectManager authorizes inside the failure boundary',
  'project:history-enable': 'ProjectManager authorizes inside the failure boundary',
  'project:history-create-checkpoint': 'ProjectManager authorizes inside the failure boundary',
  'project:history-list-checkpoints': 'ProjectManager authorizes inside the failure boundary',
  'project:history-compare-state': 'ProjectManager authorizes inside the failure boundary',
  'project:history-restore-checkpoint': 'ProjectManager authorizes inside the failure boundary',
  'project:history-reinitialize': 'ProjectManager authorizes inside the failure boundary'
}

describe('IPC endpoint session declarations', () => {
  it('declares a session check for every project-scoped endpoint unless it is justified', () => {
    const tables = [
      appIpcEndpoints,
      agentIpcEndpoints,
      editorIpcEndpoints,
      knowledgeIpcEndpoints,
      manuscriptIpcEndpoints,
      projectIpcEndpoints
    ]
    const unchecked = tables
      .flatMap((table) => Object.values(table))
      .filter(
        (endpoint) =>
          endpoint.session === 'none' &&
          endpoint.input instanceof z.ZodObject &&
          'projectSessionId' in endpoint.input.shape
      )
      .map((endpoint) => endpoint.channel)
      .sort()

    expect(unchecked).toEqual(Object.keys(projectScopedWithoutSessionCheck).sort())
  })
})
