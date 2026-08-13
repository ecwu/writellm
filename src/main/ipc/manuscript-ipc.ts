import { ipcMain, type IpcMain, type WebContents } from 'electron'
import type { Logger } from 'pino'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
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
} from '../../shared/contracts/manuscript'
import type { ProjectManager } from '../project/project-manager'
import {
  manuscriptSearchInputSchema,
  manuscriptSearchNavigationInputSchema,
  manuscriptSearchNavigationResultSchema,
  manuscriptSearchResultSchema
} from '../../shared/contracts/manuscript-search'
import { ManuscriptSearchService } from '../manuscript/manuscript-search-service'
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
  manuscriptReplacementUndoResultSchema,
  type ManuscriptReplacementChangedEvent
} from '../../shared/contracts/manuscript-replacement'
import { ManuscriptReplacementService } from '../manuscript/manuscript-replacement-service'
import {
  publicationPreviewInputSchema,
  publicationPreviewSchema
} from '../../shared/contracts/publication'
import { PublicationService } from '../manuscript/publication-service'
import { authorizeSender } from './authorize-sender'
import type { PublicationPresetRepository } from '../app-db/repositories/publication-presets'

export interface ManuscriptIpcMain extends Pick<IpcMain, 'handle' | 'removeHandler'> {}

