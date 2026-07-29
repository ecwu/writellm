import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Logger } from 'pino'
import { z } from 'zod'
import {
  init,
  readBlob,
  readCommit,
  readTree,
  resolveRef,
  writeBlob,
  writeCommit,
  writeRef,
  writeTree,
  type TreeEntry
} from 'isomorphic-git'
import {
  checkpointEntrySchema,
  checkpointNameSchema,
  checkpointNoteSchema,
  checkpointOidSchema,
  projectIdSchema,
  type CheckpointEntry,
  type VersionHistoryState
} from '../../shared/contracts/projects'
import { writeAtomicFile } from '../storage/atomic-file'
import {
  PROJECT_HISTORY_IGNORE_CONTENT,
  PROJECT_HISTORY_IGNORE_RELATIVE_PATH,
  PROJECT_HISTORY_RELATIVE_PATH,
  PROJECT_RECOVERY_DIRECTORY,
  resolveProjectPath
} from './project-paths'
import { readProjectSnapshotManifest, type ProjectSnapshotManifest } from './project-snapshot'

export const PROJECT_HISTORY_FORMAT_VERSION = 1
export const PROJECT_CHECKPOINT_FORMAT_VERSION = 1
export const PROJECT_CHECKPOINT_MANIFEST_FILE = 'writellm.checkpoint.json'
export const PROJECT_HISTORY_OWNERSHIP_FILE = 'writellm-history.json'

const historyOwnerSchema = z
  .object({
    format: z.literal('writellm-project-history'),
    formatVersion: z.literal(PROJECT_HISTORY_FORMAT_VERSION),
    projectId: projectIdSchema,
    createdByVersion: z.string().min(1).max(100)
  })
  .strict()

const checkpointManifestSchema = z
  .object({
    format: z.literal('writellm-checkpoint'),
    formatVersion: z.literal(PROJECT_CHECKPOINT_FORMAT_VERSION),
    projectId: projectIdSchema,
    stateSha256: z.string().regex(/^[a-f0-9]{64}$/),
    name: checkpointNameSchema,
    note: checkpointNoteSchema.optional(),
    createdAt: z.iso.datetime(),
    fileCount: z.number().int().nonnegative(),
    totalBytes: z.number().int().nonnegative()
  })
  .strict()

type CheckpointManifest = z.infer<typeof checkpointManifestSchema>

const AUTHOR = { name: 'WriteLLM', email: 'noreply@writellm.local' } as const
const MAIN_REF = 'refs/heads/main'

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT'
}

function stateSha256(snapshot: ProjectSnapshotManifest): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        projectId: snapshot.projectId,
        projectFormatVersion: snapshot.projectFormatVersion,
        projectDatabaseSchemaVersion: snapshot.projectDatabaseSchemaVersion,
        schemaMigrationsSha256: snapshot.schemaMigrationsSha256,
        database: snapshot.database,
        files: [...snapshot.files].sort((left, right) =>
          left.relativePath.localeCompare(right.relativePath)
        )
      })
    )
    .digest('hex')
}

async function directoryStats(root: string): Promise<{ fileCount: number; totalBytes: number }> {
  let fileCount = 0
  let totalBytes = 0
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const target = join(directory, entry.name)
      if (entry.isSymbolicLink()) throw new Error('Checkpoint source contains a symbolic link')
      if (entry.isDirectory()) {
        await visit(target)
      } else if (entry.isFile()) {
        const metadata = await stat(target)
        fileCount += 1
        totalBytes += metadata.size
      } else {
        throw new Error('Checkpoint source contains an unsupported filesystem entry')
      }
    }
  }
  await visit(root)
  return { fileCount, totalBytes }
}

async function writeDirectoryTree(gitdir: string, directory: string): Promise<string> {
  const entries = await readdir(directory, { withFileTypes: true })
  const tree: TreeEntry[] = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const target = join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error('Checkpoint tree contains a symbolic link')
    if (entry.isDirectory()) {
      tree.push({
        mode: '040000',
        path: entry.name,
        oid: await writeDirectoryTree(gitdir, target),
        type: 'tree'
      })
      continue
    }
    if (!entry.isFile()) throw new Error('Checkpoint tree contains an unsupported entry')
    tree.push({
      mode: '100644',
      path: entry.name,
      oid: await writeBlob({ fs, gitdir, blob: await readFile(target) }),
      type: 'blob'
    })
  }
  return writeTree({ fs, gitdir, tree })
}

