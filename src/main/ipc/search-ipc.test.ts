import type { IpcMainInvokeEvent } from 'electron'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import { registerSearchIpc } from './search-ipc'

const projectSessionId = '11111111-1111-4111-8111-111111111111'
const citationId = `citation-${'a'.repeat(40)}`

function harness() {
  const handlers = new Map<string, (...args: never[]) => unknown>()
  let active = true
  const retrieval = {
    search: vi.fn(async () => ({ mode: 'none', rerankStatus: 'disabled', hits: [] })),
    expand: vi.fn(async () => [
      {
        citationId,
        knowledgeItemId: '22222222-2222-4222-8222-222222222222',
        parseRevisionId: '33333333-3333-4333-8333-333333333333',
        chunkId: `chunk-${'a'.repeat(40)}`,
        title: 'Source',
        text: 'Expanded source',
        page: 0,
        headingPath: ['Heading'],
        sourceBlockIds: [`kb_${'b'.repeat(32)}`],
        assetRefs: [],
        sources: [
          {
            blockId: `kb_${'b'.repeat(32)}`,
            blockType: 'paragraph',
            page: 0,
            bbox: null,
            assetRefs: [],
            providerBlockId: null,
            segmentStart: 0,
            segmentEnd: 15
          }
        ]
      }
    ])
  }
  const manager = {
    assertActiveSession: vi.fn((value: string) => {
      if (!active || value !== projectSessionId) throw new Error('stale project session')
      return { retrieval }
    })
  }
  registerSearchIpc({
    manager: manager as never,
    logger: pino({ level: 'silent' }),
    developmentUrl: 'http://localhost:5173',
    ipc: {
      handle: (channel, handler) => handlers.set(channel, handler as never),
      removeHandler: vi.fn()
    }
  })
  const event = {
    senderFrame: { url: 'http://localhost:5173/' }
  } as unknown as IpcMainInvokeEvent
  return {
    handlers,
    retrieval,
    revoke: () => {
      active = false
    },
    invoke: (channel: string, input: unknown) =>
      handlers.get(channel)?.(event as never, input as never)
  }
}

describe('search IPC', () => {
  it('validates bounded search defaults and expands citations through a separate method', async () => {
    const { invoke, retrieval } = harness()
    await expect(
      invoke(IPC_CHANNELS.knowledgeSearch, { projectSessionId, query: 'evidence' })
    ).resolves.toEqual({ mode: 'none', rerankStatus: 'disabled', hits: [] })
    expect(retrieval.search).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'evidence',
        limits: { fts: 100, vector: 100, fused: 50, results: 20 }
      }),
      expect.any(AbortSignal)
    )
    await expect(
      invoke(IPC_CHANNELS.knowledgeExpandCitations, {
        projectSessionId,
        citationIds: [citationId]
      })
    ).resolves.toMatchObject([{ citationId, text: 'Expanded source' }])
  })

  it('rejects unauthorized, malformed, and stale requests before and after asynchronous work', async () => {
    const first = harness()
    const unauthorized = {
      senderFrame: { url: 'https://attacker.invalid/' }
    } as unknown as IpcMainInvokeEvent
    await expect(
      Promise.resolve(
        first.handlers.get(IPC_CHANNELS.knowledgeSearch)?.(
          unauthorized as never,
          { projectSessionId, query: 'evidence' } as never
        )
      )
    ).rejects.toThrow('Unauthorized IPC sender')
    await expect(
      first.invoke(IPC_CHANNELS.knowledgeSearch, {
        projectSessionId,
        query: 'evidence',
        limits: { fts: 1001 }
      })
    ).rejects.toThrow()
    expect(first.retrieval.search).not.toHaveBeenCalled()

    const second = harness()
    second.retrieval.search.mockImplementationOnce(async () => {
      second.revoke()
      return { mode: 'none', rerankStatus: 'disabled', hits: [] }
    })
    await expect(
      second.invoke(IPC_CHANNELS.knowledgeSearch, { projectSessionId, query: 'evidence' })
    ).rejects.toThrow('Knowledge search could not be completed')
  })
})
