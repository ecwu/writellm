import { randomUUID } from 'node:crypto'
import { ipcMain, type IpcMain } from 'electron'
import type { Logger } from 'pino'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import { manuscriptWorkspaceSchema } from '../../shared/contracts/manuscript'
import { updateWritingRulesIpcInputSchema } from '../../shared/contracts/writing-rules-ipc'
import {
  applyWritingRuleOperations,
  readWritingRules,
  writeWritingRules,
  type WritingRuleOperation
} from '../../shared/contracts/writing-rules'
import type { ProjectManager } from '../project/project-manager'
import { authorizeSender } from './authorize-sender'

export interface WritingRulesIpcMain extends Pick<IpcMain, 'handle' | 'removeHandler'> {}

export function registerWritingRulesIpc(options: {
  manager: ProjectManager
  logger: Pick<Logger, 'info' | 'error'>
  developmentUrl?: string
  ipc?: WritingRulesIpcMain
}): { unregister(): void } {
  const ipc = options.ipc ?? ipcMain
  const lifecycle = <T>(eventName: string, projectSessionId: string, operation: () => T): T => {
    const startedAt = Date.now()
    try {
      const result = operation()
      options.logger.info(
        { event: `${eventName}.completed`, projectSessionId, durationMs: Date.now() - startedAt },
        'Writing Rules IPC operation completed'
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
        'Writing Rules IPC operation failed'
      )
      throw err
    }
  }
  ipc.handle(IPC_CHANNELS.writingRulesUpdate, (event, rawInput: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = updateWritingRulesIpcInputSchema.parse(rawInput)
    return lifecycle('writing_rules.update', input.projectSessionId, () => {
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

  const channels = [IPC_CHANNELS.writingRulesUpdate] as const
  return {
    unregister() {
      for (const channel of channels) ipc.removeHandler(channel)
    }
  }
}