async function resolveHead(gitdir: string): Promise<string | null> {
  try {
    return checkpointOidSchema.parse(await resolveRef({ fs, gitdir, ref: MAIN_REF }))
  } catch (err) {
    if (
      isMissing(err) ||
      (err instanceof Error &&
        (err.name === 'NotFoundError' || err.message.includes('Could not find')))
    ) {
      return null
    }
    throw err
  }
}

async function readCheckpointManifest(gitdir: string, oid: string): Promise<CheckpointManifest> {
  const commit = await readCommit({ fs, gitdir, oid: checkpointOidSchema.parse(oid) })
  const root = await readTree({ fs, gitdir, oid: commit.commit.tree })
  const entry = root.tree.find(
    (candidate) => candidate.path === PROJECT_CHECKPOINT_MANIFEST_FILE && candidate.type === 'blob'
  )
  if (entry === undefined) throw new Error('Commit is missing its checkpoint manifest')
  const blob = await readBlob({ fs, gitdir, oid: entry.oid })
  return checkpointManifestSchema.parse(JSON.parse(Buffer.from(blob.blob).toString('utf8')))
}

async function checkpointEntry(gitdir: string, oid: string): Promise<CheckpointEntry> {
  const commit = await readCommit({ fs, gitdir, oid })
  if (commit.commit.parent.length > 1) throw new Error('Checkpoint history is not linear')
  const manifest = await readCheckpointManifest(gitdir, oid)
  return checkpointEntrySchema.parse({
    oid,
    name: checkpointNameSchema.parse(commit.commit.message.split('\n')[0]?.trim()),
    ...(manifest.note === undefined ? {} : { note: manifest.note }),
    createdAt: new Date(commit.commit.author.timestamp * 1_000).toISOString(),
    parentOid: commit.commit.parent[0] ?? null,
    stateSha256: manifest.stateSha256,
    fileCount: manifest.fileCount,
    totalBytes: manifest.totalBytes
  })
}

export interface ProjectVersionStore {
  inspect(): Promise<VersionHistoryState>
  enable(snapshotRoot: string, name?: string): Promise<CheckpointEntry>
  createCheckpoint(
    snapshotRoot: string,
    input: { name: string; note?: string; parentOid?: string }
  ): Promise<CheckpointEntry>
  list(input?: {
    cursor?: string
    limit?: number
  }): Promise<{ checkpoints: CheckpointEntry[]; nextCursor: string | null }>
  compareSnapshot(snapshotRoot: string): Promise<{
    status: 'up-to-date' | 'uncheckpointed-changes'
    headOid: string
  }>
  reinitialize(snapshotRoot: string): Promise<CheckpointEntry>
  materializeCheckpoint(oid: string, destination: string): Promise<CheckpointEntry>
  createRestoreCommit(targetOid: string, parentOid: string): Promise<CheckpointEntry>
}

export class IsomorphicGitProjectVersionStore implements ProjectVersionStore {
  readonly #projectRoot: string
  readonly #projectId: string
  readonly #applicationVersion: string
  readonly #log: Pick<Logger, 'info' | 'warn' | 'error'>
  readonly #beforeAdvanceRef?: () => void | Promise<void>

  constructor(options: {
    projectRoot: string
    projectId: string
    applicationVersion: string
    log: Pick<Logger, 'info' | 'warn' | 'error'>
    beforeAdvanceRef?: () => void | Promise<void>
  }) {
    this.#projectRoot = options.projectRoot
    this.#projectId = projectIdSchema.parse(options.projectId)
    this.#applicationVersion = options.applicationVersion
    this.#log = options.log
    this.#beforeAdvanceRef = options.beforeAdvanceRef
  }

  get #gitdir(): string {
    return resolveProjectPath(this.#projectRoot, PROJECT_HISTORY_RELATIVE_PATH)
  }

