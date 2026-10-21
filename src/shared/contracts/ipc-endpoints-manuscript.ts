import { z } from 'zod'
import { IPC_CHANNELS } from './channels'
import {
  createSectionRequestSchema,
  deleteSectionRequestSchema,
  manuscriptAssemblySchema,
  manuscriptReferenceIndexInputSchema,
  manuscriptReferenceIndexSchema,
  manuscriptWorkspaceInputSchema,
  manuscriptWorkspaceSchema,
  moveSectionRequestSchema,
  updateManuscriptBriefRequestSchema,
  updateSectionRequestSchema
} from './manuscript'
import { publicationPreviewInputSchema, publicationPreviewSchema } from './publication'
import {
  manuscriptSearchInputSchema,
  manuscriptSearchNavigationInputSchema,
  manuscriptSearchNavigationResultSchema,
  manuscriptSearchResultSchema
} from './manuscript-search'
import {
  manuscriptReplacementApplyInputSchema,
  manuscriptReplacementApplyResultSchema,
  manuscriptReplacementDismissInputSchema,
  manuscriptReplacementPageInputSchema,
  manuscriptReplacementPageResultSchema,
  manuscriptReplacementPlanInputSchema,
  manuscriptReplacementPlanResultSchema,
  manuscriptReplacementSubscriptionInputSchema,
  manuscriptReplacementUndoInputSchema,
  manuscriptReplacementUndoResultSchema
} from './manuscript-replacement'
import {
  changeCommentStatusInputSchema,
  commentThreadSchema,
  createCommentInputSchema,
  delegateCommentsInputSchema,
  delegateCommentsResultSchema,
  deleteCommentInputSchema,
  editCommentInputSchema,
  listCommentsInputSchema,
  listCommentsResultSchema,
  readCommentInputSchema,
  reanchorCommentInputSchema,
  replyCommentInputSchema
} from './manuscript-comments'
import { defineIpcEndpoint, type IpcEndpointApi, type IpcEndpointInput } from './ipc-endpoints'
import type { ManuscriptReplacementChangedEvent } from './manuscript-replacement'

const undefinedOutput = z.undefined()

