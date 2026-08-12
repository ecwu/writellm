import { createHash } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
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
import { writeAtomicFile } from '../storage/atomic-file'

const MANUAL_AUTOSAVE_BODY_LIMIT = 20

// Import revisions are discrete user-triggered markdown imports; keeping the latest 5
// bodies per section bounds growth while leaving recent imports inspectable.
const IMPORT_BODY_LIMIT = 5

type RevisionSourceClass = NonNullable<SaveSectionDocumentInput['revisionSource']>

// Renderer-driven save channels accept only their own manual classes; `agent_accepted`
// is minted exclusively by the Main-side agent application path, never by the renderer.
const ALLOWED_REVISION_SOURCE_CLASSES: Record<'manual' | 'import', readonly RevisionSourceClass[]> =
  {
    manual: ['manual_autosave', 'manual_checkpoint'],
    import: ['import']
  }

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
  readonly #publicationQueues = new Map<string, Promise<void>>()

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
    const requestedClass = input.revisionSource
    if (
      requestedClass !== undefined &&
      !ALLOWED_REVISION_SOURCE_CLASSES[source].includes(requestedClass)
    ) {
      this.#log.warn(
        {
          event: 'editor.persistence.revision_source_rejected',
          projectId: this.#projectId,
          sectionId: input.sectionId,
          channel: source,
          revisionSource: requestedClass
        },
        'Renderer-supplied revision source class rejected for this save channel'
      )
      throw new TypeError(
        `Revision source class '${requestedClass}' is not allowed on the '${source}' save channel`
      )
    }
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
        source,
        sourceClass: input.revisionSource ?? (source === 'import' ? 'import' : 'manual_autosave')
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
      try {
        this.#pruneRevisionBodies(input.sectionId)
      } catch (err) {
        this.#log.warn(
          { event: 'editor.revision_retention.cleanup_failed', err, projectId: this.#projectId },
          'Revision retention cleanup failed; canonical revision remains available'
        )
      }
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

  async removeMaterialization(sectionId: string): Promise<void> {
    await this.#serializePublication(sectionId, async () => {
      await rm(resolveProjectPath(this.#projectRoot, sectionMaterializationPath(sectionId)), {
        force: true
      })
    })
  }

  async materialize(revision: SectionRevision): Promise<void> {
    await this.#serializePublication(revision.sectionId, () => this.#materialize(revision))
  }

  async #materialize(revision: SectionRevision): Promise<void> {
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
    const published = await writeAtomicFile(destination, bytes, {
      beforeRename: this.#faults.beforeMaterializationRename,
      shouldRename: () =>
        this.#currentRevisionId(revision.sectionId) === revision.sectionRevisionId,
      afterRename: this.#faults.afterMaterializationRename
    })
    if (!published) return
    if (this.#currentRevisionId(revision.sectionId) !== revision.sectionRevisionId) {
      await rm(destination, { force: true })
      return
    }
    this.#database.immediate((database) => {
      const current = database
        .prepare(
          'SELECT current_revision_id FROM sections WHERE section_id = ? AND deleted_at IS NULL'
        )
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

  #currentRevisionId(sectionId: string): string | undefined {
    return this.#database.immediate(
      (database) =>
        database
          .prepare(
            'SELECT current_revision_id FROM sections WHERE section_id = ? AND deleted_at IS NULL'
          )
          .pluck()
          .get(sectionId) as string | undefined
    )
  }

  async #serializePublication<T>(sectionId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.#publicationQueues.get(sectionId) ?? Promise.resolve()
    const operation = previous.catch(() => undefined).then(task)
    const tail = operation.then(
      () => undefined,
      () => undefined
    )
    this.#publicationQueues.set(sectionId, tail)
    try {
      return await operation
    } finally {
      if (this.#publicationQueues.get(sectionId) === tail) {
        this.#publicationQueues.delete(sectionId)
      }
    }
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
      database
        .prepare(
          `UPDATE section_revisions SET content_json = '[]', content_body_retained = 0
           WHERE section_revision_id IN (
             SELECT section_revision_id FROM section_revisions
             WHERE section_id = ? AND content_body_retained = 1
               AND section_revision_id <> (SELECT current_revision_id FROM sections WHERE section_id = ?)
               AND source_class = 'manual_autosave'
               AND NOT EXISTS (
                 SELECT 1 FROM section_revisions AS agent_revision
                 WHERE agent_revision.source_class = 'agent_accepted'
                   AND agent_revision.prior_revision_id = section_revisions.section_revision_id
               )
               AND NOT EXISTS (
                 SELECT 1 FROM section_revisions AS checkpoint_revision
                 WHERE checkpoint_revision.source_class = 'manual_checkpoint'
                   AND checkpoint_revision.content_body_retained = 1
                   AND checkpoint_revision.prior_revision_id = section_revisions.section_revision_id
                   AND checkpoint_revision.section_revision_id =
                     (SELECT current_revision_id FROM sections WHERE section_id = ?)
               )
               AND NOT EXISTS (
                 SELECT 1 FROM mutation_proposals AS pending_proposal
                 WHERE pending_proposal.kind IN ('section_patch', 'generated_image_insert')
                   AND pending_proposal.status IN ('pending', 'generating')
                   AND pending_proposal.base_revision_id = section_revisions.section_revision_id
               )
             ORDER BY revision_number DESC LIMIT -1 OFFSET ?
           )`
        )
        .run(sectionId, sectionId, sectionId, MANUAL_AUTOSAVE_BODY_LIMIT)

      // Manual checkpoints: older than 30 days drop entirely; 24h-30d compact to the
      // newest per day; sub-24h compact to the newest per hour bucket. The current
      // revision and direct parents of retained accepted-agent/manual-checkpoint revisions are
      // always retained.
      database
        .prepare(
          `UPDATE section_revisions SET content_json = '[]', content_body_retained = 0
           WHERE section_id = ? AND content_body_retained = 1
             AND section_revision_id <> (SELECT current_revision_id FROM sections WHERE section_id = ?)
             AND source_class = 'manual_checkpoint'
             AND NOT EXISTS (
               SELECT 1 FROM section_revisions AS agent_revision
                 WHERE agent_revision.source_class = 'agent_accepted'
                   AND agent_revision.prior_revision_id = section_revisions.section_revision_id
             )
             AND NOT EXISTS (
               SELECT 1 FROM section_revisions AS checkpoint_revision
                 WHERE checkpoint_revision.source_class = 'manual_checkpoint'
                   AND checkpoint_revision.content_body_retained = 1
                   AND checkpoint_revision.prior_revision_id = section_revisions.section_revision_id
                   AND checkpoint_revision.section_revision_id =
                     (SELECT current_revision_id FROM sections WHERE section_id = ?)
             )
             AND NOT EXISTS (
               SELECT 1 FROM mutation_proposals AS pending_proposal
               WHERE pending_proposal.kind IN ('section_patch', 'generated_image_insert')
                 AND pending_proposal.status IN ('pending', 'generating')
                 AND pending_proposal.base_revision_id = section_revisions.section_revision_id
             )
             AND (
               julianday(created_at) < julianday('now', '-30 days')
               OR (
                 julianday(created_at) < julianday('now', '-24 hours')
                 AND EXISTS (
                   SELECT 1 FROM section_revisions AS newer
                   WHERE newer.section_id = section_revisions.section_id
                     AND newer.source_class = 'manual_checkpoint'
                     AND newer.created_at > section_revisions.created_at
                     AND date(newer.created_at) = date(section_revisions.created_at)
                 )
               )
               OR (
                 julianday(created_at) >= julianday('now', '-24 hours')
                 AND EXISTS (
                   SELECT 1 FROM section_revisions AS newer
                   WHERE newer.section_id = section_revisions.section_id
                     AND newer.source_class = 'manual_checkpoint'
                     AND newer.created_at > section_revisions.created_at
                     AND strftime('%Y-%m-%dT%H', newer.created_at) =
                         strftime('%Y-%m-%dT%H', section_revisions.created_at)
                 )
               )
             )`
        )
        .run(sectionId, sectionId, sectionId)

      // Import-class bodies: retain only the latest IMPORT_BODY_LIMIT per section, counting
      // the current revision in the ranking; the outer guard keeps it regardless.
      database
        .prepare(
          `UPDATE section_revisions SET content_json = '[]', content_body_retained = 0
           WHERE section_revision_id <> (SELECT current_revision_id FROM sections WHERE section_id = ?)
             AND section_revision_id IN (
             SELECT section_revision_id FROM section_revisions
             WHERE section_id = ? AND content_body_retained = 1
               AND source_class = 'import'
               AND NOT EXISTS (
                 SELECT 1 FROM section_revisions AS agent_revision
                 WHERE agent_revision.source_class = 'agent_accepted'
                   AND agent_revision.prior_revision_id = section_revisions.section_revision_id
               )
               AND NOT EXISTS (
                 SELECT 1 FROM mutation_proposals AS pending_proposal
                 WHERE pending_proposal.kind IN ('section_patch', 'generated_image_insert')
                   AND pending_proposal.status IN ('pending', 'generating')
                   AND pending_proposal.base_revision_id = section_revisions.section_revision_id
               )
             ORDER BY revision_number DESC LIMIT -1 OFFSET ?
           )`
        )
        .run(sectionId, sectionId, IMPORT_BODY_LIMIT)

      database
        .prepare(
          `DELETE FROM section_revision_assets
           WHERE section_revision_id IN (
             SELECT section_revision_id FROM section_revisions
             WHERE section_id = ? AND content_body_retained = 0
           )`
        )
        .run(sectionId)
    })
  }
}

export function sectionMaterializationPath(sectionId: string): string {
  return `manuscript/sections/${encodeURIComponent(sectionId)}.blocknote.json`
}

function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}
