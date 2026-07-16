import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it } from 'vitest'
import { openAppDatabase } from '../connection'
import { RECENT_PROJECT_LIMIT, RecentProjectsRepository } from './recent-projects'

const temporaryDirectories: string[] = []
const log = pino({ level: 'silent' })

async function openTestDatabase() {
  const directory = await mkdtemp(join(tmpdir(), 'writellm-recent-projects-'))
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

describe('RecentProjectsRepository', () => {
  it('lists recent project pointers newest first', async () => {
    const database = await openTestDatabase()
    const repository = new RecentProjectsRepository(database, () => '2026-07-14T12:00:00.000Z')

    await repository.upsert({
      projectId: '11111111-1111-4111-8111-111111111111',
      projectPath: '/projects/older',
      displayName: 'Older',
      lastOpenedAt: '2026-07-14T10:00:00.000Z'
    })
    await repository.upsert({
      projectId: '22222222-2222-4222-8222-222222222222',
      projectPath: '/projects/newer',
      displayName: 'Newer',
      lastOpenedAt: '2026-07-14T11:00:00.000Z'
    })

    await expect(repository.list()).resolves.toEqual([
      {
        projectId: '22222222-2222-4222-8222-222222222222',
        projectPath: '/projects/newer',
        displayName: 'Newer',
        lastOpenedAt: '2026-07-14T11:00:00.000Z'
      },
      {
        projectId: '11111111-1111-4111-8111-111111111111',
        projectPath: '/projects/older',
        displayName: 'Older',
        lastOpenedAt: '2026-07-14T10:00:00.000Z'
      }
    ])
    database.close()
  })

  it('updates a moved project path by stable project ID without creating a duplicate', async () => {
    const database = await openTestDatabase()
    let now = '2026-07-14T10:00:00.000Z'
    const repository = new RecentProjectsRepository(database, () => now)
    const projectId = '11111111-1111-4111-8111-111111111111'

    await repository.upsert({
      projectId,
      projectPath: '/projects/original',
      displayName: 'Original name',
      lastOpenedAt: '2026-07-14T10:00:00.000Z'
    })
    now = '2026-07-14T11:00:00.000Z'
    await repository.upsert({
      projectId,
      projectPath: '/projects/moved',
      displayName: 'Moved name',
      lastOpenedAt: '2026-07-14T11:00:00.000Z'
    })

    await expect(repository.list()).resolves.toEqual([
      {
        projectId,
        projectPath: '/projects/moved',
        displayName: 'Moved name',
        lastOpenedAt: '2026-07-14T11:00:00.000Z'
      }
    ])
    const storedRows = await database.kysely
      .selectFrom('recent_projects')
      .select(['created_at', 'updated_at'])
      .execute()
    expect(storedRows).toEqual([
      {
        created_at: '2026-07-14T10:00:00.000Z',
        updated_at: '2026-07-14T11:00:00.000Z'
      }
    ])
    database.close()
  })

  it('finds one recent project by stable project ID', async () => {
    const database = await openTestDatabase()
    const repository = new RecentProjectsRepository(database)
    const projectId = '11111111-1111-4111-8111-111111111111'

    await repository.upsert({
      projectId,
      projectPath: '/projects/example',
      displayName: 'Example',
      lastOpenedAt: '2026-07-14T10:00:00.000Z'
    })

    await expect(repository.find(projectId)).resolves.toEqual({
      projectId,
      projectPath: '/projects/example',
      displayName: 'Example',
      lastOpenedAt: '2026-07-14T10:00:00.000Z'
    })
    await expect(repository.find('22222222-2222-4222-8222-222222222222')).resolves.toBeNull()
    database.close()
  })

  it('removes a pointer by stable project ID and reports whether one existed', async () => {
    const database = await openTestDatabase()
    const repository = new RecentProjectsRepository(database)
    const projectId = '11111111-1111-4111-8111-111111111111'

    await repository.upsert({
      projectId,
      projectPath: '/projects/example',
      displayName: 'Example',
      lastOpenedAt: '2026-07-14T10:00:00.000Z'
    })

    await expect(repository.remove(projectId)).resolves.toBe(true)
    await expect(repository.remove(projectId)).resolves.toBe(false)
    await expect(repository.list()).resolves.toEqual([])
    database.close()
  })

  it('prunes stored pointers beyond the recent-project limit on upsert', async () => {
    const database = await openTestDatabase()
    const repository = new RecentProjectsRepository(database)

    for (let index = 0; index < RECENT_PROJECT_LIMIT + 2; index += 1) {
      await repository.upsert({
        projectId: `11111111-1111-4111-8111-11111111111${index}`,
        projectPath: `/projects/project-${index}`,
        displayName: `Project ${index}`,
        lastOpenedAt: `2026-07-14T1${index}:00:00.000Z`
      })
    }

    const stored = await repository.list()
    expect(stored).toHaveLength(RECENT_PROJECT_LIMIT)
    expect(stored.map((pointer) => pointer.displayName)).toEqual([
      'Project 6',
      'Project 5',
      'Project 4',
      'Project 3',
      'Project 2'
    ])
    const storedRows = await database.kysely
      .selectFrom('recent_projects')
      .select('project_id')
      .execute()
    expect(storedRows).toHaveLength(RECENT_PROJECT_LIMIT)
    database.close()
  })
})
