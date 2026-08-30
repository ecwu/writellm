import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, posix } from 'node:path'
import type { Logger } from 'pino'
import { parse as parseYaml } from 'yaml'
import {
  inspectGithubSkillResultSchema,
  installedSkillSchema,
  SKILL_MAX_ENTRYPOINT_BYTES,
  SKILL_MAX_FILES,
  SKILL_MAX_REFERENCE_BYTES,
  SKILL_MAX_TOTAL_BYTES,
  skillCommitSchema,
  skillDirectorySchema,
  skillIdSchema,
  skillManifestFileSchema,
  skillNameSchema,
  skillRelativePathSchema,
  skillRepositorySchema,
  skillsSnapshotSchema,
  type InspectGithubSkillInput,
  type InspectGithubSkillResult,
  type InstalledSkill,
  type SkillManifestFile,
  type SkillsSnapshot,
  type SkillUpdateResult
} from '../../shared/contracts/skills'
import type { AgentSkillTable } from '../app-db/database-types'
import type { AppDatabase } from '../app-db/connection'
import {
  CURATED_SKILL_CATALOG,
  type CuratedSkillCatalogEntry,
  type CuratedSkillFile,
  validateCuratedSkillCatalog
} from './catalog'
import { formatWriteLlmSkill, virtualSkillPath, type WriteLlmSkill } from './prompt'
import { loadManifestSkillWithPi } from './native-loader'

const INSPECTION_TTL_MS = 15 * 60 * 1_000
const GITHUB_JSON_MAX_BYTES = 8 * 1_024 * 1_024
const MANIFEST_VERSION = 1

interface DownloadedFile extends SkillManifestFile {
  bytes: Buffer
}

interface SkillPackage {
  skillId: string
  source: 'curated' | 'github'
  catalogId: string | null
  repository: string
  directory: string
  commit: string
  displayName: string
  license: string | null
  dependencies: readonly string[]
  name: string
  description: string
  body: string
  disableModelInvocation: boolean
  files: readonly DownloadedFile[]
}

interface SkillPublishState {
  package: SkillPackage
  stage: string
  target: string
  prior: string | null
  priorMoved: boolean
  published: boolean
}

export interface SkillServiceFaults {
  beforePublishRename?: (skillId: string) => void | Promise<void>
}

interface InspectionRecord {
  expiresAt: number
  value: InspectGithubSkillResult
  package: SkillPackage
}

interface StoredManifest {
  version: 1
  skillId: string
  source: 'curated' | 'github'
  repository: string
  directory: string
  commit: string
  dependencies: readonly string[]
  files: readonly SkillManifestFile[]
}

interface GitHubTreeItem {
  path: string
  mode: string
  type: string
  sha: string
  size?: number
}

export class SkillServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'SkillServiceError'
  }
}

export class SkillService {
  readonly #inspections = new Map<string, InspectionRecord>()
  readonly #operations = new Map<string, AbortController>()
  readonly #listeners = new Set<(revision: number) => void>()
  #revision = 0

