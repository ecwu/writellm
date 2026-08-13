import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it } from 'vitest'
import { openAppDatabase } from '../connection'
import { PublicationPresetRepository } from './publication-presets'

const directories: string[] = []
const log = pino({ level: 'silent' })

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('PublicationPresetRepository', () => {
  it('seeds application presets and applies user CRUD without project state', async () => {
    const database = await testDatabase()
    const repository = new PublicationPresetRepository(
      database,
      log,
      () => '2026-08-13T12:00:00.000Z',
      () => '11111111-1111-4111-8111-111111111111'
    )

    const seeded = repository.snapshot()
    expect(seeded.defaultPresetId).toBe('builtin:academic-a4')
    expect(seeded.presets).toHaveLength(3)
    expect(seeded.presets[0]).toMatchObject({
      name: 'Academic A4',
      origin: 'application',
      isDefault: true
    })
    const created = repository.create({
      name: 'My print preset',
      options: {
        schemaVersion: 1,
        pageSize: 'letter',
        marginsMm: { top: 18, right: 19, bottom: 20, left: 21 },
        template: 'report',
        includeTableOfContents: true,
        includeReferences: false,
        mermaidFallback: 'source'
      }
    })
    expect(created.presets).toHaveLength(4)
    expect(repository.setDefault('11111111-1111-4111-8111-111111111111').defaultPresetId).toBe(
      '11111111-1111-4111-8111-111111111111'
    )
    expect(repository.resolve().marginsMm).toEqual({ top: 18, right: 19, bottom: 20, left: 21 })
    expect(() => repository.delete('11111111-1111-4111-8111-111111111111')).toThrow(
      'cannot be deleted'
    )
    repository.setDefault('builtin:academic-a4')
    expect(repository.delete('11111111-1111-4111-8111-111111111111').presets).toHaveLength(3)
    expect(() =>
      repository.update({
        presetId: 'builtin:academic-a4',
        name: 'Changed',
        options: repository.resolve('builtin:academic-a4')
      })
    ).toThrow('immutable')
    database.close()
  })

  it('fails closed for malformed and version-unknown persisted options', async () => {
    const database = await testDatabase()
    const repository = new PublicationPresetRepository(database, log)
    database.immediate((native) =>
      native
        .prepare(
          "UPDATE publication_presets SET options_json = ? WHERE preset_id = 'builtin:academic-a4'"
        )
        .run('{not-json')
    )
    expect(() => repository.snapshot()).toThrow('malformed')
    database.immediate((native) =>
      native
        .prepare(
          "UPDATE publication_presets SET options_json = ?, schema_version = 1 WHERE preset_id = 'builtin:academic-a4'"
        )
        .run(JSON.stringify({ schemaVersion: 99 }))
    )
    expect(() => repository.snapshot()).toThrow()
    database.close()
  })
})

async function testDatabase() {
  const directory = await mkdtemp(join(tmpdir(), 'writellm-publication-presets-'))
  directories.push(directory)
  return openAppDatabase({
    path: join(directory, 'app.sqlite'),
    applicationVersion: 'test',
    log
  })
}
