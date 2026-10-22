import { reportIpcFailure } from '../observability/ipc-context'
import { app, ipcMain } from 'electron'
import { appIpcEndpoints } from '../../shared/contracts/ipc-endpoints'
import type { AppSettingsRepository } from '../app-db/repositories/app-settings'
import type { PublicationPresetRepository } from '../app-db/repositories/publication-presets'
import type { Logger } from 'pino'
import type { ProjectManager } from '../project/project-manager'
import { registerIpcEndpoint, type TypedIpcMain } from './endpoint'

export type AppIpcMain = TypedIpcMain

export interface RegisterIpcHandlersOptions {
  projectManager: Pick<ProjectManager, 'snapshot' | 'close'>
  quit?: () => void
  appSettings: AppSettingsRepository
  publicationPresets: PublicationPresetRepository
  logger: Logger
  developmentUrl?: string
  ipc?: AppIpcMain
}

export function registerIpcHandlers({
  appSettings,
  projectManager,
  quit = () => app.quit(),
  publicationPresets,
  logger,
  developmentUrl,
  ipc = ipcMain
}: RegisterIpcHandlersOptions): () => void {
  const unregister = [
    registerIpcEndpoint(ipc, appIpcEndpoints.quit, {
      developmentUrl,
      handle: async () => {
        try {
          if (projectManager.snapshot().state === 'open') await projectManager.close()
          if (projectManager.snapshot().state !== 'closed') {
            throw new Error('Resolve the project lifecycle before quitting')
          }
          logger.info({ event: 'app.quit.requested' }, 'Application exit requested')
          // Return the acknowledgement before shutdown destroys the invoking renderer.
          setImmediate(quit)
          return { accepted: true as const }
        } catch (err) {
          reportIpcFailure(
            logger,
            { event: 'app.quit.failed', err },
            'Unable to close project before exit'
          )
          throw new Error('Unable to exit. Resolve the project close issue and try again.', {
            cause: err
          })
        }
      }
    }),
    registerIpcEndpoint(ipc, appIpcEndpoints.getInfo, {
      developmentUrl,
      handle: () => ({ name: app.getName(), version: app.getVersion() })
    }),
    registerIpcEndpoint(ipc, appIpcEndpoints.getThemePreference, {
      developmentUrl,
      handle: () => appSettings.getThemePreference()
    }),
    registerIpcEndpoint(ipc, appIpcEndpoints.setThemePreference, {
      developmentUrl,
      handle: async ({ preference }) => {
        const persisted = await appSettings.setThemePreference(preference)
        logger.info(
          { event: 'app.settings.theme_preference_updated', preference: persisted },
          'Theme preference updated'
        )
        return persisted
      }
    }),
    registerIpcEndpoint(ipc, appIpcEndpoints.getAccentPreference, {
      developmentUrl,
      handle: () => appSettings.getAccentPreference()
    }),
    registerIpcEndpoint(ipc, appIpcEndpoints.setAccentPreference, {
      developmentUrl,
      handle: async ({ preference }) => {
        const persisted = await appSettings.setAccentPreference(preference)
        logger.info(
          { event: 'app.settings.accent_preference_updated', preference: persisted },
          'Accent preference updated'
        )
        return persisted
      }
    }),
    registerIpcEndpoint(ipc, appIpcEndpoints.getCitationDisplayMode, {
      developmentUrl,
      handle: () => appSettings.getCitationDisplayMode()
    }),
    registerIpcEndpoint(ipc, appIpcEndpoints.setCitationDisplayMode, {
      developmentUrl,
      handle: async ({ mode }) => {
        const persisted = await appSettings.setCitationDisplayMode(mode)
        logger.info(
          { event: 'app.settings.citation_display_mode_updated', mode: persisted },
          'Citation display mode updated'
        )
        return persisted
      }
    }),
    registerIpcEndpoint(ipc, appIpcEndpoints.getDefaultAgentApprovalMode, {
      developmentUrl,
      handle: () => appSettings.getDefaultAgentApprovalMode()
    }),
    registerIpcEndpoint(ipc, appIpcEndpoints.setDefaultAgentApprovalMode, {
      developmentUrl,
      handle: async ({ mode }) => {
        const persisted = await appSettings.setDefaultAgentApprovalMode(mode)
        logger.info(
          { event: 'app.settings.agent_approval_mode_updated', mode: persisted },
          'Default Agent approval mode updated'
        )
        return persisted
      }
    }),
    registerIpcEndpoint(ipc, appIpcEndpoints.getOnboardingState, {
      developmentUrl,
      handle: () => appSettings.getOnboardingState()
    }),
    registerIpcEndpoint(ipc, appIpcEndpoints.setOnboardingState, {
      developmentUrl,
      handle: async ({ state }) => {
        const persisted = await appSettings.setOnboardingState(state)
        logger.info(
          {
            event: 'app.settings.onboarding_state_updated',
            status: persisted.status,
            ...(persisted.status === 'pending' ? { step: persisted.step } : {})
          },
          'Onboarding state updated'
        )
        return persisted
      }
    }),
    registerIpcEndpoint(ipc, appIpcEndpoints.publicationPresets, {
      developmentUrl,
      handle: () => publicationPresets.snapshot()
    }),
    registerIpcEndpoint(ipc, appIpcEndpoints.createPublicationPreset, {
      developmentUrl,
      handle: (input) => publicationPresets.create(input)
    }),
    registerIpcEndpoint(ipc, appIpcEndpoints.updatePublicationPreset, {
      developmentUrl,
      handle: (input) => publicationPresets.update(input)
    }),
    registerIpcEndpoint(ipc, appIpcEndpoints.deletePublicationPreset, {
      developmentUrl,
      handle: ({ presetId }) => publicationPresets.delete(presetId)
    }),
    registerIpcEndpoint(ipc, appIpcEndpoints.setDefaultPublicationPreset, {
      developmentUrl,
      handle: ({ presetId }) => publicationPresets.setDefault(presetId)
    })
  ]

  return () => {
    for (const remove of unregister) remove()
  }
}
