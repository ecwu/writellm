import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { Logger } from 'pino'
import {
  providerConnectionTestResultSchema,
  providerRoleInputSchema,
  providerSaveInputSchema,
  providerSettingsSnapshotSchema
} from '../../shared/contracts/providers'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import type { ProviderService } from '../providers/provider-service'
import { authorizeSender } from './authorize-sender'

export interface ProviderIpcMain {
  handle(
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  ): void
  removeHandler(channel: string): void
}

export interface RegisterProviderIpcOptions {
  providers: ProviderService
  logger: Logger
  developmentUrl?: string
  ipc?: ProviderIpcMain
}

export function registerProviderIpc({
  providers,
  logger,
  developmentUrl,
  ipc = ipcMain
}: RegisterProviderIpcOptions): () => void {
  ipc.handle(IPC_CHANNELS.providersSnapshot, async (event) => {
    authorizeSender(event.senderFrame, developmentUrl)
    return providerSettingsSnapshotSchema.parse(await providers.snapshot())
  })
  ipc.handle(IPC_CHANNELS.providersSave, async (event, rawInput) => {
    authorizeSender(event.senderFrame, developmentUrl)
    const input = providerSaveInputSchema.parse(rawInput)
    logger.info(
      {
        event: 'provider.ipc.save',
        role: input.config.role,
        hasCredential: input.apiKey !== undefined
      },
      'Saving provider configuration'
    )
    return providerSettingsSnapshotSchema.parse(await providers.save(input.config, input.apiKey))
  })
  ipc.handle(IPC_CHANNELS.providersRemove, async (event, rawInput) => {
    authorizeSender(event.senderFrame, developmentUrl)
    const { role } = providerRoleInputSchema.parse(rawInput)
    return providerSettingsSnapshotSchema.parse(await providers.remove(role))
  })
  ipc.handle(IPC_CHANNELS.providersTestConnection, async (event, rawInput) => {
    authorizeSender(event.senderFrame, developmentUrl)
    const { role } = providerRoleInputSchema.parse(rawInput)
    return providerConnectionTestResultSchema.parse(await providers.testConnection(role))
  })

  return () => {
    for (const channel of [
      IPC_CHANNELS.providersSnapshot,
      IPC_CHANNELS.providersSave,
      IPC_CHANNELS.providersRemove,
      IPC_CHANNELS.providersTestConnection
    ]) {
      ipc.removeHandler(channel)
    }
  }
}
