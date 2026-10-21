import { describe, expect, it } from 'vitest'
import { agentToolEnvelope } from '../shared/agent-tool-specs'
import { agentRuntimeMessageBudget } from '../shared/agent-context-budget'
import type { AgentRunStart } from '../shared/contracts/agent'
import { prepareAgentSessionRuntime } from './agent-session-runtime'

const request = (overrides: Partial<AgentRunStart> = {}): AgentRunStart => ({
  operation: 'run_start',
  requestId: '00000000-0000-4000-8000-000000000001',
  projectSessionId: 'project-session',
  agentSessionId: 'agent-session',
  agentRunId: 'agent-run',
  modelRequestId: 'model-request',
  config: {
    role: 'agent',
    providerId: 'openai',
    model: 'test-model',
    api: 'openai-completions',
    baseUrl: 'https://example.test/v1'
  },
  credential: { apiKey: 'test-key' },
  systemPrompt: 'Write clearly.',
  history: [],
  prompt: 'Draft a paragraph.',
  modelLimits: {
    contextWindowTokens: 16_384,
    inputLimitTokens: 8_192,
    outputLimitTokens: 4_096
  },
  toolProfile: 'writing',
  interactionMode: 'write',
  activeToolGroups: [],
  traceCapture: false,
  thinkingLevel: 'off',
  maxOutputTokens: 1_024,
  ...overrides
})

describe('prepareAgentSessionRuntime', () => {
  it('derives the initial tool envelope and matching context budget', () => {
    const prepared = prepareAgentSessionRuntime(request())
    expect(prepared.initialTools.map((tool) => tool.name)).toContain('get_writing_context')
    expect(prepared.currentRuntimeMessageBudgetTokens).toBe(
      agentRuntimeMessageBudget({
        maxOutputTokens: 1_024,
        limits: request().modelLimits,
        systemPrompt: 'Write clearly.',
        advertisedTools: agentToolEnvelope(prepared.initialTools)
      })
    )
  })

  it('keeps an authorized runtime budget when one is supplied', () => {
    const prepared = prepareAgentSessionRuntime(
      request({ runtimeMessageBudgetTokens: 3_000, activeToolGroups: ['section'] })
    )
    expect(prepared.currentRuntimeMessageBudgetTokens).toBe(3_000)
    expect(prepared.activeToolGroups).toEqual(['section'])
  })
})
