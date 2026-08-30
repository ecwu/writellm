export interface ProposalToolExecutionContext {
  agentSessionId: string
  agentRunId: string
  toolCallId: string
  toolCallEventId: string
  modelRequestId: string
  createdSectionRefs?: Record<string, string>
  createdBlockRefs?: Record<string, string>
  tableOperationKinds?: string[]
  resolvesReviewIssues?: Array<{
    issueId: string
    expectedVersion: number
    resolutionSummary: string
  }>
  signal: AbortSignal
}

export class MutationProposalError extends Error {
  constructor(
    readonly code:
      | 'proposal_not_found'
      | 'proposal_not_pending'
      | 'proposal_not_applied'
      | 'proposal_not_undoable'
      | 'stale_base'
      | 'invalid_proposal',
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'MutationProposalError'
  }
}
