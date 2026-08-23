import type { Logger } from 'pino'
import {
  accentPreferenceSchema,
  citationDisplayModeSchema,
  onboardingStateSchema,
  themePreferenceSchema,
  type AccentPreference,
  type CitationDisplayMode,
  type OnboardingState,
  type ThemePreference
} from '../../../shared/contracts/app'
import {
  agentApprovalModeSchema,
  agentModelLimitsSchema,
  type AgentApprovalMode
} from '../../../shared/contracts/agent'
import { z } from 'zod'
import type { AppDatabase } from '../connection'
import { projectIdSchema } from '../../../shared/contracts/projects'
import {
  agentModelSelectionSchema,
  agentThinkingLevelSchema,
  imageProviderIdSchema,
  type AgentThinkingLevel,
  type AgentModelSelection,
  type ImageProviderId
} from '../../../shared/contracts/providers'

export const THEME_PREFERENCE_KEY = 'theme.preference'
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system'
export const DEFAULT_ACCENT_PREFERENCE: AccentPreference = 'neutral'
export const DEFAULT_CITATION_DISPLAY_MODE: CitationDisplayMode = 'full'
export const DEFAULT_AGENT_APPROVAL_MODE: AgentApprovalMode = 'manual'
const AGENT_APPROVAL_MODE_KEY = 'agent.default-approval-mode'
const AGENT_MODEL_LIMITS_CACHE_KEY = 'agent.model-limits-cache.v1'
const AGENT_DEFAULT_MODEL_SELECTION_KEY = 'agent.default-model-selection.v1'
const AGENT_LAST_THINKING_LEVEL_KEY = 'agent.last-thinking-level.v1'
export const ACTIVE_IMAGE_PROVIDER_KEY = 'image.active-provider.v1'
const ACCENT_PREFERENCE_KEY = 'theme.accent'
const CITATION_DISPLAY_MODE_KEY = 'editor.citation-display-mode.v1'
export const ONBOARDING_STATE_KEY = 'onboarding.state.v1'
export const DEFAULT_ONBOARDING_STATE: OnboardingState = {
  schemaVersion: 1,
  status: 'pending',
  step: 'welcome'
}
export const COMPLETED_ONBOARDING_STATE: OnboardingState = {
  schemaVersion: 1,
  status: 'completed'
}
const modelLimitsCacheSchema = z.record(
  z.string().regex(/^[a-f0-9]{64}$/),
  z.object({ limits: agentModelLimitsSchema, refreshedAt: z.iso.datetime() }).strict()
)
export type ModelLimitsCache = z.infer<typeof modelLimitsCacheSchema>

export class AppSettingsRepository {
  #defaultAgentApprovalMode: AgentApprovalMode = DEFAULT_AGENT_APPROVAL_MODE
  constructor(
    private readonly database: AppDatabase,
    private readonly log: Logger,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  async getThemePreference(): Promise<ThemePreference> {
    const row = await this.database.kysely
      .selectFrom('app_settings')
      .select('value_json')
      .where('key', '=', THEME_PREFERENCE_KEY)
      .executeTakeFirst()

    if (row === undefined) return DEFAULT_THEME_PREFERENCE

    try {
      return themePreferenceSchema.parse(JSON.parse(row.value_json))
    } catch (err) {
      this.log.warn(
        { event: 'app.settings.invalid_theme_preference', key: THEME_PREFERENCE_KEY, err },
        'Stored theme preference is invalid; using the default'
      )
      return DEFAULT_THEME_PREFERENCE
    }
  }

  async setThemePreference(preference: ThemePreference): Promise<ThemePreference> {
    const value = themePreferenceSchema.parse(preference)
    const now = this.now()

    await this.database.kysely
      .insertInto('app_settings')
      .values({
        key: THEME_PREFERENCE_KEY,
        value_json: JSON.stringify(value),
        created_at: now,
        updated_at: now
      })
      .onConflict((conflict) =>
        conflict.column('key').doUpdateSet({
          value_json: JSON.stringify(value),
          updated_at: now
        })
      )
      .execute()

    return value
  }

  async getAccentPreference(): Promise<AccentPreference> {
    return this.#readSetting(
      ACCENT_PREFERENCE_KEY,
      accentPreferenceSchema,
      DEFAULT_ACCENT_PREFERENCE,
      'app.settings.invalid_accent_preference'
    )
  }

