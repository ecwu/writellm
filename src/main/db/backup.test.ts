import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import Database from 'better-sqlite3'
import pino from 'pino'
import { afterEach, describe, expect, it } from 'vitest'
import {
  copyVerifiedFile,
  createVerifiedDatabaseBackup,
  createVerifiedOpenedDatabaseBackup,
  verifyDatabaseFile
} from './backup'

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
    const original = await readFile(destination)
    await expect(
      createVerifiedDatabaseBackup({ source, destination, databaseRole: 'app', log })
    ).rejects.toThrow('app database backup failed')
    expect(await readFile(destination)).toEqual(original)
    const partials = (await readdir(directory)).filter((entry) => entry.endsWith('.partial'))
    expect(partials).toEqual([])
    source.close()
  })

  it('does not publish an aborted or unverifiable backup', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'writellm-backup-abort-'))
    directories.push(directory)
    const source = new Database(join(directory, 'source.sqlite'))
    source.pragma('application_id = 123')
    source.exec('CREATE TABLE values_table (value BLOB NOT NULL)')
    source.prepare('INSERT INTO values_table VALUES (zeroblob(?))').run(16 * 1024 * 1024)

    const controller = new AbortController()
    controller.abort(new Error('fixture cancellation'))
    const abortedDestination = join(directory, 'aborted.sqlite')
    await expect(
      createVerifiedDatabaseBackup({
        source,
        destination: abortedDestination,
        databaseRole: 'app',
        signal: controller.signal,
        log
      })
    ).rejects.toThrow('app database backup failed')
    await expect(readFile(abortedDestination)).rejects.toMatchObject({ code: 'ENOENT' })

    const invalidDestination = join(directory, 'invalid.sqlite')
    await expect(
      createVerifiedDatabaseBackup({
        source,
        destination: invalidDestination,
        databaseRole: 'app',
        applicationId: 456,
        log
      })
    ).rejects.toThrow('app database backup failed')
    await expect(readFile(invalidDestination)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await readdir(directory)).filter((entry) => entry.endsWith('.partial'))).toEqual([])
    source.close()
  })

  it('cleans partial output after mid-backup cancellation or insufficient space', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'writellm-backup-io-failure-'))
    directories.push(directory)
    const controller = new AbortController()
    const cancelled = join(directory, 'cancelled.sqlite')
    await expect(
      createVerifiedOpenedDatabaseBackup({
        source: {
          backup: async (partial, options) => {
            await writeFile(partial, 'partial')
            controller.abort(new Error('fixture cancellation'))
            options?.progress({ totalPages: 2, remainingPages: 1 })
            return { totalPages: 2, remainingPages: 1 }
          }
        },
        destination: cancelled,
        databaseRole: 'project',
        signal: controller.signal,
        log
      })
    ).rejects.toThrow('project database backup failed')
    await expect(readFile(cancelled)).rejects.toMatchObject({ code: 'ENOENT' })

    const noSpace = join(directory, 'no-space.sqlite')
    await expect(
      createVerifiedOpenedDatabaseBackup({
        source: {
          backup: async (partial) => {
            await writeFile(partial, 'partial')
            throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' })
          }
        },
        destination: noSpace,
        databaseRole: 'project',
        log
      })
    ).rejects.toThrow('project database backup failed')
    await expect(readFile(noSpace)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await readdir(directory)).filter((entry) => entry.endsWith('.partial'))).toEqual([])
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

  it('rejects a source that changes after its snapshot copy', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'writellm-backup-changing-file-'))
    directories.push(directory)
    const source = join(directory, 'source.txt')
    const destination = join(directory, 'copied.txt')
    await writeFile(source, 'before', 'utf8')

    await expect(
      copyVerifiedFile({
        source,
        destination,
        copy: async (from, to) => {
          await import('node:fs/promises').then(({ copyFile }) => copyFile(from, to))
          await writeFile(from, 'after', 'utf8')
        }
      })
    ).rejects.toThrow('Snapshot source changed while it was being copied')
  })
})