  constructor(
    private readonly database: AppDatabase,
    private readonly root: string,
    private readonly log: Logger,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly faults: SkillServiceFaults = {}
  ) {
    validateCuratedSkillCatalog()
  }

  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true })
    await this.revalidateInstalled()
  }

  /** Silent-E2E bootstrap only. No Renderer or IPC surface reaches this method. */
  async installE2eFixture(input: {
    repository: string
    directory: string
    commit: string
    license: string | null
    files: readonly { path: string; bytes: Buffer }[]
  }): Promise<void> {
    const repository = skillRepositorySchema.parse(input.repository)
    const directory = skillDirectorySchema.parse(input.directory)
    const commit = skillCommitSchema.parse(input.commit)
    if (input.files.length === 0 || input.files.length > SKILL_MAX_FILES) {
      throw new SkillServiceError('skill_file_limit', 'E2E skill fixture has an invalid file count')
    }
    const files: DownloadedFile[] = input.files.map((file) => {
      const path = skillRelativePathSchema.parse(file.path)
      const limit = path === 'SKILL.md' ? SKILL_MAX_ENTRYPOINT_BYTES : SKILL_MAX_REFERENCE_BYTES
      if (file.bytes.byteLength === 0 || file.bytes.byteLength > limit) {
        throw new SkillServiceError('skill_file_limit', `${path} exceeds its byte limit`)
      }
      decodeUtf8(file.bytes)
      return {
        path,
        byteSize: file.bytes.byteLength,
        gitBlobSha: gitBlobSha(file.bytes),
        sha256: sha256(file.bytes),
        bytes: file.bytes
      }
    })
    if (new Set(files.map((file) => file.path)).size !== files.length) {
      throw new SkillServiceError('skill_file_limit', 'E2E skill fixture repeats a file')
    }
    if (files.reduce((sum, file) => sum + file.byteSize, 0) > SKILL_MAX_TOTAL_BYTES) {
      throw new SkillServiceError('skill_total_limit', 'E2E skill fixture exceeds the total limit')
    }
    const parsed = parseEntrypoint(files, basenameForSkill(directory, repository))
    const skillId = `github:${sha256(Buffer.from(`${repository}/${directory}`)).slice(0, 16)}`
    const formattedBytes = Buffer.byteLength(
      formatWriteLlmSkill({
        name: parsed.name,
        description: parsed.description,
        content: parsed.body,
        filePath: virtualSkillPath(skillId, commit),
        ...(parsed.disableModelInvocation ? { disableModelInvocation: true } : {})
      })
    )
    if (formattedBytes > SKILL_MAX_ENTRYPOINT_BYTES) {
      throw new SkillServiceError(
        'skill_entrypoint_limit',
        'E2E skill fixture exceeds the prompt limit'
      )
    }
    await this.#publish([
      {
        skillId,
        source: 'github',
        catalogId: null,
        repository,
        directory,
        commit,
        displayName: parsed.name,
        license: input.license,
        dependencies: [],
        ...parsed,
        files
      }
    ])
  }

  subscribe(listener: (revision: number) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  cancelOperation(operationId: string): void {
    this.#operations.get(operationId)?.abort()
  }

  snapshot(): SkillsSnapshot {
    const rows = this.#rows()
    const byId = new Map(rows.map((row) => [row.skill_id, row]))
    const installed = rows.map((row) => this.#toInstalled(row))
    return skillsSnapshotSchema.parse({
      available: CURATED_SKILL_CATALOG.map((entry) => ({
        skillId: entry.skillId,
        displayName: entry.displayName,
        description: entry.description,
        repository: entry.repository,
        directory: entry.directory,
        commit: entry.commit,
        license: entry.license,
        dependencies: entry.dependencies,
        installed: byId.has(entry.skillId),
        updateAvailable:
          byId.has(entry.skillId) && byId.get(entry.skillId)?.commit_sha !== entry.commit
      })),
      installed,
      revision: this.#revision
    })
  }

  async inspectGithub(
    rawInput: InspectGithubSkillInput,
    operationId: string = randomUUID()
  ): Promise<InspectGithubSkillResult> {
    const input = {
      repository: skillRepositorySchema.parse(rawInput.repository),
      directory: skillDirectorySchema.parse(rawInput.directory)
    }
    return this.#runOperation(operationId, 'skill.inspect', async (signal) => {
      const repository = await this.#githubJson<{
        default_branch?: unknown
        license?: { spdx_id?: unknown } | null
      }>(`/repos/${input.repository}`, signal)
      if (typeof repository.default_branch !== 'string' || repository.default_branch.length > 255) {
        throw new SkillServiceError('skill_github_invalid', 'GitHub repository metadata is invalid')
      }
      const commitResponse = await this.#githubJson<{ sha?: unknown }>(
        `/repos/${input.repository}/commits/${encodeURIComponent(repository.default_branch)}`,
        signal
      )
      const commit = skillCommitSchema.parse(commitResponse.sha)
      const license = normalizeLicense(repository.license?.spdx_id)
      const prepared = await this.#prepareCustom(
        input.repository,
        input.directory,
        commit,
        license,
        signal
      )
      const inspectionId = randomUUID()
      const value = inspectGithubSkillResultSchema.parse({
        inspectionId,
        repository: input.repository,
        directory: input.directory,
        commit,
        name: prepared.name,
        description: prepared.description,
        disableModelInvocation: prepared.disableModelInvocation,
        license,
        licenseStatus: license === null ? 'not_detected' : 'declared',
        fileCount: prepared.files.length,
        totalBytes: prepared.files.reduce((sum, file) => sum + file.byteSize, 0),
        files: prepared.files.map((file) => file.path)
      })
      this.#inspections.set(inspectionId, {
        expiresAt: Date.now() + INSPECTION_TTL_MS,
        value,
        package: prepared
      })
      this.#pruneInspections()
      return value
    })
  }

  async installCurated(
    skillId: string,
    operationId: string = randomUUID()
  ): Promise<SkillsSnapshot> {
    const entry = CURATED_SKILL_CATALOG.find((candidate) => candidate.skillId === skillId)
    if (entry === undefined)
      throw new SkillServiceError('skill_not_found', 'Curated skill not found')
    return this.#runOperation(operationId, 'skill.install', async (signal) => {
      const packages: SkillPackage[] = []
      for (const candidate of dependencyClosure(entry)) {
        packages.push(await this.#prepareCurated(candidate, signal))
      }
      await this.#publish(packages)
      return this.snapshot()
    })
  }

  async installInspected(inspectionId: string): Promise<SkillsSnapshot> {
    this.#pruneInspections()
    const inspection = this.#inspections.get(inspectionId)
    if (inspection === undefined) {
      throw new SkillServiceError(
        'skill_inspection_expired',
        'GitHub inspection expired; inspect the skill again'
      )
    }
    await this.#publish([inspection.package])
    this.#inspections.delete(inspectionId)
    return this.snapshot()
  }

  setEnabled(skillId: string, enabled: boolean, cascade: boolean): SkillsSnapshot {
    const row = this.#requireRow(skillId)
    const affected = this.#dependentRows(skillId)
    if (!enabled && affected.length > 0 && !cascade) {
      throw new SkillServiceError(
        'skill_dependency_confirmation_required',
        `Disable dependent skills first: ${affected.map((item) => item.display_name).join(', ')}`
      )
    }
    const enableIds = enabled ? this.#dependencyIds(row) : []
    this.database.immediate((native) => {
      const update = native.prepare(
        'UPDATE agent_skills SET enabled = ?, updated_at = ? WHERE skill_id = ?'
      )
      const now = new Date().toISOString()
      update.run(enabled ? 1 : 0, now, skillId)
      if (!enabled) for (const dependent of affected) update.run(0, now, dependent.skill_id)
      if (enabled) for (const dependencyId of enableIds) update.run(1, now, dependencyId)
    })
    this.#changed()
    return this.snapshot()
  }

  async checkUpdate(
    skillId: string,
    operationId: string = randomUUID()
  ): Promise<SkillUpdateResult> {
    const row = this.#requireRow(skillId)
    if (row.source_kind === 'curated') {
      const entry = CURATED_SKILL_CATALOG.find((candidate) => candidate.skillId === skillId)
      if (entry === undefined) {
        throw new SkillServiceError('skill_catalog_removed', 'Curated skill is not in this catalog')
      }
      this.#setChecked(skillId)
      return {
        skillId,
        available: entry.commit !== row.commit_sha,
        kind: entry.commit === row.commit_sha ? null : 'reviewed',
        currentCommit: row.commit_sha,
        nextCommit: entry.commit === row.commit_sha ? null : entry.commit
      }
    }
    return this.#runOperation(operationId, 'skill.update_check', async (signal) => {
      const repository = await this.#githubJson<{ default_branch?: unknown }>(
        `/repos/${row.repository}`,
        signal
      )
      if (typeof repository.default_branch !== 'string') {
        throw new SkillServiceError('skill_github_invalid', 'GitHub repository metadata is invalid')
      }
      const latest = await this.#githubJson<{ sha?: unknown }>(
        `/repos/${row.repository}/commits/${encodeURIComponent(repository.default_branch)}`,
        signal
      )
      const commit = skillCommitSchema.parse(latest.sha)
      this.#setChecked(skillId)
      return {
        skillId,
        available: commit !== row.commit_sha,
        kind: commit === row.commit_sha ? null : 'unreviewed',
        currentCommit: row.commit_sha,
        nextCommit: commit === row.commit_sha ? null : commit
      }
    })
  }

  async update(
    skillId: string,
    confirmUnreviewed: boolean,
    operationId: string = randomUUID()
  ): Promise<SkillsSnapshot> {
    const row = this.#requireRow(skillId)
    if (row.integrity_status !== 'ready') return this.reinstall(skillId, operationId)
    if (row.source_kind === 'curated') return this.installCurated(skillId, operationId)
    if (!confirmUnreviewed) {
      throw new SkillServiceError(
        'skill_unreviewed_confirmation_required',
        'Custom skill updates are not reviewed by WriteLLM'
      )
    }
    return this.#runOperation(operationId, 'skill.update', async (signal) => {
      const repository = await this.#githubJson<{
        default_branch?: unknown
        license?: { spdx_id?: unknown } | null
      }>(`/repos/${row.repository}`, signal)
      if (typeof repository.default_branch !== 'string') {
        throw new SkillServiceError('skill_github_invalid', 'GitHub repository metadata is invalid')
      }
      const latest = await this.#githubJson<{ sha?: unknown }>(
        `/repos/${row.repository}/commits/${encodeURIComponent(repository.default_branch)}`,
        signal
      )
      const commit = skillCommitSchema.parse(latest.sha)
      if (commit === row.commit_sha) return this.snapshot()
      const prepared = await this.#prepareCustom(
        row.repository,
        row.directory,
        commit,
        normalizeLicense(repository.license?.spdx_id),
        signal,
        row.skill_id
      )
      await this.#publish([prepared])
      return this.snapshot()
    })
  }

  async reinstall(skillId: string, operationId: string = randomUUID()): Promise<SkillsSnapshot> {
    const row = this.#requireRow(skillId)
    if (row.source_kind === 'curated') return this.installCurated(skillId, operationId)
    return this.#runOperation(operationId, 'skill.reinstall', async (signal) => {
      const prepared = await this.#prepareCustom(
        row.repository,
        row.directory,
        row.commit_sha,
        row.license_spdx,
        signal,
        row.skill_id
      )
      await this.#publish([prepared])
      return this.snapshot()
    })
  }

  async uninstall(skillId: string, cascade: boolean): Promise<SkillsSnapshot> {
    const row = this.#requireRow(skillId)
    const dependents = this.#dependentRows(skillId)
    if (dependents.length > 0 && !cascade) {
      throw new SkillServiceError(
        'skill_dependency_confirmation_required',
        `Uninstall dependent skills first: ${dependents.map((item) => item.display_name).join(', ')}`
      )
    }
    const rows = [row, ...(cascade ? dependents : [])]
    this.database.immediate((native) => {
      const remove = native.prepare('DELETE FROM agent_skills WHERE skill_id = ?')
      for (const item of rows) remove.run(item.skill_id)
    })
    for (const item of rows) {
      try {
        await rm(this.#skillDirectory(item.skill_id), { recursive: true, force: true })
      } catch (err) {
        this.log.error(
          { event: 'skill.uninstall.files_failed', err, skillId: item.skill_id },
          'Failed to remove installed skill files'
        )
      }
    }
    this.#changed()
    return this.snapshot()
  }

  async revalidateInstalled(): Promise<void> {
    let changed = false
    for (const row of this.#rows()) {
      let status: AgentSkillTable['integrity_status'] = 'ready'
      try {
        const manifest = parseStoredManifest(row.manifest_json)
        for (const file of manifest.files) {
          const path = this.#filePath(row.skill_id, row.commit_sha, file.path)
          const info = await stat(path)
          if (!info.isFile() || info.size !== file.byteSize) {
            status = 'missing_files'
            break
          }
          const bytes = await readFile(path)
          if (sha256(bytes) !== file.sha256 || gitBlobSha(bytes) !== file.gitBlobSha) {
            status = 'integrity_failed'
            break
          }
        }
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        status = code === 'ENOENT' ? 'missing_files' : 'integrity_failed'
        this.log.warn(
          { event: 'skill.integrity.failed', err, skillId: row.skill_id, integrityStatus: status },
          'Installed skill failed integrity validation'
        )
      }
      if (status !== row.integrity_status) {
        changed = true
        this.database.immediate((native) =>
          native
            .prepare(
              'UPDATE agent_skills SET integrity_status = ?, updated_at = ? WHERE skill_id = ?'
            )
            .run(status, new Date().toISOString(), row.skill_id)
        )
      }
    }
    if (changed) this.#changed()
  }

  async loadEnabled(): Promise<WriteLlmSkill[]> {
    const rows = this.#rows().filter((row) => row.enabled === 1 && row.integrity_status === 'ready')
    const skills: WriteLlmSkill[] = []
    let demoted = false
    for (const row of rows) {
      try {
        skills.push(await this.#load(row))
      } catch (err) {
        // One tampered skill must not reject the whole load; demote it so the remaining
        // enabled skills keep working and open Renderers learn about the demotion.
        demoted = true
        this.#demote(row, err)
      }
    }
    if (demoted) this.#changed()
    return skills
  }

  async loadById(skillId: string): Promise<WriteLlmSkill> {
    const row = this.#requireRow(skillId)
    if (row.enabled !== 1 || row.integrity_status !== 'ready') {
      throw new SkillServiceError('skill_unavailable', 'Writing skill is disabled or unavailable')
    }
    try {
      return await this.#load(row)
    } catch (err) {
      this.#demote(row, err)
      this.#changed()
      throw err
    }
  }

  async loadVersion(skillId: string, commit: string): Promise<WriteLlmSkill> {
    const row = this.#requireRow(skillId)
    if (row.enabled !== 1) {
      throw new SkillServiceError(
        'skill_version_unavailable',
        'The recorded writing skill is disabled'
      )
    }
    let manifest: StoredManifest
    try {
      manifest = parseStoredManifest(
        await readFile(
          join(this.#skillDirectory(skillId), skillCommitSchema.parse(commit), 'manifest.json'),
          'utf8'
        )
      )
    } catch (err) {
      throw new SkillServiceError(
        'skill_version_unavailable',
        'The recorded writing skill version is no longer installed',
        { cause: err }
      )
    }
    if (manifest.skillId !== skillId || manifest.commit !== commit) {
      throw new SkillServiceError(
        'skill_version_unavailable',
        'The recorded writing skill manifest does not match the requested version'
      )
    }
    return this.#loadManifest(manifest, row.license_spdx, row.display_name)
  }

  async readResource(skill: WriteLlmSkill, relativePath: string): Promise<string> {
    const file = skill.files.find((candidate) => candidate.path === relativePath)
    if (file === undefined || relativePath === 'SKILL.md') {
      throw new SkillServiceError('skill_resource_not_found', 'Writing skill resource not found')
    }
    const bytes = await readFile(this.#filePath(skill.skillId, skill.commit, relativePath))
    if (
      bytes.byteLength !== file.byteSize ||
      sha256(bytes) !== file.sha256 ||
      gitBlobSha(bytes) !== file.gitBlobSha
    ) {
      const err = new SkillServiceError(
        'skill_integrity_failed',
        'Writing skill resource failed integrity check'
      )
      const row = this.#rows().find(
        (candidate) => candidate.skill_id === skill.skillId && candidate.commit_sha === skill.commit
      )
      if (row !== undefined) {
        this.#demote(row, err)
        this.#changed()
      }
      throw err
    }
    return decodeUtf8(bytes)
  }

  async #load(row: AgentSkillTable): Promise<WriteLlmSkill> {
    const manifest = parseStoredManifest(row.manifest_json)
    return this.#loadManifest(manifest, row.license_spdx, row.display_name)
  }

  async #loadManifest(
    manifest: StoredManifest,
    license: string | null,
    displayName: string
  ): Promise<WriteLlmSkill> {
    const entry = manifest.files.find((file) => file.path === 'SKILL.md')
    if (entry === undefined)
      throw new SkillServiceError('skill_manifest_invalid', 'SKILL.md is missing')
    const bytes = await readFile(this.#filePath(manifest.skillId, manifest.commit, entry.path))
    if (
      bytes.byteLength !== entry.byteSize ||
      sha256(bytes) !== entry.sha256 ||
      gitBlobSha(bytes) !== entry.gitBlobSha
    ) {
      throw new SkillServiceError('skill_integrity_failed', 'Writing skill failed integrity check')
    }
    const document = decodeUtf8(bytes)
    const parsed = parseSkillDocument(
      document,
      basenameForSkill(manifest.directory, manifest.repository)
    )
    const virtualUri = virtualSkillPath(manifest.skillId, manifest.commit)
    const native = await loadManifestSkillWithPi({
      name: parsed.name,
      document,
      virtualUri
    })
    if (
      native.name !== parsed.name ||
      native.description !== parsed.description ||
      native.content !== parsed.body
    ) {
      throw new SkillServiceError('skill_manifest_invalid', 'Pi parsed inconsistent skill metadata')
    }
    return {
      skillId: manifest.skillId,
      displayName,
      name: parsed.name,
      description: parsed.description,
      content: parsed.body,
      filePath: virtualUri,
      ...(parsed.disableModelInvocation ? { disableModelInvocation: true } : {}),
      commit: manifest.commit,
      license,
      source: manifest.source,
      dependencies: manifest.dependencies,
      files: manifest.files
    }
  }

  async #prepareCurated(
    entry: CuratedSkillCatalogEntry,
    signal: AbortSignal
  ): Promise<SkillPackage> {
    const tree = await this.#tree(entry.repository, entry.commit, signal)
    const prefix = `${entry.directory}/`
    const treeByPath = new Map(tree.map((item) => [item.path, item]))
    const files: DownloadedFile[] = []
    for (const expected of entry.files) {
      const item = treeByPath.get(`${prefix}${expected.path}`)
      assertTreeFile(item, expected)
      files.push(
        await this.#downloadFile(
          entry.repository,
          entry.commit,
          `${entry.directory}/${expected.path}`,
          expected,
          signal
        )
      )
    }
    const parsed = parseEntrypoint(files, basename(entry.directory))
    return {
      skillId: entry.skillId,
      source: 'curated',
      catalogId: entry.skillId,
      repository: entry.repository,
      directory: entry.directory,
      commit: entry.commit,
      displayName: entry.displayName,
      license: entry.license,
      dependencies: entry.dependencies,
      ...parsed,
      files
    }
  }

  async #prepareCustom(
    repository: string,
    directory: string,
    commit: string,
    license: string | null,
    signal: AbortSignal,
    existingSkillId?: string
  ): Promise<SkillPackage> {
    const tree = await this.#tree(repository, commit, signal)
    const prefix = directory === '.' ? '' : `${directory}/`
    const selected = tree
      .filter(
        (item) =>
          item.type === 'blob' &&
          item.mode === '100644' &&
          item.path.startsWith(prefix) &&
          !item.path.slice(prefix.length).includes('/.git/')
      )
      .map((item) => ({ ...item, relativePath: item.path.slice(prefix.length) }))
      .filter((item) => /\.(?:md|txt)$/i.test(item.relativePath))
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath))
    if (selected.length === 0 || !selected.some((item) => item.relativePath === 'SKILL.md')) {
      throw new SkillServiceError('skill_entrypoint_missing', 'Selected directory has no SKILL.md')
    }
    if (selected.length > SKILL_MAX_FILES) {
      throw new SkillServiceError(
        'skill_file_limit',
        `Skill exceeds the ${SKILL_MAX_FILES}-file limit`
      )
    }
    let totalBytes = 0
    for (const item of selected) {
      if (!Number.isSafeInteger(item.size) || (item.size ?? 0) < 1) {
        throw new SkillServiceError('skill_tree_invalid', 'GitHub tree has an invalid file size')
      }
      const limit =
        item.relativePath === 'SKILL.md' ? SKILL_MAX_ENTRYPOINT_BYTES : SKILL_MAX_REFERENCE_BYTES
      if ((item.size ?? 0) > limit) {
        throw new SkillServiceError(
          item.relativePath === 'SKILL.md' ? 'skill_entrypoint_limit' : 'skill_reference_limit',
          `${item.relativePath} exceeds its byte limit`
        )
      }
      totalBytes += item.size ?? 0
    }
    if (totalBytes > SKILL_MAX_TOTAL_BYTES) {
      throw new SkillServiceError('skill_total_limit', 'Skill exceeds the 48 KiB text limit')
    }
    const files: DownloadedFile[] = []
    for (const item of selected) {
      files.push(
        await this.#downloadFile(
          repository,
          commit,
          item.path,
          { path: item.relativePath, byteSize: item.size ?? 0, gitBlobSha: item.sha },
          signal
        )
      )
    }
    const directoryName = basenameForSkill(directory, repository)
    const parsed = parseEntrypoint(files, directoryName)
    const skillId =
      existingSkillId ?? `github:${sha256(Buffer.from(`${repository}/${directory}`)).slice(0, 16)}`
    const formattedBytes = Buffer.byteLength(
      formatWriteLlmSkill({
        name: parsed.name,
        description: parsed.description,
        content: parsed.body,
        filePath: virtualSkillPath(skillId, commit),
        ...(parsed.disableModelInvocation ? { disableModelInvocation: true } : {})
      })
    )
    if (formattedBytes > SKILL_MAX_ENTRYPOINT_BYTES) {
      throw new SkillServiceError(
        'skill_entrypoint_limit',
        'Formatted SKILL.md exceeds the 24 KiB prompt limit'
      )
    }
    return {
      skillId,
      source: 'github',
      catalogId: null,
      repository,
      directory,
      commit,
      displayName: parsed.name,
      license,
      dependencies: [],
      ...parsed,
      files
    }
  }

  async #publish(packages: readonly SkillPackage[]): Promise<void> {
    const staged: SkillPublishState[] = []
    await mkdir(this.root, { recursive: true })
    try {
      for (const skillPackage of packages) {
        const parent = this.#skillDirectory(skillPackage.skillId)
        await mkdir(parent, { recursive: true })
        const stage = join(parent, `.install-${randomUUID()}`)
        await mkdir(stage, { recursive: false })
        const state: SkillPublishState = {
          package: skillPackage,
          stage,
          target: join(parent, skillPackage.commit),
          prior: null,
          priorMoved: false,
          published: false
        }
        staged.push(state)
        for (const file of skillPackage.files) {
          const destination = join(stage, ...file.path.split('/'))
          await mkdir(dirname(destination), { recursive: true })
          await writeFile(destination, file.bytes, { flag: 'wx', mode: 0o600 })
        }
        const manifest = storedManifest(skillPackage)
        await writeFile(join(stage, 'manifest.json'), JSON.stringify(manifest), {
          flag: 'wx',
          mode: 0o600
        })
        state.prior = await existingPriorPath(state.target, parent)
        if (state.prior !== null) {
          await rename(state.target, state.prior)
          state.priorMoved = true
        }
        await this.faults.beforePublishRename?.(skillPackage.skillId)
        await rename(stage, state.target)
        state.published = true
      }

      this.database.immediate((native) => {
        const statement = native.prepare(`
          INSERT INTO agent_skills (
            skill_id, source_kind, catalog_id, repository, directory, commit_sha,
            name, description, display_name, license_spdx, enabled,
            disable_model_invocation, integrity_status, manifest_json,
            installed_at, last_checked_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'ready', ?, ?, ?, ?, ?)
          ON CONFLICT(skill_id) DO UPDATE SET
            source_kind = excluded.source_kind,
            catalog_id = excluded.catalog_id,
            repository = excluded.repository,
            directory = excluded.directory,
            commit_sha = excluded.commit_sha,
            name = excluded.name,
            description = excluded.description,
            display_name = excluded.display_name,
            license_spdx = excluded.license_spdx,
            enabled = agent_skills.enabled,
            disable_model_invocation = excluded.disable_model_invocation,
            integrity_status = 'ready',
            manifest_json = excluded.manifest_json,
            installed_at = excluded.installed_at,
            last_checked_at = excluded.last_checked_at,
            updated_at = excluded.updated_at
        `)
        const now = new Date().toISOString()
        for (const { package: skillPackage } of staged) {
          statement.run(
            skillPackage.skillId,
            skillPackage.source,
            skillPackage.catalogId,
            skillPackage.repository,
            skillPackage.directory,
            skillPackage.commit,
            skillPackage.name,
            skillPackage.description,
            skillPackage.displayName,
            skillPackage.license,
            skillPackage.disableModelInvocation ? 1 : 0,
            JSON.stringify(storedManifest(skillPackage)),
            now,
            now,
            now,
            now
          )
        }
      })
    } catch (err) {
      this.log.error(
        { event: 'skill.install.failed', err, skillIds: packages.map((item) => item.skillId) },
        'Writing skill installation failed'
      )
      await this.#rollbackPublish(staged)
      throw new SkillServiceError('skill_install_failed', 'Writing skill installation failed', {
        cause: err
      })
    }
    for (const item of staged) {
      if (item.prior === null) continue
      try {
        await rm(item.prior, { recursive: true, force: true })
      } catch (err) {
        this.log.warn(
          { event: 'skill.install.prior_cleanup_failed', err, skillId: item.package.skillId },
          'Installed skill but could not remove its prior file generation'
        )
      }
    }
    this.log.info(
      {
        event: 'skill.install.completed',
        skillIds: packages.map((item) => item.skillId),
        fileCount: packages.reduce((sum, item) => sum + item.files.length, 0)
      },
      'Writing skills installed'
    )
    this.#changed()
  }

  async #rollbackPublish(staged: readonly SkillPublishState[]): Promise<void> {
    for (const item of staged.toReversed()) {
      await this.#rollbackStep(item, 'stage', () =>
        rm(item.stage, { recursive: true, force: true })
      )
      if (item.published) {
        await this.#rollbackStep(item, 'published_target', () =>
          rm(item.target, { recursive: true, force: true })
        )
      }
      if (item.priorMoved && item.prior !== null) {
        const prior = item.prior
        await this.#rollbackStep(item, 'prior_generation', () => rename(prior, item.target))
      }
    }
  }

  async #rollbackStep(
    item: SkillPublishState,
    step: 'stage' | 'published_target' | 'prior_generation',
    rollback: () => Promise<unknown>
  ): Promise<void> {
    try {
      await rollback()
    } catch (err) {
      this.log.error(
        { event: 'skill.install.rollback_failed', err, skillId: item.package.skillId, step },
        'Writing skill installation rollback step failed'
      )
    }
  }

  async #tree(repository: string, commit: string, signal: AbortSignal): Promise<GitHubTreeItem[]> {
    const tree = await this.#githubJson<{ truncated?: unknown; tree?: unknown }>(
      `/repos/${repository}/git/trees/${commit}?recursive=1`,
      signal
    )
    if (tree.truncated === true) {
      throw new SkillServiceError(
        'skill_tree_truncated',
        'GitHub returned a truncated repository tree'
      )
    }
    if (!Array.isArray(tree.tree) || tree.tree.length > 100_000) {
      throw new SkillServiceError('skill_tree_invalid', 'GitHub repository tree is invalid')
    }
    return tree.tree.map((raw) => {
      if (
        typeof raw !== 'object' ||
        raw === null ||
        !('path' in raw) ||
        !('mode' in raw) ||
        !('type' in raw) ||
        !('sha' in raw) ||
        typeof raw.path !== 'string' ||
        typeof raw.mode !== 'string' ||
        typeof raw.type !== 'string' ||
        typeof raw.sha !== 'string'
      ) {
        throw new SkillServiceError('skill_tree_invalid', 'GitHub repository tree is invalid')
      }
      const size = 'size' in raw && typeof raw.size === 'number' ? raw.size : undefined
      return {
        path: raw.path,
        mode: raw.mode,
        type: raw.type,
        sha: raw.sha,
        ...(size === undefined ? {} : { size })
      }
    })
  }

  async #downloadFile(
    repository: string,
    commit: string,
    repositoryPath: string,
    expected: CuratedSkillFile,
    signal: AbortSignal
  ): Promise<DownloadedFile> {
    const path = skillRelativePathSchema.parse(expected.path)
    const encodedPath = repositoryPath.split('/').map(encodeURIComponent).join('/')
    const response = await this.fetchImpl(
      `https://raw.githubusercontent.com/${repository}/${commit}/${encodedPath}`,
      { signal, headers: { Accept: 'text/plain', 'User-Agent': 'WriteLLM' } }
    )
    if (!response.ok) throw githubHttpError(response)
    const bytes = Buffer.from(await readResponseBytes(response, expected.byteSize))
    if (bytes.byteLength !== expected.byteSize || gitBlobSha(bytes) !== expected.gitBlobSha) {
      throw new SkillServiceError(
        'skill_hash_mismatch',
        'Downloaded skill file failed git hash validation'
      )
    }
    decodeUtf8(bytes)
    const metadata = skillManifestFileSchema.parse({
      path,
      byteSize: bytes.byteLength,
      gitBlobSha: expected.gitBlobSha,
      sha256: sha256(bytes)
    })
    return { ...metadata, bytes }
  }

  async #githubJson<T>(path: string, signal: AbortSignal): Promise<T> {
    const response = await this.fetchImpl(`https://api.github.com${path}`, {
      signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'WriteLLM'
      }
    })
    if (!response.ok) throw githubHttpError(response)
    const bytes = await readResponseBytes(response, GITHUB_JSON_MAX_BYTES)
    try {
      return JSON.parse(decodeUtf8(bytes)) as T
    } catch (err) {
      throw new SkillServiceError('skill_github_invalid', 'GitHub returned invalid JSON', {
        cause: err
      })
    }
  }

  async #runOperation<T>(
    operationId: string,
    event: string,
    operation: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    if (this.#operations.has(operationId)) {
      throw new SkillServiceError('skill_operation_duplicate', 'Skill operation is already running')
    }
    const controller = new AbortController()
    this.#operations.set(operationId, controller)
    const startedAt = Date.now()
    this.log.info({ event: `${event}.started`, operationId }, 'Writing skill operation started')
    try {
      const result = await operation(controller.signal)
      this.log.info(
        { event: `${event}.completed`, operationId, durationMs: Date.now() - startedAt },
        'Writing skill operation completed'
      )
      return result
    } catch (err) {
      this.log.error(
        { event: `${event}.failed`, err, operationId, durationMs: Date.now() - startedAt },
        'Writing skill operation failed'
      )
      throw err
    } finally {
      this.#operations.delete(operationId)
    }
  }

  #rows(): AgentSkillTable[] {
    return this.database.immediate((native) =>
      native.prepare('SELECT * FROM agent_skills ORDER BY name, skill_id').all()
    ) as AgentSkillTable[]
  }

  #requireRow(skillId: string): AgentSkillTable {
    const row = this.database.immediate((native) =>
      native.prepare('SELECT * FROM agent_skills WHERE skill_id = ?').get(skillId)
    ) as AgentSkillTable | undefined
    if (row === undefined)
      throw new SkillServiceError('skill_not_installed', 'Writing skill is not installed')
    return row
  }

  #toInstalled(row: AgentSkillTable): InstalledSkill {
    const manifest = parseStoredManifest(row.manifest_json)
    const catalog = CURATED_SKILL_CATALOG.find((entry) => entry.skillId === row.skill_id)
    const updateAvailable = catalog !== undefined && catalog.commit !== row.commit_sha
    const displayStatus =
      row.integrity_status === 'missing_files'
        ? 'unavailable_missing_files'
        : row.integrity_status === 'integrity_failed'
          ? 'unavailable_integrity_failed'
          : row.enabled === 0
            ? 'disabled'
            : 'ready'
    return installedSkillSchema.parse({
      skillId: row.skill_id,
      displayName: row.display_name,
      name: row.name,
      description: row.description,
      source: row.source_kind,
      repository: row.repository,
      directory: row.directory,
      commit: row.commit_sha,
      license: row.license_spdx,
      enabled: row.enabled === 1,
      disableModelInvocation: row.disable_model_invocation === 1,
      integrityStatus: row.integrity_status,
      displayStatus,
      dependencies: manifest.dependencies,
      fileCount: manifest.files.length,
      totalBytes: manifest.files.reduce((sum, file) => sum + file.byteSize, 0),
      installedAt: row.installed_at,
      checkedAt: row.last_checked_at,
      updateAvailable,
      updateKind: updateAvailable ? 'reviewed' : null
    })
  }

  #dependencyIds(row: AgentSkillTable): string[] {
    const manifest = parseStoredManifest(row.manifest_json)
    return manifest.dependencies.flatMap((id) => [id, ...this.#dependencyIds(this.#requireRow(id))])
  }

  #dependentRows(skillId: string): AgentSkillTable[] {
    return this.#rows().filter((row) =>
      parseStoredManifest(row.manifest_json).dependencies.includes(skillId)
    )
  }

  #setChecked(skillId: string): void {
    this.database.immediate((native) =>
      native
        .prepare('UPDATE agent_skills SET last_checked_at = ?, updated_at = ? WHERE skill_id = ?')
        .run(new Date().toISOString(), new Date().toISOString(), skillId)
    )
    this.#changed()
  }

  #demote(row: AgentSkillTable, err: unknown): void {
    const status: AgentSkillTable['integrity_status'] =
      (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing_files' : 'integrity_failed'
    if (status === row.integrity_status) return
    this.log.warn(
      { event: 'skill.integrity.failed', err, skillId: row.skill_id, integrityStatus: status },
      'Installed skill failed integrity validation'
    )
    this.database.immediate((native) =>
      native
        .prepare('UPDATE agent_skills SET integrity_status = ?, updated_at = ? WHERE skill_id = ?')
        .run(status, new Date().toISOString(), row.skill_id)
    )
  }

  #skillDirectory(skillId: string): string {
    return join(this.root, encodeURIComponent(skillId))
  }

  #filePath(skillId: string, commit: string, relativePath: string): string {
    const safe = skillRelativePathSchema.parse(relativePath)
    return join(this.#skillDirectory(skillId), skillCommitSchema.parse(commit), ...safe.split('/'))
  }

  #pruneInspections(): void {
    const now = Date.now()
    for (const [id, inspection] of this.#inspections) {
      if (inspection.expiresAt <= now) this.#inspections.delete(id)
    }
  }

  #changed(): void {
    this.#revision += 1
    for (const listener of this.#listeners) listener(this.#revision)
  }
}