  async setAccentPreference(preference: AccentPreference): Promise<AccentPreference> {
    const value = accentPreferenceSchema.parse(preference)
    await this.#writeSetting(ACCENT_PREFERENCE_KEY, value)
    return value
  }

  async getCitationDisplayMode(): Promise<CitationDisplayMode> {
    return this.#readSetting(
      CITATION_DISPLAY_MODE_KEY,
      citationDisplayModeSchema,
      DEFAULT_CITATION_DISPLAY_MODE,
      'app.settings.invalid_citation_display_mode'
    )
  }

  async setCitationDisplayMode(mode: CitationDisplayMode): Promise<CitationDisplayMode> {
    const value = citationDisplayModeSchema.parse(mode)
    await this.#writeSetting(CITATION_DISPLAY_MODE_KEY, value)
    return value
  }

  async getOnboardingState(): Promise<OnboardingState> {
    const row = await this.database.kysely
      .selectFrom('app_settings')
      .select('value_json')
      .where('key', '=', ONBOARDING_STATE_KEY)
      .executeTakeFirst()
    if (row === undefined) {
      return (await this.#hasPriorApplicationState())
        ? COMPLETED_ONBOARDING_STATE
        : DEFAULT_ONBOARDING_STATE
    }
    try {
      return onboardingStateSchema.parse(JSON.parse(row.value_json))
    } catch (err) {
      this.log.warn(
        { event: 'app.settings.invalid_onboarding_state', key: ONBOARDING_STATE_KEY, err },
        'Stored onboarding state is invalid; using the default'
      )
      return DEFAULT_ONBOARDING_STATE
    }
  }

  async setOnboardingState(state: OnboardingState): Promise<OnboardingState> {
    const value = onboardingStateSchema.parse(state)
    await this.#writeSetting(ONBOARDING_STATE_KEY, value)
    return value
  }

  async getDefaultAgentApprovalMode(): Promise<AgentApprovalMode> {
    this.#defaultAgentApprovalMode = await this.#readSetting(
      AGENT_APPROVAL_MODE_KEY,
      agentApprovalModeSchema,
      DEFAULT_AGENT_APPROVAL_MODE,
      'app.settings.invalid_agent_approval_mode'
    )
    return this.#defaultAgentApprovalMode
  }

  async setDefaultAgentApprovalMode(mode: AgentApprovalMode): Promise<AgentApprovalMode> {
    const value = agentApprovalModeSchema.parse(mode)
    await this.#writeSetting(AGENT_APPROVAL_MODE_KEY, value)
    this.#defaultAgentApprovalMode = value
    return value
  }

  currentDefaultAgentApprovalMode(): AgentApprovalMode {
    return this.#defaultAgentApprovalMode
  }

  async getModelLimitsCache(): Promise<ModelLimitsCache> {
    return this.#readSetting(
      AGENT_MODEL_LIMITS_CACHE_KEY,
      modelLimitsCacheSchema,
      {},
      'app.settings.invalid_model_limits_cache'
    )
  }

  async setModelLimitsCache(cache: ModelLimitsCache): Promise<void> {
    await this.#writeSetting(AGENT_MODEL_LIMITS_CACHE_KEY, modelLimitsCacheSchema.parse(cache))
  }

  async getDefaultAgentModelSelection(): Promise<AgentModelSelection | null> {
    return this.#readSetting(
      AGENT_DEFAULT_MODEL_SELECTION_KEY,
      agentModelSelectionSchema.nullable(),
      null,
      'app.settings.invalid_agent_model_selection'
    )
  }

  async setDefaultAgentModelSelection(
    selection: AgentModelSelection | null
  ): Promise<AgentModelSelection | null> {
    const value = agentModelSelectionSchema.nullable().parse(selection)
    await this.#writeSetting(AGENT_DEFAULT_MODEL_SELECTION_KEY, value)
    return value
  }

  async getLastAgentThinkingLevel(): Promise<AgentThinkingLevel> {
    return this.#readSetting(
      AGENT_LAST_THINKING_LEVEL_KEY,
      agentThinkingLevelSchema,
      'medium',
      'app.settings.invalid_agent_thinking_level'
    )
  }

  async setLastAgentThinkingLevel(level: AgentThinkingLevel): Promise<AgentThinkingLevel> {
    const value = agentThinkingLevelSchema.parse(level)
    await this.#writeSetting(AGENT_LAST_THINKING_LEVEL_KEY, value)
    return value
  }

  async getActiveImageProviderId(): Promise<ImageProviderId | null> {
    return this.#readSetting(
      ACTIVE_IMAGE_PROVIDER_KEY,
      imageProviderIdSchema.nullable(),
      null,
      'app.settings.invalid_active_image_provider'
    )
  }

  async setActiveImageProviderId(
    providerId: ImageProviderId | null
  ): Promise<ImageProviderId | null> {
    const value = imageProviderIdSchema.nullable().parse(providerId)
    await this.#writeSetting(ACTIVE_IMAGE_PROVIDER_KEY, value)
    return value
  }

  async getVersionHistoryPromptDismissed(projectId: string): Promise<boolean> {
    const validProjectId = projectIdSchema.parse(projectId)
    return this.#readSetting(
      `project.version-history-prompt-dismissed.${validProjectId}`,
      z.boolean(),
      false,
      'app.settings.invalid_version_history_prompt'
    )
  }

  async setVersionHistoryPromptDismissed(projectId: string, dismissed: boolean): Promise<void> {
    const validProjectId = projectIdSchema.parse(projectId)
    await this.#writeSetting(
      `project.version-history-prompt-dismissed.${validProjectId}`,
      z.boolean().parse(dismissed)
    )
  }

  async #readSetting<T>(key: string, schema: z.ZodType<T>, fallback: T, event: string): Promise<T> {
    const row = await this.database.kysely
      .selectFrom('app_settings')
      .select('value_json')
      .where('key', '=', key)
      .executeTakeFirst()
    if (row === undefined) return fallback
    try {
      return schema.parse(JSON.parse(row.value_json))
    } catch (err) {
      this.log.warn({ event, key, err }, 'Stored application setting is invalid; using default')
      return fallback
    }
  }

  async #writeSetting(key: string, value: unknown): Promise<void> {
    const now = this.now()
    const valueJson = JSON.stringify(value)
    await this.database.kysely
      .insertInto('app_settings')
      .values({ key, value_json: valueJson, created_at: now, updated_at: now })
      .onConflict((conflict) =>
        conflict.column('key').doUpdateSet({ value_json: valueJson, updated_at: now })
      )
      .execute()
  }

  async #hasPriorApplicationState(): Promise<boolean> {
    const applicationSetting = await this.database.kysely
      .selectFrom('app_settings')
      .select('key')
      .where('key', '!=', ONBOARDING_STATE_KEY)
      .limit(1)
      .executeTakeFirst()
    if (applicationSetting !== undefined) return true

    for (const table of [
      'recent_projects',
      'provider_configs',
      'agent_provider_preferences',
      'agent_model_preferences',
      'agent_skills'
    ] as const) {
      const row = await this.database.kysely
        .selectFrom(table)
        .selectAll()
        .limit(1)
        .executeTakeFirst()
      if (row !== undefined) return true
    }
    return false
  }
}
