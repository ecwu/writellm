import type { IpcMainInvokeEvent } from 'electron'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import type { ParsedKnowledgeDocument } from '../../shared/contracts/knowledge'
import { registerKnowledgeIpc, type KnowledgeIpcMain } from './knowledge-ipc'

const projectSessionId = '11111111-1111-4111-8111-111111111111'
const knowledgeItemId = '22222222-2222-4222-8222-222222222222'
const parseRevisionId = '33333333-3333-4333-8333-333333333333'
const normalizationRunId = '44444444-4444-4444-8444-444444444444'
const assetRef = `images/${'a'.repeat(64)}.png`

const document: ParsedKnowledgeDocument = {
  knowledgeItemId,
  parseState: 'succeeded',
  normalizationState: 'published',
  active: {
    parseRevisionId,
    normalizationRunId,
    normalizerVersion: 1,
    sourceSha256: 'b'.repeat(64),
    remoteTaskId: 'remote-task',
    providerId: 'mineru',
    modelVersion: 'pipeline',
    documentMarkdown: 'Body',
    blocks: [
      {
        id: `kb_${'c'.repeat(32)}`,
        ordinal: 0,
        type: 'image',
        text: 'Figure',
        headingPath: [],
        page: 0,
        bbox: [0, 0, 1000, 1000],
        sourceProviderBlockId: 'provider-block',
        assetRefs: [assetRef],
        contentHash: 'd'.repeat(64)
      }
    ],
    activatedAt: '2026-07-16T00:00:00.000Z'
  }
}

function harness() {
  const handlers = new Map<string, (...args: never[]) => unknown>()
  const ipc: KnowledgeIpcMain = {
    handle: (channel, handler) => handlers.set(channel, handler as never),
    removeHandler: vi.fn()
  }
  const mineruWorkflow = {
    start: vi.fn(async () => undefined),
    cancelForKnowledgeItem: vi.fn(() => ({
      parseTaskIds: [],
      parseRevisionIds: [],
      normalizationRunIds: []
    })),
    cleanupCancelledArtifacts: vi.fn(async () => undefined),
    cleanupAllArtifacts: vi.fn(async () => undefined)
  }
  const knowledgeNormalization = {
    detail: vi.fn(async () => document),
    asset: vi.fn(async () => ({ mimeType: 'image/png', dataBase64: 'iVBORw0KGgo=' }))
  }
  const projectIndex = {
    readiness: vi.fn<() => 'preparing' | 'available' | 'unavailable'>(() => 'available'),
    requestEmbeddingRefresh: vi.fn(async () => undefined),
    isCurrentGenerationIndexed: vi.fn(async () => true)
  }
  const context = {
    projectRoot: '/private/project.writellm',
    mineruWorkflow,
    jobs: {
      requestCancellationForPayload: vi.fn(() => [])
    },
    runtime: { scheduler: { cancel: vi.fn() } },
    knowledgeNormalization,
    projectIndex,
    knowledgeImports: {
      list: vi.fn(() => []),
      importPaths: vi.fn(),
      cancel: vi.fn(),
      delete: vi.fn(),
      originalRelativePath: vi.fn()
    }
  }
  let active = true
  const assertSession = (value: string) => {
    if (!active || value !== projectSessionId) throw new Error('stale project session')
    return context
  }
  const manager = {
    assertActiveSession: vi.fn(assertSession),
    assertMutationSession: vi.fn(assertSession)
  }
  registerKnowledgeIpc({
    manager: manager as never,
    getWindow: () => null,
    logger: pino({ level: 'silent' }),
    developmentUrl: 'http://localhost:5173',
    ipc
  })
  const event = {
    senderFrame: { url: 'http://localhost:5173/' }
  } as unknown as IpcMainInvokeEvent
  return {
    handlers,
    manager,
    mineruWorkflow,
    knowledgeNormalization,
    projectIndex,
    revoke: () => {
      active = false
    },
    invoke: (channel: string, input: unknown) =>
      handlers.get(channel)?.(event as never, input as never)
  }
}