function dependencyClosure(entry: CuratedSkillCatalogEntry): CuratedSkillCatalogEntry[] {
  const result: CuratedSkillCatalogEntry[] = []
  const visited = new Set<string>()
  const visit = (candidate: CuratedSkillCatalogEntry): void => {
    if (visited.has(candidate.skillId)) return
    for (const dependency of candidate.dependencies) {
      const resolved = CURATED_SKILL_CATALOG.find((item) => item.skillId === dependency)
      if (resolved === undefined) throw new Error(`Unknown curated dependency ${dependency}`)
      visit(resolved)
    }
    visited.add(candidate.skillId)
    result.push(candidate)
  }
  visit(entry)
  return result
}

function assertTreeFile(item: GitHubTreeItem | undefined, expected: CuratedSkillFile): void {
  if (
    item === undefined ||
    item.type !== 'blob' ||
    item.mode !== '100644' ||
    item.size !== expected.byteSize ||
    item.sha !== expected.gitBlobSha
  ) {
    throw new SkillServiceError(
      'skill_catalog_mismatch',
      'Curated skill no longer matches its reviewed catalog'
    )
  }
}

function parseEntrypoint(
  files: readonly DownloadedFile[],
  expectedDirectoryName: string
): {
  name: string
  description: string
  body: string
  disableModelInvocation: boolean
} {
  const entry = files.find((file) => file.path === 'SKILL.md')
  if (entry === undefined)
    throw new SkillServiceError('skill_entrypoint_missing', 'SKILL.md is missing')
  return parseSkillDocument(decodeUtf8(entry.bytes), expectedDirectoryName)
}

