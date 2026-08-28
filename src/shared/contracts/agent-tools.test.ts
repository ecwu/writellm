import { describe, expect, it } from 'vitest'
import {
  AGENT_TOOL_ARGUMENT_BYTES,
  agentToolCallPayloadSchema,
  agentToolRequestSchema,
  agentToolResultPayloadSchema,
  askUserAnswersSchema,
  askUserArgsSchema,
  getWritingContextArgsSchema,
  readCitationsArgsSchema,
  readWritingSkillResultSchema,
  readSectionArgsSchema,
  searchKnowledgeArgsSchema,
  toolResultMetaSchema
} from './agent-tools'
import { AGENT_TOOL_CONTRACT_VERSION } from './agent-mutations'

const capability = {
  type: 'tool_request' as const,
  requestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc510',
  projectSessionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc511',
  agentSessionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc512',
  agentRunId: '019c6a5c-8d34-7a8e-a602-3d37a52dc513',
  toolCallId: 'tool-1',
  modelRequestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc514'
}

describe('Agent read-tool contracts', () => {
  it('writes contract v11 while retaining v2-v10 event replay compatibility', () => {
    expect(AGENT_TOOL_CONTRACT_VERSION).toBe(11)
    for (const contractVersion of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
      expect(
        toolResultMetaSchema.parse({
          contractVersion,
          toolName: 'get_writing_context',
          toolCallId: 'tool-historical',
          modelRequestId: capability.modelRequestId
        }).contractVersion
      ).toBe(contractVersion)
    }
    expect(
      agentToolCallPayloadSchema.parse({
        toolCallId: 'tool-v1',
        toolName: 'get_writing_context',
        args: {},
        timestamp: 1
      }).contractVersion
    ).toBe(1)
    expect(
      agentToolResultPayloadSchema.parse({
        toolCallId: 'tool-v7',
        toolName: 'get_writing_context',
        contractVersion: 7,
        isError: true,
        result: null,
        error: { code: 'not_found', message: 'Historical safe error.' },
        citationIds: [],
        knowledgeItemIds: [],
        parseRevisionIds: [],
        timestamp: 1
      }).error
    ).toEqual({ code: 'not_found', message: 'Historical safe error.' })
  })

  it('applies bounded defaults without admitting project capabilities in model arguments', () => {
    expect(getWritingContextArgsSchema.parse({})).toEqual({
      includeBrief: true,
      includeOutline: true
    })
    expect(readSectionArgsSchema.parse({ sectionId: capability.agentSessionId })).toMatchObject({
      limit: 20
    })
    expect(
      readSectionArgsSchema.parse({
        sectionId: capability.agentSessionId,
        view: 'table',
        blockId: 'table-1'
      })
    ).toMatchObject({ rowOffset: 0, rowLimit: 20 })
    expect(searchKnowledgeArgsSchema.parse({ query: 'evidence' })).toMatchObject({
      limit: 10,
      rerank: true
    })
    expect(readCitationsArgsSchema.safeParse({ citationIds: [] }).success).toBe(false)
    expect(
      readCitationsArgsSchema.parse({
        requests: [
          {
            citationId: `citation-${'a'.repeat(40)}`,
            maxChars: 16_384
          }
        ]
      })
    ).toMatchObject({ citationIds: [], requests: [{ offset: 0, maxChars: 16_384 }] })
    expect(
      searchKnowledgeArgsSchema.safeParse({
        query: 'evidence',
        projectSessionId: capability.projectSessionId
      }).success
    ).toBe(false)
  })

  it('accepts curated progressive references above the custom-skill reference limit', () => {
    expect(
      readWritingSkillResultSchema.parse({
        skillId: 'nature-writing',
        displayName: 'Nature Writing',
        commit: 'a'.repeat(40),
        relativePath: 'SKILL.md',
        sha256: 'b'.repeat(64),
        byteSize: 6_488,
        content: 'Skill guidance',
        references: [
          {
            skillId: 'nature-writing',
            displayName: 'Nature Writing',
            relativePath: 'references/introduction.md',
            uri: `writellm://skills/nature-writing/${'a'.repeat(40)}/references/introduction.md`,
            sha256: 'c'.repeat(64),
            byteSize: 15_709
          }
        ],
        dependencies: []
      })
    ).toMatchObject({ references: [{ byteSize: 15_709 }] })
  })

  it('binds requests to session, run, tool call, and model request capabilities', () => {
    expect(
      agentToolRequestSchema.parse({
        ...capability,
        toolName: 'search_knowledge',
        args: { query: 'attention' }
      })
    ).toMatchObject({
      projectSessionId: capability.projectSessionId,
      agentRunId: capability.agentRunId,
      modelRequestId: capability.modelRequestId,
      args: { query: 'attention', limit: 10 }
    })
    expect(
      agentToolRequestSchema.safeParse({
        ...capability,
        toolName: 'read_section',
        args: {
          sectionId: capability.agentSessionId,
          cursor: 'cursor',
          blockIds: ['block-1']
        }
      }).success
    ).toBe(false)
    expect(
      agentToolRequestSchema.parse({
        ...capability,
        toolName: 'read_citations',
        args: {
          requests: [
            {
              citationId: `citation-${'a'.repeat(40)}`,
              maxChars: 16_384
            }
          ]
        }
      })
    ).toMatchObject({
      toolName: 'read_citations',
      args: { citationIds: [], requests: [{ offset: 0, maxChars: 16_384 }] }
    })
  })

  it('validates bounded clarification questions and exact answer kinds', () => {
    const args = askUserArgsSchema.parse({
      questions: [
        {
          id: 'document_scope',
          header: 'Scope',
          question: 'Which part should the revision cover?',
          options: [
            { label: 'Current section (Recommended)', description: 'Keep the change focused.' },
            { label: 'Entire document', description: 'Apply the decision throughout.' }
          ]
        },
        {
          id: 'tone',
          header: 'Tone',
          question: 'Which tone should the revision use?',
          options: [
            { label: 'Formal', description: 'Use a restrained professional voice.' },
            { label: 'Conversational', description: 'Use a more approachable voice.' }
          ]
        }
      ]
    })
    expect(args.questions.map((question) => question.id)).toEqual(['document_scope', 'tone'])
    expect(
      agentToolRequestSchema.parse({ ...capability, toolName: 'ask_user', args }).toolName
    ).toBe('ask_user')
    expect(
      askUserAnswersSchema.parse([
        { questionId: 'document_scope', kind: 'option', value: 'Current section (Recommended)' },
        { questionId: 'tone', kind: 'custom', value: 'Precise but approachable' }
      ])
    ).toHaveLength(2)

    expect(
      askUserArgsSchema.safeParse({
        questions: [{ ...args.questions[0], id: 'Not-Snake' }]
      }).success
    ).toBe(false)
    expect(
      askUserArgsSchema.safeParse({
        questions: [args.questions[0], { ...args.questions[1], id: 'document_scope' }]
      }).success
    ).toBe(false)
    expect(
      askUserArgsSchema.safeParse({
        questions: [
          {
            ...args.questions[0],
            options: [
              { label: 'Same', description: 'First.' },
              { label: 'Same', description: 'Second.' }
            ]
          }
        ]
      }).success
    ).toBe(false)
    expect(
      askUserArgsSchema.safeParse({
        questions: Array.from({ length: 4 }, (_, index) => ({
          ...args.questions[0],
          id: `question_${index}`
        }))
      }).success
    ).toBe(false)
    expect(askUserAnswersSchema.safeParse([]).success).toBe(false)
    expect(
      askUserAnswersSchema.safeParse([
        { questionId: 'tone', kind: 'option', value: 'Formal' },
        { questionId: 'tone', kind: 'custom', value: 'Friendly' }
      ]).success
    ).toBe(false)
    expect(
      askUserAnswersSchema.safeParse([{ questionId: 'tone', kind: 'custom', value: ' '.repeat(2) }])
        .success
    ).toBe(false)
    expect(
      askUserAnswersSchema.safeParse([
        { questionId: 'tone', kind: 'custom', value: 'x'.repeat(4_097) }
      ]).success
    ).toBe(false)
  })

  it('rejects unknown tools and argument payloads beyond the bridge bound', () => {
    expect(
      agentToolRequestSchema.safeParse({ ...capability, toolName: 'read_file', args: {} }).success
    ).toBe(false)
    expect(
      agentToolRequestSchema.safeParse({
        ...capability,
        toolName: 'search_knowledge',
        args: { query: 'x'.repeat(AGENT_TOOL_ARGUMENT_BYTES) }
      }).success
    ).toBe(false)
  })

  it('accepts only typed proposal tools and never admits project capabilities in their arguments', () => {
    expect(
      agentToolRequestSchema.parse({
        ...capability,
        toolName: 'submit_brief_change',
        args: {
          changes: { title: 'Revised' }
        }
      })
    ).toMatchObject({
      toolName: 'submit_brief_change',
      args: { changes: { title: 'Revised' }, citationIds: [] }
    })
    expect(
      agentToolRequestSchema.safeParse({
        ...capability,
        toolName: 'submit_brief_change',
        args: {
          changes: { title: 'Revised' },
          projectSessionId: capability.projectSessionId
        }
      }).success
    ).toBe(false)
  })
})
