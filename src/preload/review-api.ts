import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/contracts/channels'
import { manuscriptWorkspaceSchema } from '../shared/contracts/manuscript'
import {
  listReviewIssuesIpcInputSchema,
  reviewIssueEventsInputSchema,
  reviewIssueEventsResultSchema,
  updateReviewIssueIpcInputSchema,
  updateReviewIssueIpcResultSchema,
  updateWritingRulesIpcInputSchema
} from '../shared/contracts/review-ipc'
import { listReviewIssuesResultSchema } from '../shared/contracts/review'
import type { DesktopApi } from './desktop-api'

export const reviewApi: DesktopApi['review'] = {
  async listIssues(input) {
    return listReviewIssuesResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.reviewListIssues,
        listReviewIssuesIpcInputSchema.parse(input)
      )
    )
  },
  async issueEvents(input) {
    return reviewIssueEventsResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.reviewIssueEvents,
        reviewIssueEventsInputSchema.parse(input)
      )
    )
  },
  async updateIssue(input) {
    return updateReviewIssueIpcResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.reviewUpdateIssue,
        updateReviewIssueIpcInputSchema.parse(input)
      )
    )
  },
  async updateWritingRules(input) {
    return manuscriptWorkspaceSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.reviewUpdateWritingRules,
        updateWritingRulesIpcInputSchema.parse(input)
      )
    )
  }
}