describe('knowledge IPC', () => {
  it('starts parsing and returns validated normalized document and asset data', async () => {
    const { invoke, mineruWorkflow, knowledgeNormalization, projectIndex } = harness()
    await invoke(IPC_CHANNELS.knowledgeStartParse, { projectSessionId, knowledgeItemId })
    expect(mineruWorkflow.start).toHaveBeenCalledWith(knowledgeItemId)

    await expect(
      invoke(IPC_CHANNELS.knowledgeParsedDocument, { projectSessionId, knowledgeItemId })
    ).resolves.toEqual(document)
    await expect(
      invoke(IPC_CHANNELS.knowledgeParsedAsset, {
        projectSessionId,
        knowledgeItemId,
        parseRevisionId,
        assetRef
      })
    ).resolves.toEqual({ mimeType: 'image/png', dataBase64: 'iVBORw0KGgo=' })
    expect(knowledgeNormalization.detail).toHaveBeenCalledWith(knowledgeItemId)
    expect(knowledgeNormalization.asset).toHaveBeenCalledWith(
      knowledgeItemId,
      parseRevisionId,
      assetRef
    )
    await expect(invoke(IPC_CHANNELS.knowledgeIndexStatus, { projectSessionId })).resolves.toEqual({
      readiness: 'available',
      indexed: true
    })
    expect(projectIndex.isCurrentGenerationIndexed).toHaveBeenCalledOnce()
  })

  it('reports index preparation without waiting for the index utility', async () => {
    const { invoke, projectIndex } = harness()
    projectIndex.readiness.mockReturnValue('preparing')

    await expect(invoke(IPC_CHANNELS.knowledgeIndexStatus, { projectSessionId })).resolves.toEqual({
      readiness: 'preparing',
      indexed: false
    })
    expect(projectIndex.isCurrentGenerationIndexed).not.toHaveBeenCalled()
  })

  it('cancels parsing through a session-authorized knowledge action', async () => {
    const { invoke, mineruWorkflow } = harness()

    await invoke(IPC_CHANNELS.knowledgeCancelParse, { projectSessionId, knowledgeItemId })

    expect(mineruWorkflow.cancelForKnowledgeItem).toHaveBeenCalledWith(knowledgeItemId)
    expect(mineruWorkflow.cleanupCancelledArtifacts).toHaveBeenCalledWith(
      knowledgeItemId,
      expect.any(Object)
    )
  })

  it('queues session-authorized embedding refreshes for one parsed source or the whole project', async () => {
    const { invoke, projectIndex } = harness()

    await invoke(IPC_CHANNELS.knowledgeRefreshEmbeddings, {
      projectSessionId,
      knowledgeItemId
    })
    await invoke(IPC_CHANNELS.knowledgeRefreshEmbeddings, { projectSessionId })

    expect(projectIndex.requestEmbeddingRefresh).toHaveBeenNthCalledWith(1, knowledgeItemId)
    expect(projectIndex.requestEmbeddingRefresh).toHaveBeenNthCalledWith(2, undefined)
    await expect(
      invoke(IPC_CHANNELS.knowledgeRefreshEmbeddings, {
        projectSessionId,
        knowledgeItemId,
        force: true
      })
    ).rejects.toThrow()
  })

  it('rejects stale sessions both before and after privileged asynchronous work', async () => {
    const first = harness()
    await expect(
      first.invoke(IPC_CHANNELS.knowledgeParsedDocument, {
        projectSessionId: '55555555-5555-4555-8555-555555555555',
        knowledgeItemId
      })
    ).rejects.toThrow('stale project session')
    expect(first.knowledgeNormalization.detail).not.toHaveBeenCalled()

    const second = harness()
    second.knowledgeNormalization.detail.mockImplementationOnce(async () => {
      second.revoke()
      return document
    })
    await expect(
      second.invoke(IPC_CHANNELS.knowledgeParsedDocument, { projectSessionId, knowledgeItemId })
    ).rejects.toThrow('Parsed knowledge document could not be loaded')

    const third = harness()
    third.projectIndex.isCurrentGenerationIndexed.mockImplementationOnce(async () => {
      third.revoke()
      return true
    })
    await expect(
      third.invoke(IPC_CHANNELS.knowledgeIndexStatus, { projectSessionId })
    ).rejects.toThrow('Knowledge index status could not be loaded')
  })

  it('authorizes the sender and rejects renderer-only fields at the strict asset boundary', async () => {
    const { handlers, invoke, knowledgeNormalization } = harness()
    const unauthorized = {
      senderFrame: { url: 'https://attacker.invalid/' }
    } as unknown as IpcMainInvokeEvent
    await expect(
      Promise.resolve(
        handlers.get(IPC_CHANNELS.knowledgeParsedDocument)?.(
          unauthorized as never,
          { projectSessionId, knowledgeItemId } as never
        )
      )
    ).rejects.toThrow('Unauthorized IPC sender')

    await expect(
      invoke(IPC_CHANNELS.knowledgeParsedAsset, {
        projectSessionId,
        knowledgeItemId,
        assetRef,
        alt: 'must not cross IPC'
      })
    ).rejects.toThrow()
    expect(knowledgeNormalization.asset).not.toHaveBeenCalled()
  })
})
