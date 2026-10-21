import { z } from 'zod'
import { IPC_CHANNELS } from './channels'
import {
  accentPreferenceSchema,
  appInfoSchema,
  appQuitResultSchema,
  citationDisplayModeSchema,
  onboardingStateSchema,
  setAccentPreferenceInputSchema,
  setCitationDisplayModeInputSchema,
  setDefaultAgentApprovalModeInputSchema,
  setOnboardingStateInputSchema,
  setThemePreferenceInputSchema,
  themePreferenceSchema
} from './app'
import { agentApprovalModeSchema } from './agent'
import {
  createPublicationPresetInputSchema,
  publicationPresetIdInputSchema,
  publicationPresetSnapshotSchema,
  updatePublicationPresetInputSchema
} from './publication-presets'

/** A project capability check performed by the Main process before the handler runs. */
export type IpcSessionRequirement = 'none' | 'active' | 'mutation'

export interface IpcEndpointDefinition<
  Input extends z.ZodType = z.ZodType,
  Output extends z.ZodType = z.ZodType,
  Session extends IpcSessionRequirement = IpcSessionRequirement
> {
  readonly channel: string
  readonly input: Input
  readonly output: Output
  readonly session: Session
}

export function defineIpcEndpoint<
  const Input extends z.ZodType,
  const Output extends z.ZodType,
  const Session extends IpcSessionRequirement
>(definition: {
  channel: string
  input: Input
  output: Output
  session: Session
}): IpcEndpointDefinition<Input, Output, Session> {
  return Object.freeze(definition)
}

export type IpcEndpointInput<Endpoint extends IpcEndpointDefinition> = z.input<Endpoint['input']>
export type IpcEndpointParsedInput<Endpoint extends IpcEndpointDefinition> = z.output<
  Endpoint['input']
>
export type IpcEndpointOutput<Endpoint extends IpcEndpointDefinition> = z.output<Endpoint['output']>

export type IpcEndpointApiMethod<Endpoint extends IpcEndpointDefinition> =
  undefined extends IpcEndpointInput<Endpoint>
    ? (input?: IpcEndpointInput<Endpoint>) => Promise<IpcEndpointOutput<Endpoint>>
    : (input: IpcEndpointInput<Endpoint>) => Promise<IpcEndpointOutput<Endpoint>>

export type IpcEndpointApi<Endpoints extends Record<string, IpcEndpointDefinition>> = {
  [Name in keyof Endpoints]: IpcEndpointApiMethod<Endpoints[Name]>
}

/**
 * Application-scoped request contracts. Project-scoped endpoints can use the same definition
 * shape, but keep their session-aware handlers close to the owning domain until migration.
 */
export const appIpcEndpoints = {
  quit: defineIpcEndpoint({
    channel: IPC_CHANNELS.appQuit,
    input: z.undefined(),
    output: appQuitResultSchema,
    session: 'none'
  }),
  getInfo: defineIpcEndpoint({
    channel: IPC_CHANNELS.appGetInfo,
    input: z.undefined(),
    output: appInfoSchema,
    session: 'none'
  }),
  getThemePreference: defineIpcEndpoint({
    channel: IPC_CHANNELS.appGetThemePreference,
    input: z.undefined(),
    output: themePreferenceSchema,
    session: 'none'
  }),
  setThemePreference: defineIpcEndpoint({
    channel: IPC_CHANNELS.appSetThemePreference,
    input: setThemePreferenceInputSchema,
    output: themePreferenceSchema,
    session: 'none'
  }),
  getAccentPreference: defineIpcEndpoint({
    channel: IPC_CHANNELS.appGetAccentPreference,
    input: z.undefined(),
    output: accentPreferenceSchema,
    session: 'none'
  }),
  setAccentPreference: defineIpcEndpoint({
    channel: IPC_CHANNELS.appSetAccentPreference,
    input: setAccentPreferenceInputSchema,
    output: accentPreferenceSchema,
    session: 'none'
  }),
  getCitationDisplayMode: defineIpcEndpoint({
    channel: IPC_CHANNELS.appGetCitationDisplayMode,
    input: z.undefined(),
    output: citationDisplayModeSchema,
    session: 'none'
  }),
  setCitationDisplayMode: defineIpcEndpoint({
    channel: IPC_CHANNELS.appSetCitationDisplayMode,
    input: setCitationDisplayModeInputSchema,
    output: citationDisplayModeSchema,
    session: 'none'
  }),
  getDefaultAgentApprovalMode: defineIpcEndpoint({
    channel: IPC_CHANNELS.appGetDefaultAgentApprovalMode,
    input: z.undefined(),
    output: agentApprovalModeSchema,
    session: 'none'
  }),
  setDefaultAgentApprovalMode: defineIpcEndpoint({
    channel: IPC_CHANNELS.appSetDefaultAgentApprovalMode,
    input: setDefaultAgentApprovalModeInputSchema,
    output: agentApprovalModeSchema,
    session: 'none'
  }),
  getOnboardingState: defineIpcEndpoint({
    channel: IPC_CHANNELS.appGetOnboardingState,
    input: z.undefined(),
    output: onboardingStateSchema,
    session: 'none'
  }),
  setOnboardingState: defineIpcEndpoint({
    channel: IPC_CHANNELS.appSetOnboardingState,
    input: setOnboardingStateInputSchema,
    output: onboardingStateSchema,
    session: 'none'
  }),
  publicationPresets: defineIpcEndpoint({
    channel: IPC_CHANNELS.publicationPresetsSnapshot,
    input: z.undefined(),
    output: publicationPresetSnapshotSchema,
    session: 'none'
  }),
  createPublicationPreset: defineIpcEndpoint({
    channel: IPC_CHANNELS.publicationPresetsCreate,
    input: createPublicationPresetInputSchema,
    output: publicationPresetSnapshotSchema,
    session: 'none'
  }),
  updatePublicationPreset: defineIpcEndpoint({
    channel: IPC_CHANNELS.publicationPresetsUpdate,
    input: updatePublicationPresetInputSchema,
    output: publicationPresetSnapshotSchema,
    session: 'none'
  }),
  deletePublicationPreset: defineIpcEndpoint({
    channel: IPC_CHANNELS.publicationPresetsDelete,
    input: publicationPresetIdInputSchema,
    output: publicationPresetSnapshotSchema,
    session: 'none'
  }),
  setDefaultPublicationPreset: defineIpcEndpoint({
    channel: IPC_CHANNELS.publicationPresetsSetDefault,
    input: publicationPresetIdInputSchema,
    output: publicationPresetSnapshotSchema,
    session: 'none'
  })
} as const

export type AppIpcApi = Omit<IpcEndpointApi<typeof appIpcEndpoints>, 'quit'> & {
  /** The preload API keeps the historical void return while the IPC acknowledgement is validated. */
  quit(): Promise<void>
}
