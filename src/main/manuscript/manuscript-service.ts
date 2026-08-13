import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { Logger } from 'pino'
import {
  appendSectionRevisionInputSchema,
  createSectionInputSchema,
  deleteSectionInputSchema,
  MANUSCRIPT_BRIEF_SCHEMA_VERSION,
  MAX_MANUSCRIPT_OUTLINE_DEPTH,
  MAX_MANUSCRIPT_SECTIONS,
  SECTION_CONTENT_SCHEMA_VERSION,
  SECTION_COUNT_ALGORITHM_VERSION,
  ManuscriptDomainError,
  moveSectionInputSchema,
  type AppendSectionRevisionInput,
  type BlockNoteDocument,
  type CreateSectionInput,
  type DeleteSectionInput,
  type ManuscriptAssembly,
  type ManuscriptBrief,
  type ManuscriptReferenceIndex,
  type ManuscriptWorkspace,
  type MoveSectionInput,
  type Section,
  type SectionRevision,
  type SectionRevisionSummary,
  type UpdateManuscriptBriefInput,
  type UpdateSectionInput,
  updateManuscriptBriefInputSchema,
  updateSectionInputSchema,
  blockNoteDocumentSchema,
  normalizeFigureMetadata
} from '../../shared/contracts/manuscript'
import { buildManuscriptReferenceIndex } from '../../shared/readable-citation'
import {
  applyReplacementOperations,
  type ReplacementOperation
} from '../../shared/manuscript-replacement'
import type {
  ManuscriptBriefTable,
  ManuscriptTable,
  SectionRevisionTable,
  SectionTable
} from '../project/database-types'
import type { ProjectDatabase } from '../project/project-database'
import { prepareSectionContent } from './content'
import { recordRevisionAssetReferences } from './asset-service'
import { ManuscriptRepository } from './manuscript-repository'

const POSITION_OFFSET = 1_000_000_000

export interface SectionDeletionGuard {
  assertCanDelete(database: Database.Database, sectionId: string): void
}

const allowSectionDeletion: SectionDeletionGuard = {
  assertCanDelete: () => undefined
}

export interface ManuscriptServiceOptions {
  database: ProjectDatabase
  projectId: string
  log: Pick<Logger, 'info' | 'error'>
  now?: () => Date
  createId?: () => string
  deletionGuard?: SectionDeletionGuard
}

export interface ReplacementBatchSection {
  sectionId: string
  baseRevisionId: string
  baseContentHash: string
  operations: ReplacementOperation[]
}

export interface ReplacementBatchResult {
  revisions: SectionRevision[]
  transactionDurationMs: number
}

export interface ImportSectionsAtomicInput {
  baseBriefVersion: number
  baseOutlineVersion: number
  sections: Array<{ title: string; outlineLevel: number; document: BlockNoteDocument }>
}

export interface ImportSectionsAtomicResult {
  sections: Section[]
  revisions: SectionRevision[]
}

export class ManuscriptService {
  readonly #database: ProjectDatabase
  readonly #projectId: string
  readonly #log: ManuscriptServiceOptions['log']
  readonly #now: () => Date
  readonly #createId: () => string
  readonly #deletionGuard: SectionDeletionGuard
  readonly #repository: ManuscriptRepository

  constructor(options: ManuscriptServiceOptions) {
    this.#database = options.database
    this.#projectId = options.projectId
    this.#log = options.log
    this.#now = options.now ?? (() => new Date())
    this.#createId = options.createId ?? randomUUID
    this.#deletionGuard = options.deletionGuard ?? allowSectionDeletion
    this.#repository = new ManuscriptRepository(options.database)
    this.#primary()
  }

  getBrief(): ManuscriptBrief {
    const manuscript = this.#primary()
    const row = this.#repository.latestBrief(manuscript.manuscript_id)
    if (row === undefined) throw new Error('Primary manuscript brief is missing')
    return briefFromRow(row)
  }

