import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import pino from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createProject, INDEX_DATABASE_APPLICATION_ID } from './project-lifecycle'
import { openProjectDatabase } from './project-database'
import { readProjectManifest } from './project-manifest'
import { inspectProjectWriteLock } from './project-lock'
import {
  INDEX_DATABASE_RELATIVE_PATH,
  KNOWLEDGE_ORIGINALS_DIRECTORY,
  KNOWLEDGE_PARSED_DIRECTORY,
  MANUSCRIPT_ASSETS_DIRECTORY,
  MANUSCRIPT_EXPORTS_DIRECTORY,
  MANUSCRIPT_SECTIONS_DIRECTORY,
  PROJECT_BACKUPS_DIRECTORY,
  PROJECT_DATABASE_RELATIVE_PATH,
  PROJECT_RECOVERY_DIRECTORY,
  PROJECT_TEMP_DIRECTORY
} from './project-paths'

const temporaryDirectories: string[] = []
const log = pino({ level: 'silent' })

async function temporaryParent(): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), 'writellm-project-create-'))
  temporaryDirectories.push(parent)
  return parent
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

describe('project creation lifecycle', () => {
  it('atomically creates a complete project with Unicode names and bootstrap records', async () => {
    const parent = await temporaryParent()
    const destination = join(parent, '研究 项目-你好')

    const created = await createProject({
      destination,
      forbiddenApplicationDirectories: [],
      applicationVersion: '1.0.0-test',
      initialTitle: '跨语言文章',
      log
    })

    expect(created.projectRoot).toBe(await realpath(destination))
    expect((await readProjectManifest(destination)).projectId).toBe(created.manifest.projectId)
    for (const relativeDirectory of [
      MANUSCRIPT_SECTIONS_DIRECTORY,
      MANUSCRIPT_ASSETS_DIRECTORY,
      MANUSCRIPT_EXPORTS_DIRECTORY,
      `${KNOWLEDGE_ORIGINALS_DIRECTORY}/sha256`,
      KNOWLEDGE_PARSED_DIRECTORY,
      PROJECT_TEMP_DIRECTORY,
      PROJECT_BACKUPS_DIRECTORY,
      PROJECT_RECOVERY_DIRECTORY
    ]) {
      await expect(access(join(destination, relativeDirectory))).resolves.toBeUndefined()
    }
    await expect(access(join(destination, PROJECT_DATABASE_RELATIVE_PATH))).resolves.toBeUndefined()
    await expect(access(join(destination, INDEX_DATABASE_RELATIVE_PATH))).resolves.toBeUndefined()

    const database = await openProjectDatabase({
      projectRoot: destination,
      manifest: created.manifest,
      applicationVersion: '1.0.0-test',
      log
    })
    expect(await database.kysely.selectFrom('manuscripts').selectAll().execute()).toHaveLength(1)
    expect(
      await database.kysely
        .selectFrom('manuscript_briefs')
        .select(['title', 'version'])
        .executeTakeFirstOrThrow()
    ).toEqual({ title: '跨语言文章', version: 1 })
    expect(await database.kysely.selectFrom('sections').selectAll().execute()).toHaveLength(1)
    database.close()

    const index = new Database(join(destination, INDEX_DATABASE_RELATIVE_PATH), { readonly: true })
    expect(index.pragma('application_id', { simple: true })).toBe(INDEX_DATABASE_APPLICATION_ID)
    const indexTables = index
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table'")
      .pluck()
      .all()
    expect(indexTables).toEqual([])
    index.close()

    expect((await readdir(parent)).filter((name) => name.includes('writellm-staging'))).toEqual([])
    await created.writeLock.release()
  })

  it('creates a new destination inside a non-empty parent', async () => {
    const parent = await temporaryParent()
    const destination = join(parent, 'new-project.writellm')
    await writeFile(join(parent, 'existing.txt'), 'keep')

    const created = await createProject({
      destination,
      forbiddenApplicationDirectories: [],
      applicationVersion: '1.0.0-test',
      log
    })

    await expect(readFile(join(destination, 'writellm.project.json'), 'utf8')).resolves.toContain(
      'writellm-project'
    )
    await expect(readFile(join(parent, 'existing.txt'), 'utf8')).resolves.toBe('keep')
    await created.writeLock.release()
  })

  it('rejects any existing target and forbidden application destinations', async () => {
    const parent = await temporaryParent()
    const nonEmpty = join(parent, 'non-empty')
    const empty = join(parent, 'empty')
    const linked = join(parent, 'linked')
    const forbidden = join(parent, 'user-data')
    await Promise.all([mkdir(nonEmpty), mkdir(empty)])
    await mkdir(join(nonEmpty, 'already-here'))
    await mkdir(forbidden)
    await symlink(empty, linked)

    for (const destination of [nonEmpty, empty, linked]) {
      await expect(
        createProject({
          destination,
          forbiddenApplicationDirectories: [],
          applicationVersion: '1.0.0-test',
          log
        })
      ).rejects.toThrow('Failed to create project')
    }
    await expect(
      createProject({
        destination: join(forbidden, 'project'),
        forbiddenApplicationDirectories: [forbidden],
        applicationVersion: '1.0.0-test',
        log
      })
    ).rejects.toThrow('Failed to create project')
    await expect(
      createProject({
        destination: join(forbidden, '..notes.writellm'),
        forbiddenApplicationDirectories: [forbidden],
        applicationVersion: '1.0.0-test',
        log
      })
    ).rejects.toThrow('Failed to create project')
    expect(await readdir(nonEmpty)).toEqual(['already-here'])
    expect(await readdir(empty)).toEqual([])
  })

  it('leaves no valid final project when atomic publication fails', async () => {
    const parent = await temporaryParent()
    const destination = join(parent, 'publication-fails')
    const publicationError = new Error('simulated publication failure')
    const error = vi.fn()
    const spyLog = { info: vi.fn(), error } as unknown as typeof log

    await expect(
      createProject({
        destination,
        forbiddenApplicationDirectories: [],
        applicationVersion: '1.0.0-test',
        log: spyLog,
        publishManifest: async () => {
          throw publicationError
        }
      })
    ).rejects.toMatchObject({ cause: publicationError })

    await expect(access(destination)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await readdir(parent)).filter((name) => name.includes('writellm-staging'))).toEqual([])
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'project.create.failed', err: publicationError }),
      expect.any(String)
    )
    expect(JSON.stringify(error.mock.calls)).not.toContain(destination)
  })

  it('holds the project lock before publishing the manifest', async () => {
    const parent = await temporaryParent()
    const destination = join(parent, 'published')
    let lockObserved = false

    const created = await createProject({
      destination,
      forbiddenApplicationDirectories: [],
      applicationVersion: '1.0.0-test',
      log,
      publishManifest: async (projectRoot, manifest) => {
        lockObserved = (await inspectProjectWriteLock(projectRoot, { logger: log })) !== null
        await writeFile(
          join(projectRoot, 'writellm.project.json'),
          `${JSON.stringify(manifest, null, 2)}\n`
        )
      }
    })

    expect(lockObserved).toBe(true)
    await created.writeLock.release()
  })
})
