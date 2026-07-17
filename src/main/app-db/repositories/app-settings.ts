import type { Logger } from 'pino'
import { themePreferenceSchema, type ThemePreference } from '../../../shared/contracts/app'
import type { AppDatabase } from '../connection'

export const THEME_PREFERENCE_KEY = 'theme.preference'
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system'

export class AppSettingsRepository {
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
}
