import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import { registerSearchIpc } from './search-ipc'

const projectSessionId = '11111111-1111-4111-8111-111111111111'
const citationId = `citation-${'a'.repeat(40)}`

function harness() {
  const handlers = new Map<string, (...args: never[]) => unknown>()
  let active = true
  let retrievalAvailable = true
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
  const logger = { info: vi.fn(), error: vi.fn() }
  const manager = {
    assertActiveSession: vi.fn((value: string) => {
      if (!active || value !== projectSessionId) throw new Error('stale project session')
      return {
        retrieval,
        projectIndex: { isRetrievalAvailable: () => retrievalAvailable },
        database: {
          immediate: (operation: (database: unknown) => unknown) =>
            operation({ prepare: () => ({ all: () => [] }) })
        }
      }
    })
  }
  registerSearchIpc({
    manager: manager as never,
    logger,
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
    logger,
    manager,
    retrieval,
    revoke: () => {
      active = false
    },
    setRetrievalAvailable: (value: boolean) => {
      retrievalAvailable = value
    },
    invoke: (channel: string, input: unknown) =>
      handlers.get(channel)?.(event as never, input as never)
  }
}

describe('search IPC', () => {
  it('validates bounded search defaults and expands citations through a separate method', async () => {
    const { invoke, logger, retrieval } = harness()
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
    await expect(
      invoke(IPC_CHANNELS.knowledgeResolveReadableCitation, {
        projectSessionId,
        sectionRevisionId: '44444444-4444-4444-8444-444444444444',
        blockId: 'grounded-paragraph',
        title: 'Source',
        pageIndex: 0
      })
    ).resolves.toEqual({ status: 'unavailable', reason: 'unlinked' })
    const completion = logger.info.mock.calls.find(
      ([fields]) => fields.event === 'knowledge.readable_citation_resolution.completed'
    )?.[0]
    expect(completion).toMatchObject({
      projectSessionId,
      sectionRevisionId: '44444444-4444-4444-8444-444444444444',
      blockId: 'grounded-paragraph',
      status: 'unavailable',
      candidateCount: 0
    })
    expect(completion).not.toHaveProperty('title')
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
      Promise.resolve(
        first.handlers.get(IPC_CHANNELS.knowledgeResolveReadableCitation)?.(
          unauthorized as never,
          {
            projectSessionId,
            sectionRevisionId: '44444444-4444-4444-8444-444444444444',
            blockId: 'grounded-paragraph',
            title: 'Source'
          } as never
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
    await expect(
      first.invoke(IPC_CHANNELS.knowledgeResolveReadableCitation, {
        projectSessionId,
        sectionRevisionId: '44444444-4444-4444-8444-444444444444',
        blockId: '',
        title: 'Source'
      })
    ).rejects.toThrow()
    await expect(
      first.invoke(IPC_CHANNELS.knowledgeResolveReadableCitation, {
        projectSessionId: '99999999-9999-4999-8999-999999999999',
        sectionRevisionId: '44444444-4444-4444-8444-444444444444',
        blockId: 'grounded-paragraph',
        title: 'Source'
      })
    ).rejects.toThrow('stale project session')
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

  it('rejects search explicitly while the project index is preparing', async () => {
    const fixture = harness()
    fixture.setRetrievalAvailable(false)

    await expect(
      fixture.invoke(IPC_CHANNELS.knowledgeSearch, { projectSessionId, query: 'evidence' })
    ).rejects.toThrow('still preparing')
    expect(fixture.retrieval.search).not.toHaveBeenCalled()
  })
})
