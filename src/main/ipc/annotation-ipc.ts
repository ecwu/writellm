import { ipcMain, type IpcMain } from 'electron'
import type { Logger } from 'pino'
import {
  annotationRecordSchema,
  createAnnotationInputSchema,
  listAnnotationsInputSchema,
  updateAnnotationInputSchema
} from '../../shared/contracts/annotations'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import type { ProjectManager } from '../project/project-manager'
import { authorizeSender } from './authorize-sender'

export interface AnnotationIpcMain extends Pick<IpcMain, 'handle' | 'removeHandler'> {}

export function registerAnnotationIpc(options: {
  manager: ProjectManager
  logger: Pick<Logger, 'info' | 'error'>
  developmentUrl?: string
  ipc?: AnnotationIpcMain
}): { unregister(): void } {
  const ipc = options.ipc ?? ipcMain
  const lifecycle = <T>(eventName: string, projectSessionId: string, operation: () => T): T => {
    const startedAt = Date.now()
    try {
      const result = operation()
      options.logger.info(
        { event: `${eventName}.completed`, projectSessionId, durationMs: Date.now() - startedAt },
        'Annotation IPC operation completed'
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
        'Annotation IPC operation failed'
      )
      throw err
    }
  }
  const service = (projectSessionId: string) =>
    options.manager.assertActiveSession(projectSessionId).annotations

  ipc.handle(IPC_CHANNELS.annotationsList, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = listAnnotationsInputSchema.parse(raw)
    const { projectSessionId, ...filters } = input
    return lifecycle('annotations.list', projectSessionId, () =>
      service(projectSessionId).list(filters)
    )
  })
  ipc.handle(IPC_CHANNELS.annotationsCreate, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = createAnnotationInputSchema.parse(raw)
    const { projectSessionId, ...create } = input
    return lifecycle('annotations.create', projectSessionId, () =>
      annotationRecordSchema.parse(
        options.manager.assertMutationSession(projectSessionId).annotations.create(create)
      )
    )
  })
  ipc.handle(IPC_CHANNELS.annotationsUpdate, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = updateAnnotationInputSchema.parse(raw)
    return lifecycle('annotations.update', input.projectSessionId, () =>
      annotationRecordSchema.parse(
        options.manager
          .assertMutationSession(input.projectSessionId)
          .annotations.update(input.operation)
      )
    )
  })

  const channels = [
    IPC_CHANNELS.annotationsList,
    IPC_CHANNELS.annotationsCreate,
    IPC_CHANNELS.annotationsUpdate
  ] as const
  return {
    unregister() {
      for (const channel of channels) ipc.removeHandler(channel)
    }
  }
}
