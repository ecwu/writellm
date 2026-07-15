import { mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import pino from 'pino'
import { afterEach, describe, expect, it } from 'vitest'
import { copyVerifiedFile, createVerifiedDatabaseBackup, verifyDatabaseFile } from './backup'

const directories: string[] = []
const log = pino({ level: 'silent' })

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('database backups', () => {
  it('includes committed data that remains in the WAL', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'writellm-backup-wal-'))
    directories.push(directory)
    const sourcePath = join(directory, 'source.sqlite')
    const destination = join(directory, 'backups', 'verified.sqlite')
    const source = new Database(sourcePath)
    source.pragma('journal_mode = WAL')
    source.pragma('wal_autocheckpoint = 0')
    source.pragma('application_id = 0x574c4150')
    source.exec(
      "CREATE TABLE values_table (value TEXT NOT NULL); INSERT INTO values_table VALUES ('from-wal')"
    )

    await createVerifiedDatabaseBackup({
      source,
      destination,
      databaseRole: 'app',
      applicationId: 0x574c4150,
      log
    })
    source.close()

    const backup = new Database(destination, { readonly: true, fileMustExist: true })
    expect(backup.prepare('SELECT value FROM values_table').pluck().get()).toBe('from-wal')
    backup.close()
  })

  it('does not publish an invalid or conflicting backup destination', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'writellm-backup-failure-'))
    directories.push(directory)
    const source = new Database(join(directory, 'source.sqlite'))
    source.exec('CREATE TABLE values_table (value TEXT NOT NULL)')
    const destination = join(directory, 'verified.sqlite')
    await createVerifiedDatabaseBackup({ source, destination, databaseRole: 'app', log })
    await expect(
      createVerifiedDatabaseBackup({ source, destination, databaseRole: 'app', log })
    ).rejects.toThrow('app database backup failed')
    const partials = (await readdir(directory)).filter((entry) => entry.endsWith('.partial'))
    expect(partials).toEqual([])
    source.close()
  })

  it('requires full integrity checks for an explicit candidate', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'writellm-backup-integrity-'))
    directories.push(directory)
    const source = new Database(join(directory, 'source.sqlite'))
    source.exec('CREATE TABLE values_table (value TEXT NOT NULL)')
    source.close()
    await expect(
      verifyDatabaseFile(join(directory, 'source.sqlite'), {
        databaseRole: 'snapshot',
        integrity: 'full',
        log
      })
    ).resolves.toMatchObject({
      size: expect.any(Number),
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/)
    })
  })

  it('rejects symlink sources and file hash mismatches during snapshot copying', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'writellm-backup-files-'))
    directories.push(directory)
    const source = join(directory, 'source.txt')
    const destination = join(directory, 'copied.txt')
    await writeFile(source, 'source', 'utf8')
    await expect(
      copyVerifiedFile({ source, destination, expectedSha256: '0'.repeat(64) })
    ).rejects.toThrow('does not match its inventory record')
    const linked = join(directory, 'linked.txt')
    await symlink(source, linked)
    await expect(copyVerifiedFile({ source: linked, destination })).rejects.toThrow(
      'Snapshot source must be a regular file'
    )
  })
})
