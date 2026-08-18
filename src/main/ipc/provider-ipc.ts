import { randomUUID } from 'node:crypto'
import type { AuthEvent, AuthPrompt } from '@earendil-works/pi-ai'
import { ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import type { Logger } from 'pino'
import {
  agentCustomPresetInputSchema,
  agentAuthFlowInputSchema,
  agentAuthInteractionEventSchema,
  agentAuthPromptResponseSchema,
  agentModelSelectionSchema,
  agentModelEnabledInputSchema,
  agentManualModelInputSchema,
  agentManualModelRemoveInputSchema,
  agentProviderEnabledInputSchema,
  agentPresetLoginInputSchema,
  agentPresetInputSchema,
  agentPresetCredentialInputSchema,
  providerConnectionTestResultSchema,
  imageProviderSelectionInputSchema,
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
  openExternal?: (url: string) => Promise<unknown>
}

export function registerProviderIpc({
  providers,
  logger,
  developmentUrl,
  ipc = ipcMain,
  openExternal = (url) => shell.openExternal(url)
}: RegisterProviderIpcOptions): () => void {
  const authFlows = new Map<
    string,
    {
      senderId: number
      abort: AbortController
      prompts: Map<string, { resolve: (value: string) => void; reject: (err: Error) => void }>
    }
  >()
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
    const input = providerRoleInputSchema.parse(rawInput)
    return providerSettingsSnapshotSchema.parse(
      await providers.remove(input.role, input.role === 'image' ? input.providerId : undefined)
    )
  })
  ipc.handle(IPC_CHANNELS.providersTestConnection, async (event, rawInput) => {
    authorizeSender(event.senderFrame, developmentUrl)
    const input = providerRoleInputSchema.parse(rawInput)
    return providerConnectionTestResultSchema.parse(
      await providers.testConnection(
        input.role,
        input.role === 'image' ? input.providerId : undefined
      )
    )
  })
  ipc.handle(IPC_CHANNELS.providersSetActiveImage, async (event, rawInput) => {
    authorizeSender(event.senderFrame, developmentUrl)
    const { providerId } = imageProviderSelectionInputSchema.parse(rawInput)
    return providerSettingsSnapshotSchema.parse(await providers.setActiveImageProvider(providerId))
  })
  ipc.handle(IPC_CHANNELS.providersSaveAgentPreset, async (event, rawInput) => {
    authorizeSender(event.senderFrame, developmentUrl)
    const input = agentCustomPresetInputSchema.parse(rawInput)
    return providerSettingsSnapshotSchema.parse(await providers.saveAgentCustomPreset(input))
  })
  ipc.handle(IPC_CHANNELS.providersRemoveAgentPreset, async (event, rawInput) => {
    authorizeSender(event.senderFrame, developmentUrl)
    const { presetId } = agentPresetInputSchema.parse(rawInput)
    return providerSettingsSnapshotSchema.parse(await providers.removeAgentPreset(presetId))
  })
  ipc.handle(IPC_CHANNELS.providersRefreshAgentPreset, async (event, rawInput) => {
    authorizeSender(event.senderFrame, developmentUrl)
    const { presetId } = agentPresetInputSchema.parse(rawInput)
    const controller = new AbortController()
    return providerSettingsSnapshotSchema.parse(
      await providers.refreshAgentPreset(presetId, controller.signal)
    )
  })
  ipc.handle(IPC_CHANNELS.providersSetAgentDefault, async (event, rawInput) => {
    authorizeSender(event.senderFrame, developmentUrl)
    const selection = agentModelSelectionSchema.nullable().parse(rawInput)
    return providerSettingsSnapshotSchema.parse(await providers.setAgentDefaultSelection(selection))
  })
  ipc.handle(IPC_CHANNELS.providersSetAgentCredential, async (event, rawInput) => {
    authorizeSender(event.senderFrame, developmentUrl)
    const { presetId, apiKey } = agentPresetCredentialInputSchema.parse(rawInput)
    return providerSettingsSnapshotSchema.parse(await providers.setAgentApiKey(presetId, apiKey))
  })
  ipc.handle(IPC_CHANNELS.providersClearAgentCredential, async (event, rawInput) => {
    authorizeSender(event.senderFrame, developmentUrl)
    const { presetId } = agentPresetInputSchema.parse(rawInput)
    return providerSettingsSnapshotSchema.parse(await providers.clearAgentCredential(presetId))
  })
  ipc.handle(IPC_CHANNELS.providersSetAgentProviderEnabled, async (event, rawInput) => {
    authorizeSender(event.senderFrame, developmentUrl)
    const { presetId, enabled } = agentProviderEnabledInputSchema.parse(rawInput)
    return providerSettingsSnapshotSchema.parse(
      await providers.setAgentProviderEnabled(presetId, enabled)
    )
  })
  ipc.handle(IPC_CHANNELS.providersSetAgentModelEnabled, async (event, rawInput) => {
    authorizeSender(event.senderFrame, developmentUrl)
    const { presetId, modelId, enabled } = agentModelEnabledInputSchema.parse(rawInput)
    return providerSettingsSnapshotSchema.parse(
      await providers.setAgentModelEnabled(presetId, modelId, enabled)
    )
  })
  ipc.handle(IPC_CHANNELS.providersSaveAgentManualModel, async (event, rawInput) => {
    authorizeSender(event.senderFrame, developmentUrl)
    const { presetId, model } = agentManualModelInputSchema.parse(rawInput)
    return providerSettingsSnapshotSchema.parse(
      await providers.saveAgentManualModel(presetId, model)
    )
  })
  ipc.handle(IPC_CHANNELS.providersRemoveAgentManualModel, async (event, rawInput) => {
    authorizeSender(event.senderFrame, developmentUrl)
    const { presetId, modelId } = agentManualModelRemoveInputSchema.parse(rawInput)
    return providerSettingsSnapshotSchema.parse(
      await providers.removeAgentManualModel(presetId, modelId)
    )
  })
  ipc.handle(IPC_CHANNELS.providersLoginAgentPreset, async (event, rawInput) => {
    authorizeSender(event.senderFrame, developmentUrl)
    const input = agentPresetLoginInputSchema.parse(rawInput)
    if (authFlows.has(input.flowId)) throw new Error('Agent authentication flow already exists')
    const flow = {
      senderId: event.sender.id,
      abort: new AbortController(),
      prompts: new Map<string, { resolve: (value: string) => void; reject: (err: Error) => void }>()
    }
    authFlows.set(input.flowId, flow)
    const send = (value: unknown): void => {
      event.sender.send(
        IPC_CHANNELS.providersAgentAuthEvent,
        agentAuthInteractionEventSchema.parse(value)
      )
    }
    try {
      const snapshot = await providers.loginAgentPreset(input.presetId, input.type, {
        signal: flow.abort.signal,
        prompt: (prompt) =>
          new Promise<string>((resolve, reject) => {
            const promptId = randomUUID()
            const parsedPrompt = serializeAuthPrompt(prompt)
            flow.prompts.set(promptId, { resolve, reject })
            const abortPrompt = (): void => {
              flow.prompts.delete(promptId)
              reject(new Error('Agent authentication prompt was cancelled'))
            }
            prompt.signal?.addEventListener('abort', abortPrompt, { once: true })
            send({ kind: 'prompt', flowId: input.flowId, promptId, prompt: parsedPrompt })
          }),
        notify: (notice) => {
          const parsedNotice = serializeAuthNotice(notice)
          send({ kind: 'notice', flowId: input.flowId, notice: parsedNotice })
          const url =
            parsedNotice.type === 'auth_url'
              ? parsedNotice.url
              : parsedNotice.type === 'device_code'
                ? parsedNotice.verificationUri
                : null
          if (url !== null && isAllowedAuthUrl(url)) {
            void openExternal(url).catch((err) => {
              logger.error(
                { event: 'agent.provider_auth.open_external_failed', err, flowId: input.flowId },
                'Failed to open Agent provider authentication URL'
              )
            })
          }
        }
      })
      return providerSettingsSnapshotSchema.parse(snapshot)
    } catch (err) {
      logger.error(
        {
          event: 'agent.provider_auth.login_failed',
          err,
          presetId: input.presetId,
          authType: input.type
        },
        'Agent provider login failed'
      )
      throw new Error('Agent provider login failed', { cause: err })
    } finally {
      authFlows.delete(input.flowId)
      for (const prompt of flow.prompts.values()) {
        prompt.reject(new Error('Agent authentication flow ended'))
      }
    }
  })
  ipc.handle(IPC_CHANNELS.providersRespondAgentAuth, (event, rawInput) => {
    authorizeSender(event.senderFrame, developmentUrl)
    const input = agentAuthPromptResponseSchema.parse(rawInput)
    const flow = authFlows.get(input.flowId)
    if (flow === undefined || flow.senderId !== event.sender.id) {
      throw new Error('Agent authentication flow is unavailable')
    }
    const prompt = flow.prompts.get(input.promptId)
    if (prompt === undefined) throw new Error('Agent authentication prompt is unavailable')
    flow.prompts.delete(input.promptId)
    prompt.resolve(input.value)
  })
  ipc.handle(IPC_CHANNELS.providersCancelAgentAuth, (event, rawInput) => {
    authorizeSender(event.senderFrame, developmentUrl)
    const { flowId } = agentAuthFlowInputSchema.parse(rawInput)
    const flow = authFlows.get(flowId)
    if (flow !== undefined && flow.senderId === event.sender.id) {
      flow.abort.abort(new Error('Agent authentication was cancelled'))
      for (const prompt of flow.prompts.values()) {
        prompt.reject(new Error('Agent authentication was cancelled'))
      }
      flow.prompts.clear()
    }
  })

  return () => {
    for (const channel of [
      IPC_CHANNELS.providersSnapshot,
      IPC_CHANNELS.providersSave,
      IPC_CHANNELS.providersRemove,
      IPC_CHANNELS.providersTestConnection,
      IPC_CHANNELS.providersSetActiveImage,
      IPC_CHANNELS.providersSaveAgentPreset,
      IPC_CHANNELS.providersRemoveAgentPreset,
      IPC_CHANNELS.providersRefreshAgentPreset,
      IPC_CHANNELS.providersSetAgentDefault,
      IPC_CHANNELS.providersSetAgentCredential,
      IPC_CHANNELS.providersClearAgentCredential,
      IPC_CHANNELS.providersSetAgentProviderEnabled,
      IPC_CHANNELS.providersSetAgentModelEnabled,
      IPC_CHANNELS.providersSaveAgentManualModel,
      IPC_CHANNELS.providersRemoveAgentManualModel,
      IPC_CHANNELS.providersLoginAgentPreset,
      IPC_CHANNELS.providersRespondAgentAuth,
      IPC_CHANNELS.providersCancelAgentAuth
    ]) {
      ipc.removeHandler(channel)
    }
  }
}

function serializeAuthPrompt(prompt: AuthPrompt): unknown {
  if (prompt.type === 'select') {
    return { type: prompt.type, message: prompt.message, options: prompt.options }
  }
  return {
    type: prompt.type,
    message: prompt.message,
    ...(prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder })
  }
}

function serializeAuthNotice(notice: AuthEvent): AuthEvent {
  return notice
}

function isAllowedAuthUrl(value: string): boolean {
  const url = new URL(value)
  return url.protocol === 'https:' || url.protocol === 'http:'
}
