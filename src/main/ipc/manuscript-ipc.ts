import { reportIpcFailure } from '../observability/ipc-context'
import { ipcMain, type IpcMain, type WebContents } from 'electron'
import type { Logger } from 'pino'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import type { ProjectManager } from '../project/project-manager'
import { ManuscriptSearchService } from '../manuscript/manuscript-search-service'
import {
  manuscriptReplacementChangedEventSchema,
  type ManuscriptReplacementChangedEvent
} from '../../shared/contracts/manuscript-replacement'
import { ManuscriptReplacementService } from '../manuscript/manuscript-replacement-service'
import { PublicationService } from '../manuscript/publication-service'
import { manuscriptIpcEndpoints } from '../../shared/contracts/ipc-endpoints-manuscript'
import { createEndpointRegistrar } from './endpoint'
import type { ProjectContext } from '../project/project-context'
import type { PublicationPresetRepository } from '../app-db/repositories/publication-presets'
import type { CitationFormattingService } from '../references/citation-formatting-service'
import { ManuscriptCommentService } from '../manuscript/comment-service'

export interface ManuscriptIpcMain extends Pick<IpcMain, 'handle' | 'removeHandler'> {}

export function registerManuscriptIpc(options: {
  manager: ProjectManager
  logger: Pick<Logger, 'info' | 'warn' | 'error'>
  developmentUrl?: string
  ipc?: ManuscriptIpcMain
  publicationPresets?: Pick<PublicationPresetRepository, 'resolve'>
  citationFormatting?: CitationFormattingService
  flushForMutation?(
    projectSessionId: string,
    affectedSectionIds: readonly string[],
    flushMetadata?: boolean
  ): Promise<void>
}): { revokeSession(projectSessionId: string): void; unregister(): void } {
  const ipc = options.ipc ?? ipcMain
  const handle = createEndpointRegistrar(ipc, {
    developmentUrl: options.developmentUrl,
    manager: options.manager
  })
  const replacementServices = new Map<string, ManuscriptReplacementService>()
  const commentServices = new Map<string, ManuscriptCommentService>()
  const publicationService = new PublicationService(options.logger, options.citationFormatting)
  const replacementSubscribers = new Map<string, Map<string, WebContents>>()
  const replacementService = (
    projectSessionId: string,
    context: ProjectContext
  ): ManuscriptReplacementService => {
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
  const commentService = (
    projectSessionId: string,
    context: ProjectContext
  ): ManuscriptCommentService => {
    let service = commentServices.get(projectSessionId)
    if (service === undefined) {
      service = new ManuscriptCommentService({
        database: context.database,
        manuscript: context.manuscript,
        projectSessionId,
        log: options.logger
      })
      commentServices.set(projectSessionId, service)
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
        reportIpcFailure(
          options.logger,
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
  // Endpoint output schemas validate the workspace returned by every outline operation.
  const workspace = (context: ProjectContext) => context.manuscript.getWorkspace()
  const lifecycle =
    <Input extends { projectSessionId: string }>(
      event: string,
      details: (input: Input) => Record<string, unknown> = () => ({})
    ) =>
    <T>(input: Input, run: () => Promise<T>): Promise<T> =>
      runLifecycle(event, input.projectSessionId, run, details(input))
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
      reportIpcFailure(
        options.logger,
        {
          event: `${event}.failed`,
          err,
          projectSessionId,
          durationMs: Date.now() - startedAt,
          ...context
        },
        'Manuscript IPC operation failed'
      )
      if (
        err instanceof Error &&
        'code' in err &&
        (err.code === 'brief_version_conflict' || err.code === 'outline_version_conflict')
      ) {
        throw new Error(`[${err.code}] ${err.message}`, { cause: err })
      }
      throw err
    }
  }

  /** Log load failures, including session rejections, with the original error. */
  const loadBoundary =
    (event: string, message: string) =>
    async <T>(parsed: { projectSessionId: string }, run: () => Promise<T>): Promise<T> => {
      const startedAt = Date.now()
      try {
        return await run()
      } catch (err) {
        reportIpcFailure(
          options.logger,
          {
            event,
            err,
            projectSessionId: parsed.projectSessionId,
            durationMs: Date.now() - startedAt
          },
          message
        )
        throw err
      }
    }

  handle(
    manuscriptIpcEndpoints.workspace,
    (parsed, context) => {
      const startedAt = Date.now()
      const result = workspace(context)
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
    },
    { around: loadBoundary('manuscript.workspace.load_failed', 'Manuscript workspace load failed') }
  )

  handle(
    manuscriptIpcEndpoints.references,
    (parsed, context) => {
      const startedAt = Date.now()
      const result = context.manuscript.getReferenceIndex()
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
    },
    {
      around: loadBoundary(
        'manuscript.references.load_failed',
        'Manuscript reference index load failed'
      )
    }
  )

  handle(manuscriptIpcEndpoints.preview, (_parsed, context) => context.manuscript.assemble(), {
    around: lifecycle('manuscript.preview.load')
  })

  handle(manuscriptIpcEndpoints.publicationPreview, (parsed, context) =>
    publicationService.preview(context, parsed.options ?? options.publicationPresets?.resolve())
  )

  handle(
    manuscriptIpcEndpoints.updateBrief,
    (parsed, context) => {
      context.manuscript.updateBrief(parsed.update)
      return workspace(context)
    },
    {
      around: lifecycle('manuscript.brief.update', (parsed) => ({
        baseVersion: parsed.update.baseVersion
      }))
    }
  )

  handle(
    manuscriptIpcEndpoints.createSection,
    async (parsed, context) => {
      const created = context.manuscript.createSection(parsed.create)
      try {
        await context.editorPersistence.materialize(
          context.editorPersistence.loadSection(created.sectionId).revision
        )
      } catch (err) {
        reportIpcFailure(
          options.logger,
          {
            event: 'manuscript.section.initial_materialization_failed',
            err,
            projectSessionId: parsed.projectSessionId,
            sectionId: created.sectionId
          },
          'New section canonical revision exists but its materialization is pending repair'
        )
      }
      return workspace(options.manager.assertActiveSession(parsed.projectSessionId))
    },
    {
      around: lifecycle('manuscript.section.create', (parsed) => ({
        baseOutlineVersion: parsed.create.baseOutlineVersion
      }))
    }
  )

  handle(
    manuscriptIpcEndpoints.updateSection,
    (parsed, context) => {
      context.manuscript.updateSection(parsed.update)
      return workspace(context)
    },
    {
      around: lifecycle('manuscript.section.update', (parsed) => ({
        sectionId: parsed.update.sectionId,
        baseOutlineVersion: parsed.update.baseOutlineVersion
      }))
    }
  )

  handle(
    manuscriptIpcEndpoints.moveSection,
    (parsed, context) => {
      context.manuscript.moveSection(parsed.move)
      return workspace(context)
    },
    {
      around: lifecycle('manuscript.section.move', (parsed) => ({
        sectionId: parsed.move.sectionId,
        baseOutlineVersion: parsed.move.baseOutlineVersion
      }))
    }
  )

  handle(
    manuscriptIpcEndpoints.deleteSection,
    async (parsed, context) => {
      context.manuscript.deleteSection(parsed.delete)
      try {
        await context.editorPersistence.removeMaterialization(parsed.delete.sectionId)
      } catch (err) {
        reportIpcFailure(
          options.logger,
          {
            event: 'manuscript.section.materialization_delete_failed',
            err,
            projectSessionId: parsed.projectSessionId,
            sectionId: parsed.delete.sectionId
          },
          'Deleted section materialization cleanup failed'
        )
      }
      return workspace(options.manager.assertActiveSession(parsed.projectSessionId))
    },
    {
      around: lifecycle('manuscript.section.delete', (parsed) => ({
        sectionId: parsed.delete.sectionId,
        baseOutlineVersion: parsed.delete.baseOutlineVersion
      }))
    }
  )

  handle(manuscriptIpcEndpoints.search, async (parsed, context) => {
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
      return bounded
    } finally {
      release?.()
    }
  })

  handle(manuscriptIpcEndpoints.revalidateSearch, async (parsed, context) => {
    const controller = new AbortController()
    const release = context.operations?.track(controller)
    try {
      const result = await new ManuscriptSearchService({
        manuscript: context.manuscript,
        log: options.logger
      }).revalidate(parsed, controller.signal)
      options.manager.assertActiveSession(parsed.projectSessionId)
      return result
    } finally {
      release?.()
    }
  })

  handle(manuscriptIpcEndpoints.createReplacementPlan, async (input, context) => {
    const service = replacementService(input.projectSessionId, context)
    const sectionIds = service.scopeSectionIds(input)
    await options.flushForMutation?.(input.projectSessionId, sectionIds, true)
    options.manager.assertMutationSession(input.projectSessionId)
    const controller = new AbortController()
    const release = options.manager
      .assertActiveSession(input.projectSessionId)
      .operations?.track(controller)
    try {
      return await service.createPlan(input, controller.signal)
    } finally {
      release?.()
    }
  })

  handle(manuscriptIpcEndpoints.replacementPage, (input, context) => {
    return replacementService(input.projectSessionId, context).page(input)
  })

  handle(manuscriptIpcEndpoints.dismissReplacementPlan, (input, context) => {
    replacementService(input.projectSessionId, context).dismiss(input.planId)
  })

  handle(manuscriptIpcEndpoints.applyReplacement, async (input, context) => {
    const service = replacementService(input.projectSessionId, context)
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
    const result = await service.apply(input, checkpointCreated)
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

  handle(manuscriptIpcEndpoints.undoReplacement, async (input, context) => {
    const service = replacementService(input.projectSessionId, context)
    const sectionId = service.undoSectionId(input.undoCapability)
    if (sectionId !== null)
      await options.flushForMutation?.(input.projectSessionId, [sectionId], true)
    options.manager.assertMutationSession(input.projectSessionId)
    const result = await service.undo(input.undoCapability)
    if (result.status === 'undone') {
      publishReplacementChanged({
        projectSessionId: input.projectSessionId,
        reason: 'undo',
        sections: [{ sectionId: result.sectionId, sectionRevisionId: result.sectionRevisionId }]
      })
    }
    return result
  })

  handle(manuscriptIpcEndpoints.replacementSubscribe, (input, _context, event) => {
    const subscriptions =
      replacementSubscribers.get(input.projectSessionId) ?? new Map<string, WebContents>()
    subscriptions.set(input.subscriptionId, event.sender)
    replacementSubscribers.set(input.projectSessionId, subscriptions)
  })

  handle(manuscriptIpcEndpoints.replacementUnsubscribe, (input, _context, event) => {
    const subscriptions = replacementSubscribers.get(input.projectSessionId)
    if (subscriptions?.get(input.subscriptionId)?.id === event.sender.id) {
      subscriptions.delete(input.subscriptionId)
      if (subscriptions.size === 0) replacementSubscribers.delete(input.projectSessionId)
    }
  })

  handle(manuscriptIpcEndpoints.listComments, (input, context) => {
    return commentService(input.projectSessionId, context).list(input)
  })
  handle(manuscriptIpcEndpoints.readComment, (input, context) => {
    return commentService(input.projectSessionId, context).read(input.threadId)
  })
  handle(manuscriptIpcEndpoints.createComment, async (input) => {
    await options.flushForMutation?.(input.projectSessionId, [input.sectionId])
    // The editor flush awaits, so revalidate the mutation capability before writing.
    const current = options.manager.assertMutationSession(input.projectSessionId)
    return commentService(input.projectSessionId, current).create(input)
  })
  handle(manuscriptIpcEndpoints.replyComment, (input, context) => {
    return commentService(input.projectSessionId, context).reply(input)
  })
  handle(manuscriptIpcEndpoints.editComment, (input, context) => {
    return commentService(input.projectSessionId, context).edit(input)
  })
  handle(manuscriptIpcEndpoints.resolveComment, (input, context) => {
    return commentService(input.projectSessionId, context).resolve(input)
  })
  handle(manuscriptIpcEndpoints.reopenComment, (input, context) => {
    return commentService(input.projectSessionId, context).reopen(input)
  })
  handle(manuscriptIpcEndpoints.deleteComment, (input, context) => {
    commentService(input.projectSessionId, context).delete(input)
  })
  handle(manuscriptIpcEndpoints.reanchorComment, (input, context) => {
    return commentService(input.projectSessionId, context).reanchor(input)
  })
  handle(manuscriptIpcEndpoints.delegateComments, (input, context) => {
    return commentService(input.projectSessionId, context).delegate(input)
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
    IPC_CHANNELS.manuscriptReplacementUnsubscribe,
    IPC_CHANNELS.manuscriptCommentsList,
    IPC_CHANNELS.manuscriptCommentsRead,
    IPC_CHANNELS.manuscriptCommentsCreate,
    IPC_CHANNELS.manuscriptCommentsReply,
    IPC_CHANNELS.manuscriptCommentsEdit,
    IPC_CHANNELS.manuscriptCommentsResolve,
    IPC_CHANNELS.manuscriptCommentsReopen,
    IPC_CHANNELS.manuscriptCommentsDelete,
    IPC_CHANNELS.manuscriptCommentsReanchor,
    IPC_CHANNELS.manuscriptCommentsDelegate
  ] as const
  return {
    revokeSession(projectSessionId) {
      replacementServices.get(projectSessionId)?.revoke()
      replacementServices.delete(projectSessionId)
      commentServices.delete(projectSessionId)
      replacementSubscribers.delete(projectSessionId)
    },
    unregister() {
      for (const service of replacementServices.values()) service.revoke()
      replacementServices.clear()
      commentServices.clear()
      replacementSubscribers.clear()
      for (const channel of channels) ipc.removeHandler(channel)
    }
  }
}
