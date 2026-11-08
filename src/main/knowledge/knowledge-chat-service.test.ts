import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { NOTEBOOK_MAX_CHAT_BYTES, NOTEBOOK_MAX_MESSAGES } from '../../shared/contracts/notebook'
import type { AgentSessionRuntime } from '../providers/gateways'
import { ModelRequestRepository } from '../providers/model-request-repository'
import { KnowledgeChatService } from './knowledge-chat-service'
import {
  harness,
  completed,
  sourceA,
  sourceB,
  citationId
} from './knowledge-chat-service.test-support'

describe('KnowledgeChatService', () => {
  it('shares the first default-model load with a concurrent start', async () => {
    const { service, agentCatalog } = await harness()
    const loading = Promise.withResolvers<void>()
    const catalog = await agentCatalog.snapshot()
    const release = Promise.withResolvers<typeof catalog>()
    agentCatalog.snapshot.mockClear()
    agentCatalog.snapshot.mockImplementationOnce(() => {
      loading.resolve()
      return release.promise
    })
    const snapshot = service.snapshot()
    await loading.promise
    const start = service.startTurn('Use the default model')
    release.resolve(catalog)
    const [initial] = await Promise.all([snapshot, start])
    expect(initial.modelSelection).toEqual(catalog.defaultSelection)
    expect(agentCatalog.snapshot).toHaveBeenCalledOnce()
    expect((await completed(service)).messages.at(-1)).toMatchObject({ status: 'complete' })
  })

  it('does not apply a default model after closing during initialization', async () => {
    const { service, agentCatalog } = await harness()
    const loading = Promise.withResolvers<void>()
    const catalog = await agentCatalog.snapshot()
    const release = Promise.withResolvers<typeof catalog>()
    agentCatalog.snapshot.mockImplementationOnce(() => {
      loading.resolve()
      return release.promise
    })
    const snapshot = service.snapshot()
    await loading.promise
    await service.close()
    release.resolve(catalog)
    await expect(snapshot).rejects.toThrow('closed')
    expect(agentCatalog.resolve).not.toHaveBeenCalled()
  })

  it.each([51, 201, 301, 1_000])(
    'searches all %i sources and honors explicit exclusions',
    async (count) => {
      const ids = Array.from(
        { length: count },
        (_, index) => `019d0000-0000-7000-8000-${String(index + 1000).padStart(12, '0')}`
      )
      const { service, retrieval } = await harness({ sourceIds: ids, evidence: false })
      expect((await service.snapshot()).availableKnowledgeItemIds).toEqual(ids)
      await service.startTurn('Search all sources')
      await completed(service)
      expect(retrieval.search).toHaveBeenLastCalledWith(
        expect.objectContaining({
          filters: expect.objectContaining({ knowledgeItemIds: ids })
        }),
        expect.any(AbortSignal)
      )
      await service.setSources({ mode: 'selected', knowledgeItemIds: ids.slice(1) })
      await service.startTurn('Search selected sources')
      await completed(service)
      expect(retrieval.search).toHaveBeenLastCalledWith(
        expect.objectContaining({
          filters: expect.objectContaining({ knowledgeItemIds: ids.slice(1) })
        }),
        expect.any(AbortSignal)
      )
      await expect(
        service.setSources({ mode: 'selected', knowledgeItemIds: [sourceA] })
      ).rejects.toThrow('indexed')
      await service.setSources({ mode: 'selected', knowledgeItemIds: [] })
      await expect(service.startTurn('No sources')).rejects.toThrow('at least one')
    }
  )

  it('keeps the active turn scope frozen when another indexed source appears', async () => {
    const ids = [sourceA]
    const { service, retrieval } = await harness({ sourceIds: ids, evidence: false })
    let release: (() => void) | undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    retrieval.search.mockImplementationOnce(async () => {
      await held
      return { mode: 'none', rerankStatus: 'disabled', hits: [] }
    })
    await service.startTurn('Use the current sources')
    await vi.waitFor(() => expect(retrieval.search).toHaveBeenCalledTimes(1))
    ids.push(sourceB)
    expect((await service.snapshot()).availableKnowledgeItemIds).toContain(sourceB)
    expect(retrieval.search).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({ knowledgeItemIds: [sourceA] })
      }),
      expect.any(AbortSignal)
    )
    release?.()
    await completed(service)
    await service.startTurn('Now use the new sources too')
    await completed(service)
    expect(retrieval.search).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({ knowledgeItemIds: [sourceA, sourceB] })
      }),
      expect.any(AbortSignal)
    )
  })

  it('keeps the admitted history when sources change during the initial request save', async () => {
    const ids = [sourceA]
    const { service, runtime, retrieval } = await harness({ sourceIds: ids, evidence: false })
    await service.startTurn('First question')
    await completed(service)
    const saved = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const start = ModelRequestRepository.prototype.start
    const save = vi
      .spyOn(ModelRequestRepository.prototype, 'start')
      .mockImplementationOnce(async function (this: ModelRequestRepository, input) {
        const record = await start.call(this, input)
        saved.resolve()
        await release.promise
        return record
      })
    try {
      await service.startTurn('Continue the first question')
      await saved.promise
      ids.push(sourceB)
      const changed = await service.snapshot()
      expect(changed.messages.at(-1)?.role).toBe('source_boundary')
      release.resolve()
      await completed(service)
      expect(runtime.calls[1]?.history).toEqual([
        expect.objectContaining({ role: 'user', content: 'First question' }),
        expect.objectContaining({ role: 'assistant' })
      ])
      expect(retrieval.search).toHaveBeenLastCalledWith(
        expect.objectContaining({
          filters: expect.objectContaining({ knowledgeItemIds: [sourceA] })
        }),
        expect.any(AbortSignal)
      )
      await service.startTurn('Use the updated source set')
      await completed(service)
      expect(runtime.calls[2]?.history).toEqual([])
    } finally {
      release.resolve()
      save.mockRestore()
      await service.close()
    }
  })

  it('rechecks the source set after model resolution even before the first chat message', async () => {
    const ids = [sourceA]
    const { service, runtime, agentCatalog, database } = await harness({ sourceIds: ids })
    const before = await service.snapshot()
    const resolved = await agentCatalog.resolve()
    const resolving = Promise.withResolvers<void>()
    const release = Promise.withResolvers<typeof resolved>()
    agentCatalog.resolve.mockImplementationOnce(() => {
      resolving.resolve()
      return release.promise
    })
    const starting = service.startTurn('Use the current sources')
    try {
      await Promise.race([resolving.promise, starting])
      ids.push(sourceB)
      const changed = await service.snapshot()
      expect(changed.contextEpoch).toBe(before.contextEpoch)
      expect(changed.availableKnowledgeItemIds).toEqual([sourceA, sourceB])
      release.resolve(resolved)
      await expect(starting).rejects.toThrow('Notebook sources changed')
      expect(runtime.calls).toEqual([])
      expect(await database.kysely.selectFrom('model_requests').select('status').execute()).toEqual(
        []
      )
    } finally {
      release.resolve(resolved)
      await Promise.allSettled([starting])
      await service.close()
    }
  })

  it('refreshes all sources between turns without expanding explicit selections', async () => {
    const ids = [sourceA]
    const { service, retrieval, currentIndexedSources } = await harness({
      sourceIds: ids,
      evidence: false
    })
    await service.snapshot()
    ids.push(sourceB)
    await service.startTurn('New source included')
    await completed(service)
    expect(retrieval.search).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({ knowledgeItemIds: [sourceA, sourceB] })
      }),
      expect.any(AbortSignal)
    )
    await service.setSources({ mode: 'selected', knowledgeItemIds: [sourceA] })
    ids.push(randomUUID())
    expect((await service.snapshot()).sourceScope.knowledgeItemIds).toEqual([sourceA])
    currentIndexedSources.mockResolvedValueOnce({ state: 'unavailable' })
    expect((await service.snapshot()).sourceReadiness).toBe('unavailable')
    ids.splice(0, 1)
    expect((await service.snapshot()).sourceScope.knowledgeItemIds).toEqual([])
  })

  it.each(['same sources', 'older sources'] as const)(
    'reconciles only once when a late snapshot returns %s',
    async (late) => {
      const ids = [sourceA]
      const { service, currentIndexedSources } = await harness({ sourceIds: ids })
      await service.startTurn('Use the first source')
      const before = await completed(service)
      const oldIndex = await currentIndexedSources()
      ids.push(sourceB)
      const newIndex = await currentIndexedSources()
      const reading = Promise.withResolvers<void>()
      const release = Promise.withResolvers<typeof oldIndex>()
      currentIndexedSources.mockImplementationOnce(() => {
        reading.resolve()
        return release.promise
      })
      const older = service.snapshot()
      try {
        await reading.promise
        const newer = await service.snapshot()
        expect(newer.contextEpoch).toBe(before.contextEpoch + 1)
        expect(newer.availableKnowledgeItemIds).toEqual([sourceA, sourceB])
        release.resolve(late === 'older sources' ? oldIndex : newIndex)
        expect(await older).toEqual(newer)
        expect(newer.messages.filter((message) => message.role === 'source_boundary')).toHaveLength(
          1
        )
      } finally {
        release.resolve(oldIndex)
        await older
        await service.close()
      }
    }
  )

  it('defaults to all indexed sources and skips the answer model when evidence is absent', async () => {
    const { service, retrieval, runtime } = await harness({ evidence: false })
    const initial = await service.snapshot()
    expect(initial.sourceScope).toEqual({ mode: 'all', knowledgeItemIds: [] })
    expect(initial.availableKnowledgeItemIds).toEqual([sourceA, sourceB])

    await service.startTurn('What does the evidence say?')
    const snapshot = await completed(service)
    expect(retrieval.search).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({ knowledgeItemIds: [sourceA, sourceB] })
      }),
      expect.any(AbortSignal)
    )
    expect(runtime.calls).toHaveLength(1)
    expect(snapshot.messages.at(-1)).toMatchObject({
      role: 'assistant',
      status: 'complete',
      content: '选中的资料中没有足够信息。'
    })
  })

  it('streams one metadata-only answer call and binds a per-message citation registry', async () => {
    const { service, runtime, logger, database } = await harness()
    await service.setSources({ mode: 'selected', knowledgeItemIds: [sourceA] })
    await service.startTurn('Summarize the evidence.')
    const snapshot = await completed(service)
    const assistant = snapshot.messages.at(-1)
    expect(assistant).toMatchObject({
      role: 'assistant',
      status: 'complete',
      citations: [{ ordinal: 1, citationId, knowledgeItemId: sourceA }]
    })
    expect(runtime.calls).toHaveLength(1)
    expect(runtime.calls[0]).toMatchObject({
      toolProfile: 'notebook_knowledge',
      thinkingLevel: 'off'
    })
    const modelRequests = await database.kysely.selectFrom('model_requests').selectAll().execute()
    expect(modelRequests).toHaveLength(3)
    expect(modelRequests.every((request) => request.response_ids_json === '[]')).toBe(true)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'security.notebook_citation_marker_rejected',
        unknownCount: 1
      }),
      expect.any(String)
    )
  })

  it('accepts repeated registered citations without security warnings', async () => {
    const { service, logger } = await harness({ answer: 'First [[cite:1]]. Again [[cite:1]].' })
    await service.startTurn('Summarize the evidence.')
    const snapshot = await completed(service)
    expect(snapshot.messages.at(-1)).toMatchObject({
      content: 'First [[cite:1]]. Again [[cite:1]].',
      citations: [{ ordinal: 1, citationId, knowledgeItemId: sourceA }]
    })
    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: 'security.notebook_citation_marker_rejected' }),
      expect.any(String)
    )
  })

  it('inserts a source boundary and excludes old questions from the next retrieval query', async () => {
    const { service, runtime } = await harness({ answer: 'First [[cite:1]].' })
    await service.startTurn('Old scope question')
    await completed(service)
    await service.setSources({ mode: 'selected', knowledgeItemIds: [sourceA] })
    const afterChange = await service.snapshot()
    expect(afterChange.messages.at(-1)).toMatchObject({
      role: 'source_boundary',
      content: 'Sources changed'
    })
    await service.startTurn('New scope question')
    await completed(service)
    expect(runtime.calls[1]?.history).toEqual([])
  })

  it('refreshes sources when chat has no room for another message', async () => {
    const ids = [sourceA]
    const { service } = await harness({ sourceIds: ids })
    await service.startTurn('Keep this question')
    let full = await completed(service)
    while (full.messages.length < NOTEBOOK_MAX_MESSAGES) {
      full = await service.setSources(
        full.sourceScope.mode === 'all'
          ? { mode: 'selected', knowledgeItemIds: [sourceA] }
          : { mode: 'all', knowledgeItemIds: [] }
      )
    }
    ids.push(sourceB)
    const changed = await service.snapshot()
    expect(changed.availableKnowledgeItemIds).toEqual([sourceA, sourceB])
    expect(changed.contextEpoch).toBe(full.contextEpoch + 1)
    expect(changed.messages).toEqual(full.messages)
    await expect(service.startTurn('Another question')).rejects.toThrow('temporary chat limit')
    expect((await service.clear()).messages).toEqual([])
  })

  it('refreshes sources when the chat text leaves no room for a marker', async () => {
    const ids = [sourceA]
    const question = 'Keep this question'
    const answer = 'x'.repeat(NOTEBOOK_MAX_CHAT_BYTES - Buffer.byteLength(question))
    const { service } = await harness({ sourceIds: ids, answer })
    await service.startTurn(question)
    const full = await completed(service)
    expect(full.messages.at(-1)?.content.length).toBe(answer.length)
    ids.push(sourceB)
    const changed = await service.snapshot()
    expect(changed.availableKnowledgeItemIds).toEqual([sourceA, sourceB])
    expect(changed.contextEpoch).toBe(full.contextEpoch + 1)
    expect(changed.messages).toEqual(full.messages)
    await expect(service.startTurn('Another question')).rejects.toThrow('temporary chat limit')
    expect((await service.clear()).messages).toEqual([])
  })

  it('stops an overflowing multibyte delta before it enters a snapshot', async () => {
    const firstQuestion = 'Keep this question'
    const nextQuestion = 'Continue'
    const answer = 'x'.repeat(
      NOTEBOOK_MAX_CHAT_BYTES - Buffer.byteLength(firstQuestion + nextQuestion) - 5
    )
    const { service, runtime } = await harness({ answer })
    await service.startTurn(firstQuestion)
    await completed(service)
    runtime.block = true
    const eventHandler =
      Promise.withResolvers<Parameters<AgentSessionRuntime['beginSessionRun']>[4]>()
    const begin = runtime.beginSessionRun.bind(runtime)
    vi.spyOn(runtime, 'beginSessionRun').mockImplementationOnce((...args) => {
      eventHandler.resolve(args[4])
      return begin(...args)
    })
    try {
      await service.startTurn(nextQuestion)
      const onEvent = await eventHandler.promise
      await onEvent({ type: 'assistant_delta', delta: '🙂' })
      expect((await service.snapshot()).messages.at(-1)).toMatchObject({
        content: '🙂',
        status: 'streaming'
      })
      await expect(
        Promise.resolve(onEvent({ type: 'assistant_delta', delta: '界' }))
      ).rejects.toThrow('temporary chat limit')
      const after = await completed(service)
      expect(after.messages.at(-1)).toMatchObject({ content: '🙂', status: 'failed' })
      expect(after.lastError).toContain('temporary chat limit')
    } finally {
      await service.close()
    }
  })

  it('marks an active turn stopped and releases all memory on close', async () => {
    const { service, runtime } = await harness()
    runtime.block = true
    await service.startTurn('Wait for me')
    await vi.waitFor(() => expect(runtime.calls).toHaveLength(1))
    const stopped = await service.stopTurn()
    expect(stopped.phase).toBe('idle')
    expect(stopped.messages.at(-1)).toMatchObject({ role: 'assistant', status: 'stopped' })
    await service.close()
    await expect(service.snapshot()).rejects.toThrow('closed')
  })

  it.each(['stopping', 'idle'] as const)(
    'settles Stop while publication of the %s snapshot is pending',
    async (phase) => {
      const { serviceOptions, runtime, database } = await harness()
      runtime.block = true
      const publishing = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const service = new KnowledgeChatService({
        ...serviceOptions,
        publish: async (event) => {
          if (
            event.kind === 'snapshot' &&
            event.snapshot.phase === phase &&
            event.snapshot.messages.length > 0
          ) {
            publishing.resolve()
            await release.promise
          }
        }
      })
      await service.startTurn('Wait for me')
      await vi.waitFor(() => expect(runtime.calls).toHaveLength(1))
      const result = Promise.allSettled([service.stopTurn()])
      const settled = vi.fn()
      void result.then(settled)
      try {
        await Promise.race([publishing.promise, result])
        await vi.waitFor(() => expect(settled).toHaveBeenCalledOnce())
        expect(await result).toMatchObject([
          { status: 'fulfilled', value: { phase: 'idle', activeTurnId: null } }
        ])
        const stopped = await service.snapshot()
        expect(stopped.messages.at(-1)).toMatchObject({ status: 'stopped' })
        expect(
          await database.kysely.selectFrom('model_requests').select('status').execute()
        ).toEqual([{ status: 'aborted' }])
      } finally {
        release.resolve()
        await result
        await service.close()
      }
    }
  )

  it.each(['stopTurn', 'clear', 'close'] as const)(
    'settles the real turn on %s during initial publication',
    async (cancel) => {
      const { serviceOptions, runtime, database } = await harness()
      runtime.block = true
      const publishing = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const service = new KnowledgeChatService({
        ...serviceOptions,
        publish: async (event) => {
          if (event.kind === 'snapshot' && event.snapshot.phase === 'thinking') {
            publishing.resolve()
            await release.promise
          }
        }
      })
      const starting = service.startTurn('Wait for me')
      try {
        await Promise.race([publishing.promise, starting])
        await vi.waitFor(() => expect(runtime.calls).toHaveLength(1))
        const result = await service[cancel]()
        if (cancel === 'close') {
          await expect(service.snapshot()).rejects.toThrow('closed')
        } else {
          expect(result).toMatchObject({ phase: 'idle', activeTurnId: null })
          if (cancel === 'clear') expect(result).toMatchObject({ messages: [] })
          else
            expect(result).toMatchObject({
              messages: [expect.anything(), { role: 'assistant', status: 'stopped' }]
            })
        }
        expect(
          await database.kysely.selectFrom('model_requests').select('status').execute()
        ).toEqual([{ status: 'aborted' }])
      } finally {
        release.resolve()
        await starting
        await service.close()
      }
    }
  )

  it.each(['stopTurn', 'clear', 'close'] as const)(
    'cancels preparation on %s before the model resolves',
    async (cancel) => {
      const { service, agentCatalog, runtime, database } = await harness()
      const initial = await service.snapshot()
      const resolved = await agentCatalog.resolve()
      const resolving = Promise.withResolvers<void>()
      const release = Promise.withResolvers<typeof resolved>()
      agentCatalog.resolve.mockImplementationOnce(() => {
        resolving.resolve()
        return release.promise
      })
      const starting = service.startTurn('Cancel this question')
      try {
        await Promise.race([resolving.promise, starting])
        await expect(service.startTurn('Competing question')).rejects.toThrow('already in progress')
        await expect(service.setSources(initial.sourceScope)).rejects.toThrow('Stop the active')
        const result = await service[cancel]()
        if (cancel !== 'close') {
          expect(result).toMatchObject({ phase: 'idle', activeTurnId: null, messages: [] })
        }
        release.resolve(resolved)
        await expect(starting).rejects.toMatchObject({ name: 'AbortError' })
        expect(runtime.calls).toEqual([])
        expect(
          await database.kysely.selectFrom('model_requests').select('status').execute()
        ).toEqual([])
        if (cancel !== 'close') {
          await service.startTurn('Start a fresh question')
          expect((await completed(service)).messages.at(-1)).toMatchObject({ status: 'complete' })
        }
      } finally {
        release.resolve(resolved)
        await Promise.allSettled([starting])
        await service.close()
      }
    }
  )

  it('keeps a source change that is still resolving out of an active turn', async () => {
    const { service, runtime, currentIndexedSources } = await harness()
    await service.snapshot()
    const indexed = await currentIndexedSources()
    const resolving = Promise.withResolvers<void>()
    const release = Promise.withResolvers<typeof indexed>()
    currentIndexedSources.mockImplementationOnce(() => {
      resolving.resolve()
      return release.promise
    })
    runtime.block = true
    const changing = service.setSources({ mode: 'selected', knowledgeItemIds: [sourceA] })
    try {
      await Promise.race([resolving.promise, changing])
      await service.startTurn('Use the current scope')
      release.resolve(indexed)
      await expect(changing).rejects.toThrow('Stop the active')
      expect((await service.snapshot()).sourceScope).toEqual({ mode: 'all', knowledgeItemIds: [] })
    } finally {
      release.resolve(indexed)
      await Promise.allSettled([changing])
      await service.close()
    }
  })

  it('aborts an unsent metadata-only continuation before Stop completes', async () => {
    const { service, runtime, database } = await harness()
    runtime.block = true
    const eventHandler =
      Promise.withResolvers<Parameters<AgentSessionRuntime['beginSessionRun']>[4]>()
    const authorize = vi.fn()
    const begin = runtime.beginSessionRun.bind(runtime)
    vi.spyOn(runtime, 'beginSessionRun').mockImplementation((...args) => {
      eventHandler.resolve(args[4])
      return { ...begin(...args), authorizeModelCall: authorize }
    })
    await service.startTurn('Gather the evidence.')
    const onEvent = await eventHandler.promise
    const saved = Promise.withResolvers<string>()
    const release = Promise.withResolvers<void>()
    const start = ModelRequestRepository.prototype.start
    const save = vi
      .spyOn(ModelRequestRepository.prototype, 'start')
      .mockImplementationOnce(async function (this: ModelRequestRepository, input) {
        const record = await start.call(this, input)
        saved.resolve(record.modelRequestId)
        await release.promise
        return record
      })
    const continuation = Promise.resolve(
      onEvent({
        type: 'model_call_requested',
        continuationId: randomUUID(),
        reason: 'tool_continuation'
      })
    )
    try {
      const modelRequestId = await Promise.race([saved.promise, continuation.then(() => '')])
      expect(modelRequestId).not.toBe('')
      const stopping = service.stopTurn()
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect((await service.snapshot()).phase).toBe('stopping')
      release.resolve()
      const [snapshot] = await Promise.all([stopping, continuation])
      expect(snapshot.messages.at(-1)).toMatchObject({ status: 'stopped' })
      expect(authorize).not.toHaveBeenCalled()
      expect(save).toHaveBeenCalledWith(expect.objectContaining({ retention: 'metadata_only' }))
      const row = await database.kysely
        .selectFrom('model_requests')
        .select(['status', 'response_ids_json'])
        .where('model_request_id', '=', modelRequestId)
        .executeTakeFirstOrThrow()
      expect(row).toEqual({ status: 'aborted', response_ids_json: '[]' })
    } finally {
      release.resolve()
      save.mockRestore()
      await service.close()
    }
  })

  it.each(['preparing', 'unavailable'] as const)(
    'preserves the source context while the index is %s',
    async (state) => {
      const { service, runtime, currentIndexedSources } = await harness()
      await service.setSources({ mode: 'selected', knowledgeItemIds: [sourceA] })
      await service.startTurn('Keep this question')
      const before = await completed(service)
      currentIndexedSources.mockResolvedValueOnce({ state })
      const waiting = await service.snapshot()
      expect(waiting.sourceReadiness).toBe(state)
      expect(waiting.sourceScope).toEqual(before.sourceScope)
      expect(waiting.availableKnowledgeItemIds).toEqual([])
      expect(waiting.messages).toEqual(before.messages)
      expect(waiting.revision).toBeGreaterThan(before.revision)

      await service.startTurn('Use the same sources again')
      const after = await completed(service)
      expect(after.contextEpoch).toBe(before.contextEpoch)
      expect(after.messages.filter((message) => message.role === 'source_boundary')).toEqual([])
      expect(runtime.calls[1]?.history[0]).toMatchObject({
        role: 'user',
        content: 'Keep this question'
      })
    }
  )

  it('does not repeat a source boundary when an explicit change becomes ready', async () => {
    const { service, currentIndexedSources } = await harness()
    await service.setSources({ mode: 'selected', knowledgeItemIds: [sourceA] })
    await service.startTurn('Use the selected source')
    const before = await completed(service)
    currentIndexedSources.mockResolvedValueOnce({ state: 'preparing' })
    const changed = await service.setSources({ mode: 'all', knowledgeItemIds: [] })
    expect(changed.contextEpoch).toBe(before.contextEpoch + 1)
    expect(changed.messages.at(-1)?.role).toBe('source_boundary')
    const ready = await service.snapshot()
    expect(ready.availableKnowledgeItemIds).toEqual([sourceA, sourceB])
    expect(ready.messages).toEqual(changed.messages)
    expect(ready.contextEpoch).toBe(changed.contextEpoch)
  })

  it('preserves an explicit source selection while a replacement index is preparing', async () => {
    const { service, currentIndexedSources } = await harness()
    await service.snapshot()
    await service.setSources({ mode: 'selected', knowledgeItemIds: [sourceA] })
    currentIndexedSources.mockResolvedValueOnce({ state: 'preparing' })

    const preparing = await service.snapshot()
    expect(preparing.sourceScope).toEqual({ mode: 'selected', knowledgeItemIds: [sourceA] })
    expect(preparing.availableKnowledgeItemIds).toEqual([])

    const ready = await service.snapshot()
    expect(ready.sourceScope).toEqual({ mode: 'selected', knowledgeItemIds: [sourceA] })
    expect(ready.availableKnowledgeItemIds).toEqual([sourceA, sourceB])
  })

  it('rejects out-of-scope searches and citations that were not registered by this run', async () => {
    const outside = await harness({ searchKnowledgeItemIds: [sourceB] })
    await outside.service.setSources({ mode: 'selected', knowledgeItemIds: [sourceA] })
    await outside.service.startTurn('Search outside the scope')
    const outsideSnapshot = await completed(outside.service)
    expect(outsideSnapshot.messages.at(-1)).toMatchObject({ status: 'failed' })
    expect(outside.retrieval.search).not.toHaveBeenCalled()

    const forgedCitation = `citation-${'f'.repeat(40)}`
    const forged = await harness({ readCitationIds: [forgedCitation] })
    await forged.service.startTurn('Read an unregistered citation')
    const forgedSnapshot = await completed(forged.service)
    expect(forgedSnapshot.messages.at(-1)).toMatchObject({ status: 'failed' })
    expect(forged.retrieval.expand).not.toHaveBeenCalled()
  })

  it('clamps the inherited effort and rejects unsupported local effort without changing defaults', async () => {
    const fixture = await harness()
    fixture.agentCatalog.snapshot.mockResolvedValueOnce({
      presets: [],
      defaultSelection: { presetId: 'builtin:openai', modelId: 'gpt-test' },
      defaultThinkingLevel: 'high'
    })

    const initial = await fixture.service.snapshot()
    expect(initial.thinkingLevel).toBe('off')
    await expect(fixture.service.setThinkingLevel('high')).rejects.toThrow('unavailable')
    expect(fixture.agentCatalog.snapshot).toHaveBeenCalledTimes(1)
  })

  it('keeps a supported local effort and passes it through the shared runtime', async () => {
    const fixture = await harness({ reasoning: true, defaultThinkingLevel: 'medium' })
    expect((await fixture.service.snapshot()).thinkingLevel).toBe('medium')
    expect((await fixture.service.setThinkingLevel('high')).thinkingLevel).toBe('high')
    await fixture.service.startTurn('Use high effort')
    await completed(fixture.service)
    expect(fixture.runtime.calls[0]?.thinkingLevel).toBe('high')
    expect(fixture.agentCatalog.snapshot).toHaveBeenCalledTimes(1)
  })

  it('keeps only the newest complete pairs within the 64 KiB Agent history budget', async () => {
    const fixture = await harness({ answer: 'x'.repeat(40_000), readCitationIds: [] })
    await fixture.service.startTurn('First bounded history question')
    await completed(fixture.service)
    await fixture.service.startTurn('Second bounded history question')
    await completed(fixture.service)
    await fixture.service.startTurn('Third bounded history question')
    await completed(fixture.service)

    expect(fixture.runtime.calls[1]?.history).toHaveLength(2)
    expect(fixture.runtime.calls[2]?.history).toHaveLength(2)
    expect(fixture.runtime.calls[2]?.history[0]).toMatchObject({
      role: 'user',
      content: 'Second bounded history question'
    })
  })

  it('registers at most twelve unique citation ordinals and leaves forged markers inactive', async () => {
    const fixture = await harness({
      hitCount: 20,
      readCitationIds: [],
      answer: 'Bounded [[cite:1]] [[cite:12]] [[cite:13]].'
    })
    await fixture.service.startTurn('Find many sources')
    const snapshot = await completed(fixture.service)
    const assistant = snapshot.messages.at(-1)
    expect(assistant?.role).toBe('assistant')
    if (assistant?.role !== 'assistant') throw new Error('Expected Notebook answer')
    expect(assistant.citations).toHaveLength(12)
    expect(assistant.citations.map((citation) => citation.ordinal)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12
    ])
    expect(fixture.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'security.notebook_citation_marker_rejected',
        unknownCount: 1
      }),
      expect.any(String)
    )
  })

  it('requires a configured model and reports retrieval failures without losing the question', async () => {
    const missingModel = await harness()
    missingModel.agentCatalog.snapshot.mockResolvedValueOnce({
      presets: [],
      defaultSelection: null,
      defaultThinkingLevel: 'off'
    } as never)
    await expect(missingModel.service.startTurn('Can I ask?')).rejects.toThrow(
      'Configure and select an Agent model'
    )

    const failed = await harness()
    const retrievalError = new Error('retrieval failed: Keep this question visible')
    failed.retrieval.search.mockRejectedValueOnce(retrievalError)
    await failed.service.startTurn('Keep this question visible')
    const snapshot = await completed(failed.service)
    expect(snapshot.messages).toEqual([
      expect.objectContaining({ role: 'user', content: 'Keep this question visible' }),
      expect.objectContaining({ role: 'assistant', status: 'failed' })
    ])
    expect(snapshot.lastError).toBe('retrieval failed: [REDACTED]')
    expect(failed.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: retrievalError, event: 'knowledge.notebook.tool_failed' }),
      expect.any(String)
    )
  })
})
