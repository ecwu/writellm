import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Logger } from 'pino'
import {
  blockNoteDocumentSchema,
  SECTION_CONTENT_SCHEMA_VERSION,
  SECTION_MATERIALIZATION_ENVELOPE_SCHEMA_VERSION,
  SECTION_MATERIALIZATION_FORMAT_VERSION,
  type SaveSectionDocumentInput,
  type SaveSectionDocumentResult,
  type SectionRevision
} from '../../shared/contracts/manuscript'
import type { SectionMaterializationTable } from '../project/database-types'
import type { ProjectDatabase } from '../project/project-database'
import { resolveProjectPath } from '../project/project-paths'
import { prepareSectionContent } from './content'
import type { ManuscriptService } from './manuscript-service'

const MANUAL_BODY_LIMIT = 95
const OTHER_BODY_LIMIT = 32

export interface EditorPersistenceFaults {
  afterDatabaseCommit?(): void | Promise<void>
  beforeMaterializationRename?(): void | Promise<void>
  afterMaterializationRename?(): void | Promise<void>
}

export interface EditorPersistenceServiceOptions {
  projectRoot: string
  projectId: string
  database: ProjectDatabase
  manuscript: ManuscriptService
  log: Pick<Logger, 'info' | 'warn' | 'error'>
  now?: () => Date
  faults?: EditorPersistenceFaults
}

export class EditorPersistenceService {
  readonly #projectRoot: string
  readonly #projectId: string
  readonly #database: ProjectDatabase
  readonly #manuscript: ManuscriptService
  readonly #log: EditorPersistenceServiceOptions['log']
  readonly #now: () => Date
  readonly #faults: EditorPersistenceFaults

  constructor(options: EditorPersistenceServiceOptions) {
    this.#projectRoot = options.projectRoot
    this.#projectId = options.projectId
    this.#database = options.database
    this.#manuscript = options.manuscript
    this.#log = options.log
    this.#now = options.now ?? (() => new Date())
    this.#faults = options.faults ?? {}
  }

