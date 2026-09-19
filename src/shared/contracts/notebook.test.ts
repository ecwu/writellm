import { describe, expect, it } from 'vitest'
import {
  NOTEBOOK_MAX_CHAT_BYTES,
  notebookChatSnapshotSchema,
  notebookChatStartTurnInputSchema,
  notebookSourceScopeSchema
} from './notebook'

const notebookId = '019d0000-0000-7000-8000-000000000499'
const projectSessionId = '019d0000-0000-7000-8000-000000000401'

describe('Notebook chat contracts', () => {
  it.each([51, 201, 301, 1_000])('accepts %i selected and available sources', (count) => {
    const ids = Array.from(
      { length: count },
      (_, index) => `019d0000-0000-7000-8000-${String(index).padStart(12, '0')}`
    )
    expect(
      notebookSourceScopeSchema.parse({ mode: 'selected', knowledgeItemIds: ids }).knowledgeItemIds
    ).toEqual(ids)
    expect(notebookChatSnapshotSchema.shape.availableKnowledgeItemIds.parse(ids)).toEqual(ids)
  })

  it('accepts a bounded idle snapshot and source scope', () => {
    expect(
      notebookChatSnapshotSchema.parse({
        projectSessionId,
        notebookId,
        revision: 0,
        phase: 'idle',
        activeTurnId: null,
        sourceScope: { mode: 'all', knowledgeItemIds: [] },
        sourceReadiness: 'ready',
        availableKnowledgeItemIds: ['019d0000-0000-7000-8000-000000000402'],
        modelSelection: { presetId: 'builtin:openai', modelId: 'gpt-test' },
        thinkingLevel: 'medium',
        contextEpoch: 0,
        messages: [],
        lastError: null
      })
    ).toMatchObject({ phase: 'idle', sourceReadiness: 'ready' })
  })

  it('rejects inconsistent activity, duplicate sources, and oversized content', () => {
    expect(() =>
      notebookChatSnapshotSchema.parse({
        projectSessionId,
        notebookId,
        revision: 0,
        phase: 'generating',
        activeTurnId: null,
        sourceScope: { mode: 'all', knowledgeItemIds: [] },
        sourceReadiness: 'ready',
        availableKnowledgeItemIds: [],
        modelSelection: null,
        thinkingLevel: 'off',
        contextEpoch: 0,
        messages: [],
        lastError: null
      })
    ).toThrow('active turn')
    expect(() =>
      notebookSourceScopeSchema.parse({
        mode: 'selected',
        knowledgeItemIds: [
          '019d0000-0000-7000-8000-000000000402',
          '019d0000-0000-7000-8000-000000000402'
        ]
      })
    ).toThrow('unique')
    expect(() =>
      notebookChatStartTurnInputSchema.parse({
        projectSessionId,
        notebookId,
        content: 'x'.repeat(NOTEBOOK_MAX_CHAT_BYTES)
      })
    ).toThrow()
  })
})
