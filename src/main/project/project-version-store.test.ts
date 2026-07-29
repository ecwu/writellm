import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createProjectManifest, writeProjectManifest } from './project-manifest'
import {
  PROJECT_DATABASE_RELATIVE_PATH,
  PROJECT_HISTORY_RELATIVE_PATH,
  resolveProjectPath
} from './project-paths'
import {
  PROJECT_SNAPSHOT_FORMAT,
  PROJECT_SNAPSHOT_FORMAT_VERSION,
  PROJECT_SNAPSHOT_MANIFEST_FILE
} from './project-snapshot'
import {
  IsomorphicGitProjectVersionStore,
  PROJECT_HISTORY_OWNERSHIP_FILE
} from './project-version-store'

const roots: string[] = []
const log = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture(): Promise<{
  projectRoot: string
  projectId: string
  createSnapshot(state: string): Promise<string>
}> {
  const parent = await mkdtemp(join(tmpdir(), 'writellm-history-'))
  roots.push(parent)
  const projectRoot = join(parent, 'Novel.writellm')
  await mkdir(resolveProjectPath(projectRoot, '.writellm'), { recursive: true })
  const manifest = createProjectManifest()
  await writeProjectManifest(projectRoot, manifest)
  return {
    projectRoot,
    projectId: manifest.projectId,
    async createSnapshot(state: string): Promise<string> {
      const root = join(parent, `snapshot-${randomUUID()}`)
      await mkdir(resolveProjectPath(root, '.writellm'), { recursive: true })
      await writeProjectManifest(root, manifest)
      const database = Buffer.from(`database:${state}`)
      await writeFile(resolveProjectPath(root, PROJECT_DATABASE_RELATIVE_PATH), database)
      await writeFile(
        join(root, PROJECT_SNAPSHOT_MANIFEST_FILE),
        `${JSON.stringify({
          snapshotFormat: PROJECT_SNAPSHOT_FORMAT,
          snapshotFormatVersion: PROJECT_SNAPSHOT_FORMAT_VERSION,
          projectId: manifest.projectId,
          projectFormatVersion: manifest.formatVersion,
          projectDatabaseSchemaVersion: 22,
          schemaMigrationsSha256: 'a'.repeat(64),
          createdAt: new Date().toISOString(),
          sourceAppVersion: 'test',
          indexIncluded: false,
          indexRebuildRequired: true,
          database: {
            path: PROJECT_DATABASE_RELATIVE_PATH,
            sha256: state.padEnd(64, '0').slice(0, 64),
            size: database.length
          },
          files: [],
          versionHistory: { included: false, files: [] }
        })}\n`
      )
      return root
    }
  }
}

