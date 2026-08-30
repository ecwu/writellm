import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/contracts/channels'
import { diagnosticExportResultSchema } from '../shared/contracts/diagnostics'
import {
  checkpointOperationResultSchema,
  compareCheckpointStateInputSchema,
  compareCheckpointStateResultSchema,
  createCheckpointInputSchema,
  dismissVersionHistoryPromptInputSchema,
  enableVersionHistoryInputSchema,
  listCheckpointsInputSchema,
  listCheckpointsResultSchema,
  projectCreateInputSchema,
  projectCloneCancelResultSchema,
  projectCloneInputSchema,
  projectLifecycleEventSchema,
  projectLifecycleSnapshotSchema,
  projectRecoveryActionInputSchema,
  projectSnapshotResultSchema,
  recentProjectOpenInputSchema,
  recentProjectsSchema,
  projectSelectionResultSchema,
  projectSessionInputSchema,
  reinitializeVersionHistoryInputSchema,
  restoreCheckpointInputSchema,
  restoreCheckpointResultSchema,
  versionHistoryStatusSchema
} from '../shared/contracts/projects'
import {
  manuscriptExportCancelResultSchema,
  manuscriptExportInputSchema,
  manuscriptExportResultSchema
} from '../shared/contracts/manuscript-export'
import {
  deleteUserProjectTemplateInputSchema,
  projectTemplateCatalogSchema,
  projectTemplateExtractionPreviewSchema,
  saveUserProjectTemplateInputSchema
} from '../shared/contracts/project-templates'
import type { DesktopApi } from './desktop-api'

export const projectsApi: DesktopApi['projects'] = {
  async lifecycle() {
    return projectLifecycleSnapshotSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.projectGetLifecycle)
    )
  },
  async recent() {
    return recentProjectsSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectGetRecent))
  },
  async create(input) {
    return projectSelectionResultSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.projectCreate, projectCreateInputSchema.parse(input))
    )
  },
  async open() {
    return projectSelectionResultSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.projectOpen))
  },
  async openRecent(input) {
    return projectSelectionResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.projectOpenRecent,
        recentProjectOpenInputSchema.parse(input)
      )
    )
  },
  async close(input) {
    return projectLifecycleSnapshotSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.projectClose, projectSessionInputSchema.parse(input))
    )
  },
  async switch(input) {
    return projectSelectionResultSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.projectSwitch, projectSessionInputSchema.parse(input))
    )
  },
  async clone(input) {
    return projectSelectionResultSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.projectClone, projectCloneInputSchema.parse(input))
    )
  },
  async cancelClone(input) {
    return projectCloneCancelResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.projectCloneCancel,
        projectCloneInputSchema.parse(input)
      )
    )
  },
  async templates() {
    return projectTemplateCatalogSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.projectTemplatesList)
    )
  },
  async previewTemplate(input) {
    return projectTemplateExtractionPreviewSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.projectTemplatePreview,
        projectSessionInputSchema.parse(input)
      )
    )
  },
  async saveTemplate(input) {
    return projectTemplateCatalogSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.projectTemplateSave,
        saveUserProjectTemplateInputSchema.parse(input)
      )
    )
  },
  async deleteTemplate(input) {
    return projectTemplateCatalogSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.projectTemplateDelete,
        deleteUserProjectTemplateInputSchema.parse(input)
      )
    )
  },
  async retryOpen() {
    return projectLifecycleSnapshotSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.projectRecoveryRetryOpen,
        projectRecoveryActionInputSchema.parse({})
      )
    )
  },
  async recoverStaleLock() {
    return projectLifecycleSnapshotSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.projectRecoveryStaleLock,
        projectRecoveryActionInputSchema.parse({})
      )
    )
  },
  async retryClose() {
    return projectLifecycleSnapshotSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.projectRecoveryRetryClose,
        projectRecoveryActionInputSchema.parse({})
      )
    )
  },
  async discardIncompleteCreate() {
    return projectLifecycleSnapshotSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.projectRecoveryDiscardIncompleteCreate,
        projectRecoveryActionInputSchema.parse({})
      )
    )
  },
  async locateMoved() {
    return projectSelectionResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.projectRecoveryLocateMoved,
        projectRecoveryActionInputSchema.parse({})
      )
    )
  },
  async exportRecoveryDiagnostics() {
    return diagnosticExportResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.projectRecoveryExportDiagnostics,
        projectRecoveryActionInputSchema.parse({})
      )
    )
  },
  async returnToClosed() {
    return projectLifecycleSnapshotSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.projectRecoveryReturnToClosed,
        projectRecoveryActionInputSchema.parse({})
      )
    )
  },
  async createSnapshot(input) {
    return projectSnapshotResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.projectSnapshotCreate,
        projectSessionInputSchema.parse(input)
      )
    )
  },
  async restoreSnapshot() {
    return projectSelectionResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.projectSnapshotRestore,
        projectRecoveryActionInputSchema.parse({})
      )
    )
  },
  async exportManuscript(input) {
    return manuscriptExportResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.projectManuscriptExport,
        manuscriptExportInputSchema.parse(input)
      )
    )
  },
  async cancelManuscriptExport(input) {
    return manuscriptExportCancelResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.projectManuscriptExportCancel,
        projectSessionInputSchema.parse(input)
      )
    )
  },
  async versionHistoryStatus(input) {
    return versionHistoryStatusSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.projectHistoryStatus,
        projectSessionInputSchema.parse(input)
      )
    )
  },
  async enableVersionHistory(input) {
    return checkpointOperationResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.projectHistoryEnable,
        enableVersionHistoryInputSchema.parse(input)
      )
    ).checkpoint
  },
  async reinitializeVersionHistory(input) {
    return checkpointOperationResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.projectHistoryReinitialize,
        reinitializeVersionHistoryInputSchema.parse(input)
      )
    ).checkpoint
  },
  async dismissVersionHistoryPrompt(input) {
    return versionHistoryStatusSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.projectHistoryDismissPrompt,
        dismissVersionHistoryPromptInputSchema.parse(input)
      )
    )
  },
  async createCheckpoint(input) {
    return checkpointOperationResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.projectHistoryCreateCheckpoint,
        createCheckpointInputSchema.parse(input)
      )
    ).checkpoint
  },
  async listCheckpoints(input) {
    return listCheckpointsResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.projectHistoryListCheckpoints,
        listCheckpointsInputSchema.parse(input)
      )
    )
  },
  async compareCheckpointState(input) {
    return compareCheckpointStateResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.projectHistoryCompareState,
        compareCheckpointStateInputSchema.parse(input)
      )
    )
  },
  async restoreCheckpoint(input) {
    return restoreCheckpointResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.projectHistoryRestoreCheckpoint,
        restoreCheckpointInputSchema.parse(input)
      )
    )
  },
  async subscribe(input, listener) {
    const parsedInput = projectSessionInputSchema.parse(input)
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const lifecycleEvent = projectLifecycleEventSchema.parse(value)
      if (lifecycleEvent.projectSessionId === parsedInput.projectSessionId) {
        listener(lifecycleEvent)
      }
    }
    ipcRenderer.on(IPC_CHANNELS.projectLifecycleEvent, handler)
    try {
      await ipcRenderer.invoke(IPC_CHANNELS.projectSubscribeLifecycle, parsedInput)
    } catch (err) {
      ipcRenderer.removeListener(IPC_CHANNELS.projectLifecycleEvent, handler)
      throw err
    }
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.projectLifecycleEvent, handler)
      void ipcRenderer.invoke(IPC_CHANNELS.projectUnsubscribeLifecycle, parsedInput)
    }
  }
}
