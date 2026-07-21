import { describe, expect, it } from 'vitest'
import {
  AGENT_TOOL_ARGUMENT_BYTES,
  agentToolRequestSchema,
  getWritingContextArgsSchema,
  readCitationsArgsSchema,
  readSectionArgsSchema,
  searchKnowledgeArgsSchema
} from './agent-tools'

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
  it('applies bounded defaults without admitting project capabilities in model arguments', () => {
    expect(getWritingContextArgsSchema.parse({})).toEqual({
      includeBrief: true,
      includeOutline: true
    })
    expect(readSectionArgsSchema.parse({ sectionId: capability.agentSessionId })).toMatchObject({
      limit: 20
    })
    expect(searchKnowledgeArgsSchema.parse({ query: 'evidence' })).toMatchObject({
      limit: 10,
      rerank: true
    })
    expect(readCitationsArgsSchema.safeParse({ citationIds: [] }).success).toBe(false)
    expect(
      searchKnowledgeArgsSchema.safeParse({
        query: 'evidence',
        projectSessionId: capability.projectSessionId
      }).success
    ).toBe(false)
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
        toolName: 'propose_brief_update',
        args: {
          manuscriptId: capability.agentSessionId,
          baseBriefVersion: 1,
          changes: { title: 'Revised' }
        }
      })
    ).toMatchObject({
      toolName: 'propose_brief_update',
      args: { schemaVersion: 1, citationIds: [] }
    })
    expect(
      agentToolRequestSchema.safeParse({
        ...capability,
        toolName: 'propose_brief_update',
        args: {
          manuscriptId: capability.agentSessionId,
          baseBriefVersion: 1,
          changes: { title: 'Revised' },
          projectSessionId: capability.projectSessionId
        }
      }).success
    ).toBe(false)
  })
})
