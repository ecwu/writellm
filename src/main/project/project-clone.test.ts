import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it } from 'vitest'
import { createProjectClone } from './project-clone'
import {
  initializeProjectDatabase,
  openProjectDatabase,
  type ProjectDatabase
} from './project-database'
import {
  createProjectManifest,
  readProjectManifest,
  writeProjectManifest,
  type ProjectManifest
} from './project-manifest'
import {
  INDEX_DATABASE_RELATIVE_PATH,
  PROJECT_HISTORY_RELATIVE_PATH,
  resolveProjectPath
} from './project-paths'
import type { SnapshotBarrier } from './project-snapshot'

const roots: string[] = []
const log = pino({ level: 'silent' })

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('project clone', () => {
  it('publishes an independent Unicode clone from live WAL state and omits derived/transient authority', async () => {
    const fixture = await sourceFixture(`研究项目-${'长'.repeat(60)}`)
    fixture.database.immediate((database) =>
      database.prepare('UPDATE manuscript_briefs SET title = ?').run('WAL-visible title')
    )
    await mkdir(resolveProjectPath(fixture.root, PROJECT_HISTORY_RELATIVE_PATH), {
      recursive: true
    })
    await writeFile(
      resolveProjectPath(fixture.root, `${PROJECT_HISTORY_RELATIVE_PATH}/HEAD`),
      'old'
    )
    await writeFile(resolveProjectPath(fixture.root, INDEX_DATABASE_RELATIVE_PATH), 'derived index')
    await writeFile(resolveProjectPath(fixture.root, '.writellm/credentials.json'), 'not portable')
    await mkdir(resolveProjectPath(fixture.root, 'manuscript/exports/old'), { recursive: true })
    await writeFile(
      resolveProjectPath(fixture.root, 'manuscript/exports/old/manuscript.md'),
      'old export'
    )
    await mkdir(resolveProjectPath(fixture.root, 'knowledge/originals/sha256'), { recursive: true })
    await writeFile(
      resolveProjectPath(fixture.root, 'knowledge/originals/sha256/source.txt'),
      '知识'
    )

    const destination = join(fixture.parent, `副本-${'路'.repeat(40)}.writellm`)
    const result = await createProjectClone({
      sourceRoot: fixture.root,
      sourceManifest: fixture.manifest,
      sourceDatabase: fixture.database,
      destination,
      sourceAppVersion: 'clone-test',
      barrier: noOpBarrier(),
      log,
      createId: sequenceIds(
        '019d0000-0000-7000-8000-000000000301',
        '019d0000-0000-7000-8000-000000000302'
      ),
      now: () => new Date('2026-08-13T05:00:00.000Z')
    })

    expect(result.projectId).not.toBe(fixture.manifest.projectId)
    expect((await readProjectManifest(destination)).projectId).toBe(result.projectId)
    await expect(
      readFile(join(destination, 'knowledge/originals/sha256/source.txt'), 'utf8')
    ).resolves.toBe('知识')
    await expect(
      access(resolveProjectPath(destination, INDEX_DATABASE_RELATIVE_PATH))
    ).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(
      access(resolveProjectPath(destination, PROJECT_HISTORY_RELATIVE_PATH))
    ).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(
      access(resolveProjectPath(destination, '.writellm/credentials.json'))
    ).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(
      access(join(destination, 'manuscript/exports/old/manuscript.md'))
    ).rejects.toMatchObject({ code: 'ENOENT' })

    const cloneManifest = await readProjectManifest(destination)
    const cloneDatabase = await openProjectDatabase({
      projectRoot: destination,
      manifest: cloneManifest,
      applicationVersion: 'clone-test',
      log
    })
    expect(
      cloneDatabase.immediate((database) =>
        database.prepare('SELECT title FROM manuscript_briefs').pluck().get()
      )
    ).toBe('WAL-visible title')
    expect(
      cloneDatabase.immediate((database) =>
        database.prepare('SELECT DISTINCT project_id FROM manuscripts').pluck().all()
      )
    ).toEqual([result.projectId])
    cloneDatabase.close()

    expect(
      fixture.database.immediate((database) =>
        database.prepare('SELECT project_id FROM project_meta').pluck().get()
      )
    ).toBe(fixture.manifest.projectId)
    fixture.database.close()
  })

  it('fails closed for links, cancellation, ENOSPC, and an incomplete identity rewrite list', async () => {
    const linked = await sourceFixture('Linked')
    await symlink(join(linked.parent, 'outside'), join(linked.root, 'linked-file'))
    await expect(clone(linked, join(linked.parent, 'linked-clone.writellm'))).rejects.toThrow(
      'Project clone failed'
    )
    await expect(access(join(linked.parent, 'linked-clone.writellm'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    linked.database.close()

    const cancelled = await sourceFixture('Cancelled')
    const controller = new AbortController()
    controller.abort(new Error('cancelled by test'))
    await expect(
      clone(cancelled, join(cancelled.parent, 'cancelled-clone.writellm'), {
        signal: controller.signal
      })
    ).rejects.toThrow('Project clone failed')
    cancelled.database.close()

    const full = await sourceFixture('Full')
    const noSpace = Object.assign(new Error('disk full'), { code: 'ENOSPC' })
    await expect(
      clone(full, join(full.parent, 'full-clone.writellm'), {
        barrier: {
          ...noOpBarrier(),
          finalEditorFlush: async () => {
            throw noSpace
          }
        }
      })
    ).rejects.toThrow('Project clone failed')
    await expect(access(join(full.parent, 'full-clone.writellm'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    full.database.close()

    const futureSchema = await sourceFixture('Future')
    futureSchema.database.immediate((database) =>
      database.exec('CREATE TABLE future_identity (project_id TEXT NOT NULL)')
    )
    await expect(
      clone(futureSchema, join(futureSchema.parent, 'future-clone.writellm'))
    ).rejects.toThrow('Project clone failed')
    await expect(access(join(futureSchema.parent, 'future-clone.writellm'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    futureSchema.database.close()
  })
})

async function sourceFixture(name: string): Promise<{
  parent: string
  root: string
  manifest: ProjectManifest
  database: ProjectDatabase
}> {
  const parent = await mkdtemp(join(tmpdir(), 'writellm-clone-'))
  roots.push(parent)
  const root = join(parent, `${name}.writellm`)
  await mkdir(root)
  const manifest = createProjectManifest({
    projectId: '019d0000-0000-7000-8000-000000000300',
    createdAt: '2026-08-13T04:00:00.000Z'
  })
  await writeProjectManifest(root, manifest)
  const database = await initializeProjectDatabase({
    projectRoot: root,
    manifest,
    applicationVersion: 'clone-test',
    initialTitle: name,
    log
  })
  await mkdir(join(root, 'manuscript/sections'), { recursive: true })
  await writeFile(join(root, 'manuscript/sections/current.json'), '[]\n')
  return { parent, root, manifest, database }
}

function clone(
  fixture: Awaited<ReturnType<typeof sourceFixture>>,
  destination: string,
  overrides: { signal?: AbortSignal; barrier?: SnapshotBarrier } = {}
) {
  return createProjectClone({
    sourceRoot: fixture.root,
    sourceManifest: fixture.manifest,
    sourceDatabase: fixture.database,
    destination,
    sourceAppVersion: 'clone-test',
    barrier: overrides.barrier ?? noOpBarrier(),
    log,
    ...(overrides.signal === undefined ? {} : { signal: overrides.signal })
  })
}

function noOpBarrier(): SnapshotBarrier {
  return {
    pauseMutations: async () => undefined,
    finalEditorFlush: async () => undefined,
    pauseFilePublishers: async () => undefined,
    resumeFilePublishers: async () => undefined,
    resumeMutations: async () => undefined
  }
}

function sequenceIds(...ids: string[]): () => string {
  return () => {
    const id = ids.shift()
    if (id === undefined) throw new Error('Missing test ID')
    return id
  }
}
