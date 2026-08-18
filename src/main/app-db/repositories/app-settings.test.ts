import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it } from 'vitest'
import { openAppDatabase } from '../connection'
import {
  DEFAULT_ACCENT_PREFERENCE,
  DEFAULT_CITATION_DISPLAY_MODE,
  DEFAULT_THEME_PREFERENCE,
  THEME_PREFERENCE_KEY,
  AppSettingsRepository
} from './app-settings'

const temporaryDirectories: string[] = []
const log = pino({ level: 'silent' })

async function openTestDatabase() {
  const directory = await mkdtemp(join(tmpdir(), 'writellm-app-settings-'))
  temporaryDirectories.push(directory)

  return openAppDatabase({
    path: join(directory, 'app.sqlite'),
    applicationVersion: '1.0.0-test',
    log
  })
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

describe('AppSettingsRepository', () => {
  it('persists version-history prompt dismissal independently per project', async () => {
    const database = await openTestDatabase()
    const repository = new AppSettingsRepository(database, log)
    const first = '11111111-1111-4111-8111-111111111111'
    const second = '22222222-2222-4222-8222-222222222222'

    await expect(repository.getVersionHistoryPromptDismissed(first)).resolves.toBe(false)
    await repository.setVersionHistoryPromptDismissed(first, true)
    await expect(repository.getVersionHistoryPromptDismissed(first)).resolves.toBe(true)
    await expect(repository.getVersionHistoryPromptDismissed(second)).resolves.toBe(false)
    database.close()
  })

  it('defaults to following the system and persists the selected theme', async () => {
    const database = await openTestDatabase()
    const repository = new AppSettingsRepository(database, log, () => '2026-07-16T12:00:00.000Z')

    await expect(repository.getThemePreference()).resolves.toBe(DEFAULT_THEME_PREFERENCE)
    await expect(repository.setThemePreference('dark')).resolves.toBe('dark')
    await expect(repository.getThemePreference()).resolves.toBe('dark')
    await expect(repository.setThemePreference('light')).resolves.toBe('light')
    await expect(repository.getThemePreference()).resolves.toBe('light')

    const row = await database.kysely
      .selectFrom('app_settings')
      .select(['key', 'value_json', 'created_at', 'updated_at'])
      .where('key', '=', THEME_PREFERENCE_KEY)
      .executeTakeFirstOrThrow()
    expect(row).toEqual({
      key: THEME_PREFERENCE_KEY,
      value_json: '"light"',
      created_at: '2026-07-16T12:00:00.000Z',
      updated_at: '2026-07-16T12:00:00.000Z'
    })
    database.close()
  })

  it('defaults to neutral and persists a bounded accent preference', async () => {
    const database = await openTestDatabase()
    const repository = new AppSettingsRepository(database, log)

    await expect(repository.getAccentPreference()).resolves.toBe(DEFAULT_ACCENT_PREFERENCE)
    await expect(repository.setAccentPreference('violet')).resolves.toBe('violet')
    await expect(repository.getAccentPreference()).resolves.toBe('violet')
    database.close()
  })

  it('defaults, persists, and safely recovers the citation display mode', async () => {
    const database = await openTestDatabase()
    const repository = new AppSettingsRepository(database, log)

    await expect(repository.getCitationDisplayMode()).resolves.toBe(DEFAULT_CITATION_DISPLAY_MODE)
    await expect(repository.setCitationDisplayMode('numbered')).resolves.toBe('numbered')
    await expect(repository.getCitationDisplayMode()).resolves.toBe('numbered')
    await database.kysely
      .updateTable('app_settings')
      .set({ value_json: '"compact"' })
      .where('key', '=', 'editor.citation-display-mode.v1')
      .execute()
    await expect(repository.getCitationDisplayMode()).resolves.toBe(DEFAULT_CITATION_DISPLAY_MODE)
    database.close()
  })

  it('falls back safely when a stored preference has an unsupported value', async () => {
    const database = await openTestDatabase()
    const repository = new AppSettingsRepository(database, log)

    await database.kysely
      .insertInto('app_settings')
      .values({
        key: THEME_PREFERENCE_KEY,
        value_json: '"sepia"',
        created_at: '2026-07-16T12:00:00.000Z',
        updated_at: '2026-07-16T12:00:00.000Z'
      })
      .execute()

    await expect(repository.getThemePreference()).resolves.toBe(DEFAULT_THEME_PREFERENCE)
    database.close()
  })

  it('defaults, persists, and safely recovers the last Agent Thinking level', async () => {
    const database = await openTestDatabase()
    const repository = new AppSettingsRepository(database, log)

    await expect(repository.getLastAgentThinkingLevel()).resolves.toBe('medium')
    await expect(repository.setLastAgentThinkingLevel('xhigh')).resolves.toBe('xhigh')
    await expect(repository.getLastAgentThinkingLevel()).resolves.toBe('xhigh')

    await database.kysely
      .updateTable('app_settings')
      .set({ value_json: '"extreme"' })
      .where('key', '=', 'agent.last-thinking-level.v1')
      .execute()
    await expect(repository.getLastAgentThinkingLevel()).resolves.toBe('medium')
    database.close()
  })

  it('stores only a fixed active image provider and can clear the selection', async () => {
    const database = await openTestDatabase()
    const repository = new AppSettingsRepository(database, log)

    await expect(repository.getActiveImageProviderId()).resolves.toBeNull()
    await expect(repository.setActiveImageProviderId('openai')).resolves.toBe('openai')
    await expect(repository.getActiveImageProviderId()).resolves.toBe('openai')
    await expect(repository.setActiveImageProviderId('custom' as 'openai')).rejects.toThrow()
    await expect(repository.setActiveImageProviderId(null)).resolves.toBeNull()
    await expect(repository.getActiveImageProviderId()).resolves.toBeNull()
    database.close()
  })
})
