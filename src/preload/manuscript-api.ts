import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/contracts/channels'
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
} from '../shared/contracts/manuscript'
import {
  publicationPreviewInputSchema,
  publicationPreviewSchema
} from '../shared/contracts/publication'
import {
  manuscriptSearchInputSchema,
  manuscriptSearchNavigationInputSchema,
  manuscriptSearchNavigationResultSchema,
  manuscriptSearchResultSchema
} from '../shared/contracts/manuscript-search'
import {
  manuscriptReplacementApplyInputSchema,
  manuscriptReplacementApplyResultSchema,
  manuscriptReplacementChangedEventSchema,
  manuscriptReplacementDismissInputSchema,
  manuscriptReplacementPageInputSchema,
  manuscriptReplacementPageResultSchema,
  manuscriptReplacementPlanInputSchema,
  manuscriptReplacementPlanResultSchema,
  manuscriptReplacementSubscriptionInputSchema,
  manuscriptReplacementUndoInputSchema,
  manuscriptReplacementUndoResultSchema
} from '../shared/contracts/manuscript-replacement'
import type { DesktopApi } from './desktop-api'

export const manuscriptApi: DesktopApi['manuscript'] = {
  async workspace(input) {
    return manuscriptWorkspaceSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.manuscriptGetWorkspace,
        manuscriptWorkspaceInputSchema.parse(input)
      )
    )
  },
  async references(input) {
    return manuscriptReferenceIndexSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.manuscriptGetReferences,
        manuscriptReferenceIndexInputSchema.parse(input)
      )
    )
  },
  async preview(input) {
    return manuscriptAssemblySchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.manuscriptGetPreview,
        manuscriptWorkspaceInputSchema.parse(input)
      )
    )
  },
  async publicationPreview(input) {
    return publicationPreviewSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.manuscriptGetPublicationPreview,
        publicationPreviewInputSchema.parse(input)
      )
    )
  },
  async updateBrief(input) {
    return manuscriptWorkspaceSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.manuscriptUpdateBrief,
        updateManuscriptBriefRequestSchema.parse(input)
      )
    )
  },
  async createSection(input) {
    return manuscriptWorkspaceSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.manuscriptCreateSection,
        createSectionRequestSchema.parse(input)
      )
    )
  },
  async updateSection(input) {
    return manuscriptWorkspaceSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.manuscriptUpdateSection,
        updateSectionRequestSchema.parse(input)
      )
    )
  },
  async moveSection(input) {
    return manuscriptWorkspaceSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.manuscriptMoveSection,
        moveSectionRequestSchema.parse(input)
      )
    )
  },
  async deleteSection(input) {
    return manuscriptWorkspaceSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.manuscriptDeleteSection,
        deleteSectionRequestSchema.parse(input)
      )
    )
  },
  async search(input) {
    return manuscriptSearchResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.manuscriptSearch,
        manuscriptSearchInputSchema.parse(input)
      )
    )
  },
  async revalidateSearch(input) {
    return manuscriptSearchNavigationResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.manuscriptSearchRevalidate,
        manuscriptSearchNavigationInputSchema.parse(input)
      )
    )
  },
  async createReplacementPlan(input) {
    return manuscriptReplacementPlanResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.manuscriptReplacementPlan,
        manuscriptReplacementPlanInputSchema.parse(input)
      )
    )
  },
  async replacementPage(input) {
    return manuscriptReplacementPageResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.manuscriptReplacementPage,
        manuscriptReplacementPageInputSchema.parse(input)
      )
    )
  },
  async dismissReplacementPlan(input) {
    await ipcRenderer.invoke(
      IPC_CHANNELS.manuscriptReplacementDismiss,
      manuscriptReplacementDismissInputSchema.parse(input)
    )
  },
  async applyReplacement(input) {
    return manuscriptReplacementApplyResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.manuscriptReplacementApply,
        manuscriptReplacementApplyInputSchema.parse(input)
      )
    )
  },
  async undoReplacement(input) {
    return manuscriptReplacementUndoResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.manuscriptReplacementUndo,
        manuscriptReplacementUndoInputSchema.parse(input)
      )
    )
  },
  async subscribeReplacementChanges(input, listener) {
    const subscription = manuscriptReplacementSubscriptionInputSchema.parse({
      ...input,
      subscriptionId: globalThis.crypto.randomUUID()
    })
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const changed = manuscriptReplacementChangedEventSchema.parse(value)
      if (changed.projectSessionId === input.projectSessionId) listener(changed)
    }
    ipcRenderer.on(IPC_CHANNELS.manuscriptReplacementChanged, handler)
    try {
      await ipcRenderer.invoke(IPC_CHANNELS.manuscriptReplacementSubscribe, subscription)
    } catch (err) {
      ipcRenderer.removeListener(IPC_CHANNELS.manuscriptReplacementChanged, handler)
      throw err
    }
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.manuscriptReplacementChanged, handler)
      void ipcRenderer.invoke(IPC_CHANNELS.manuscriptReplacementUnsubscribe, subscription)
    }
  }
}
