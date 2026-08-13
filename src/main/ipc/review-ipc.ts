import { randomUUID } from 'node:crypto'
import { ipcMain, type IpcMain } from 'electron'
import type { Logger } from 'pino'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import { manuscriptWorkspaceSchema } from '../../shared/contracts/manuscript'
import {
  listReviewIssuesIpcInputSchema,
  reviewIssueEventsInputSchema,
  reviewIssueEventsResultSchema,
  updateReviewIssueIpcInputSchema,
  updateReviewIssueIpcResultSchema,
  updateWritingRulesIpcInputSchema
} from '../../shared/contracts/review-ipc'
import {
  applyWritingRuleOperations,
  readWritingRules,
  writeWritingRules,
  type WritingRuleOperation
} from '../../shared/contracts/writing-rules'
import type { ProjectManager } from '../project/project-manager'
import { authorizeSender } from './authorize-sender'

export interface ReviewIpcMain extends Pick<IpcMain, 'handle' | 'removeHandler'> {}

export function registerReviewIpc(options: {
  manager: ProjectManager
  logger: Pick<Logger, 'info' | 'error'>
  developmentUrl?: string
  ipc?: ReviewIpcMain
}): { unregister(): void } {
  const ipc = options.ipc ?? ipcMain
  const lifecycle = <T>(eventName: string, projectSessionId: string, operation: () => T): T => {
    const startedAt = Date.now()
    try {
      const result = operation()
      options.logger.info(
        { event: `${eventName}.completed`, projectSessionId, durationMs: Date.now() - startedAt },
        'Review fixture IPC operation completed'
      )
      return result
    } catch (err) {
      options.logger.error(
        {
          event: `${eventName}.failed`,
          err,
          projectSessionId,
          durationMs: Date.now() - startedAt
        },
        'Review fixture IPC operation failed'
      )
      throw err
    }
  }
  const service = (projectSessionId: string) => {
    const reviewIssues = options.manager.assertActiveSession(projectSessionId).reviewIssues
    if (reviewIssues === null) throw new Error('Review issues are unavailable')
    return reviewIssues
  }

  ipc.handle(IPC_CHANNELS.reviewListIssues, (event, rawInput: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = listReviewIssuesIpcInputSchema.parse(rawInput)
    const { projectSessionId, ...filters } = input
    return lifecycle('review.issues.list', projectSessionId, () =>
      service(projectSessionId).list(filters)
    )
  })

  ipc.handle(IPC_CHANNELS.reviewIssueEvents, (event, rawInput: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = reviewIssueEventsInputSchema.parse(rawInput)
    return lifecycle('review.issue_events.list', input.projectSessionId, () =>
      reviewIssueEventsResultSchema.parse(service(input.projectSessionId).events(input.issueId))
    )
  })

  ipc.handle(IPC_CHANNELS.reviewUpdateIssue, (event, rawInput: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = updateReviewIssueIpcInputSchema.parse(rawInput)
    return lifecycle('review.issue.update', input.projectSessionId, () =>
      updateReviewIssueIpcResultSchema.parse(
        service(input.projectSessionId).updateByUser(input.operation)
      )
    )
  })

  ipc.handle(IPC_CHANNELS.reviewUpdateWritingRules, (event, rawInput: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = updateWritingRulesIpcInputSchema.parse(rawInput)
    return lifecycle('review.writing_rules.update', input.projectSessionId, () => {
      const context = options.manager.assertMutationSession(input.projectSessionId)
      const brief = context.manuscript.getBrief()
      if (brief.version !== input.baseBriefVersion) {
        throw new Error('Brief version changed; refresh Writing Rules')
      }
      const operations: WritingRuleOperation[] = input.operations.map((operation) =>
        operation.type === 'add'
          ? { type: 'add', rule: { ruleId: randomUUID(), ...operation.rule } }
          : operation
      )
      const rules = applyWritingRuleOperations(readWritingRules(brief.extensible), operations)
      context.manuscript.updateBrief({
        baseVersion: brief.version,
        title: brief.title,
        description: brief.description,
        topic: brief.topic,
        targetAudience: brief.targetAudience,
        language: brief.language,
        styleTone: brief.styleTone,
        scopeExclusions: brief.scopeExclusions,
        targetLength: brief.targetLength,
        citationRequirements: brief.citationRequirements,
        additionalInstructions: brief.additionalInstructions,
        extensible: writeWritingRules(brief.extensible, rules)
      })
      return manuscriptWorkspaceSchema.parse(context.manuscript.getWorkspace())
    })
  })

  const channels = [
    IPC_CHANNELS.reviewListIssues,
    IPC_CHANNELS.reviewIssueEvents,
    IPC_CHANNELS.reviewUpdateIssue,
    IPC_CHANNELS.reviewUpdateWritingRules
  ] as const
  return {
    unregister() {
      for (const channel of channels) ipc.removeHandler(channel)
    }
  }
}