  async inspect(): Promise<VersionHistoryState> {
    try {
      const metadata = await lstat(this.#gitdir)
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) return 'damaged'
      const owner = historyOwnerSchema.parse(
        JSON.parse(await readFile(join(this.#gitdir, PROJECT_HISTORY_OWNERSHIP_FILE), 'utf8'))
      )
      if (owner.projectId !== this.#projectId) return 'damaged'
      const head = await resolveHead(this.#gitdir)
      if (head === null) return 'damaged'
      const checkpoint = await readCheckpointManifest(this.#gitdir, head)
      return checkpoint.projectId === this.#projectId ? 'ready' : 'damaged'
    } catch (err) {
      if (isMissing(err)) return 'uninitialized'
      this.#log.error(
        { event: 'project_history.inspect_failed', err, projectId: this.#projectId },
        'Project history inspection failed'
      )
      return 'damaged'
    }
  }

  async enable(snapshotRoot: string, name = 'Initial checkpoint'): Promise<CheckpointEntry> {
    const state = await this.inspect()
    if (state === 'ready') {
      const head = await resolveHead(this.#gitdir)
      if (head === null) throw new Error('Ready history does not have a head')
      return checkpointEntry(this.#gitdir, head)
    }
    if (state === 'damaged') throw new Error('Project version history is damaged')

    const partial = `${this.#gitdir}.partial-${randomUUID()}`
    try {
      await writeAtomicFile(
        resolveProjectPath(this.#projectRoot, PROJECT_HISTORY_IGNORE_RELATIVE_PATH),
        PROJECT_HISTORY_IGNORE_CONTENT,
        { mode: 0o600 }
      )
      await mkdir(dirname(partial), { recursive: true, mode: 0o700 })
      await mkdir(partial, { mode: 0o700 })
      await init({ fs, gitdir: partial, bare: true, defaultBranch: 'main' })
      await chmod(partial, 0o700)
      await writeAtomicFile(
        join(partial, PROJECT_HISTORY_OWNERSHIP_FILE),
        `${JSON.stringify(
          {
            format: 'writellm-project-history',
            formatVersion: PROJECT_HISTORY_FORMAT_VERSION,
            projectId: this.#projectId,
            createdByVersion: this.#applicationVersion
          },
          null,
          2
        )}\n`,
        { mode: 0o600 }
      )
      const result = await this.#commit(partial, snapshotRoot, { name })
      const verifiedHead = await resolveHead(partial)
      const verified = await readCheckpointManifest(partial, result.oid)
      if (verifiedHead !== result.oid || verified.projectId !== this.#projectId) {
        throw new Error('Initialized history failed verification')
      }
      await rename(partial, this.#gitdir)
      this.#log.info(
        {
          event: 'project_history.enabled',
          projectId: this.#projectId,
          checkpointOid: result.oid
        },
        'Project version history enabled'
      )
      return result
    } catch (err) {
      this.#log.error(
        { event: 'project_history.enable_failed', err, projectId: this.#projectId },
        'Project version history enable failed'
      )
      throw new Error('Failed to enable project version history', { cause: err })
    } finally {
      await rm(partial, { recursive: true, force: true }).catch((err) =>
        this.#log.error(
          { event: 'project_history.partial_cleanup_failed', err, projectId: this.#projectId },
          'Failed to clean partial project history'
        )
      )
    }
  }

  async createCheckpoint(
    snapshotRoot: string,
    input: { name: string; note?: string; parentOid?: string }
  ): Promise<CheckpointEntry> {
    if ((await this.inspect()) !== 'ready')
      throw new Error('Project version history is unavailable')
    return this.#commit(this.#gitdir, snapshotRoot, input)
  }

  async list(
    input: { cursor?: string; limit?: number } = {}
  ): Promise<{ checkpoints: CheckpointEntry[]; nextCursor: string | null }> {
    if ((await this.inspect()) !== 'ready')
      throw new Error('Project version history is unavailable')
    const head = await resolveHead(this.#gitdir)
    if (head === null) throw new Error('Project version history has no head')
    const requestedCursor =
      input.cursor === undefined ? head : checkpointOidSchema.parse(input.cursor)
    let current: string | null = head
    while (current !== null && current !== requestedCursor) {
      const commit = await readCommit({ fs, gitdir: this.#gitdir, oid: current })
      if (commit.commit.parent.length > 1) throw new Error('Checkpoint history is not linear')
      current = commit.commit.parent[0] ?? null
    }
    if (current === null) throw new Error('Checkpoint cursor is not reachable from history head')
    const checkpoints: CheckpointEntry[] = []
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 50)
    while (current !== null && checkpoints.length < limit) {
      const entry = await checkpointEntry(this.#gitdir, current)
      checkpoints.push(entry)
      current = entry.parentOid
    }
    return { checkpoints, nextCursor: current }
  }

  async compareSnapshot(snapshotRoot: string): Promise<{
    status: 'up-to-date' | 'uncheckpointed-changes'
    headOid: string
  }> {
    if ((await this.inspect()) !== 'ready')
      throw new Error('Project version history is unavailable')
    const headOid = await resolveHead(this.#gitdir)
    if (headOid === null) throw new Error('Project version history has no head')
    const current = stateSha256(await readProjectSnapshotManifest(snapshotRoot))
    const head = await readCheckpointManifest(this.#gitdir, headOid)
    return {
      status: current === head.stateSha256 ? 'up-to-date' : 'uncheckpointed-changes',
      headOid
    }
  }

  async reinitialize(snapshotRoot: string): Promise<CheckpointEntry> {
    const state = await this.inspect()
    if (state === 'ready') throw new Error('Ready project history cannot be reinitialized')
    if (state === 'damaged') {
      const recoveryRoot = resolveProjectPath(this.#projectRoot, PROJECT_RECOVERY_DIRECTORY)
      await mkdir(recoveryRoot, { recursive: true, mode: 0o700 })
      const destination = join(
        recoveryRoot,
        `history-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`
      )
      await rename(this.#gitdir, destination)
      this.#log.warn(
        { event: 'project_history.damaged_quarantined', projectId: this.#projectId },
        'Damaged project history moved to recovery'
      )
    }
    return this.enable(snapshotRoot)
  }

  async materializeCheckpoint(oid: string, destination: string): Promise<CheckpointEntry> {
    const entry = await this.#requireReachable(oid)
    try {
      await lstat(destination)
      throw new Error('Checkpoint materialization destination already exists')
    } catch (err) {
      if (!isMissing(err)) throw err
    }
    await mkdir(destination, { recursive: true, mode: 0o700 })
    const commit = await readCommit({ fs, gitdir: this.#gitdir, oid: entry.oid })
    const materializeTree = async (treeOid: string, directory: string): Promise<void> => {
      const tree = await readTree({ fs, gitdir: this.#gitdir, oid: treeOid })
      for (const child of tree.tree) {
        if (
          child.path === '' ||
          child.path === '.' ||
          child.path === '..' ||
          child.path.includes('/') ||
          child.path.includes('\\')
        ) {
          throw new Error('Checkpoint tree contains an invalid path')
        }
        const target = join(directory, child.path)
        if (child.type === 'tree') {
          await mkdir(target, { mode: 0o700 })
          await materializeTree(child.oid, target)
        } else if (child.type === 'blob') {
          const blob = await readBlob({ fs, gitdir: this.#gitdir, oid: child.oid })
          await writeFile(target, blob.blob, { mode: 0o600, flag: 'wx' })
        } else {
          throw new Error('Checkpoint tree contains an unsupported entry')
        }
      }
    }
    try {
      await materializeTree(commit.commit.tree, destination)
      const snapshot = await readProjectSnapshotManifest(destination)
      if (snapshot.projectId !== this.#projectId) {
        throw new Error('Materialized checkpoint belongs to another project')
      }
      return entry
    } catch (err) {
      await rm(destination, { recursive: true, force: true })
      throw err
    }
  }

  async createRestoreCommit(targetOid: string, parentOid: string): Promise<CheckpointEntry> {
    const target = await this.#requireReachable(targetOid)
    const currentHead = await resolveHead(this.#gitdir)
    const parent = checkpointOidSchema.parse(parentOid)
    if (currentHead !== parent) throw new Error('Restore commit parent is stale')
    const targetCommit = await readCommit({ fs, gitdir: this.#gitdir, oid: target.oid })
    const createdAt = new Date()
    const identity = {
      ...AUTHOR,
      timestamp: Math.floor(createdAt.getTime() / 1_000),
      timezoneOffset: createdAt.getTimezoneOffset()
    }
    const oid = await writeCommit({
      fs,
      gitdir: this.#gitdir,
      commit: {
        tree: targetCommit.commit.tree,
        parent: [parent],
        author: identity,
        committer: identity,
        message: `${checkpointNameSchema.parse(`Restored ${target.name}`.slice(0, 100))}\n`
      }
    })
    await this.#beforeAdvanceRef?.()
    if ((await resolveHead(this.#gitdir)) !== parent) throw new Error('Restore head changed')
    await writeRef({ fs, gitdir: this.#gitdir, ref: MAIN_REF, value: oid, force: true })
    return checkpointEntry(this.#gitdir, oid)
  }

  async #requireReachable(oid: string): Promise<CheckpointEntry> {
    const target = checkpointOidSchema.parse(oid)
    if ((await this.inspect()) !== 'ready')
      throw new Error('Project version history is unavailable')
    const head = await resolveHead(this.#gitdir)
    let current = head
    while (current !== null) {
      if (current === target) return checkpointEntry(this.#gitdir, current)
      const commit = await readCommit({ fs, gitdir: this.#gitdir, oid: current })
      if (commit.commit.parent.length > 1) throw new Error('Checkpoint history is not linear')
      current = commit.commit.parent[0] ?? null
    }
    throw new Error('Checkpoint is not reachable from history head')
  }

  async #commit(
    gitdir: string,
    snapshotRoot: string,
    input: { name: string; note?: string; parentOid?: string }
  ): Promise<CheckpointEntry> {
    const name = checkpointNameSchema.parse(input.name)
    const note =
      input.note === undefined || input.note.trim() === ''
        ? undefined
        : checkpointNoteSchema.parse(input.note)
    const snapshot = await readProjectSnapshotManifest(snapshotRoot)
    if (snapshot.projectId !== this.#projectId) {
      throw new Error('Checkpoint snapshot belongs to another project')
    }
    const currentHead = await resolveHead(gitdir)
    const expectedParent =
      input.parentOid === undefined ? currentHead : checkpointOidSchema.parse(input.parentOid)
    if (input.parentOid !== undefined && currentHead !== expectedParent) {
      throw new Error('Checkpoint parent is stale')
    }
    const createdAt = new Date().toISOString()
    const statistics = await directoryStats(snapshotRoot)
    const checkpoint = checkpointManifestSchema.parse({
      format: 'writellm-checkpoint',
      formatVersion: PROJECT_CHECKPOINT_FORMAT_VERSION,
      projectId: this.#projectId,
      stateSha256: stateSha256(snapshot),
      name,
      ...(note === undefined ? {} : { note }),
      createdAt,
      ...statistics
    })
    await writeFile(
      join(snapshotRoot, PROJECT_CHECKPOINT_MANIFEST_FILE),
      `${JSON.stringify(checkpoint, null, 2)}\n`,
      { mode: 0o600, flag: 'wx' }
    )
    const tree = await writeDirectoryTree(gitdir, snapshotRoot)
    const timestamp = Math.floor(new Date(createdAt).getTime() / 1_000)
    const identity = { ...AUTHOR, timestamp, timezoneOffset: new Date().getTimezoneOffset() }
    const oid = await writeCommit({
      fs,
      gitdir,
      commit: {
        tree,
        parent: expectedParent === null ? [] : [expectedParent],
        author: identity,
        committer: identity,
        message: `${name}\n`
      }
    })
    await this.#beforeAdvanceRef?.()
    const headBeforeAdvance = await resolveHead(gitdir)
    if (headBeforeAdvance !== expectedParent)
      throw new Error('Checkpoint head changed unexpectedly')
    await writeRef({ fs, gitdir, ref: MAIN_REF, value: oid, force: true })
    const result = await checkpointEntry(gitdir, oid)
    this.#log.info(
      {
        event: 'project_history.checkpoint_created',
        projectId: this.#projectId,
        checkpointOid: oid,
        parentOid: expectedParent,
        fileCount: result.fileCount,
        totalBytes: result.totalBytes
      },
      'Project checkpoint created'
    )
    return result
  }
}
