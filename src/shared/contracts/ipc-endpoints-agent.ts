import { z } from 'zod'
import { IPC_CHANNELS } from './channels'
import {
  agentAttachmentActionSchema,
  agentAttachmentImportSchema,
  agentAttachmentSchema,
  agentAttachmentSelectSchema,
  agentAttachmentSelectionSchema,
  agentAttachmentScopeSchema
} from './agent-attachments'
import {
  agentArchiveSessionInputSchema,
  agentArchiveSessionResultSchema,
  agentAnswerUserQuestionInputSchema,
  agentAnswerUserQuestionResultSchema,
  agentCompactSessionInputSchema,
  agentCompactSessionResultSchema,
  agentCreateSessionInputSchema,
  agentCreateSessionResultSchema,
  agentEditLastMessageInputSchema,
  agentEventPageInputSchema,
  agentEventPageSchema,
  agentForkConversationInputSchema,
  agentForkConversationResultSchema,
  agentGenerateSessionTitleInputSchema,
  agentGenerateSessionTitleResultSchema,
  agentListProposalsResultSchema,
  agentListRunsInputSchema,
  agentListRunsResultSchema,
  agentListSessionsInputSchema,
  agentListSessionsResultSchema,
  agentPendingMessageActionInputSchema,
  agentQueueInputSchema,
  agentRestoreSessionInputSchema,
  agentRestoreSessionResultSchema,
  agentRunInputSchema,
  agentSetApprovalModeInputSchema,
  agentSetApprovalModeResultSchema,
  agentSetInteractionModeInputSchema,
  agentSetInteractionModeResultSchema,
  agentSetModelSelectionInputSchema,
  agentSetImageModelSelectionInputSchema,
  agentSetImageModelSelectionResultSchema,
  agentSetModelSelectionResultSchema,
  agentSetThinkingLevelInputSchema,
  agentSetThinkingLevelResultSchema,
  agentStartRunInputSchema,
  agentStartRunResultSchema,
  agentStopCompactionInputSchema,
  agentStopCompactionResultSchema,
  agentSessionInputSchema
} from './agent-ipc'
import { changeSetBatchInputSchema, changeSetBatchResultSchema } from './agent-change-set'
import {
  approveMutationProposalInputSchema,
  approveMutationProposalResultSchema,
  cancelImageGenerationInputSchema,
  cancelImageGenerationResultSchema,
  mutationProposalActionResultSchema,
  rejectMutationProposalInputSchema,
  undoMutationProposalInputSchema
} from './agent-mutations'
import { userUpdateWritingTaskInputSchema, userUpdateWritingTaskResultSchema } from './writing-task'
import {
  defineIpcEndpoint,
  type IpcEndpointApi,
  type IpcEndpointInput,
  type IpcEndpointOutput
} from './ipc-endpoints'
import type {
  AgentEventPage,
  AgentProjectActivitySnapshot,
  AgentRendererEvent,
  AgentRunRecord,
  AgentSessionRecord
} from './agent-ipc'
import type { MutationProposalChanged, MutationSectionChanged } from './agent-mutations'

const undefinedOutput = z.undefined()

