import { ipcMain, type IpcMain } from 'electron'
import type { Logger } from 'pino'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import { projectSessionInputSchema } from '../../shared/contracts/projects'
import {
  contentTabId,
  workbenchLayoutSchema,
  workbenchLayoutSaveSchema
} from '../../shared/contracts/workbench'
import type { AppSettingsRepository } from '../app-db/repositories/app-settings'
import type { ProjectManager } from '../project/project-manager'
import { authorizeSender } from './authorize-sender'

export function registerWorkbenchIpc(options: {
  manager: Pick<ProjectManager, 'assertActiveSession'>
  authorizeLayoutFlush(projectSessionId: string, closingToken: string, senderId: number): string
  settings: AppSettingsRepository
  log: Pick<Logger, 'info' | 'error'>
  developmentUrl?: string
  ipc?: Pick<IpcMain, 'handle' | 'removeHandler'>
}): { unregister(): void } {
  const ipc = options.ipc ?? ipcMain
  const channels = [
    IPC_CHANNELS.workbenchLayoutRead,
    IPC_CHANNELS.workbenchLayoutSave,
    IPC_CHANNELS.workbenchLayoutReset
  ]
  for (const channel of channels)
    ipc.handle(channel, async (event, raw: unknown) => {
      authorizeSender(event.senderFrame, options.developmentUrl)
      const input =
        channel === IPC_CHANNELS.workbenchLayoutSave
          ? workbenchLayoutSaveSchema.parse(raw)
          : projectSessionInputSchema.parse(raw)
      const projectId =
        'closingToken' in input && typeof input.closingToken === 'string'
          ? options.authorizeLayoutFlush(
              input.projectSessionId,
              input.closingToken,
              event.sender.id
            )
          : options.manager.assertActiveSession(input.projectSessionId).manifest.projectId
      try {
        if (channel === IPC_CHANNELS.workbenchLayoutRead) {
          const layout = workbenchLayoutSchema
            .nullable()
            .parse(await options.settings.getWorkbenchLayout(projectId))
          options.log.info(
            {
              event: 'workbench.layout.restored',
              projectId,
              tabCount: layout?.tabs.length ?? 0,
              usedDefault: layout === null
            },
            'Workbench layout read'
          )
          return layout
        }
        const previous = await options.settings.getWorkbenchLayout(projectId)
        const layout =
          'layout' in input
            ? workbenchLayoutSchema.parse(input.layout)
            : previous
              ? { ...previous, tools: null }
              : null
        await options.settings.setWorkbenchLayout(projectId, layout)
        const before = new Set(previous?.tabs.map(contentTabId))
        const after = new Set(layout?.tabs.map(contentTabId))
        for (const tab of layout?.tabs ?? [])
          if (!before.has(contentTabId(tab)))
            options.log.info(
              {
                event: 'workbench.tab.opened',
                projectId,
                tabId: contentTabId(tab),
                kind: tab.kind
              },
              'Workbench tab opened'
            )
        for (const tab of previous?.tabs ?? [])
          if (!after.has(contentTabId(tab)))
            options.log.info(
              {
                event: 'workbench.tab.closed',
                projectId,
                tabId: contentTabId(tab),
                kind: tab.kind
              },
              'Workbench tab closed'
            )
        options.log.info(
          { event: 'workbench.layout.saved', projectId, tabCount: layout?.tabs.length ?? 0 },
          'Workbench layout saved'
        )
        return undefined
      } catch (err) {
        options.log.error(
          { event: 'workbench.layout.failed', err, projectId },
          'Workbench layout operation failed'
        )
        throw new Error('Workspace layout could not be saved or restored.', { cause: err })
      }
    })
  return {
    unregister: () => {
      for (const channel of channels) ipc.removeHandler(channel)
    }
  }
}