  loadSection(sectionId: string): {
    section: ReturnType<ManuscriptService['getSection']>
    revision: SectionRevision
  } {
    const section = this.#manuscript.getSection(sectionId)
    return { section, revision: this.#manuscript.getRevision(section.currentRevisionId) }
  }

  openEditor(): { activeSection: ReturnType<EditorPersistenceService['loadSection']> | null } {
    const first = this.#manuscript.listSections()[0]
    return { activeSection: first === undefined ? null : this.loadSection(first.sectionId) }
  }

  async save(
    input: SaveSectionDocumentInput,
    source: 'manual' | 'import' = 'manual'
  ): Promise<SaveSectionDocumentResult> {
    const startedAt = Date.now()
    const document = blockNoteDocumentSchema.parse(input.document)
    const documentHash = prepareSectionContent(document).contentHash
    const wasAlreadyCurrent =
      this.loadSection(input.sectionId).revision.contentHash === documentHash
    let revision: SectionRevision
    try {
      revision = this.#manuscript.appendRevision({
        sectionId: input.sectionId,
        baseRevisionId: input.baseRevisionId,
        baseContentHash: input.baseContentHash,
        content: document,
        source
      })
    } catch (err) {
      this.#log.error(
        {
          event: 'editor.persistence.save_failed',
          err,
          projectId: this.#projectId,
          sectionId: input.sectionId
        },
        'Editor save failed before materialization'
      )
      throw err
    }

    const unchanged = wasAlreadyCurrent
    try {
      await this.#faults.afterDatabaseCommit?.()
      await this.materialize(revision)
      this.#pruneRevisionBodies(input.sectionId)
      this.#log.info(
        {
          event: unchanged ? 'editor.persistence.unchanged' : 'editor.persistence.saved',
          projectId: this.#projectId,
          sectionId: input.sectionId,
          sectionRevisionId: revision.sectionRevisionId,
          durationMs: Date.now() - startedAt
        },
        unchanged ? 'Editor document was already current' : 'Editor document saved and materialized'
      )
      return { revision, disposition: unchanged ? 'unchanged' : 'saved' }
    } catch (err) {
      this.#log.error(
        {
          event: 'editor.materialization.publish_failed',
          err,
          projectId: this.#projectId,
          sectionId: input.sectionId,
          sectionRevisionId: revision.sectionRevisionId
        },
        'Canonical editor revision saved but materialization publication failed'
      )
      return { revision, disposition: 'saved_materialization_pending' }
    }
  }

  async repairAll(): Promise<void> {
    for (const section of this.#manuscript.listSections()) {
      const revision = this.#manuscript.getRevision(section.currentRevisionId)
      try {
        if (!(await this.#isCurrentMaterialization(revision))) await this.materialize(revision)
      } catch (err) {
        this.#log.error(
          {
            event: 'editor.materialization.repair_failed',
            err,
            projectId: this.#projectId,
            sectionId: section.sectionId,
            sectionRevisionId: revision.sectionRevisionId
          },
          'Materialization repair failed; canonical database content remains available'
        )
      }
    }
  }

  async materialize(revision: SectionRevision): Promise<void> {
    const relativePath = sectionMaterializationPath(revision.sectionId)
    const destination = resolveProjectPath(this.#projectRoot, relativePath)
    const envelope = {
      format: 'writellm-blocknote-section',
      formatVersion: SECTION_MATERIALIZATION_FORMAT_VERSION,
      contentSchemaVersion: SECTION_CONTENT_SCHEMA_VERSION,
      sectionId: revision.sectionId,
      sectionRevisionId: revision.sectionRevisionId,
      contentHash: revision.contentHash,
      document: revision.content
    }
    const bytes = Buffer.from(JSON.stringify(envelope), 'utf8')
    const fileSha256 = sha256(bytes)
    await mkdir(dirname(destination), { recursive: true })
    const temporary = `${destination}.${randomUUID()}.tmp`
    let handle: Awaited<ReturnType<typeof open>> | undefined
    try {
      handle = await open(temporary, 'wx', 0o600)
      await handle.writeFile(bytes)
      await handle.sync()
      await handle.close()
      handle = undefined
      await this.#faults.beforeMaterializationRename?.()
      await rename(temporary, destination)
      await this.#faults.afterMaterializationRename?.()
      const directory = await open(dirname(destination), 'r')
      try {
        await directory.sync()
      } finally {
        await directory.close()
      }
    } finally {
      await handle?.close().catch(() => undefined)
      await rm(temporary, { force: true }).catch(() => undefined)
    }
    this.#database.immediate((database) => {
      const current = database
        .prepare('SELECT current_revision_id FROM sections WHERE section_id = ?')
        .pluck()
        .get(revision.sectionId) as string | undefined
      if (current !== revision.sectionRevisionId) return
      database
        .prepare(
          `INSERT INTO section_materializations (
            section_id, section_revision_id, content_hash, relative_path, file_sha256,
            byte_size, envelope_schema_version, materialized_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(section_id) DO UPDATE SET
            section_revision_id = excluded.section_revision_id,
            content_hash = excluded.content_hash,
            relative_path = excluded.relative_path,
            file_sha256 = excluded.file_sha256,
            byte_size = excluded.byte_size,
            envelope_schema_version = excluded.envelope_schema_version,
            materialized_at = excluded.materialized_at`
        )
        .run(
          revision.sectionId,
          revision.sectionRevisionId,
          revision.contentHash,
          relativePath,
          fileSha256,
          bytes.byteLength,
          SECTION_MATERIALIZATION_ENVELOPE_SCHEMA_VERSION,
          this.#now().toISOString()
        )
    })
  }

  async #isCurrentMaterialization(revision: SectionRevision): Promise<boolean> {
    const row = this.#database.immediate(
      (database) =>
        database
          .prepare('SELECT * FROM section_materializations WHERE section_id = ?')
          .get(revision.sectionId) as SectionMaterializationTable | undefined
    )
    const expectedPath = sectionMaterializationPath(revision.sectionId)
    if (
      row === undefined ||
      row.section_revision_id !== revision.sectionRevisionId ||
      row.content_hash !== revision.contentHash ||
      row.relative_path !== expectedPath ||
      row.envelope_schema_version !== SECTION_MATERIALIZATION_ENVELOPE_SCHEMA_VERSION
    )
      return false
    try {
      const bytes = await readFile(resolveProjectPath(this.#projectRoot, expectedPath))
      if (bytes.byteLength !== row.byte_size || sha256(bytes) !== row.file_sha256) return false
      const envelope = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>
      return (
        envelope.format === 'writellm-blocknote-section' &&
        envelope.formatVersion === SECTION_MATERIALIZATION_FORMAT_VERSION &&
        envelope.sectionId === revision.sectionId &&
        envelope.sectionRevisionId === revision.sectionRevisionId &&
        envelope.contentHash === revision.contentHash &&
        prepareSectionContent(blockNoteDocumentSchema.parse(envelope.document)).contentHash ===
          revision.contentHash
      )
    } catch {
      return false
    }
  }

  #pruneRevisionBodies(sectionId: string): void {
    this.#database.immediate((database) => {
      for (const [sourceGroup, limit] of [
        ['manual', MANUAL_BODY_LIMIT],
        ['other', OTHER_BODY_LIMIT]
      ] as const) {
        database
          .prepare(
            `UPDATE section_revisions SET content_json = '[]', content_body_retained = 0
             WHERE section_revision_id IN (
               SELECT section_revision_id FROM section_revisions
               WHERE section_id = ? AND content_body_retained = 1
                 AND section_revision_id <> (SELECT current_revision_id FROM sections WHERE section_id = ?)
                 AND ${sourceGroup === 'manual' ? "source = 'manual'" : "source <> 'manual'"}
               ORDER BY revision_number DESC LIMIT -1 OFFSET ?
             )`
          )
          .run(sectionId, sectionId, limit)
      }
    })
  }
}

export function sectionMaterializationPath(sectionId: string): string {
  return `manuscript/sections/${encodeURIComponent(sectionId)}.blocknote.json`
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}