  updateBrief(input: UpdateManuscriptBriefInput): ManuscriptBrief {
    const startedAt = Date.now()
    try {
      const extensibleJson = JSON.stringify(input.extensible)
      const parsed = updateManuscriptBriefInputSchema.parse(input)
      const now = this.#now().toISOString()
      const briefId = this.#createId()
      const row = this.#database.immediate((database) => {
        const manuscript = this.#primary(database)
        const current = this.#repository.latestBrief(manuscript.manuscript_id, database)
        if (current === undefined) throw new Error('Primary manuscript brief is missing')
        if (current.version !== parsed.baseVersion) {
          throw new ManuscriptDomainError(
            'brief_version_conflict',
            'The manuscript brief has changed'
          )
        }
        return database
          .prepare(
            `INSERT INTO manuscript_briefs (
              manuscript_brief_id, manuscript_id, version, schema_version, title, description,
              topic, target_audience, language, style_tone, scope_exclusions, target_length,
              citation_requirements, additional_instructions, extensible_json, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`
          )
          .get(
            briefId,
            manuscript.manuscript_id,
            current.version + 1,
            MANUSCRIPT_BRIEF_SCHEMA_VERSION,
            parsed.title,
            parsed.description,
            parsed.topic,
            parsed.targetAudience,
            parsed.language,
            parsed.styleTone,
            parsed.scopeExclusions,
            parsed.targetLength,
            parsed.citationRequirements,
            parsed.additionalInstructions,
            extensibleJson,
            now,
            now
          ) as ManuscriptBriefTable
      })
      this.#log.info(
        {
          event: 'manuscript.brief.updated',
          projectId: this.#projectId,
          manuscriptId: row.manuscript_id,
          briefVersion: row.version,
          durationMs: Date.now() - startedAt
        },
        'Manuscript brief version appended'
      )
      return briefFromRow(row)
    } catch (err) {
      this.#logFailure('manuscript.brief.update_failed', err, startedAt)
      throw err
    }
  }

  listSections(): Section[] {
    const manuscript = this.#primary()
    return orderOutline(this.#repository.sections(manuscript.manuscript_id)).map(sectionFromRow)
  }

  getSection(sectionId: string): Section {
    const manuscript = this.#primary()
    const row = this.#repository.section(sectionId)
    if (row === undefined || row.manuscript_id !== manuscript.manuscript_id) {
      throw new ManuscriptDomainError('section_not_found', 'Section does not exist')
    }
    return sectionFromRow(row)
  }

  createSection(input: CreateSectionInput): Section {
    const parsed = createSectionInputSchema.parse(input)
    const sectionId = this.#createId()
    const prepared = prepareSectionContent([], sectionId)
    const revisionId = this.#createId()
    const now = this.#now().toISOString()
    const startedAt = Date.now()
    try {
      const row = this.#database.immediate((database) => {
        const manuscript = this.#primary(database)
        assertOutlineVersion(manuscript, parsed.baseOutlineVersion)
        const rows = this.#repository.sections(manuscript.manuscript_id, database)
        const parent =
          parsed.parentSectionId === null
            ? undefined
            : rows.find((item) => item.section_id === parsed.parentSectionId)
        if (parsed.parentSectionId !== null && parent === undefined) {
          throw new ManuscriptDomainError('section_parent_invalid', 'Section parent does not exist')
        }
        if ((parent?.level ?? 0) + 1 > MAX_MANUSCRIPT_OUTLINE_DEPTH) {
          throw new ManuscriptDomainError(
            'outline_depth_exceeded',
            `Outline depth cannot exceed ${MAX_MANUSCRIPT_OUTLINE_DEPTH}`
          )
        }
        const siblings = siblingRows(rows, parsed.parentSectionId)
        if (parsed.position > siblings.length) {
          throw new ManuscriptDomainError(
            'section_position_invalid',
            'Section position is outside the sibling list'
          )
        }
        parkSiblings(database, manuscript.manuscript_id, parsed.parentSectionId)
        siblings.splice(parsed.position, 0, {
          section_id: sectionId,
          manuscript_id: manuscript.manuscript_id,
          parent_section_id: parsed.parentSectionId,
          position: parsed.position,
          level: (parent?.level ?? 0) + 1,
          title: parsed.title,
          objective: parsed.objective,
          status: parsed.status,
          current_revision_id: revisionId,
          deleted_at: null,
          created_at: now,
          updated_at: now
        })
        database
          .prepare(
            `INSERT INTO sections (
              section_id, manuscript_id, parent_section_id, position, level, title, objective,
              status, current_revision_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            sectionId,
            manuscript.manuscript_id,
            parsed.parentSectionId,
            parsed.position,
            (parent?.level ?? 0) + 1,
            parsed.title,
            parsed.objective,
            parsed.status,
            revisionId,
            now,
            now
          )
        insertRevision(database, {
          revisionId,
          sectionId,
          revisionNumber: 1,
          source: 'bootstrap',
          sourceClass: 'manual_checkpoint',
          prepared,
          priorRevisionId: null,
          agentRunId: null,
          agentToolCallId: null,
          agentProposalId: null,
          createdAt: now
        })
        normalizeSiblings(database, siblings)
        incrementOutline(database, manuscript.manuscript_id, now)
        return this.#repository.section(sectionId, database) as SectionTable
      })
      this.#log.info(
        {
          event: 'manuscript.section.created',
          projectId: this.#projectId,
          manuscriptId: row.manuscript_id,
          sectionId,
          sectionRevisionId: revisionId,
          durationMs: Date.now() - startedAt
        },
        'Manuscript section created'
      )
      return sectionFromRow(row)
    } catch (err) {
      this.#logFailure('manuscript.section.create_failed', err, startedAt, { sectionId })
      throw err
    }
  }

  importSectionsAtomic(input: ImportSectionsAtomicInput): ImportSectionsAtomicResult {
    const startedAt = Date.now()
    if (input.sections.length === 0 || input.sections.length > MAX_MANUSCRIPT_SECTIONS) {
      throw new TypeError('Import must contain between 1 and the maximum manuscript sections')
    }
    const drafts = input.sections.map((section) => ({
      title: section.title.trim(),
      outlineLevel: section.outlineLevel,
      document: blockNoteDocumentSchema.parse(section.document),
      sectionId: this.#createId(),
      revisionId: this.#createId()
    }))
    if (drafts.some((section) => section.title.length === 0 || section.title.length > 500)) {
      throw new TypeError('Imported section title is invalid')
    }
    const now = this.#now().toISOString()
    try {
      const rows = this.#database.immediate((database) => {
        const manuscript = this.#primary(database)
        assertOutlineVersion(manuscript, input.baseOutlineVersion)
        const brief = this.#repository.latestBrief(manuscript.manuscript_id, database)
        if (brief === undefined || brief.version !== input.baseBriefVersion) {
          throw new ManuscriptDomainError(
            'brief_version_conflict',
            'The manuscript brief has changed'
          )
        }
        const existing = this.#repository.sections(manuscript.manuscript_id, database)
        if (existing.length + drafts.length > MAX_MANUSCRIPT_SECTIONS) {
          throw new TypeError('Import would exceed the manuscript section limit')
        }
        const parentAtLevel = new Map<number, string>()
        const nextPosition = new Map<string, number>()
        nextPosition.set('root', siblingRows(existing, null).length)
        const created: Array<{ section: SectionTable; revision: SectionRevisionTable }> = []
        for (const draft of drafts) {
          const parentSectionId =
            draft.outlineLevel === 1 ? null : parentAtLevel.get(draft.outlineLevel - 1)
          if (draft.outlineLevel > 1 && parentSectionId === undefined) {
            throw new ManuscriptDomainError(
              'section_parent_invalid',
              'Imported outline level has no preceding parent'
            )
          }
          if (draft.outlineLevel > MAX_MANUSCRIPT_OUTLINE_DEPTH) {
            throw new ManuscriptDomainError(
              'outline_depth_exceeded',
              `Outline depth cannot exceed ${MAX_MANUSCRIPT_OUTLINE_DEPTH}`
            )
          }
          const parentKey = parentSectionId ?? 'root'
          const position =
            nextPosition.get(parentKey) ?? siblingRows(existing, parentSectionId ?? null).length
          nextPosition.set(parentKey, position + 1)
          const prepared = prepareSectionContent(draft.document, draft.sectionId)
          database
            .prepare(
              `INSERT INTO sections (
                section_id, manuscript_id, parent_section_id, position, level, title, objective,
                status, current_revision_id, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, ?, NULL, 'drafting', ?, ?, ?)`
            )
            .run(
              draft.sectionId,
              manuscript.manuscript_id,
              parentSectionId ?? null,
              position,
              draft.outlineLevel,
              draft.title,
              draft.revisionId,
              now,
              now
            )
          insertRevision(database, {
            revisionId: draft.revisionId,
            sectionId: draft.sectionId,
            revisionNumber: 1,
            source: 'import',
            sourceClass: 'import',
            prepared,
            priorRevisionId: null,
            agentRunId: null,
            agentToolCallId: null,
            agentProposalId: null,
            createdAt: now
          })
          recordRevisionAssetReferences(database, draft.revisionId, prepared.content, now)
          created.push({
            section: this.#repository.section(draft.sectionId, database) as SectionTable,
            revision: this.#repository.revision(draft.revisionId, database) as SectionRevisionTable
          })
          parentAtLevel.set(draft.outlineLevel, draft.sectionId)
          for (const level of [...parentAtLevel.keys()]) {
            if (level > draft.outlineLevel) parentAtLevel.delete(level)
          }
        }
        incrementOutline(database, manuscript.manuscript_id, now)
        return created
      })
      const result = {
        sections: rows.map((row) => sectionFromRow(row.section)),
        revisions: rows.map((row) => revisionFromRow(row.revision))
      }
      this.#log.info(
        {
          event: 'manuscript.sections.imported',
          projectId: this.#projectId,
          sectionCount: result.sections.length,
          sectionIds: result.sections.map((section) => section.sectionId),
          durationMs: Date.now() - startedAt
        },
        'Imported manuscript sections committed atomically'
      )
      return result
    } catch (err) {
      this.#logFailure('manuscript.sections.import_failed', err, startedAt, {
        sectionCount: input.sections.length
      })
      throw err
    }
  }

  updateSection(input: UpdateSectionInput): Section {
    const parsed = updateSectionInputSchema.parse(input)
    const now = this.#now().toISOString()
    const startedAt = Date.now()
    try {
      const row = this.#database.immediate((database) => {
        const manuscript = this.#primary(database)
        assertOutlineVersion(manuscript, parsed.baseOutlineVersion)
        const current = this.#repository.section(parsed.sectionId, database)
        if (current === undefined || current.manuscript_id !== manuscript.manuscript_id) {
          throw new ManuscriptDomainError('section_not_found', 'Section does not exist')
        }
        const next = {
          title: parsed.title ?? current.title,
          objective: parsed.objective === undefined ? current.objective : parsed.objective,
          status: parsed.status ?? current.status
        }
        const changed =
          next.title !== current.title ||
          next.objective !== current.objective ||
          next.status !== current.status
        if (!changed) return current
        const updated = database
          .prepare(
            `UPDATE sections SET title = ?, objective = ?, status = ?, updated_at = ?
              WHERE section_id = ? AND deleted_at IS NULL RETURNING *`
          )
          .get(next.title, next.objective, next.status, now, parsed.sectionId) as SectionTable
        incrementOutline(database, manuscript.manuscript_id, now)
        return updated
      })
      this.#log.info(
        {
          event: 'manuscript.section.updated',
          projectId: this.#projectId,
          manuscriptId: row.manuscript_id,
          sectionId: row.section_id,
          durationMs: Date.now() - startedAt
        },
        'Manuscript section metadata updated'
      )
      return sectionFromRow(row)
    } catch (err) {
      this.#logFailure('manuscript.section.update_failed', err, startedAt, {
        sectionId: parsed.sectionId
      })
      throw err
    }
  }

  moveSection(input: MoveSectionInput): Section {
    const parsed = moveSectionInputSchema.parse(input)
    const now = this.#now().toISOString()
    const startedAt = Date.now()
    try {
      const row = this.#database.immediate((database) => {
        const manuscript = this.#primary(database)
        assertOutlineVersion(manuscript, parsed.baseOutlineVersion)
        const rows = this.#repository.sections(manuscript.manuscript_id, database)
        const target = rows.find((item) => item.section_id === parsed.sectionId)
        if (target === undefined)
          throw new ManuscriptDomainError('section_not_found', 'Section does not exist')
        const parent =
          parsed.parentSectionId === null
            ? undefined
            : rows.find((item) => item.section_id === parsed.parentSectionId)
        if (parsed.parentSectionId !== null && parent === undefined) {
          throw new ManuscriptDomainError('section_parent_invalid', 'Section parent does not exist')
        }
        const descendants = descendantIds(rows, target.section_id)
        if (
          parsed.parentSectionId === target.section_id ||
          (parsed.parentSectionId !== null && descendants.has(parsed.parentSectionId))
        ) {
          throw new ManuscriptDomainError(
            'section_cycle',
            'Section move would create an outline cycle'
          )
        }
        if (
          (parent?.level ?? 0) + subtreeHeightFromRows(rows, target.section_id) >
          MAX_MANUSCRIPT_OUTLINE_DEPTH
        ) {
          throw new ManuscriptDomainError(
            'outline_depth_exceeded',
            `Outline depth cannot exceed ${MAX_MANUSCRIPT_OUTLINE_DEPTH}`
          )
        }
        const sourceSiblings = siblingRows(rows, target.parent_section_id).filter(
          (item) => item.section_id !== target.section_id
        )
        const destinationSiblings =
          target.parent_section_id === parsed.parentSectionId
            ? sourceSiblings
            : siblingRows(rows, parsed.parentSectionId)
        if (parsed.position > destinationSiblings.length) {
          throw new ManuscriptDomainError(
            'section_position_invalid',
            'Section position is outside the sibling list'
          )
        }
        parkSiblings(database, manuscript.manuscript_id, target.parent_section_id)
        if (target.parent_section_id !== parsed.parentSectionId)
          parkSiblings(database, manuscript.manuscript_id, parsed.parentSectionId)
        destinationSiblings.splice(parsed.position, 0, target)
        normalizeSiblings(database, sourceSiblings)
        normalizeSiblings(database, destinationSiblings, target.section_id, parsed.parentSectionId)
        const levelDelta = (parent?.level ?? 0) + 1 - target.level
        database
          .prepare(
            `UPDATE sections SET parent_section_id = ?, level = level + ?, updated_at = ?
              WHERE section_id = ? AND deleted_at IS NULL`
          )
          .run(parsed.parentSectionId, levelDelta, now, target.section_id)
        for (const descendantId of descendants) {
          database
            .prepare(
              `UPDATE sections SET level = level + ?, updated_at = ?
                WHERE section_id = ? AND deleted_at IS NULL`
            )
            .run(levelDelta, now, descendantId)
        }
        incrementOutline(database, manuscript.manuscript_id, now)
        return this.#repository.section(target.section_id, database) as SectionTable
      })
      this.#log.info(
        {
          event: 'manuscript.section.moved',
          projectId: this.#projectId,
          manuscriptId: row.manuscript_id,
          sectionId: row.section_id,
          outlineVersionChanged: true,
          durationMs: Date.now() - startedAt
        },
        'Manuscript section moved'
      )
      return sectionFromRow(row)
    } catch (err) {
      this.#logFailure('manuscript.section.move_failed', err, startedAt, {
        sectionId: parsed.sectionId
      })
      throw err
    }
  }

  deleteSection(input: DeleteSectionInput): void {
    const parsed = deleteSectionInputSchema.parse(input)
    const sectionId = parsed.sectionId
    const startedAt = Date.now()
    try {
      const manuscriptId = this.#database.immediate((database) => {
        const manuscript = this.#primary(database)
        assertOutlineVersion(manuscript, parsed.baseOutlineVersion)
        const rows = this.#repository.sections(manuscript.manuscript_id, database)
        const target = rows.find((item) => item.section_id === sectionId)
        if (target === undefined)
          throw new ManuscriptDomainError('section_not_found', 'Section does not exist')
        if (rows.length === 1)
          throw new ManuscriptDomainError('section_is_last', 'The last section cannot be deleted')
        if (rows.some((item) => item.parent_section_id === sectionId)) {
          throw new ManuscriptDomainError(
            'section_has_children',
            'A section with children cannot be deleted'
          )
        }
        try {
          this.#deletionGuard.assertCanDelete(database, sectionId)
        } catch (err) {
          if (err instanceof ManuscriptDomainError) throw err
          this.#logFailure('manuscript.section.deletion_guard_failed', err, startedAt, {
            sectionId
          })
          throw new ManuscriptDomainError(
            'section_deletion_blocked',
            'Section deletion is blocked',
            { cause: err }
          )
        }
        const now = this.#now().toISOString()
        const deleted = database
          .prepare(
            `UPDATE sections SET deleted_at = ?, updated_at = ?
              WHERE section_id = ? AND deleted_at IS NULL`
          )
          .run(now, now, sectionId)
        if (deleted.changes !== 1) {
          throw new ManuscriptDomainError('section_not_found', 'Section does not exist')
        }
        database.prepare('DELETE FROM section_materializations WHERE section_id = ?').run(sectionId)
        const siblings = siblingRows(rows, target.parent_section_id).filter(
          (item) => item.section_id !== sectionId
        )
        parkSiblings(database, manuscript.manuscript_id, target.parent_section_id)
        normalizeSiblings(database, siblings)
        incrementOutline(database, manuscript.manuscript_id, now)
        return manuscript.manuscript_id
      })
      this.#log.info(
        {
          event: 'manuscript.section.deleted',
          projectId: this.#projectId,
          manuscriptId,
          sectionId,
          durationMs: Date.now() - startedAt
        },
        'Manuscript section deleted'
      )
    } catch (err) {
      this.#logFailure('manuscript.section.delete_failed', err, startedAt, { sectionId })
      throw err
    }
  }

  getRevision(revisionId: string): SectionRevision {
    const row = this.#repository.revision(revisionId)
    if (row === undefined) {
      throw new ManuscriptDomainError(
        'section_revision_not_found',
        'Section revision does not exist'
      )
    }
    return revisionFromRow(row)
  }

  appendRevision(input: AppendSectionRevisionInput): SectionRevision {
    const revisionId = this.#createId()
    const now = this.#now().toISOString()
    const startedAt = Date.now()
    try {
      const parsed = appendSectionRevisionInputSchema.parse(input)
      if (parsed.source !== 'manual' && parsed.source !== 'import') {
        throw new TypeError('Editor persistence only permits manual and import revision appends')
      }
      const hasAnyLineage =
        parsed.agentRunId !== null ||
        parsed.agentToolCallId !== null ||
        parsed.agentProposalId !== null
      if (hasAnyLineage) throw new TypeError('Editor revisions cannot include agent lineage')
      const prepared = prepareSectionContent(parsed.content, parsed.sectionId)
      const row = this.#database.immediate((database) => {
        const manuscript = this.#primary(database)
        const section = this.#repository.section(parsed.sectionId, database)
        if (section === undefined || section.manuscript_id !== manuscript.manuscript_id) {
          throw new ManuscriptDomainError('section_not_found', 'Section does not exist')
        }
        const current = this.#repository.revision(section.current_revision_id, database)
        if (current === undefined) throw new Error('Section current revision is missing')
        assertCurrentCountAlgorithm(current)
        if (current.content_hash === prepared.contentHash) return current
        if (
          current.section_revision_id !== parsed.baseRevisionId ||
          current.content_hash !== parsed.baseContentHash
        ) {
          throw new ManuscriptDomainError(
            'section_revision_conflict',
            'The section body has changed'
          )
        }
        insertRevision(database, {
          revisionId,
          sectionId: section.section_id,
          revisionNumber: current.revision_number + 1,
          source: parsed.source,
          sourceClass:
            parsed.sourceClass ?? (parsed.source === 'import' ? 'import' : 'manual_autosave'),
          prepared,
          priorRevisionId: current.section_revision_id,
          agentRunId: parsed.agentRunId,
          agentToolCallId: parsed.agentToolCallId,
          agentProposalId: parsed.agentProposalId,
          createdAt: now
        })
        recordRevisionAssetReferences(database, revisionId, prepared.content, now)
        const updated = database
          .prepare(
            `UPDATE sections SET current_revision_id = ?, updated_at = ?
              WHERE section_id = ? AND current_revision_id = ? AND deleted_at IS NULL`
          )
          .run(revisionId, now, section.section_id, current.section_revision_id)
        if (updated.changes !== 1) {
          throw new ManuscriptDomainError(
            'section_revision_conflict',
            'The section body has changed'
          )
        }
        return this.#repository.revision(revisionId, database) as SectionRevisionTable
      })
      this.#log.info(
        {
          event:
            row.section_revision_id === revisionId
              ? 'manuscript.revision.appended'
              : 'manuscript.revision.noop',
          projectId: this.#projectId,
          sectionId: row.section_id,
          sectionRevisionId: row.section_revision_id,
          revisionNumber: row.revision_number,
          wordCount: row.word_count,
          characterCount: row.character_count,
          durationMs: Date.now() - startedAt
        },
        row.section_revision_id === revisionId
          ? 'Section revision appended'
          : 'Identical section revision skipped'
      )
      return revisionFromRow(row)
    } catch (err) {
      this.#logFailure('manuscript.revision.append_failed', err, startedAt, {
        sectionId: typeof input.sectionId === 'string' ? input.sectionId : undefined,
        sectionRevisionId:
          typeof input.baseRevisionId === 'string' ? input.baseRevisionId : undefined
      })
      throw err
    }
  }

  applyReplacementBatch(input: {
    outlineVersion: number
    replacement: string
    sections: ReplacementBatchSection[]
  }): ReplacementBatchResult {
    const transactionStartedAt = performance.now()
    const rows = this.#database.immediate((database) => {
      const manuscript = this.#primary(database)
      assertOutlineVersion(manuscript, input.outlineVersion)
      const now = this.#now().toISOString()
      const result: SectionRevisionTable[] = []
      for (const planned of input.sections) {
        const section = this.#repository.section(planned.sectionId, database)
        if (section === undefined || section.manuscript_id !== manuscript.manuscript_id) {
          throw new ManuscriptDomainError('section_not_found', 'Section does not exist')
        }
        const current = this.#repository.revision(section.current_revision_id, database)
        if (current === undefined) throw new Error('Section current revision is missing')
        assertCurrentCountAlgorithm(current)
        if (
          current.section_revision_id !== planned.baseRevisionId ||
          current.content_hash !== planned.baseContentHash
        ) {
          throw new ManuscriptDomainError(
            'section_revision_conflict',
            'The section body has changed'
          )
        }
        const currentDocument = blockNoteDocumentSchema.parse(JSON.parse(current.content_json))
        const document = applyReplacementOperations(
          currentDocument,
          planned.operations,
          input.replacement
        )
        const prepared = prepareSectionContent(document, section.section_id)
        if (prepared.contentHash === current.content_hash) {
          throw new ManuscriptDomainError(
            'section_revision_conflict',
            'Replacement no longer changes the section body'
          )
        }
        const revisionId = this.#createId()
        insertRevision(database, {
          revisionId,
          sectionId: section.section_id,
          revisionNumber: current.revision_number + 1,
          source: 'manual',
          sourceClass: 'manual_checkpoint',
          prepared,
          priorRevisionId: current.section_revision_id,
          agentRunId: null,
          agentToolCallId: null,
          agentProposalId: null,
          createdAt: now
        })
        recordRevisionAssetReferences(database, revisionId, prepared.content, now)
        const updated = database
          .prepare(
            `UPDATE sections SET current_revision_id = ?, updated_at = ?
              WHERE section_id = ? AND current_revision_id = ? AND deleted_at IS NULL`
          )
          .run(revisionId, now, section.section_id, current.section_revision_id)
        if (updated.changes !== 1) {
          throw new ManuscriptDomainError(
            'section_revision_conflict',
            'The section body has changed'
          )
        }
        const row = this.#repository.revision(revisionId, database)
        if (row === undefined) throw new Error('Replacement revision was not stored')
        result.push(row)
      }
      return result
    })
    const transactionDurationMs = performance.now() - transactionStartedAt
    this.#log.info(
      {
        event: 'manuscript.replacement_batch.applied',
        projectId: this.#projectId,
        sectionCount: rows.length,
        replacementCount: input.sections.reduce(
          (total, section) => total + section.operations.length,
          0
        ),
        transactionDurationMs
      },
      'Replacement revisions applied atomically'
    )
    return { revisions: rows.map(revisionFromRow), transactionDurationMs }
  }

  undoReplacementRevision(input: {
    sectionId: string
    appliedRevisionId: string
  }): SectionRevision {
    const row = this.#database.immediate((database) => {
      const manuscript = this.#primary(database)
      const section = this.#repository.section(input.sectionId, database)
      if (section === undefined || section.manuscript_id !== manuscript.manuscript_id) {
        throw new ManuscriptDomainError('section_not_found', 'Section does not exist')
      }
      if (section.current_revision_id !== input.appliedRevisionId) {
        throw new ManuscriptDomainError('section_revision_conflict', 'The section body has changed')
      }
      const applied = this.#repository.revision(input.appliedRevisionId, database)
      if (
        applied === undefined ||
        applied.source !== 'manual' ||
        applied.source_class !== 'manual_checkpoint' ||
        applied.prior_revision_id === null
      ) {
        throw new ManuscriptDomainError(
          'section_revision_conflict',
          'Replacement revision is not undoable'
        )
      }
      const parent = this.#repository.revision(applied.prior_revision_id, database)
      if (parent === undefined || Number(parent.content_body_retained) !== 1) {
        throw new ManuscriptDomainError(
          'section_revision_conflict',
          'Replacement parent revision is unavailable'
        )
      }
      const document = blockNoteDocumentSchema.parse(JSON.parse(parent.content_json))
      const prepared = prepareSectionContent(document, section.section_id)
      const revisionId = this.#createId()
      const now = this.#now().toISOString()
      insertRevision(database, {
        revisionId,
        sectionId: section.section_id,
        revisionNumber: applied.revision_number + 1,
        source: 'undo',
        sourceClass: 'manual_checkpoint',
        prepared,
        priorRevisionId: applied.section_revision_id,
        agentRunId: null,
        agentToolCallId: null,
        agentProposalId: null,
        createdAt: now
      })
      recordRevisionAssetReferences(database, revisionId, prepared.content, now)
      const updated = database
        .prepare(
          `UPDATE sections SET current_revision_id = ?, updated_at = ?
            WHERE section_id = ? AND current_revision_id = ? AND deleted_at IS NULL`
        )
        .run(revisionId, now, section.section_id, applied.section_revision_id)
      if (updated.changes !== 1) {
        throw new ManuscriptDomainError('section_revision_conflict', 'The section body has changed')
      }
      const created = this.#repository.revision(revisionId, database)
      if (created === undefined) throw new Error('Replacement undo revision was not stored')
      return created
    })
    this.#log.info(
      {
        event: 'manuscript.replacement_undo.applied',
        projectId: this.#projectId,
        sectionId: row.section_id,
        sectionRevisionId: row.section_revision_id
      },
      'Replacement revision undone'
    )
    return revisionFromRow(row)
  }

  assemble(): ManuscriptAssembly {
    const snapshot = this.#database.immediate((database) => {
      const manuscript = this.#primary(database)
      const brief = this.#repository.latestBrief(manuscript.manuscript_id, database)
      if (brief === undefined) throw new Error('Primary manuscript brief is missing')
      const sections = orderOutline(
        this.#repository.sections(manuscript.manuscript_id, database)
      ).map((section) => {
        const revision = this.#repository.revision(section.current_revision_id, database)
        if (revision === undefined) throw new Error('Section current revision is missing')
        assertCurrentCountAlgorithm(revision)
        return { section, revision }
      })
      return { manuscript, brief, sections }
    })
    const sections = snapshot.sections.map(({ section, revision }) => ({
      section: sectionFromRow(section),
      revision: revisionFromRow(revision)
    }))
    return {
      manuscriptId: snapshot.manuscript.manuscript_id,
      outlineVersion: snapshot.manuscript.outline_version,
      brief: briefFromRow(snapshot.brief),
      sections,
      wordCount: sections.reduce((total, item) => total + item.revision.wordCount, 0),
      characterCount: sections.reduce((total, item) => total + item.revision.characterCount, 0)
    }
  }

  getWorkspace(): ManuscriptWorkspace {
    const snapshot = this.#database.immediate((database) => {
      const manuscript = this.#primary(database)
      const brief = this.#repository.latestBrief(manuscript.manuscript_id, database)
      if (brief === undefined) throw new Error('Primary manuscript brief is missing')
      const sections = orderOutline(
        this.#repository.sections(manuscript.manuscript_id, database)
      ).map((section) => {
        const revision = this.#repository.revision(section.current_revision_id, database)
        if (revision === undefined) throw new Error('Section current revision is missing')
        assertCurrentCountAlgorithm(revision)
        return { section, revision }
      })
      return { manuscript, brief, sections }
    })
    const sections = snapshot.sections.map(({ section, revision }) => {
      return { section: sectionFromRow(section), revision: revisionSummaryFromRow(revision) }
    })
    return {
      manuscriptId: snapshot.manuscript.manuscript_id,
      outlineVersion: snapshot.manuscript.outline_version,
      brief: briefFromRow(snapshot.brief),
      sections,
      wordCount: sections.reduce((total, item) => total + item.revision.wordCount, 0),
      characterCount: sections.reduce((total, item) => total + item.revision.characterCount, 0)
    }
  }

  getReferenceIndex(): ManuscriptReferenceIndex {
    const assembly = this.assemble()
    const index = buildManuscriptReferenceIndex(
      assembly.sections.map((item) => ({
        sectionId: item.section.sectionId,
        sectionRevisionId: item.revision.sectionRevisionId,
        content: item.revision.content
      }))
    )
    return { outlineVersion: assembly.outlineVersion, entries: index.entries }
  }

  #primary(database?: Database.Database): ManuscriptTable {
    const rows = this.#repository.primary(database)
    if (rows.length === 0)
      throw new ManuscriptDomainError('primary_manuscript_missing', 'Primary manuscript is missing')
    if (rows.length !== 1)
      throw new ManuscriptDomainError(
        'primary_manuscript_ambiguous',
        'Primary manuscript is ambiguous'
      )
    return rows[0] as ManuscriptTable
  }

  #logFailure(
    event: string,
    err: unknown,
    startedAt: number,
    fields: Record<string, unknown> = {}
  ): void {
    this.#log.error(
      { event, err, projectId: this.#projectId, durationMs: Date.now() - startedAt, ...fields },
      'Manuscript operation failed'
    )
  }
}

function briefFromRow(row: ManuscriptBriefTable): ManuscriptBrief {
  return {
    manuscriptBriefId: row.manuscript_brief_id,
    manuscriptId: row.manuscript_id,
    version: row.version,
    schemaVersion: MANUSCRIPT_BRIEF_SCHEMA_VERSION,
    title: row.title,
    description: row.description,
    topic: row.topic,
    targetAudience: row.target_audience,
    language: row.language,
    styleTone: row.style_tone,
    scopeExclusions: row.scope_exclusions,
    targetLength: row.target_length,
    citationRequirements: row.citation_requirements,
    additionalInstructions: row.additional_instructions,
    extensible: JSON.parse(row.extensible_json) as Record<string, unknown>,
    createdAt: row.created_at
  }
}

function sectionFromRow(row: SectionTable): Section {
  return {
    sectionId: row.section_id,
    manuscriptId: row.manuscript_id,
    parentSectionId: row.parent_section_id,
    position: row.position,
    level: row.level,
    title: row.title,
    objective: row.objective,
    status: row.status,
    currentRevisionId: row.current_revision_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function revisionFromRow(row: SectionRevisionTable): SectionRevision {
  const content = normalizeFigureMetadata(
    blockNoteDocumentSchema.parse(JSON.parse(row.content_json)),
    row.section_id
  )
  return {
    sectionRevisionId: row.section_revision_id,
    sectionId: row.section_id,
    revisionNumber: row.revision_number,
    source: row.source,
    sourceClass: row.source_class,
    content,
    contentSchemaVersion: contentSchemaVersionFromRow(row),
    contentHash: row.content_hash,
    priorRevisionId: row.prior_revision_id,
    wordCount: row.word_count,
    characterCount: row.character_count,
    countAlgorithmVersion: countAlgorithmVersionFromRow(row),
    agentRunId: row.agent_run_id,
    agentToolCallId: row.agent_tool_call_id,
    agentProposalId: row.agent_proposal_id,
    createdAt: row.created_at
  }
}

function revisionSummaryFromRow(row: SectionRevisionTable): SectionRevisionSummary {
  return {
    sectionRevisionId: row.section_revision_id,
    sectionId: row.section_id,
    revisionNumber: row.revision_number,
    source: row.source,
    sourceClass: row.source_class,
    contentSchemaVersion: contentSchemaVersionFromRow(row),
    contentHash: row.content_hash,
    priorRevisionId: row.prior_revision_id,
    wordCount: row.word_count,
    characterCount: row.character_count,
    countAlgorithmVersion: countAlgorithmVersionFromRow(row),
    agentRunId: row.agent_run_id,
    agentToolCallId: row.agent_tool_call_id,
    agentProposalId: row.agent_proposal_id,
    createdAt: row.created_at
  }
}

function contentSchemaVersionFromRow(row: SectionRevisionTable): 1 | 2 | 3 {
  if (
    row.content_schema_version !== 1 &&
    row.content_schema_version !== 2 &&
    row.content_schema_version !== 3
  ) {
    throw new Error('Section revision content schema version is unsupported')
  }
  return row.content_schema_version
}

function countAlgorithmVersionFromRow(row: SectionRevisionTable): 1 | 2 {
  if (row.count_algorithm_version !== 1 && row.count_algorithm_version !== 2) {
    throw new Error('Section revision count algorithm version is unsupported')
  }
  return row.count_algorithm_version
}

function assertCurrentCountAlgorithm(row: SectionRevisionTable): void {
  if (
    row.count_algorithm_version !== SECTION_COUNT_ALGORITHM_VERSION ||
    row.content_schema_version !== SECTION_CONTENT_SCHEMA_VERSION
  ) {
    throw new Error('Current section revision schema version is stale')
  }
}

function siblingRows(rows: SectionTable[], parentId: string | null): SectionTable[] {
  return rows
    .filter((row) => row.parent_section_id === parentId)
    .sort((left, right) => left.position - right.position)
}

function descendantIds(rows: SectionTable[], sectionId: string): Set<string> {
  const result = new Set<string>()
  const visit = (parentId: string): void => {
    for (const row of rows)
      if (row.parent_section_id === parentId) {
        result.add(row.section_id)
        visit(row.section_id)
      }
  }
  visit(sectionId)
  return result
}

function subtreeHeightFromRows(rows: SectionTable[], sectionId: string): number {
  const children = rows.filter((row) => row.parent_section_id === sectionId)
  if (children.length === 0) return 1
  return 1 + Math.max(...children.map((child) => subtreeHeightFromRows(rows, child.section_id)))
}

function orderOutline(rows: SectionTable[]): SectionTable[] {
  const ordered: SectionTable[] = []
  const visit = (parentId: string | null): void => {
    for (const row of siblingRows(rows, parentId)) {
      ordered.push(row)
      visit(row.section_id)
    }
  }
  visit(null)
  if (ordered.length !== rows.length)
    throw new Error('Manuscript outline is disconnected or cyclic')
  return ordered
}

function parkSiblings(
  database: Database.Database,
  manuscriptId: string,
  parentId: string | null
): void {
  if (parentId === null)
    database
      .prepare(
        `UPDATE sections SET position = position + ?
          WHERE manuscript_id = ? AND parent_section_id IS NULL AND deleted_at IS NULL`
      )
      .run(POSITION_OFFSET, manuscriptId)
  else
    database
      .prepare(
        `UPDATE sections SET position = position + ?
          WHERE manuscript_id = ? AND parent_section_id = ? AND deleted_at IS NULL`
      )
      .run(POSITION_OFFSET, manuscriptId, parentId)
}

function normalizeSiblings(
  database: Database.Database,
  rows: SectionTable[],
  movedId?: string,
  parentId?: string | null
): void {
  rows.forEach((row, position) => {
    if (row.section_id === movedId)
      database
        .prepare(
          `UPDATE sections SET parent_section_id = ?, position = ?
            WHERE section_id = ? AND deleted_at IS NULL`
        )
        .run(parentId ?? null, position, row.section_id)
    else
      database
        .prepare('UPDATE sections SET position = ? WHERE section_id = ? AND deleted_at IS NULL')
        .run(position, row.section_id)
  })
}

function incrementOutline(database: Database.Database, manuscriptId: string, now: string): void {
  database
    .prepare(
      'UPDATE manuscripts SET outline_version = outline_version + 1, updated_at = ? WHERE manuscript_id = ?'
    )
    .run(now, manuscriptId)
}

function assertOutlineVersion(manuscript: ManuscriptTable, baseOutlineVersion: number): void {
  if (manuscript.outline_version !== baseOutlineVersion) {
    throw new ManuscriptDomainError(
      'outline_version_conflict',
      'The manuscript outline has changed'
    )
  }
}

function insertRevision(
  database: Database.Database,
  input: {
    revisionId: string
    sectionId: string
    revisionNumber: number
    source: SectionRevisionTable['source']
    sourceClass: SectionRevisionTable['source_class']
    prepared: ReturnType<typeof prepareSectionContent>
    priorRevisionId: string | null
    agentRunId: string | null
    agentToolCallId: string | null
    agentProposalId: string | null
    createdAt: string
  }
): void {
  database
    .prepare(
      `INSERT INTO section_revisions (section_revision_id, section_id, revision_number, source, source_class, content_json, content_schema_version, content_hash, prior_revision_id, word_count, character_count, count_algorithm_version, agent_run_id, agent_tool_call_id, agent_proposal_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.revisionId,
      input.sectionId,
      input.revisionNumber,
      input.source,
      input.sourceClass,
      input.prepared.contentJson,
      input.prepared.contentSchemaVersion,
      input.prepared.contentHash,
      input.priorRevisionId,
      input.prepared.wordCount,
      input.prepared.characterCount,
      input.prepared.countAlgorithmVersion,
      input.agentRunId,
      input.agentToolCallId,
      input.agentProposalId,
      input.createdAt
    )
}
