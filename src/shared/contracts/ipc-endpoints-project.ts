import { z } from 'zod'
import { IPC_CHANNELS } from './channels'
import { diagnosticExportResultSchema } from './diagnostics'
import {
  manuscriptExportCancelResultSchema,
  manuscriptExportInputSchema,
  manuscriptExportResultSchema
} from './manuscript-export'
import {
  deleteUserProjectTemplateInputSchema,
  projectTemplateCatalogSchema,
  projectTemplateExtractionPreviewSchema,
  saveUserProjectTemplateInputSchema
} from './project-templates'
import {
  checkpointOperationResultSchema,
  compareCheckpointStateInputSchema,
  compareCheckpointStateResultSchema,
  createCheckpointInputSchema,
  dismissVersionHistoryPromptInputSchema,
  enableVersionHistoryInputSchema,
  listCheckpointsInputSchema,
  listCheckpointsResultSchema,
  projectCloneCancelResultSchema,
  projectCloneInputSchema,
  projectCreateInputSchema,
  projectLifecycleSnapshotSchema,
  projectRecoveryActionInputSchema,
  projectSelectionResultSchema,
  projectSessionInputSchema,
  projectSnapshotResultSchema,
  recentProjectOpenInputSchema,
  recentProjectRemoveInputSchema,
  recentProjectsSchema,
  reinitializeVersionHistoryInputSchema,
  restoreCheckpointInputSchema,
  restoreCheckpointResultSchema,
  versionHistoryStatusSchema
} from './projects'
import {
  defineIpcEndpoint,
  type IpcEndpointApi,
  type IpcEndpointInput,
  type IpcEndpointOutput
} from './ipc-endpoints'
import type { CheckpointEntry, ProjectLifecycleEvent, ProjectSessionInput } from './projects'

/**
 * Project lifecycle and manuscript export requests share one typed channel table. Dialog-backed
 * flows remain ordinary handlers; the table only describes their IPC boundary and capability.
 */
