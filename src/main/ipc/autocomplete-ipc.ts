import { z } from 'zod'
import { ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import {
  autocompleteRequestIdentitySchema,
  autocompleteCancelSchema,
  autocompleteRequestSchema,
  autocompleteResultSchema,
  autocompleteSelectionSchema,
  autocompleteStyleSchema,
  autocompleteSessionInputSchema,
  autocompleteSessionSchema,
  autocompleteSettingsSchema,
  autocompleteToggleInputSchema
} from '../../shared/contracts/autocomplete'
import type { ProjectManager } from '../project/project-manager'
import type { AutocompleteService } from '../providers/autocomplete-service'
import { authorizeSender } from './authorize-sender'
import type { ProviderIpcMain } from './provider-ipc'

export function registerAutocompleteIpc(options: {
  service: AutocompleteService
  manager: Pick<ProjectManager, 'assertActiveSession'>
  developmentUrl?: string
  ipc?: ProviderIpcMain
}): { unregister(): void; revokeSession(id: string): void } {
  const ipc = options.ipc ?? ipcMain
  const channels: string[] = []
  const owners = new Map<string, number>()
  function handle<I, O>(
    channel: string,
    schema: z.ZodType<I>,
    output: z.ZodType<O>,
    run: (input: I) => O | Promise<O>
  ): void {
    channels.push(channel)
    ipc.handle(channel, async (event, raw) => {
      authorizeSender(event.senderFrame, options.developmentUrl)
      const input = schema.parse(raw)
      if (typeof input === 'object' && input !== null && 'projectSessionId' in input) {
        const id = String(input.projectSessionId)
        options.manager.assertActiveSession(id)
        const owner = owners.get(id)
        if (owner !== undefined && owner !== event.sender.id)
          throw new Error('Autocomplete session belongs to another window')
        owners.set(id, event.sender.id)
      }
      return output.parse(await run(input))
    })
  }
  handle(IPC_CHANNELS.autocompleteSettings, z.undefined(), autocompleteSettingsSchema, () =>
    options.service.settings()
  )
  handle(
    IPC_CHANNELS.autocompleteSelect,
    autocompleteSelectionSchema.nullable(),
    autocompleteSettingsSchema,
    (input) => options.service.select(input)
  )
  handle(
    IPC_CHANNELS.autocompleteStyle,
    autocompleteStyleSchema,
    autocompleteSettingsSchema,
    (input) => options.service.setStyle(input)
  )
  handle(
    IPC_CHANNELS.autocompleteSession,
    autocompleteSessionInputSchema,
    autocompleteSessionSchema,
    ({ projectSessionId }) => options.service.session(projectSessionId)
  )
  handle(
    IPC_CHANNELS.autocompleteToggle,
    autocompleteToggleInputSchema,
    autocompleteSessionSchema,
    ({ projectSessionId, enabled }) => options.service.toggle(projectSessionId, enabled)
  )
  handle(
    IPC_CHANNELS.autocompleteComplete,
    autocompleteRequestSchema,
    autocompleteResultSchema,
    (input) => options.service.complete(input)
  )
  handle(
    IPC_CHANNELS.autocompleteCancel,
    autocompleteCancelSchema,
    z.void(),
    ({ projectSessionId, requestId, reason }) =>
      options.service.cancel(projectSessionId, requestId, reason)
  )
  handle(
    IPC_CHANNELS.autocompleteAccepted,
    autocompleteRequestIdentitySchema,
    z.void(),
    ({ projectSessionId, requestId }) => options.service.accepted(projectSessionId, requestId)
  )
  return {
    unregister() {
      for (const channel of channels) ipc.removeHandler(channel)
      for (const id of owners.keys()) options.service.revokeSession(id)
      owners.clear()
    },
    revokeSession(id) {
      owners.delete(id)
      options.service.revokeSession(id)
    }
  }
}
