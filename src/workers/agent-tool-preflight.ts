import { agentToolNameSchema } from '../shared/contracts/agent-tools'

export type AgentToolCallForPreflight = {
  readonly id: string
  readonly name: string
}

export type AgentToolPreflightFailure = {
  readonly code: 'invalid_arguments' | 'unknown_tool'
  readonly message: string
}

/** Validate the batch-level tool rules before any tool can be dispatched. */
export function validateAgentToolCallBatch(input: {
  readonly toolName: string
  readonly calls: readonly AgentToolCallForPreflight[]
  readonly isMutationTool: (toolName: string) => boolean
}): AgentToolPreflightFailure | undefined {
  if (!agentToolNameSchema.safeParse(input.toolName).success) {
    return {
      code: 'unknown_tool',
      message:
        'The requested tool is not authorized by WriteLLM. Choose one of the advertised tools.'
    }
  }
  const clarificationCalls = input.calls.filter((call) => call.name === 'ask_user')
  if (
    clarificationCalls.length > 0 &&
    (clarificationCalls.length !== 1 || input.calls.length !== 1)
  ) {
    return {
      code: 'invalid_arguments',
      message:
        'User clarification must be the only tool in an assistant message. Ask one clarification.'
    }
  }
  const activationCalls = input.calls.filter((call) => call.name === 'activate_tool_groups')
  if (activationCalls.length > 0 && (activationCalls.length !== 1 || input.calls.length !== 1)) {
    return {
      code: 'invalid_arguments',
      message:
        'Tool-group activation must be the only tool in an assistant message. Activate the required groups, then continue on the next turn.'
    }
  }
  const mutationCalls = input.calls.filter((call) => input.isMutationTool(call.name))
  if (input.isMutationTool(input.toolName) && mutationCalls.length > 1) {
    return {
      code: 'invalid_arguments',
      message: 'Only one mutation may be submitted in an assistant message.'
    }
  }
  if (
    input.isMutationTool(input.toolName) &&
    input.calls.some((call) => !input.isMutationTool(call.name))
  ) {
    return {
      code: 'invalid_arguments',
      message:
        'A mutation cannot be mixed with read tools in one assistant message. Finish the reads, then submit exactly one mutation on the next turn.'
    }
  }
  return undefined
}
