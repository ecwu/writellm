import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { quarantineLegacyCoreDatabase } from './legacy-core'

const temporaryDirectories: string[] = []

async function temporaryUserData(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'writellm-legacy-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

describe('legacy core database', () => {
  it('quarantines the unreleased development database instead of reusing it', async () => {
    const userData = await temporaryUserData()
    await writeFile(join(userData, 'core.sqlite'), 'fixture')
    const log = { warn: vi.fn(), error: vi.fn() } as never

    await quarantineLegacyCoreDatabase(userData, log)

    await expect(access(join(userData, 'core.sqlite'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(access(join(userData, 'core.sqlite.development-reset'))).resolves.toBeUndefined()
  })
})
