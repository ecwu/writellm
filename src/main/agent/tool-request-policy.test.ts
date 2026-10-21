import { describe, expect, it } from 'vitest'
import type { AgentToolRequest } from '../../shared/contracts/agent-tools'
import { authorizeAgentToolRequest } from './tool-request-policy'

const request = (overrides: Record<string, unknown> = {}): AgentToolRequest =>
  ({
    type: 'tool_request',
    requestId: '00000000-0000-4000-8000-000000000001',
    projectSessionId: 'project-session',
    agentSessionId: 'agent-session',
    agentRunId: 'agent-run',
    toolCallId: 'tool-call',
    modelRequestId: 'model-request',
    toolName: 'get_writing_context',
    args: { includeBrief: true, includeOutline: true },
    ...overrides
  }) as AgentToolRequest

const baseInput = () => ({
  request: request(),
  projectSessionId: 'project-session',
  agentSessionId: 'agent-session',
  agentRunId: 'agent-run',
  authorizedModelRequestIds: new Set(['model-request']),
  activeToolGroups: [],
  interactionMode: 'write' as const,
  signalAborted: false
})

describe('authorizeAgentToolRequest', () => {
  it('keeps capability mismatch ahead of cancellation and active-group checks', () => {
    expect(
      authorizeAgentToolRequest({
        ...baseInput(),
        request: request({ projectSessionId: 'other-project' }),
        signalAborted: true,
        activeToolGroups: []
      })
    ).toBe('capability_mismatch')
  })

  it('rejects an authorized request after cancellation', () => {
    expect(authorizeAgentToolRequest({ ...baseInput(), signalAborted: true })).toBe('aborted')
  })

  it('enforces the interaction-mode and active-group ceiling', () => {
    expect(
      authorizeAgentToolRequest({
        ...baseInput(),
        request: request({ toolName: 'submit_section_change', args: {} })
      })
    ).toBe('inactive_group')
  })

  it('authorizes a request in the active tool set', () => {
    expect(authorizeAgentToolRequest(baseInput())).toBe('authorized')
  })
})