export const projectIpcEndpoints = {
  lifecycle: defineIpcEndpoint({
    channel: IPC_CHANNELS.projectGetLifecycle,
    input: z.undefined(),
    output: projectLifecycleSnapshotSchema,
    session: 'none'
  }),
  recent: defineIpcEndpoint({
    channel: IPC_CHANNELS.projectGetRecent,
    input: z.undefined(),
    output: recentProjectsSchema,
    session: 'none'
  }),
  removeRecent: defineIpcEndpoint({
    channel: IPC_CHANNELS.projectRemoveRecent,
    input: recentProjectRemoveInputSchema,
    output: recentProjectsSchema,
    session: 'none'
  }),
  create: defineIpcEndpoint({
    channel: IPC_CHANNELS.projectCreate,
    input: projectCreateInputSchema,
    output: projectSelectionResultSchema,
    session: 'none'
  }),
  open: defineIpcEndpoint({
    channel: IPC_CHANNELS.projectOpen,
    input: z.undefined(),
    output: projectSelectionResultSchema,
    session: 'none'
  }),
  openRecent: defineIpcEndpoint({
    channel: IPC_CHANNELS.projectOpenRecent,
    input: recentProjectOpenInputSchema,
    output: projectSelectionResultSchema,
    session: 'none'
  }),
  close: defineIpcEndpoint({
    channel: IPC_CHANNELS.projectClose,
    input: projectSessionInputSchema,
    output: projectLifecycleSnapshotSchema,
    session: 'active'
  }),
  switch: defineIpcEndpoint({
    channel: IPC_CHANNELS.projectSwitch,
    input: projectSessionInputSchema,
    output: projectSelectionResultSchema,
    session: 'active'
  }),
  clone: defineIpcEndpoint({
    channel: IPC_CHANNELS.projectClone,
    input: projectCloneInputSchema,
    output: projectSelectionResultSchema,
    session: 'active'
  }),
  cancelClone: defineIpcEndpoint({
    channel: IPC_CHANNELS.projectCloneCancel,
    input: projectCloneInputSchema,
    output: projectCloneCancelResultSchema,
    session: 'active'
  }),
  templates: defineIpcEndpoint({
    channel: IPC_CHANNELS.projectTemplatesList,
    input: z.undefined(),
    output: projectTemplateCatalogSchema,
    session: 'none'
  }),
  previewTemplate: defineIpcEndpoint({
    channel: IPC_CHANNELS.projectTemplatePreview,
    input: projectSessionInputSchema,
    output: projectTemplateExtractionPreviewSchema,
    // ProjectManager authorizes the session inside the handler's failure boundary.
    session: 'none'
  }),
  saveTemplate: defineIpcEndpoint({
    channel: IPC_CHANNELS.projectTemplateSave,
    input: saveUserProjectTemplateInputSchema,
    output: projectTemplateCatalogSchema,
    // ProjectManager authorizes the session inside the handler's failure boundary.
    session: 'none'
  }),
  deleteTemplate: defineIpcEndpoint({
    channel: IPC_CHANNELS.projectTemplateDelete,
    input: deleteUserProjectTemplateInputSchema,
    output: projectTemplateCatalogSchema,
    session: 'none'
  }),
  retryOpen: defineIpcEndpoint({
    channel: IPC_CHANNELS.projectRecoveryRetryOpen,
    input: projectRecoveryActionInputSchema,
    output: projectLifecycleSnapshotSchema,
    session: 'none'
  }),
  recoverStaleLock: defineIpcEndpoint({
    channel: IPC_CHANNELS.projectRecoveryStaleLock,
    input: projectRecoveryActionInputSchema,
    output: projectLifecycleSnapshotSchema,
    session: 'none'
  }),
  retryClose: defineIpcEndpoint({
    channel: IPC_CHANNELS.projectRecoveryRetryClose,
    input: projectRecoveryActionInputSchema,
    output: projectLifecycleSnapshotSchema,
    session: 'none'
  }),
  discardIncompleteCreate: defineIpcEndpoint({
    channel: IPC_CHANNELS.projectRecoveryDiscardIncompleteCreate,
    input: projectRecoveryActionInputSchema,
    output: projectLifecycleSnapshotSchema,
    session: 'none'
  }),
  locateMoved: defineIpcEndpoint({
    channel: IPC_CHANNELS.projectRecoveryLocateMoved,
    input: projectRecoveryActionInputSchema,
    output: projectSelectionResultSchema,
    session: 'none'
  }),
  exportRecoveryDiagnostics: defineIpcEndpoint({
    channel: IPC_CHANNELS.projectRecoveryExportDiagnostics,
    input: projectRecoveryActionInputSchema,
    output: diagnosticExportResultSchema,
    session: 'none'
  }),
  returnToClosed: defineIpcEndpoint({
    channel: IPC_CHANNELS.projectRecoveryReturnToClosed,
    input: projectRecoveryActionInputSchema,
    output: projectLifecycleSnapshotSchema,
    session: 'none'
  }),
  createSnapshot: defineIpcEndpoint({
    channel: IPC_CHANNELS.projectSnapshotCreate,
    input: projectSessionInputSchema,
    output: projectSnapshotResultSchema,
    session: 'active'
  }),
  restoreSnapshot: defineIpcEndpoint({
    channel: IPC_CHANNELS.projectSnapshotRestore,
    input: projectRecoveryActionInputSchema,
    output: projectSelectionResultSchema,
    session: 'none'
  }),
  exportManuscript: defineIpcEndpoint({
    channel: IPC_CHANNELS.projectManuscriptExport,
    input: manuscriptExportInputSchema,
    output: manuscriptExportResultSchema,
    session: 'active'
  }),
  cancelManuscriptExport: defineIpcEndpoint({
    channel: IPC_CHANNELS.projectManuscriptExportCancel,
    input: projectSessionInputSchema,
    output: manuscriptExportCancelResultSchema,
    session: 'active'
  }),
  versionHistoryStatus: defineIpcEndpoint({
    channel: IPC_CHANNELS.projectHistoryStatus,
    input: projectSessionInputSchema,
    output: versionHistoryStatusSchema,
    session: 'active'
  }),
  enableVersionHistory: defineIpcEndpoint({
    channel: IPC_CHANNELS.projectHistoryEnable,
    input: enableVersionHistoryInputSchema,
    output: checkpointOperationResultSchema,
    // ProjectManager authorizes the session inside the handler's failure boundary.
    session: 'none'
  }),
  reinitializeVersionHistory: defineIpcEndpoint({
    channel: IPC_CHANNELS.projectHistoryReinitialize,
    input: reinitializeVersionHistoryInputSchema,
    output: checkpointOperationResultSchema,
    // ProjectManager authorizes the session inside the handler's failure boundary.
    session: 'none'
  }),
  dismissVersionHistoryPrompt: defineIpcEndpoint({
    channel: IPC_CHANNELS.projectHistoryDismissPrompt,
    input: dismissVersionHistoryPromptInputSchema,
    output: versionHistoryStatusSchema,
    session: 'active'
  }),
  createCheckpoint: defineIpcEndpoint({
    channel: IPC_CHANNELS.projectHistoryCreateCheckpoint,
    input: createCheckpointInputSchema,
    output: checkpointOperationResultSchema,
    // ProjectManager authorizes the session inside the handler's failure boundary.
    session: 'none'
  }),
  listCheckpoints: defineIpcEndpoint({
    channel: IPC_CHANNELS.projectHistoryListCheckpoints,
    input: listCheckpointsInputSchema,
    output: listCheckpointsResultSchema,
    // ProjectManager authorizes the session inside the handler's failure boundary.
    session: 'none'
  }),
  compareCheckpointState: defineIpcEndpoint({
    channel: IPC_CHANNELS.projectHistoryCompareState,
    input: compareCheckpointStateInputSchema,
    output: compareCheckpointStateResultSchema,
    // ProjectManager authorizes the session inside the handler's failure boundary.
    session: 'none'
  }),
  restoreCheckpoint: defineIpcEndpoint({
    channel: IPC_CHANNELS.projectHistoryRestoreCheckpoint,
    input: restoreCheckpointInputSchema,
    output: restoreCheckpointResultSchema,
    // ProjectManager authorizes the session inside the handler's failure boundary.
    session: 'none'
  }),
  subscribe: defineIpcEndpoint({
    channel: IPC_CHANNELS.projectSubscribeLifecycle,
    input: projectSessionInputSchema,
    output: z.undefined(),
    session: 'active'
  }),
  unsubscribe: defineIpcEndpoint({
    channel: IPC_CHANNELS.projectUnsubscribeLifecycle,
    input: projectSessionInputSchema,
    output: z.undefined(),
    session: 'none'
  })
} as const

