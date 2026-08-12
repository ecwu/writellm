import { app, ipcMain } from 'electron'
import {
  accentPreferenceSchema,
  appInfoSchema,
  citationDisplayModeSchema,
  setAccentPreferenceInputSchema,
  setCitationDisplayModeInputSchema,
  setDefaultAgentApprovalModeInputSchema,
  setThemePreferenceInputSchema,
  themePreferenceSchema
} from '../../shared/contracts/app'
import { agentApprovalModeSchema } from '../../shared/contracts/agent'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import type { AppSettingsRepository } from '../app-db/repositories/app-settings'
import type { Logger } from 'pino'
import { authorizeSender } from './authorize-sender'

export interface AppIpcMain {
  handle(
    channel: string,
    listener: (event: Electron.IpcMainInvokeEvent, ...args: unknown[]) => unknown
  ): void
  removeHandler(channel: string): void
}

export interface RegisterIpcHandlersOptions {
  appSettings: AppSettingsRepository
  logger: Logger
  developmentUrl?: string
  ipc?: AppIpcMain
}

export function registerIpcHandlers({
  appSettings,
  logger,
  developmentUrl,
  ipc = ipcMain
}: RegisterIpcHandlersOptions): () => void {
  ipc.handle(IPC_CHANNELS.appGetInfo, (event) => {
    authorizeSender(event.senderFrame, developmentUrl)

    return appInfoSchema.parse({
      name: app.getName(),
      version: app.getVersion()
    })
  })

  ipc.handle(IPC_CHANNELS.appGetThemePreference, async (event) => {
    authorizeSender(event.senderFrame, developmentUrl)
    return themePreferenceSchema.parse(await appSettings.getThemePreference())
  })

  ipc.handle(IPC_CHANNELS.appSetThemePreference, async (event, rawInput) => {
    authorizeSender(event.senderFrame, developmentUrl)
    const { preference } = setThemePreferenceInputSchema.parse(rawInput)
    const persisted = await appSettings.setThemePreference(preference)
    logger.info(
      { event: 'app.settings.theme_preference_updated', preference: persisted },
      'Theme preference updated'
    )
    return themePreferenceSchema.parse(persisted)
  })

  ipc.handle(IPC_CHANNELS.appGetAccentPreference, async (event) => {
    authorizeSender(event.senderFrame, developmentUrl)
    return accentPreferenceSchema.parse(await appSettings.getAccentPreference())
  })

  ipc.handle(IPC_CHANNELS.appSetAccentPreference, async (event, rawInput) => {
    authorizeSender(event.senderFrame, developmentUrl)
    const { preference } = setAccentPreferenceInputSchema.parse(rawInput)
    const persisted = await appSettings.setAccentPreference(preference)
    logger.info(
      { event: 'app.settings.accent_preference_updated', preference: persisted },
      'Accent preference updated'
    )
    return accentPreferenceSchema.parse(persisted)
  })

  ipc.handle(IPC_CHANNELS.appGetCitationDisplayMode, async (event) => {
    authorizeSender(event.senderFrame, developmentUrl)
    return citationDisplayModeSchema.parse(await appSettings.getCitationDisplayMode())
  })

  ipc.handle(IPC_CHANNELS.appSetCitationDisplayMode, async (event, rawInput) => {
    authorizeSender(event.senderFrame, developmentUrl)
    const { mode } = setCitationDisplayModeInputSchema.parse(rawInput)
    const persisted = await appSettings.setCitationDisplayMode(mode)
    logger.info(
      { event: 'app.settings.citation_display_mode_updated', mode: persisted },
      'Citation display mode updated'
    )
    return citationDisplayModeSchema.parse(persisted)
  })

  ipc.handle(IPC_CHANNELS.appGetDefaultAgentApprovalMode, async (event) => {
    authorizeSender(event.senderFrame, developmentUrl)
    return agentApprovalModeSchema.parse(await appSettings.getDefaultAgentApprovalMode())
  })

  ipc.handle(IPC_CHANNELS.appSetDefaultAgentApprovalMode, async (event, rawInput) => {
    authorizeSender(event.senderFrame, developmentUrl)
    const { mode } = setDefaultAgentApprovalModeInputSchema.parse(rawInput)
    const persisted = await appSettings.setDefaultAgentApprovalMode(mode)
    logger.info(
      { event: 'app.settings.agent_approval_mode_updated', mode: persisted },
      'Default Agent approval mode updated'
    )
    return agentApprovalModeSchema.parse(persisted)
  })

  return () => {
    for (const channel of [
      IPC_CHANNELS.appGetInfo,
      IPC_CHANNELS.appGetThemePreference,
      IPC_CHANNELS.appSetThemePreference,
      IPC_CHANNELS.appGetAccentPreference,
      IPC_CHANNELS.appSetAccentPreference,
      IPC_CHANNELS.appGetCitationDisplayMode,
      IPC_CHANNELS.appSetCitationDisplayMode,
      IPC_CHANNELS.appGetDefaultAgentApprovalMode,
      IPC_CHANNELS.appSetDefaultAgentApprovalMode
    ]) {
      ipc.removeHandler(channel)
    }
  }
}
