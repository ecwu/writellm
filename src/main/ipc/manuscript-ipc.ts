import { ipcMain, type IpcMain } from 'electron'
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
import { authorizeSender } from './authorize-sender'

export interface ManuscriptIpcMain extends Pick<IpcMain, 'handle' | 'removeHandler'> {}

export function registerManuscriptIpc(options: {
  manager: ProjectManager
  logger: Pick<Logger, 'info' | 'error'>
  developmentUrl?: string
  ipc?: ManuscriptIpcMain
}): () => void {
  const ipc = options.ipc ?? ipcMain
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

  return () => {
    for (const channel of [
      IPC_CHANNELS.manuscriptGetWorkspace,
      IPC_CHANNELS.manuscriptGetReferences,
      IPC_CHANNELS.manuscriptGetPreview,
      IPC_CHANNELS.manuscriptUpdateBrief,
      IPC_CHANNELS.manuscriptCreateSection,
      IPC_CHANNELS.manuscriptUpdateSection,
      IPC_CHANNELS.manuscriptMoveSection,
      IPC_CHANNELS.manuscriptDeleteSection
    ])
      ipc.removeHandler(channel)
  }
}