/** Direct Agent requests. Event replay and live subscriptions remain explicit lifecycle code. */
export const agentIpcEndpoints = {
  importImage: defineIpcEndpoint({
    channel: IPC_CHANNELS.agentImportImage,
    input: agentAttachmentImportSchema,
    output: agentAttachmentSchema,
    session: 'mutation'
  }),
  selectImages: defineIpcEndpoint({
    channel: IPC_CHANNELS.agentSelectImages,
    input: agentAttachmentSelectSchema,
    output: agentAttachmentSelectionSchema,
    session: 'active'
  }),
  pasteImage: defineIpcEndpoint({
    channel: IPC_CHANNELS.agentPasteImage,
    input: agentAttachmentScopeSchema,
    output: agentAttachmentSchema.nullable(),
    session: 'active'
  }),
  getImage: defineIpcEndpoint({
    channel: IPC_CHANNELS.agentGetImage,
    input: agentAttachmentActionSchema,
    output: agentAttachmentSchema,
    session: 'active'
  }),
  releaseImage: defineIpcEndpoint({
    channel: IPC_CHANNELS.agentReleaseImage,
    input: agentAttachmentActionSchema,
    output: undefinedOutput,
    session: 'active'
  }),
  listSessions: defineIpcEndpoint({
    channel: IPC_CHANNELS.agentListSessions,
    input: agentListSessionsInputSchema,
    output: agentListSessionsResultSchema,
    session: 'active'
  }),
  getSession: defineIpcEndpoint({
    channel: IPC_CHANNELS.agentGetSession,
    input: agentSessionInputSchema,
    output: agentCreateSessionResultSchema,
    session: 'active'
  }),
  forkConversation: defineIpcEndpoint({
    channel: IPC_CHANNELS.agentForkConversation,
    input: agentForkConversationInputSchema,
    output: agentForkConversationResultSchema,
    session: 'mutation'
  }),
  createSession: defineIpcEndpoint({
    channel: IPC_CHANNELS.agentCreateSession,
    input: agentCreateSessionInputSchema,
    output: agentCreateSessionResultSchema,
    session: 'mutation'
  }),
  generateSessionTitle: defineIpcEndpoint({
    channel: IPC_CHANNELS.agentGenerateSessionTitle,
    input: agentGenerateSessionTitleInputSchema,
    output: agentGenerateSessionTitleResultSchema,
    session: 'mutation'
  }),
  archiveSession: defineIpcEndpoint({
    channel: IPC_CHANNELS.agentArchiveSession,
    input: agentArchiveSessionInputSchema,
    output: agentArchiveSessionResultSchema,
    session: 'mutation'
  }),
  restoreSession: defineIpcEndpoint({
    channel: IPC_CHANNELS.agentRestoreSession,
    input: agentRestoreSessionInputSchema,
    output: agentRestoreSessionResultSchema,
    session: 'mutation'
  }),
  setApprovalMode: defineIpcEndpoint({
    channel: IPC_CHANNELS.agentSetApprovalMode,
    input: agentSetApprovalModeInputSchema,
    output: agentSetApprovalModeResultSchema,
    session: 'mutation'
  }),
  setInteractionMode: defineIpcEndpoint({
    channel: IPC_CHANNELS.agentSetInteractionMode,
    input: agentSetInteractionModeInputSchema,
    output: agentSetInteractionModeResultSchema,
    session: 'mutation'
  }),
  setModelSelection: defineIpcEndpoint({
    channel: IPC_CHANNELS.agentSetModelSelection,
    input: agentSetModelSelectionInputSchema,
    output: agentSetModelSelectionResultSchema,
    session: 'mutation'
  }),
  setImageModelSelection: defineIpcEndpoint({
    channel: IPC_CHANNELS.agentSetImageModelSelection,
    input: agentSetImageModelSelectionInputSchema,
    output: agentSetImageModelSelectionResultSchema,
    session: 'mutation'
  }),
  setThinkingLevel: defineIpcEndpoint({
    channel: IPC_CHANNELS.agentSetThinkingLevel,
    input: agentSetThinkingLevelInputSchema,
    output: agentSetThinkingLevelResultSchema,
    session: 'mutation'
  }),
  updateWritingTask: defineIpcEndpoint({
    channel: IPC_CHANNELS.agentUpdateWritingTask,
    input: userUpdateWritingTaskInputSchema,
    output: userUpdateWritingTaskResultSchema,
    session: 'mutation'
  }),
  listEvents: defineIpcEndpoint({
    channel: IPC_CHANNELS.agentListEvents,
    input: agentEventPageInputSchema,
    output: agentEventPageSchema,
    session: 'active'
  }),
  listRuns: defineIpcEndpoint({
    channel: IPC_CHANNELS.agentListRuns,
    input: agentListRunsInputSchema,
    output: agentListRunsResultSchema,
    session: 'active'
  }),
  listProposals: defineIpcEndpoint({
    channel: IPC_CHANNELS.agentListProposals,
    input: agentSessionInputSchema,
    output: agentListProposalsResultSchema,
    session: 'active'
  }),
  editLastMessageAndRestart: defineIpcEndpoint({
    channel: IPC_CHANNELS.agentEditLastMessage,
    input: agentEditLastMessageInputSchema,
    output: agentStartRunResultSchema,
    session: 'mutation'
  }),
  startRun: defineIpcEndpoint({
    channel: IPC_CHANNELS.agentStartRun,
    input: agentStartRunInputSchema,
    output: agentStartRunResultSchema,
    session: 'mutation'
  }),
  steerRun: defineIpcEndpoint({
    channel: IPC_CHANNELS.agentSteerRun,
    input: agentQueueInputSchema,
    output: undefinedOutput,
    session: 'mutation'
  }),
  followUpRun: defineIpcEndpoint({
    channel: IPC_CHANNELS.agentFollowUpRun,
    input: agentQueueInputSchema,
    output: undefinedOutput,
    session: 'mutation'
  }),
  steerPendingFollowUp: defineIpcEndpoint({
    channel: IPC_CHANNELS.agentSteerPendingFollowUp,
    input: agentPendingMessageActionInputSchema,
    output: undefinedOutput,
    session: 'mutation'
  }),
  deletePendingFollowUp: defineIpcEndpoint({
    channel: IPC_CHANNELS.agentDeletePendingFollowUp,
    input: agentPendingMessageActionInputSchema,
    output: undefinedOutput,
    session: 'mutation'
  }),
  abortRun: defineIpcEndpoint({
    channel: IPC_CHANNELS.agentAbortRun,
    input: agentRunInputSchema,
    output: undefinedOutput,
    session: 'mutation'
  }),
  answerUserQuestion: defineIpcEndpoint({
    channel: IPC_CHANNELS.agentAnswerUserQuestion,
    input: agentAnswerUserQuestionInputSchema,
    output: agentAnswerUserQuestionResultSchema,
    session: 'mutation'
  }),
  compactSession: defineIpcEndpoint({
    channel: IPC_CHANNELS.agentCompactSession,
    input: agentCompactSessionInputSchema,
    output: agentCompactSessionResultSchema,
    session: 'mutation'
  }),
  stopCompaction: defineIpcEndpoint({
    channel: IPC_CHANNELS.agentStopCompaction,
    input: agentStopCompactionInputSchema,
    output: agentStopCompactionResultSchema,
    session: 'mutation'
  }),
  // Proposal handlers run the mutation session check inside their lifecycle() wrapper so a stale
  // session still reports the per-operation audit event.
  approveProposal: defineIpcEndpoint({
    channel: IPC_CHANNELS.agentProposalApprove,
    input: approveMutationProposalInputSchema,
    output: approveMutationProposalResultSchema,
    session: 'mutation'
  }),
  rejectProposal: defineIpcEndpoint({
    channel: IPC_CHANNELS.agentProposalReject,
    input: rejectMutationProposalInputSchema,
    output: mutationProposalActionResultSchema,
    session: 'mutation'
  }),
  undoProposal: defineIpcEndpoint({
    channel: IPC_CHANNELS.agentProposalUndo,
    input: undoMutationProposalInputSchema,
    output: mutationProposalActionResultSchema,
    session: 'mutation'
  }),
  decideChangeSet: defineIpcEndpoint({
    channel: IPC_CHANNELS.agentChangeSetBatch,
    input: changeSetBatchInputSchema,
    output: changeSetBatchResultSchema,
    session: 'active'
  }),
  cancelImageGeneration: defineIpcEndpoint({
    channel: IPC_CHANNELS.agentCancelImageGeneration,
    input: cancelImageGenerationInputSchema,
    output: cancelImageGenerationResultSchema,
    session: 'mutation'
  })
} as const