export function parseSkillDocument(
  document: string,
  expectedDirectoryName: string
): { name: string; description: string; body: string; disableModelInvocation: boolean } {
  const normalized = document.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(normalized)
  if (match === null)
    throw new SkillServiceError('skill_frontmatter_missing', 'SKILL.md requires YAML frontmatter')
  let metadata: unknown
  try {
    metadata = parseYaml(match[1] ?? '')
  } catch (err) {
    throw new SkillServiceError(
      'skill_frontmatter_invalid',
      'SKILL.md frontmatter is invalid YAML',
      {
        cause: err
      }
    )
  }
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    throw new SkillServiceError(
      'skill_frontmatter_invalid',
      'SKILL.md frontmatter must be a mapping'
    )
  }
  const values = metadata as Record<string, unknown>
  const name = skillNameSchema.parse(values['name'])
  if (name !== expectedDirectoryName) {
    throw new SkillServiceError('skill_name_mismatch', 'Skill name must match its directory name')
  }
  if (typeof values['description'] !== 'string') {
    throw new SkillServiceError('skill_description_missing', 'Skill description is required')
  }
  const description = values['description'].trim()
  if (description.length === 0 || description.length > 1_024) {
    throw new SkillServiceError(
      'skill_description_invalid',
      'Skill description must be 1–1,024 characters'
    )
  }
  const disabled = values['disable-model-invocation']
  if (disabled !== undefined && typeof disabled !== 'boolean') {
    throw new SkillServiceError(
      'skill_model_invocation_invalid',
      'disable-model-invocation must be a boolean'
    )
  }
  return {
    name,
    description,
    body: (match[2] ?? '').trim(),
    disableModelInvocation: disabled === true
  }
}