export function registerManuscriptIpc(options: {
  manager: ProjectManager
  logger: Pick<Logger, 'info' | 'warn' | 'error'>
  developmentUrl?: string
  ipc?: ManuscriptIpcMain
  publicationPresets?: Pick<PublicationPresetRepository, 'resolve'>
  flushForMutation?(
    projectSessionId: string,
    affectedSectionIds: readonly string[],
    flushMetadata?: boolean
  ): Promise<void>
}): { revokeSession(projectSessionId: string): void; unregister(): void } {
  const ipc = options.ipc ?? ipcMain
  const replacementServices = new Map<string, ManuscriptReplacementService>()
  const publicationService = new PublicationService(options.logger)
  const replacementSubscribers = new Map<string, Map<string, WebContents>>()
  const replacementService = (projectSessionId: string): ManuscriptReplacementService => {
    const context = options.manager.assertMutationSession(projectSessionId)
    let service = replacementServices.get(projectSessionId)
    if (service === undefined) {
      service = new ManuscriptReplacementService({
        manuscript: context.manuscript,
        editorPersistence: context.editorPersistence,
        log: options.logger
      })
      replacementServices.set(projectSessionId, service)
    }
    return service
  }
  const publishReplacementChanged = (event: ManuscriptReplacementChangedEvent): void => {
    const parsed = manuscriptReplacementChangedEventSchema.parse(event)
    for (const sender of replacementSubscribers.get(parsed.projectSessionId)?.values() ?? []) {
      if (sender.isDestroyed()) continue
      try {
        sender.send(IPC_CHANNELS.manuscriptReplacementChanged, parsed)
      } catch (err) {
        options.logger.error(
          {
            event: 'manuscript.replacement_change.notification_failed',
            err,
            projectSessionId: parsed.projectSessionId,
            sectionCount: parsed.sections.length
          },
          'Replacement change notification failed'
        )
      }
    }
  }
  const workspace = (projectSessionId: string) =>
    manuscriptWorkspaceSchema.parse(
      options.manager.assertActiveSession(projectSessionId).manuscript.getWorkspace()
    )
  const runLifecycle = async <T>(
    event: string,
    projectSessionId: string,
    operation: () => T | Promise<T>,
    context: Record<string, unknown> = {}
  ): Promise<T> => {
    const startedAt = Date.now()
    try {
      const result = await operation()
      options.logger.info(
        {
          event: `${event}.completed`,
          projectSessionId,
          durationMs: Date.now() - startedAt,
          ...context
        },
        'Manuscript IPC operation completed'
      )
      return result
    } catch (err) {
      options.logger.error(
        {
          event: `${event}.failed`,
          err,
          projectSessionId,
          durationMs: Date.now() - startedAt,
          ...context
        },
        'Manuscript IPC operation failed'
      )
      throw err
    }
  }

  ipc.handle(IPC_CHANNELS.manuscriptGetWorkspace, (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = manuscriptWorkspaceInputSchema.parse(input)
    const startedAt = Date.now()
    try {
      const result = workspace(parsed.projectSessionId)
      options.logger.info(
        {
          event: 'manuscript.workspace.loaded',
          projectSessionId: parsed.projectSessionId,
          manuscriptId: result.manuscriptId,
          sectionCount: result.sections.length,
          durationMs: Date.now() - startedAt
        },
        'Manuscript workspace loaded'
      )
      return result
    } catch (err) {
      options.logger.error(
        {
          event: 'manuscript.workspace.load_failed',
          err,
          projectSessionId: parsed.projectSessionId,
          durationMs: Date.now() - startedAt
        },
        'Manuscript workspace load failed'
      )
      throw err
    }
  })

  ipc.handle(IPC_CHANNELS.manuscriptGetReferences, (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = manuscriptReferenceIndexInputSchema.parse(input)
    const startedAt = Date.now()
    try {
      const result = manuscriptReferenceIndexSchema.parse(
        options.manager.assertActiveSession(parsed.projectSessionId).manuscript.getReferenceIndex()
      )
      options.logger.info(
        {
          event: 'manuscript.references.loaded',
          projectSessionId: parsed.projectSessionId,
          referenceCount: result.entries.length,
          occurrenceCount: result.entries.reduce((total, entry) => total + entry.count, 0),
          durationMs: Date.now() - startedAt
        },
        'Manuscript reference index loaded'
      )
      return result
    } catch (err) {
      options.logger.error(
        {
          event: 'manuscript.references.load_failed',
          err,
          projectSessionId: parsed.projectSessionId,
          durationMs: Date.now() - startedAt
        },
        'Manuscript reference index load failed'
      )
      throw err
    }
  })

  ipc.handle(IPC_CHANNELS.manuscriptGetPreview, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = manuscriptWorkspaceInputSchema.parse(input)
    return runLifecycle('manuscript.preview.load', parsed.projectSessionId, () =>
      manuscriptAssemblySchema.parse(
        options.manager.assertActiveSession(parsed.projectSessionId).manuscript.assemble()
      )
    )
  })

  ipc.handle(IPC_CHANNELS.manuscriptGetPublicationPreview, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = publicationPreviewInputSchema.parse(input)
    return publicationPreviewSchema.parse(
      await publicationService.preview(
        options.manager.assertActiveSession(parsed.projectSessionId),
        parsed.options ?? options.publicationPresets?.resolve()
      )
    )
  })

  ipc.handle(IPC_CHANNELS.manuscriptUpdateBrief, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = updateManuscriptBriefRequestSchema.parse(input)
    return runLifecycle(
      'manuscript.brief.update',
      parsed.projectSessionId,
      () => {
        options.manager
          .assertMutationSession(parsed.projectSessionId)
          .manuscript.updateBrief(parsed.update)
        return workspace(parsed.projectSessionId)
      },
      { baseVersion: parsed.update.baseVersion }
    )
  })

  ipc.handle(IPC_CHANNELS.manuscriptCreateSection, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = createSectionRequestSchema.parse(input)
    return runLifecycle(
      'manuscript.section.create',
      parsed.projectSessionId,
      async () => {
        const context = options.manager.assertMutationSession(parsed.projectSessionId)
        const created = context.manuscript.createSection(parsed.create)
        try {
          await context.editorPersistence.materialize(
            context.editorPersistence.loadSection(created.sectionId).revision
          )
        } catch (err) {
          options.logger.error(
            {
              event: 'manuscript.section.initial_materialization_failed',
              err,
              projectSessionId: parsed.projectSessionId,
              sectionId: created.sectionId
            },
            'New section canonical revision exists but its materialization is pending repair'
          )
        }
        options.manager.assertActiveSession(parsed.projectSessionId)
        return workspace(parsed.projectSessionId)
      },
      { baseOutlineVersion: parsed.create.baseOutlineVersion }
    )
  })

  ipc.handle(IPC_CHANNELS.manuscriptUpdateSection, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = updateSectionRequestSchema.parse(input)
    return runLifecycle(
      'manuscript.section.update',
      parsed.projectSessionId,
      () => {
        options.manager
          .assertMutationSession(parsed.projectSessionId)
          .manuscript.updateSection(parsed.update)
        return workspace(parsed.projectSessionId)
      },
      {
        sectionId: parsed.update.sectionId,
        baseOutlineVersion: parsed.update.baseOutlineVersion
      }
    )
  })

  ipc.handle(IPC_CHANNELS.manuscriptMoveSection, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = moveSectionRequestSchema.parse(input)
    return runLifecycle(
      'manuscript.section.move',
      parsed.projectSessionId,
      () => {
        options.manager
          .assertMutationSession(parsed.projectSessionId)
          .manuscript.moveSection(parsed.move)
        return workspace(parsed.projectSessionId)
      },
      {
        sectionId: parsed.move.sectionId,
        baseOutlineVersion: parsed.move.baseOutlineVersion
      }
    )
  })

  ipc.handle(IPC_CHANNELS.manuscriptDeleteSection, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = deleteSectionRequestSchema.parse(input)
    return runLifecycle(
      'manuscript.section.delete',
      parsed.projectSessionId,
      async () => {
        const context = options.manager.assertMutationSession(parsed.projectSessionId)
        context.manuscript.deleteSection(parsed.delete)
        try {
          await context.editorPersistence.removeMaterialization(parsed.delete.sectionId)
        } catch (err) {
          options.logger.error(
            {
              event: 'manuscript.section.materialization_delete_failed',
              err,
              projectSessionId: parsed.projectSessionId,
              sectionId: parsed.delete.sectionId
            },
            'Deleted section materialization cleanup failed'
          )
        }
        options.manager.assertActiveSession(parsed.projectSessionId)
        return workspace(parsed.projectSessionId)
      },
      {
        sectionId: parsed.delete.sectionId,
        baseOutlineVersion: parsed.delete.baseOutlineVersion
      }
    )
  })

  ipc.handle(IPC_CHANNELS.manuscriptSearch, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = manuscriptSearchInputSchema.parse(input)
    const context = options.manager.assertActiveSession(parsed.projectSessionId)
    const controller = new AbortController()
    const release = context.operations?.track(controller)
    try {
      const service = new ManuscriptSearchService({
        manuscript: context.manuscript,
        log: options.logger
      })
      const result = await service.search(parsed, controller.signal)
      options.manager.assertActiveSession(parsed.projectSessionId)
      const { metrics: _metrics, ...bounded } = result
      return manuscriptSearchResultSchema.parse(bounded)
    } finally {
      release?.()
    }
  })

  ipc.handle(IPC_CHANNELS.manuscriptSearchRevalidate, async (event, input: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const parsed = manuscriptSearchNavigationInputSchema.parse(input)
    const context = options.manager.assertActiveSession(parsed.projectSessionId)
    const controller = new AbortController()
    const release = context.operations?.track(controller)
    try {
      const result = await new ManuscriptSearchService({
        manuscript: context.manuscript,
        log: options.logger
      }).revalidate(parsed, controller.signal)
      options.manager.assertActiveSession(parsed.projectSessionId)
      return manuscriptSearchNavigationResultSchema.parse(result)
    } finally {
      release?.()
    }
  })

  ipc.handle(IPC_CHANNELS.manuscriptReplacementPlan, async (event, rawInput: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = manuscriptReplacementPlanInputSchema.parse(rawInput)
    const service = replacementService(input.projectSessionId)
    const sectionIds = service.scopeSectionIds(input)
    await options.flushForMutation?.(input.projectSessionId, sectionIds, true)
    options.manager.assertMutationSession(input.projectSessionId)
    const controller = new AbortController()
    const release = options.manager
      .assertActiveSession(input.projectSessionId)
      .operations?.track(controller)
    try {
      return manuscriptReplacementPlanResultSchema.parse(
        await service.createPlan(input, controller.signal)
      )
    } finally {
      release?.()
    }
  })

  ipc.handle(IPC_CHANNELS.manuscriptReplacementPage, (event, rawInput: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = manuscriptReplacementPageInputSchema.parse(rawInput)
    return manuscriptReplacementPageResultSchema.parse(
      replacementService(input.projectSessionId).page(input)
    )
  })

  ipc.handle(IPC_CHANNELS.manuscriptReplacementDismiss, (event, rawInput: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = manuscriptReplacementDismissInputSchema.parse(rawInput)
    replacementService(input.projectSessionId).dismiss(input.planId)
  })

  ipc.handle(IPC_CHANNELS.manuscriptReplacementApply, async (event, rawInput: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = manuscriptReplacementApplyInputSchema.parse(rawInput)
    const service = replacementService(input.projectSessionId)
    const sectionIds = service.selectedSectionIds(input)
    if (sectionIds !== null)
      await options.flushForMutation?.(input.projectSessionId, sectionIds, true)
    let checkpointCreated = false
    if (
      input.createCheckpoint &&
      (await options.manager.versionHistoryState(input.projectSessionId)) === 'ready'
    ) {
      await options.manager.createCheckpoint(input.projectSessionId, {
        name: `Before replacement ${new Date().toISOString()}`,
        note: 'Automatic checkpoint before a confirmed manuscript replacement.'
      })
      checkpointCreated = true
    }
    options.manager.assertMutationSession(input.projectSessionId)
    const result = manuscriptReplacementApplyResultSchema.parse(
      await service.apply(input, checkpointCreated)
    )
    if (result.status === 'applied') {
      publishReplacementChanged({
        projectSessionId: input.projectSessionId,
        reason: 'replacement',
        sections: result.affectedSections.map(({ sectionId, sectionRevisionId }) => ({
          sectionId,
          sectionRevisionId
        }))
      })
    }
    return result
  })

  ipc.handle(IPC_CHANNELS.manuscriptReplacementUndo, async (event, rawInput: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = manuscriptReplacementUndoInputSchema.parse(rawInput)
    const service = replacementService(input.projectSessionId)
    const sectionId = service.undoSectionId(input.undoCapability)
    if (sectionId !== null)
      await options.flushForMutation?.(input.projectSessionId, [sectionId], true)
    options.manager.assertMutationSession(input.projectSessionId)
    const result = manuscriptReplacementUndoResultSchema.parse(
      await service.undo(input.undoCapability)
    )
    if (result.status === 'undone') {
      publishReplacementChanged({
        projectSessionId: input.projectSessionId,
        reason: 'undo',
        sections: [{ sectionId: result.sectionId, sectionRevisionId: result.sectionRevisionId }]
      })
    }
    return result
  })

  ipc.handle(IPC_CHANNELS.manuscriptReplacementSubscribe, (event, rawInput: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = manuscriptReplacementSubscriptionInputSchema.parse(rawInput)
    options.manager.assertActiveSession(input.projectSessionId)
    const subscriptions =
      replacementSubscribers.get(input.projectSessionId) ?? new Map<string, WebContents>()
    subscriptions.set(input.subscriptionId, event.sender)
    replacementSubscribers.set(input.projectSessionId, subscriptions)
  })

  ipc.handle(IPC_CHANNELS.manuscriptReplacementUnsubscribe, (event, rawInput: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = manuscriptReplacementSubscriptionInputSchema.parse(rawInput)
    const subscriptions = replacementSubscribers.get(input.projectSessionId)
    if (subscriptions?.get(input.subscriptionId)?.id === event.sender.id) {
      subscriptions.delete(input.subscriptionId)
      if (subscriptions.size === 0) replacementSubscribers.delete(input.projectSessionId)
    }
  })

  const channels = [
    IPC_CHANNELS.manuscriptGetWorkspace,
    IPC_CHANNELS.manuscriptGetReferences,
    IPC_CHANNELS.manuscriptGetPreview,
    IPC_CHANNELS.manuscriptGetPublicationPreview,
    IPC_CHANNELS.manuscriptUpdateBrief,
    IPC_CHANNELS.manuscriptCreateSection,
    IPC_CHANNELS.manuscriptUpdateSection,
    IPC_CHANNELS.manuscriptMoveSection,
    IPC_CHANNELS.manuscriptDeleteSection,
    IPC_CHANNELS.manuscriptSearch,
    IPC_CHANNELS.manuscriptSearchRevalidate,
    IPC_CHANNELS.manuscriptReplacementPlan,
    IPC_CHANNELS.manuscriptReplacementPage,
    IPC_CHANNELS.manuscriptReplacementDismiss,
    IPC_CHANNELS.manuscriptReplacementApply,
    IPC_CHANNELS.manuscriptReplacementUndo,
    IPC_CHANNELS.manuscriptReplacementSubscribe,
    IPC_CHANNELS.manuscriptReplacementUnsubscribe
  ] as const
  return {
    revokeSession(projectSessionId) {
      replacementServices.get(projectSessionId)?.revoke()
      replacementServices.delete(projectSessionId)
      replacementSubscribers.delete(projectSessionId)
    },
    unregister() {
      for (const service of replacementServices.values()) service.revoke()
      replacementServices.clear()
      replacementSubscribers.clear()
      for (const channel of channels) ipc.removeHandler(channel)
    }
  }
}