type AgentEndpointApi = IpcEndpointApi<typeof agentIpcEndpoints>

export type AgentIpcApi = Omit<
  AgentEndpointApi,
  'editLastMessageAndRestart' | 'startRun' | 'answerUserQuestion' | 'stopCompaction'
> & {
  editLastMessageAndRestart(
    input: IpcEndpointInput<typeof agentIpcEndpoints.editLastMessageAndRestart>
  ): Promise<IpcEndpointOutput<typeof agentIpcEndpoints.editLastMessageAndRestart>['run']>
  startRun(
    input: IpcEndpointInput<typeof agentIpcEndpoints.startRun>
  ): Promise<IpcEndpointOutput<typeof agentIpcEndpoints.startRun>['run']>
  answerUserQuestion(
    input: IpcEndpointInput<typeof agentIpcEndpoints.answerUserQuestion>
  ): Promise<void>
  stopCompaction(input: IpcEndpointInput<typeof agentIpcEndpoints.stopCompaction>): Promise<void>
  subscribeEvents(
    input: { projectSessionId: string; agentSessionId: string; afterSequence?: number },
    listener: (event: AgentRendererEvent) => void
  ): Promise<() => void>
  subscribeActivity(
    input: { projectSessionId: string },
    listener: (event: AgentRendererEvent) => void
  ): Promise<{
    snapshot: AgentProjectActivitySnapshot
    activate: () => Promise<void>
    unsubscribe: () => void
  }>
  subscribeSectionChanged(
    input: { projectSessionId: string },
    listener: (event: MutationSectionChanged) => void
  ): Promise<() => void>
  subscribeMutations(
    input: { projectSessionId: string },
    listener: (event: MutationProposalChanged) => void
  ): Promise<() => void>
}

export type AgentSessionRecordIpc = AgentSessionRecord
export type AgentRunRecordIpc = AgentRunRecord
export type AgentEventPageIpc = AgentEventPage