function storedManifest(skillPackage: SkillPackage): StoredManifest {
  return {
    version: MANIFEST_VERSION,
    skillId: skillPackage.skillId,
    source: skillPackage.source,
    repository: skillPackage.repository,
    directory: skillPackage.directory,
    commit: skillPackage.commit,
    dependencies: skillPackage.dependencies,
    files: skillPackage.files.map(({ bytes: _, ...file }) => file)
  }
}

function parseStoredManifest(value: string): StoredManifest {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch (err) {
    throw new SkillServiceError('skill_manifest_invalid', 'Writing skill manifest is invalid', {
      cause: err
    })
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new SkillServiceError('skill_manifest_invalid', 'Writing skill manifest is invalid')
  }
  const object = parsed as Record<string, unknown>
  if (
    object['version'] !== MANIFEST_VERSION ||
    (object['source'] !== 'curated' && object['source'] !== 'github') ||
    !Array.isArray(object['dependencies']) ||
    !Array.isArray(object['files'])
  ) {
    throw new SkillServiceError('skill_manifest_invalid', 'Writing skill manifest is invalid')
  }
  return {
    version: 1,
    skillId: skillIdSchema.parse(object['skillId']),
    source: object['source'],
    repository: skillRepositorySchema.parse(object['repository']),
    directory: skillDirectorySchema.parse(object['directory']),
    commit: skillCommitSchema.parse(object['commit']),
    dependencies: object['dependencies'].map((value) => skillIdSchema.parse(value)),
    files: object['files'].map((file) => skillManifestFileSchema.parse(file))
  }
}