/** Typed manuscript, search, replacement, and comments IPC boundaries. */
export const manuscriptIpcEndpoints = {
  workspace: defineIpcEndpoint({
    channel: IPC_CHANNELS.manuscriptGetWorkspace,
    input: manuscriptWorkspaceInputSchema,
    output: manuscriptWorkspaceSchema,
    session: 'active'
  }),
  references: defineIpcEndpoint({
    channel: IPC_CHANNELS.manuscriptGetReferences,
    input: manuscriptReferenceIndexInputSchema,
    output: manuscriptReferenceIndexSchema,
    session: 'active'
  }),
  preview: defineIpcEndpoint({
    channel: IPC_CHANNELS.manuscriptGetPreview,
    input: manuscriptWorkspaceInputSchema,
    output: manuscriptAssemblySchema,
    session: 'active'
  }),
  publicationPreview: defineIpcEndpoint({
    channel: IPC_CHANNELS.manuscriptGetPublicationPreview,
    input: publicationPreviewInputSchema,
    output: publicationPreviewSchema,
    session: 'active'
  }),
  updateBrief: defineIpcEndpoint({
    channel: IPC_CHANNELS.manuscriptUpdateBrief,
    input: updateManuscriptBriefRequestSchema,
    output: manuscriptWorkspaceSchema,
    session: 'mutation'
  }),
  createSection: defineIpcEndpoint({
    channel: IPC_CHANNELS.manuscriptCreateSection,
    input: createSectionRequestSchema,
    output: manuscriptWorkspaceSchema,
    session: 'mutation'
  }),
  updateSection: defineIpcEndpoint({
    channel: IPC_CHANNELS.manuscriptUpdateSection,
    input: updateSectionRequestSchema,
    output: manuscriptWorkspaceSchema,
    session: 'mutation'
  }),
  moveSection: defineIpcEndpoint({
    channel: IPC_CHANNELS.manuscriptMoveSection,
    input: moveSectionRequestSchema,
    output: manuscriptWorkspaceSchema,
    session: 'mutation'
  }),
  deleteSection: defineIpcEndpoint({
    channel: IPC_CHANNELS.manuscriptDeleteSection,
    input: deleteSectionRequestSchema,
    output: manuscriptWorkspaceSchema,
    session: 'mutation'
  }),
  search: defineIpcEndpoint({
    channel: IPC_CHANNELS.manuscriptSearch,
    input: manuscriptSearchInputSchema,
    output: manuscriptSearchResultSchema,
    session: 'active'
  }),
  revalidateSearch: defineIpcEndpoint({
    channel: IPC_CHANNELS.manuscriptSearchRevalidate,
    input: manuscriptSearchNavigationInputSchema,
    output: manuscriptSearchNavigationResultSchema,
    session: 'active'
  }),
  createReplacementPlan: defineIpcEndpoint({
    channel: IPC_CHANNELS.manuscriptReplacementPlan,
    input: manuscriptReplacementPlanInputSchema,
    output: manuscriptReplacementPlanResultSchema,
    session: 'mutation'
  }),
  replacementPage: defineIpcEndpoint({
    channel: IPC_CHANNELS.manuscriptReplacementPage,
    input: manuscriptReplacementPageInputSchema,
    output: manuscriptReplacementPageResultSchema,
    session: 'mutation'
  }),
  dismissReplacementPlan: defineIpcEndpoint({
    channel: IPC_CHANNELS.manuscriptReplacementDismiss,
    input: manuscriptReplacementDismissInputSchema,
    output: undefinedOutput,
    session: 'mutation'
  }),
  applyReplacement: defineIpcEndpoint({
    channel: IPC_CHANNELS.manuscriptReplacementApply,
    input: manuscriptReplacementApplyInputSchema,
    output: manuscriptReplacementApplyResultSchema,
    session: 'mutation'
  }),
  undoReplacement: defineIpcEndpoint({
    channel: IPC_CHANNELS.manuscriptReplacementUndo,
    input: manuscriptReplacementUndoInputSchema,
    output: manuscriptReplacementUndoResultSchema,
    session: 'mutation'
  }),
  replacementSubscribe: defineIpcEndpoint({
    channel: IPC_CHANNELS.manuscriptReplacementSubscribe,
    input: manuscriptReplacementSubscriptionInputSchema,
    output: undefinedOutput,
    session: 'active'
  }),
  replacementUnsubscribe: defineIpcEndpoint({
    channel: IPC_CHANNELS.manuscriptReplacementUnsubscribe,
    input: manuscriptReplacementSubscriptionInputSchema,
    output: undefinedOutput,
    session: 'none'
  }),
  listComments: defineIpcEndpoint({
    channel: IPC_CHANNELS.manuscriptCommentsList,
    input: listCommentsInputSchema,
    output: listCommentsResultSchema,
    session: 'active'
  }),
  readComment: defineIpcEndpoint({
    channel: IPC_CHANNELS.manuscriptCommentsRead,
    input: readCommentInputSchema,
    output: commentThreadSchema,
    session: 'active'
  }),
  createComment: defineIpcEndpoint({
    channel: IPC_CHANNELS.manuscriptCommentsCreate,
    input: createCommentInputSchema,
    output: commentThreadSchema,
    session: 'mutation'
  }),
  replyComment: defineIpcEndpoint({
    channel: IPC_CHANNELS.manuscriptCommentsReply,
    input: replyCommentInputSchema,
    output: commentThreadSchema,
    session: 'mutation'
  }),
  editComment: defineIpcEndpoint({
    channel: IPC_CHANNELS.manuscriptCommentsEdit,
    input: editCommentInputSchema,
    output: commentThreadSchema,
    session: 'mutation'
  }),
  resolveComment: defineIpcEndpoint({
    channel: IPC_CHANNELS.manuscriptCommentsResolve,
    input: changeCommentStatusInputSchema,
    output: commentThreadSchema,
    session: 'mutation'
  }),
  reopenComment: defineIpcEndpoint({
    channel: IPC_CHANNELS.manuscriptCommentsReopen,
    input: changeCommentStatusInputSchema,
    output: commentThreadSchema,
    session: 'mutation'
  }),
  deleteComment: defineIpcEndpoint({
    channel: IPC_CHANNELS.manuscriptCommentsDelete,
    input: deleteCommentInputSchema,
    output: undefinedOutput,
    session: 'mutation'
  }),
  reanchorComment: defineIpcEndpoint({
    channel: IPC_CHANNELS.manuscriptCommentsReanchor,
    input: reanchorCommentInputSchema,
    output: commentThreadSchema,
    session: 'mutation'
  }),
  delegateComments: defineIpcEndpoint({
    channel: IPC_CHANNELS.manuscriptCommentsDelegate,
    input: delegateCommentsInputSchema,
    output: delegateCommentsResultSchema,
    session: 'mutation'
  })
} as const

type ManuscriptEndpointApi = IpcEndpointApi<typeof manuscriptIpcEndpoints>

export type ManuscriptIpcApi = Omit<
  ManuscriptEndpointApi,
  'replacementSubscribe' | 'replacementUnsubscribe'
> & {
  subscribeReplacementChanges(
    input: { projectSessionId: string },
    listener: (event: ManuscriptReplacementChangedEvent) => void
  ): Promise<() => void>
}

export type ManuscriptEndpointInput = IpcEndpointInput<typeof manuscriptIpcEndpoints.workspace>
