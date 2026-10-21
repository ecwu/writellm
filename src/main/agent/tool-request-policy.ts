import { activeAgentToolSetAllows } from '../../shared/agent-tool-specs'
import type { AgentInteractionMode, WritingToolGroup } from '../../shared/contracts/agent'
import type { AgentToolRequest } from '../../shared/contracts/agent-tools'

export type AgentToolAuthorization =
  | 'authorized'
  | 'capability_mismatch'
  | 'aborted'
  | 'inactive_group'

export interface AgentToolAuthorizationInput {
  readonly request: AgentToolRequest
  readonly projectSessionId: string
  readonly agentSessionId: string
  readonly agentRunId: string
  readonly authorizedModelRequestIds: ReadonlySet<string>
  readonly activeToolGroups: readonly WritingToolGroup[]
  readonly interactionMode: AgentInteractionMode
  readonly signalAborted: boolean
}

/**
 * Keep the pre-dispatch checks in one ordered policy stage. The order is part
 * of the tool capability contract: identity is checked before cancellation,
 * and cancellation is checked before the active tool-group ceiling.
 */
export function authorizeAgentToolRequest(
  input: AgentToolAuthorizationInput
): AgentToolAuthorization {
  const { request } = input
  if (
    request.projectSessionId !== input.projectSessionId ||
    request.agentSessionId !== input.agentSessionId ||
    request.agentRunId !== input.agentRunId ||
    !input.authorizedModelRequestIds.has(request.modelRequestId)
  ) {
    return 'capability_mismatch'
  }
  if (input.signalAborted) return 'aborted'
  if (
    !activeAgentToolSetAllows(
      'writing',
      input.activeToolGroups,
      request.toolName,
      input.interactionMode
    )
  ) {
    return 'inactive_group'
  }
  return 'authorized'
}
