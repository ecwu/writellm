import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  harness,
  completed,
  sourceA,
  sourceB,
  citationId
} from './knowledge-chat-service.test-support'

describe('KnowledgeChatService', () => {
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