function basenameForSkill(directory: string, repository: string): string {
  return directory === '.'
    ? (repository.split('/')[1]?.toLowerCase() ?? '')
    : posix.basename(directory)
}

function normalizeLicense(value: unknown): string | null {
  return typeof value === 'string' &&
    value !== 'NOASSERTION' &&
    value !== 'OTHER' &&
    value.length <= 100
    ? value
    : null
}

async function readResponseBytes(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new SkillServiceError('skill_download_limit', 'GitHub response exceeds the byte limit')
  }
  if (response.body === null) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > maxBytes) {
      throw new SkillServiceError('skill_download_limit', 'GitHub response exceeds the byte limit')
    }
    return bytes
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const next = await reader.read()
    if (next.done) break
    total += next.value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new SkillServiceError('skill_download_limit', 'GitHub response exceeds the byte limit')
    }
    chunks.push(next.value)
  }
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

async function existingPriorPath(target: string, parent: string): Promise<string | null> {
  try {
    await access(target)
    return join(parent, `.prior-${randomUUID()}`)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

function githubHttpError(response: Response): SkillServiceError {
  const rateLimited =
    response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0'
  return new SkillServiceError(
    rateLimited ? 'skill_github_rate_limited' : 'skill_github_http_error',
    rateLimited
      ? 'GitHub API rate limit reached; try again after the reset time'
      : `GitHub request failed with status ${response.status}`
  )
}

function decodeUtf8(bytes: Uint8Array): string {
  if (bytes.includes(0))
    throw new SkillServiceError('skill_binary_rejected', 'Skill files must be UTF-8 text')
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (err) {
    throw new SkillServiceError('skill_utf8_invalid', 'Skill files must be valid UTF-8 text', {
      cause: err
    })
  }
}

function gitBlobSha(bytes: Uint8Array): string {
  return createHash('sha1').update(`blob ${bytes.byteLength}\0`).update(bytes).digest('hex')
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
