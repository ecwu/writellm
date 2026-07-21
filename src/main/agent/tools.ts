import type { AgentEditorContext } from '../../shared/contracts/agent'
import {
  agentProposalToolNameSchema,
  type MutationProposalToolResult
} from '../../shared/contracts/agent-mutations'
import {
  agentReadToolNameSchema,
  type AgentToolName,
  type ReadCitationsResult,
  type ReadSectionResult,
  type SearchKnowledgeResult,
  type WritingContextResult
} from '../../shared/contracts/agent-tools'
import type { AgentContextBuilder } from './context'
import type { MutationProposalService } from './mutation-service'
import type { AgentReadToolExecutor } from './read-tools'

interface AgentToolResultMap {
  get_writing_context: WritingContextResult
  read_section: ReadSectionResult
  search_knowledge: SearchKnowledgeResult
  read_citations: ReadCitationsResult
  propose_brief_update: MutationProposalToolResult
  propose_outline_patch: MutationProposalToolResult
  propose_section_patch: MutationProposalToolResult
}

export interface AgentToolExecutionInput<TName extends AgentToolName = AgentToolName> {
  toolName: TName
  args: unknown
  editorContext: AgentEditorContext
  agentSessionId: string
  agentRunId: string
  toolCallId: string
  toolCallEventId: string
  modelRequestId: string
  signal: AbortSignal
}

export interface AgentToolExecutor {
  execute<TName extends AgentToolName>(
    input: AgentToolExecutionInput<TName>
  ): Promise<AgentToolResultMap[TName]>
}

export class MainAgentTools implements AgentToolExecutor {
  constructor(
    private readonly readTools: AgentReadToolExecutor & { contextBuilder(): AgentContextBuilder },
    readonly mutations: MutationProposalService
  ) {}

  contextBuilder(): AgentContextBuilder {
    return this.readTools.contextBuilder()
  }

  async execute<TName extends AgentToolName>(
    input: AgentToolExecutionInput<TName>
  ): Promise<AgentToolResultMap[TName]> {
    const readName = agentReadToolNameSchema.safeParse(input.toolName)
    if (readName.success) {
      return this.readTools.execute({
        toolName: readName.data,
        args: input.args,
        editorContext: input.editorContext,
        signal: input.signal
      }) as Promise<AgentToolResultMap[TName]>
    }
    const proposalName = agentProposalToolNameSchema.parse(input.toolName)
    return Promise.resolve(
      this.mutations.propose(proposalName, input.args, {
        agentSessionId: input.agentSessionId,
        agentRunId: input.agentRunId,
        toolCallId: input.toolCallId,
        toolCallEventId: input.toolCallEventId,
        modelRequestId: input.modelRequestId,
        signal: input.signal
      }) as AgentToolResultMap[TName]
    )
  }
}
