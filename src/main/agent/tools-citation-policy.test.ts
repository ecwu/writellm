import { describe, expect, it, vi } from 'vitest'
import { MainAgentTools } from './tools'

const agentSessionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc522'
const agentRunId = '019c6a5c-8d34-7a8e-a602-3d37a52dc523'
const modelRequestId = '019c6a5c-8d34-7a8e-a602-3d37a52dc524'
const sectionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc525'
const revisionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc526'
const citationId = `citation-${'a'.repeat(40)}`

describe('Main Agent citation policy', () => {
  it.each([
    ['internal ID', `Claim (${citationId}).`],
    ['xx placeholder', 'Claim [xx].'],
    ['question placeholder', 'Claim [?].'],
    ['generic placeholder', 'Claim [citation].']
  ])('rejects an opaque %s in model-authored section text', async (_label, text) => {
    const { tools, propose } = createTools()

    await expect(submitText(tools, text, [])).rejects.toMatchObject({
      code: 'invalid_arguments',
      message: expect.stringContaining('opaque citation marker')
    })
    expect(propose).not.toHaveBeenCalled()
  })

  it('requires expanded proposal provenance for the readable fallback', async () => {
    const { tools, propose } = createTools()

    await expect(submitText(tools, '[Source: Exact paper title, p. 3]', [])).rejects.toMatchObject({
      code: 'invalid_arguments',
      message: 'Readable source labels require corresponding expanded citationIds'
    })
    expect(propose).not.toHaveBeenCalled()
  })

  it('recognizes the Chinese readable fallback at the proposal boundary', async () => {
    const { tools, propose } = createTools()

    await expect(
      submitText(tools, '【来源：Exact paper title，第 3 页】', [])
    ).rejects.toMatchObject({
      code: 'invalid_arguments',
      message: 'Readable source labels require corresponding expanded citationIds'
    })
    expect(propose).not.toHaveBeenCalled()
  })

  it('accepts a readable fallback with a corresponding citation ID', async () => {
    const { tools, propose } = createTools()

    await submitText(tools, '[Source: Exact paper title, p. 3]', [citationId])

    expect(propose).toHaveBeenCalledWith(
      'submit_section_change',
      expect.objectContaining({ citationIds: [citationId] }),
      expect.objectContaining({ agentSessionId, agentRunId, modelRequestId })
    )
  })

  it('blocks the generic Brief tool from bypassing the Writing Rules contract', async () => {
    const { tools, propose } = createTools()

    await expect(
      tools.execute({
        ...baseExecution('submit_brief_change'),
        args: { changes: { extensible: { writingRulesV1: { schemaVersion: 1, rules: [] } } } }
      })
    ).rejects.toThrow()
    expect(propose).not.toHaveBeenCalled()
  })

  it('normalizes a batch Writing Rules proposal without a separate Agent flow', async () => {
    const { tools, propose } = createTools()

    await tools.execute({
      ...baseExecution('submit_writing_rules_change'),
      args: {
        operations: [
          {
            type: 'add',
            clientRef: 'llm-term',
            rule: {
              category: 'translation',
              instruction: 'Translate LLM consistently.',
              preferredForm: '大型语言模型',
              discouragedForms: ['大语言模型'],
              rationale: null,
              active: true
            }
          },
          {
            type: 'add',
            clientRef: 'academic-tone',
            rule: {
              category: 'academic',
              instruction: 'Qualify causal claims.',
              preferredForm: null,
              discouragedForms: [],
              rationale: null,
              active: true
            }
          }
        ]
      }
    })

    expect(propose).toHaveBeenCalledWith(
      'submit_writing_rules_change',
      expect.objectContaining({
        baseBriefVersion: 1,
        changes: {
          extensible: {
            writingRulesV1: {
              schemaVersion: 1,
              rules: [
                expect.objectContaining({ instruction: 'Translate LLM consistently.' }),
                expect.objectContaining({ instruction: 'Qualify causal claims.' })
              ]
            }
          }
        }
      }),
      expect.objectContaining({ agentSessionId, agentRunId, modelRequestId })
    )
  })
})

function createTools() {
  const propose = vi.fn(() => ({ proposalId: 'proposal' }))
  const tools = new MainAgentTools(
    { contextBuilder: vi.fn() } as never,
    {
      propose,
      assertCanonicalBlockRead: vi.fn(),
      list: vi.fn(() => [])
    } as never
  )
  return { tools, propose }
}

function submitText(tools: MainAgentTools, text: string, citationIds: string[]) {
  return tools.execute({
    toolName: 'submit_section_change',
    args: {
      sectionId,
      operations: [
        {
          type: 'insertTextBlocks',
          anchor: null,
          placement: 'end',
          blocks: [{ blockType: 'paragraph', text }]
        }
      ],
      citationIds
    },
    editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] },
    agentSessionId,
    agentRunId,
    toolCallId: 'tool-call',
    toolCallEventId: 'tool-call-event',
    modelRequestId,
    snapshot: {
      snapshotId: revisionId,
      observedAt: '2026-08-10T00:00:00.000Z',
      workspace: {
        manuscriptId: 'manuscript',
        outlineVersion: 1,
        brief: { version: 1 },
        sections: [
          {
            section: { sectionId, currentRevisionId: revisionId },
            revision: { sectionRevisionId: revisionId }
          }
        ]
      },
      sectionContents: new Map([[revisionId, []]]),
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    } as never,
    signal: new AbortController().signal
  })
}

function baseExecution(toolName: 'submit_brief_change' | 'submit_writing_rules_change') {
  return {
    toolName,
    editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] },
    agentSessionId,
    agentRunId,
    toolCallId: 'tool-call',
    toolCallEventId: 'tool-call-event',
    modelRequestId,
    snapshot: {
      snapshotId: revisionId,
      observedAt: '2026-08-10T00:00:00.000Z',
      workspace: {
        manuscriptId: 'manuscript',
        outlineVersion: 1,
        brief: { version: 1, extensible: {} },
        sections: []
      },
      sectionContents: new Map(),
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] },
      reviewResources: null
    } as never,
    signal: new AbortController().signal
  }
}
