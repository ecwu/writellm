import { mkdtemp, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cleanupLogRetention } from './log-retention'

describe('cleanupLogRetention', () => {
  it('deletes expired logs without deleting the active file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'writellm-retention-'))
    const active = join(directory, 'app.log')
    const old = join(directory, 'app.1.log')
    const current = join(directory, 'app.2.log')
    await writeFile(active, 'active')
    await writeFile(old, 'old')
    await writeFile(current, 'current')
    await utimes(old, new Date(0), new Date(0))

    const result = await cleanupLogRetention(directory, {
      activeFileName: 'app.log',
      maxAgeMs: 1_000,
      maxTotalBytes: 1_000,
      now: 10_000
    })

    expect(result.deleted).toEqual(['app.1.log'])
    expect((await stat(active)).isFile()).toBe(true)
    expect((await stat(current)).isFile()).toBe(true)
  })

  it('deletes oldest logs when the directory exceeds its size cap', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'writellm-retention-size-'))
    await writeFile(join(directory, 'app.log'), 'active')
    await writeFile(join(directory, 'app.1.log'), 'oldest')
    await writeFile(join(directory, 'app.2.log'), 'newest')
    await utimes(join(directory, 'app.1.log'), new Date(1_000), new Date(1_000))
    await utimes(join(directory, 'app.2.log'), new Date(2_000), new Date(2_000))

    const result = await cleanupLogRetention(directory, {
      activeFileName: 'app.log',
      maxAgeMs: Number.MAX_SAFE_INTEGER,
      maxTotalBytes: 7,
      now: 3_000
    })
    expect(result.deleted).toEqual(['app.1.log'])
  })
})
