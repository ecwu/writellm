import { app, ipcMain } from 'electron'
import {
  accentPreferenceSchema,
  appInfoSchema,
  citationDisplayModeSchema,
  onboardingStateSchema,
  setAccentPreferenceInputSchema,
  setCitationDisplayModeInputSchema,
  setDefaultAgentApprovalModeInputSchema,
  setOnboardingStateInputSchema,
  setThemePreferenceInputSchema,
  themePreferenceSchema
} from '../../shared/contracts/app'
import { agentApprovalModeSchema } from '../../shared/contracts/agent'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import {
  createPublicationPresetInputSchema,
  publicationPresetIdInputSchema,
  publicationPresetSnapshotSchema,
  updatePublicationPresetInputSchema
} from '../../shared/contracts/publication-presets'
import type { AppSettingsRepository } from '../app-db/repositories/app-settings'
import type { PublicationPresetRepository } from '../app-db/repositories/publication-presets'
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
  publicationPresets: PublicationPresetRepository
  logger: Logger
  developmentUrl?: string
  ipc?: AppIpcMain
}

export function registerIpcHandlers({
  appSettings,
  publicationPresets,
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

  ipc.handle(IPC_CHANNELS.appGetOnboardingState, async (event) => {
    authorizeSender(event.senderFrame, developmentUrl)
    return onboardingStateSchema.parse(await appSettings.getOnboardingState())
  })

  ipc.handle(IPC_CHANNELS.appSetOnboardingState, async (event, rawInput) => {
    authorizeSender(event.senderFrame, developmentUrl)
    const { state } = setOnboardingStateInputSchema.parse(rawInput)
    const persisted = await appSettings.setOnboardingState(state)
    logger.info(
      {
        event: 'app.settings.onboarding_state_updated',
        status: persisted.status,
        ...(persisted.status === 'pending' ? { step: persisted.step } : {})
      },
      'Onboarding state updated'
    )
    return onboardingStateSchema.parse(persisted)
  })

  ipc.handle(IPC_CHANNELS.publicationPresetsSnapshot, (event) => {
    authorizeSender(event.senderFrame, developmentUrl)
    return publicationPresetSnapshotSchema.parse(publicationPresets.snapshot())
  })

  ipc.handle(IPC_CHANNELS.publicationPresetsCreate, (event, rawInput) => {
    authorizeSender(event.senderFrame, developmentUrl)
    return publicationPresetSnapshotSchema.parse(
      publicationPresets.create(createPublicationPresetInputSchema.parse(rawInput))
    )
  })

  ipc.handle(IPC_CHANNELS.publicationPresetsUpdate, (event, rawInput) => {
    authorizeSender(event.senderFrame, developmentUrl)
    return publicationPresetSnapshotSchema.parse(
      publicationPresets.update(updatePublicationPresetInputSchema.parse(rawInput))
    )
  })

  ipc.handle(IPC_CHANNELS.publicationPresetsDelete, (event, rawInput) => {
    authorizeSender(event.senderFrame, developmentUrl)
    const { presetId } = publicationPresetIdInputSchema.parse(rawInput)
    return publicationPresetSnapshotSchema.parse(publicationPresets.delete(presetId))
  })

  ipc.handle(IPC_CHANNELS.publicationPresetsSetDefault, (event, rawInput) => {
    authorizeSender(event.senderFrame, developmentUrl)
    const { presetId } = publicationPresetIdInputSchema.parse(rawInput)
    return publicationPresetSnapshotSchema.parse(publicationPresets.setDefault(presetId))
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
      IPC_CHANNELS.appSetDefaultAgentApprovalMode,
      IPC_CHANNELS.appGetOnboardingState,
      IPC_CHANNELS.appSetOnboardingState,
      IPC_CHANNELS.publicationPresetsSnapshot,
      IPC_CHANNELS.publicationPresetsCreate,
      IPC_CHANNELS.publicationPresetsUpdate,
      IPC_CHANNELS.publicationPresetsDelete,
      IPC_CHANNELS.publicationPresetsSetDefault
    ]) {
      ipc.removeHandler(channel)
    }
  }
}