type ProjectEndpointApi = IpcEndpointApi<typeof projectIpcEndpoints>
type CapturedProjectEndpoint =
  | 'retryOpen'
  | 'recoverStaleLock'
  | 'retryClose'
  | 'discardIncompleteCreate'
  | 'locateMoved'
  | 'exportRecoveryDiagnostics'
  | 'returnToClosed'
  | 'restoreSnapshot'

// Preload captures the empty request for these historical zero-argument business methods.
type CapturedProjectApi = {
  [Name in CapturedProjectEndpoint]: () => ReturnType<ProjectEndpointApi[Name]>
}

export type ProjectIpcApi = Omit<
  ProjectEndpointApi,
  | CapturedProjectEndpoint
  | 'enableVersionHistory'
  | 'reinitializeVersionHistory'
  | 'createCheckpoint'
  | 'subscribe'
  | 'unsubscribe'
> &
  CapturedProjectApi & {
    enableVersionHistory(
      input: IpcEndpointInput<typeof projectIpcEndpoints.enableVersionHistory>
    ): Promise<IpcEndpointOutput<typeof projectIpcEndpoints.enableVersionHistory>['checkpoint']>
    reinitializeVersionHistory(
      input: IpcEndpointInput<typeof projectIpcEndpoints.reinitializeVersionHistory>
    ): Promise<
      IpcEndpointOutput<typeof projectIpcEndpoints.reinitializeVersionHistory>['checkpoint']
    >
    createCheckpoint(
      input: IpcEndpointInput<typeof projectIpcEndpoints.createCheckpoint>
    ): Promise<IpcEndpointOutput<typeof projectIpcEndpoints.createCheckpoint>['checkpoint']>
    subscribe(
      input: ProjectSessionInput,
      listener: (event: ProjectLifecycleEvent) => void
    ): Promise<() => void>
  }

export type ProjectCheckpointEntry = CheckpointEntry
