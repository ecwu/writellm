import { createHash, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { Logger } from 'pino'
import {
  annotationRecordSchema,
  annotationSelectionSchema,
  annotationUserOperationSchema,
  createAnnotationInputSchema,
  listAnnotationsInputSchema,
  listAnnotationsResultSchema,
  type AnnotationRecord
} from '../../shared/contracts/annotations'
import {
  blockNoteDocumentSchema,
  type BlockNoteBlockValue
} from '../../shared/contracts/manuscript'
import type { AnnotationTable } from '../project/database-types'
import type { ProjectDatabase } from '../project/project-database'

const MAX_ANNOTATIONS = 5_000

export class AnnotationService {
  constructor(
    private readonly options: {
      database: ProjectDatabase
      log: Pick<Logger, 'info' | 'error'>
      now?: () => Date
      createId?: () => string
    }
  ) {}

  create(raw: unknown): AnnotationRecord {
    const input = createAnnotationInputSchema.omit({ projectSessionId: true }).parse(raw)
    const startedAt = Date.now()
    try {
      const result = this.options.database.immediate((database) => {
        const count = (
          database.prepare('SELECT COUNT(*) AS count FROM manuscript_annotations').get() as {
            count: number
          }
        ).count
        if (count >= MAX_ANNOTATIONS) throw new Error('Project annotation limit reached')
        const anchor = currentAnchor(database, input.sectionId, input.blockId)
        if (anchor.anchorStatus !== 'current') throw new Error('Annotation anchor is not current')
        const annotationId = (this.options.createId ?? randomUUID)()
        const now = (this.options.now ?? (() => new Date()))().toISOString()
        const textAnchor = input.textAnchor ?? null
        database
          .prepare(
            `INSERT INTO manuscript_annotations (
               annotation_id, kind, status, body, section_id, block_id, anchor_revision_id,
               text_anchor, text_anchor_fingerprint, version, created_at, updated_at, resolved_at
             ) VALUES (?, ?, 'open', ?, ?, ?, ?, ?, ?, 1, ?, ?, NULL)`
          )
          .run(
            annotationId,
            input.kind,
            input.body,
            input.sectionId,
            input.blockId,
            anchor.revisionId,
            textAnchor,
            textAnchor === null ? null : sha256(textAnchor),
            now,
            now
          )
        return mapAnnotation(database, requireAnnotation(database, annotationId))
      })
      this.options.log.info(
        {
          event: 'annotation.created',
          annotationId: result.annotationId,
          sectionId: result.sectionId,
          kind: result.kind,
          durationMs: Date.now() - startedAt
        },
        'Manuscript annotation created'
      )
      return result
    } catch (err) {
      this.options.log.error(
        { event: 'annotation.create_failed', err, sectionId: input.sectionId },
        'Manuscript annotation creation failed'
      )
      throw err
    }
  }

  list(raw: unknown): ReturnType<typeof listAnnotationsResultSchema.parse> {
    const input = listAnnotationsInputSchema.omit({ projectSessionId: true }).parse(raw)
    const offset = decodeCursor(input.cursor)
    const conditions: string[] = []
    const parameters: unknown[] = []
    appendInFilter(conditions, parameters, 'status', input.statuses)
    appendInFilter(conditions, parameters, 'kind', input.kinds)
    if (input.sectionId !== undefined) {
      conditions.push('section_id = ?')
      parameters.push(input.sectionId)
    }
    const where = conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`
    return this.options.database.immediate((database) => {
      const total = (
        database
          .prepare(`SELECT COUNT(*) AS count FROM manuscript_annotations ${where}`)
          .get(...parameters) as { count: number }
      ).count
      const rows = database
        .prepare(
          `SELECT * FROM manuscript_annotations ${where}
           ORDER BY CASE kind WHEN 'todo' THEN 0 ELSE 1 END, updated_at DESC, annotation_id
           LIMIT ? OFFSET ?`
        )
        .all(...parameters, input.limit, offset) as AnnotationTable[]
      return listAnnotationsResultSchema.parse({
        annotations: rows.map((row) => mapAnnotation(database, row)),
        nextCursor: offset + rows.length < total ? encodeCursor(offset + rows.length) : null,
        total
      })
    })
  }

  update(raw: unknown): AnnotationRecord {
    const operation = annotationUserOperationSchema.parse(raw)
    const startedAt = Date.now()
    try {
      const result = this.options.database.immediate((database) => {
        const current = requireAnnotation(database, operation.annotationId)
        if (current.version !== operation.expectedVersion) throw new Error('Annotation changed')
        const now = (this.options.now ?? (() => new Date()))().toISOString()
        if (operation.action === 'edit') {
          database
            .prepare(
              `UPDATE manuscript_annotations
               SET kind = ?, body = ?, version = version + 1, updated_at = ?
               WHERE annotation_id = ? AND version = ?`
            )
            .run(
              operation.kind,
              operation.body,
              now,
              operation.annotationId,
              operation.expectedVersion
            )
        } else {
          const status = operation.action === 'resolve' ? 'resolved' : 'open'
          database
            .prepare(
              `UPDATE manuscript_annotations
               SET status = ?, resolved_at = ?, version = version + 1, updated_at = ?
               WHERE annotation_id = ? AND version = ?`
            )
            .run(
              status,
              status === 'resolved' ? now : null,
              now,
              operation.annotationId,
              operation.expectedVersion
            )
        }
        const changes = database.prepare('SELECT changes() AS count').get() as { count: number }
        if (changes.count !== 1) {
          throw new Error('Annotation changed')
        }
        return mapAnnotation(database, requireAnnotation(database, operation.annotationId))
      })
      this.options.log.info(
        {
          event: 'annotation.updated',
          annotationId: result.annotationId,
          action: operation.action,
          durationMs: Date.now() - startedAt
        },
        'Manuscript annotation updated'
      )
      return result
    } catch (err) {
      this.options.log.error(
        { event: 'annotation.update_failed', err, annotationId: operation.annotationId },
        'Manuscript annotation update failed'
      )
      throw err
    }
  }

  agentContext(rawIds: unknown): { ids: string[]; content: string } {
    const ids = annotationSelectionSchema.parse(rawIds)
    if (ids.length === 0) return { ids, content: '' }
    return this.options.database.immediate((database) => {
      const annotations = ids.map((id) => mapAnnotation(database, requireAnnotation(database, id)))
      const content = annotations
        .map(
          (annotation, index) =>
            `${index + 1}. [${annotation.kind.toUpperCase()} · ${annotation.status} · ${annotation.anchorStatus}] ${annotation.body}`
        )
        .join('\n')
      return { ids, content }
    })
  }
}

function requireAnnotation(database: Database.Database, annotationId: string): AnnotationTable {
  const row = database
    .prepare('SELECT * FROM manuscript_annotations WHERE annotation_id = ?')
    .get(annotationId) as AnnotationTable | undefined
  if (row === undefined) throw new Error('Annotation does not exist')
  return row
}

function mapAnnotation(database: Database.Database, row: AnnotationTable): AnnotationRecord {
  const anchor = currentAnchor(database, row.section_id, row.block_id)
  return annotationRecordSchema.parse({
    annotationId: row.annotation_id,
    kind: row.kind,
    status: row.status,
    body: row.body,
    sectionId: row.section_id,
    blockId: row.block_id,
    anchorRevisionId: row.anchor_revision_id,
    textAnchor: row.text_anchor,
    textAnchorFingerprint: row.text_anchor_fingerprint,
    anchorStatus: anchor.anchorStatus,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at
  })
}

function currentAnchor(
  database: Database.Database,
  sectionId: string,
  blockId: string
): { anchorStatus: 'current' | 'orphaned'; revisionId: string } {
  const row = database
    .prepare(
      `SELECT sections.current_revision_id, sections.deleted_at, section_revisions.content_json,
              section_revisions.content_body_retained
       FROM sections
       JOIN section_revisions
         ON section_revisions.section_revision_id = sections.current_revision_id
       WHERE sections.section_id = ?`
    )
    .get(sectionId) as
    | {
        current_revision_id: string
        deleted_at: string | null
        content_json: string | null
        content_body_retained: number
      }
    | undefined
  if (row === undefined) throw new Error('Annotation section does not exist')
  if (row.deleted_at !== null || row.content_body_retained !== 1 || row.content_json === null) {
    return { anchorStatus: 'orphaned', revisionId: row.current_revision_id }
  }
  const document = blockNoteDocumentSchema.parse(JSON.parse(row.content_json))
  return {
    anchorStatus: containsBlock(document, blockId) ? 'current' : 'orphaned',
    revisionId: row.current_revision_id
  }
}

function containsBlock(blocks: BlockNoteBlockValue[], blockId: string): boolean {
  for (const block of blocks) {
    if (block.id === blockId || containsBlock(block.children, blockId)) return true
  }
  return false
}

function sha256(value: string): string {
  return createHash('sha256').update(value.normalize('NFC')).digest('hex')
}

function appendInFilter(
  conditions: string[],
  parameters: unknown[],
  column: string,
  values: string[]
): void {
  if (values.length === 0) return
  conditions.push(`${column} IN (${values.map(() => '?').join(', ')})`)
  parameters.push(...values)
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url')
}

function decodeCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      offset?: unknown
    }
    if (!Number.isInteger(parsed.offset) || (parsed.offset as number) < 0) throw new Error()
    return parsed.offset as number
  } catch {
    throw new Error('Annotation cursor is invalid')
  }
}