describe('IsomorphicGitProjectVersionStore', () => {
  it('initializes one independent bare history and is idempotent', async () => {
    const value = await fixture()
    const outerGit = join(value.projectRoot, '..', '.git')
    await mkdir(outerGit)
    await writeFile(join(outerGit, 'sentinel'), 'untouched')
    const snapshot = await value.createSnapshot('1')
    const store = new IsomorphicGitProjectVersionStore({
      projectRoot: value.projectRoot,
      projectId: value.projectId,
      applicationVersion: '1.0.0',
      log
    })

    expect(await store.inspect()).toBe('uninitialized')
    const initial = await store.enable(snapshot)
    expect(initial.name).toBe('Initial checkpoint')
    expect(initial.parentOid).toBeNull()
    expect(await store.inspect()).toBe('ready')
    expect((await store.enable(snapshot)).oid).toBe(initial.oid)
    expect((await store.list()).checkpoints).toHaveLength(1)
    expect(await readFile(join(outerGit, 'sentinel'), 'utf8')).toBe('untouched')
  })

  it('creates a linear parent chain, paginates, and compares exact state', async () => {
    const value = await fixture()
    const firstSnapshot = await value.createSnapshot('1')
    const secondSnapshot = await value.createSnapshot('2')
    const store = new IsomorphicGitProjectVersionStore({
      projectRoot: value.projectRoot,
      projectId: value.projectId,
      applicationVersion: '1.0.0',
      log
    })
    const first = await store.enable(firstSnapshot)
    const second = await store.createCheckpoint(secondSnapshot, {
      name: 'Chapter complete',
      note: 'Private note'
    })

    expect(second.parentOid).toBe(first.oid)
    expect(await store.compareSnapshot(secondSnapshot)).toEqual({
      status: 'up-to-date',
      headOid: second.oid
    })
    expect((await store.compareSnapshot(firstSnapshot)).status).toBe('uncheckpointed-changes')
    const page = await store.list({ limit: 1 })
    expect(page.checkpoints.map((entry) => entry.oid)).toEqual([second.oid])
    expect(page.nextCursor).toBe(first.oid)
    expect(
      (await store.list({ cursor: page.nextCursor ?? undefined, limit: 1 })).checkpoints[0]?.oid
    ).toBe(first.oid)
    const materialized = join(value.projectRoot, '..', `materialized-${randomUUID()}`)
    await store.materializeCheckpoint(first.oid, materialized)
    expect(
      await readFile(resolveProjectPath(materialized, PROJECT_DATABASE_RELATIVE_PATH), 'utf8')
    ).toBe('database:1')
    const restored = await store.createRestoreCommit(first.oid, second.oid)
    expect(restored.parentOid).toBe(second.oid)
    expect(restored.name).toBe('Restored Initial checkpoint')
    expect((await store.list()).checkpoints).toHaveLength(3)
  })

  it('marks a foreign ownership marker as damaged without overwriting it', async () => {
    const value = await fixture()
    const snapshot = await value.createSnapshot('1')
    const store = new IsomorphicGitProjectVersionStore({
      projectRoot: value.projectRoot,
      projectId: value.projectId,
      applicationVersion: '1.0.0',
      log
    })
    await store.enable(snapshot)
    const marker = join(
      resolveProjectPath(value.projectRoot, PROJECT_HISTORY_RELATIVE_PATH),
      PROJECT_HISTORY_OWNERSHIP_FILE
    )
    const before = JSON.parse(await readFile(marker, 'utf8')) as Record<string, unknown>
    await writeFile(marker, `${JSON.stringify({ ...before, projectId: randomUUID() })}\n`)

    expect(await store.inspect()).toBe('damaged')
    await expect(store.enable(snapshot)).rejects.toThrow('damaged')
    expect(JSON.parse(await readFile(marker, 'utf8'))).toMatchObject({
      projectId: expect.not.stringMatching(value.projectId)
    })
  })

  it('fails closed for a symbolic-link repository and quarantines it only on reinitialize', async () => {
    const value = await fixture()
    const snapshot = await value.createSnapshot('1')
    const external = join(value.projectRoot, '..', 'external-history')
    await mkdir(external)
    await writeFile(join(external, 'sentinel'), 'untouched')
    await symlink(external, resolveProjectPath(value.projectRoot, PROJECT_HISTORY_RELATIVE_PATH))
    const store = new IsomorphicGitProjectVersionStore({
      projectRoot: value.projectRoot,
      projectId: value.projectId,
      applicationVersion: '1.0.0',
      log
    })

    expect(await store.inspect()).toBe('damaged')
    await expect(store.enable(snapshot)).rejects.toThrow('damaged')
    expect(await readFile(join(external, 'sentinel'), 'utf8')).toBe('untouched')

    const checkpoint = await store.reinitialize(snapshot)
    expect(checkpoint.name).toBe('Initial checkpoint')
    expect(await store.inspect()).toBe('ready')
    expect(await readFile(join(external, 'sentinel'), 'utf8')).toBe('untouched')
  })

  it('leaves the old head valid when advancing a new commit fails', async () => {
    const value = await fixture()
    const firstSnapshot = await value.createSnapshot('1')
    const failedInitial = new IsomorphicGitProjectVersionStore({
      projectRoot: value.projectRoot,
      projectId: value.projectId,
      applicationVersion: '1.0.0',
      log,
      beforeAdvanceRef: () => {
        throw Object.assign(new Error('disk full'), { code: 'ENOSPC' })
      }
    })

    await expect(failedInitial.enable(firstSnapshot)).rejects.toThrow(
      'Failed to enable project version history'
    )
    expect(await failedInitial.inspect()).toBe('uninitialized')

    const healthy = new IsomorphicGitProjectVersionStore({
      projectRoot: value.projectRoot,
      projectId: value.projectId,
      applicationVersion: '1.0.0',
      log
    })
    const initial = await healthy.enable(await value.createSnapshot('2'))
    const failing = new IsomorphicGitProjectVersionStore({
      projectRoot: value.projectRoot,
      projectId: value.projectId,
      applicationVersion: '1.0.0',
      log,
      beforeAdvanceRef: () => {
        throw new Error('simulated crash before ref update')
      }
    })
    await expect(
      failing.createCheckpoint(await value.createSnapshot('3'), { name: 'Never published' })
    ).rejects.toThrow('simulated crash')
    expect((await healthy.list()).checkpoints.map((entry) => entry.oid)).toEqual([initial.oid])
  })
})
