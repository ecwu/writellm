import type Database from 'better-sqlite3'
import type { BlockNoteDocument } from '../../shared/contracts/manuscript'
import type { PreparedSectionContent } from './content'
import { prepareSectionContent } from './content'
import { recordRevisionAssetReferences } from './asset-service'
import type { SectionRevisionTable, SectionStatus, SectionTable } from '../project/database-types'

export interface SectionRevisionWriteInput {
  revisionId: string
  sectionId: string
  revisionNumber: number
  source: SectionRevisionTable['source']
  sourceClass: SectionRevisionTable['source_class']
  content?: BlockNoteDocument
  prepared?: PreparedSectionContent
  priorRevisionId: string | null
  agentRunId: string | null
  agentToolCallId: string | null
  agentProposalId: string | null
  createdAt: string
}

export interface SectionInsertInput {
  sectionId: string
  manuscriptId: string
  parentSectionId: string | null
  position: number
  level: number
  title: string
  objective: string | null
  status: SectionStatus
  currentRevisionId: string
  createdAt: string
  updatedAt: string
}

export interface SectionNodeUpdateInput {
  sectionId: string
  manuscriptId: string
  parentSectionId: string | null
  position: number
  level: number
  title: string
  objective: string | null
  status: SectionStatus
  updatedAt: string
}

/**
 * Shared prepared-SQL writes for authoritative manuscript section state.
 * Callers own the surrounding transaction and domain validation.
 */
export const SectionRepository = {
  POSITION_OFFSET: 1_000_000_000,

  insertSection(database: Database.Database, input: SectionInsertInput): SectionTable {
    database
      .prepare(
        `INSERT INTO sections (
          section_id, manuscript_id, parent_section_id, position, level, title, objective,
          status, current_revision_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.sectionId,
        input.manuscriptId,
        input.parentSectionId,
        input.position,
        input.level,
        input.title,
        input.objective,
        input.status,
        input.currentRevisionId,
        input.createdAt,
        input.updatedAt
      )
    const row = database
      .prepare('SELECT * FROM sections WHERE section_id = ?')
      .get(input.sectionId) as SectionTable | undefined
    if (row === undefined) throw new Error('Inserted manuscript section was not stored')
    return row
  },

  insertRevision(
    database: Database.Database,
    input: SectionRevisionWriteInput
  ): PreparedSectionContent {
    const prepared =
      input.prepared ??
      (input.content === undefined
        ? (() => {
            throw new TypeError('Section revision content is required')
          })()
        : prepareSectionContent(input.content, input.sectionId))
    database
      .prepare(
        `INSERT INTO section_revisions (
           section_revision_id, section_id, revision_number, source, source_class,
           content_json, content_schema_version, content_hash, prior_revision_id,
           word_count, character_count, count_algorithm_version, agent_run_id,
           agent_tool_call_id, agent_proposal_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.revisionId,
        input.sectionId,
        input.revisionNumber,
        input.source,
        input.sourceClass,
        prepared.contentJson,
        prepared.contentSchemaVersion,
        prepared.contentHash,
        input.priorRevisionId,
        prepared.wordCount,
        prepared.characterCount,
        prepared.countAlgorithmVersion,
        input.agentRunId,
        input.agentToolCallId,
        input.agentProposalId,
        input.createdAt
      )
    recordRevisionAssetReferences(database, input.revisionId, prepared.content, input.createdAt)
    return prepared
  },

  updateCurrentRevision(
    database: Database.Database,
    input: {
      sectionId: string
      expectedRevisionId: string
      revisionId: string
      updatedAt: string
    }
  ): boolean {
    const result = database
      .prepare(
        `UPDATE sections SET current_revision_id = ?, updated_at = ?
          WHERE section_id = ? AND current_revision_id = ? AND deleted_at IS NULL`
      )
      .run(input.revisionId, input.updatedAt, input.sectionId, input.expectedRevisionId)
    return result.changes === 1
  },

  updateNode(database: Database.Database, input: SectionNodeUpdateInput): boolean {
    const result = database
      .prepare(
        `UPDATE sections
            SET parent_section_id = ?, position = ?, level = ?, title = ?,
                objective = ?, status = ?, updated_at = ?
          WHERE section_id = ? AND manuscript_id = ? AND deleted_at IS NULL`
      )
      .run(
        input.parentSectionId,
        input.position,
        input.level,
        input.title,
        input.objective,
        input.status,
        input.updatedAt,
        input.sectionId,
        input.manuscriptId
      )
    return result.changes === 1
  },

  updateHierarchy(
    database: Database.Database,
    input: {
      sectionId: string
      manuscriptId: string
      parentSectionId: string | null
      position: number
      level: number
      updatedAt: string
    }
  ): boolean {
    const result = database
      .prepare(
        `UPDATE sections SET parent_section_id = ?, position = ?, level = ?, updated_at = ?
          WHERE section_id = ? AND manuscript_id = ? AND deleted_at IS NULL`
      )
      .run(
        input.parentSectionId,
        input.position,
        input.level,
        input.updatedAt,
        input.sectionId,
        input.manuscriptId
      )
    return result.changes === 1
  },

  shiftLevel(
    database: Database.Database,
    input: { sectionId: string; levelDelta: number; updatedAt: string }
  ): boolean {
    const result = database
      .prepare(
        `UPDATE sections SET level = level + ?, updated_at = ?
          WHERE section_id = ? AND deleted_at IS NULL`
      )
      .run(input.levelDelta, input.updatedAt, input.sectionId)
    return result.changes === 1
  },

  updateMetadata(
    database: Database.Database,
    input: {
      sectionId: string
      title: string
      objective: string | null
      status: SectionStatus
      updatedAt: string
    }
  ): SectionTable | undefined {
    return database
      .prepare(
        `UPDATE sections SET title = ?, objective = ?, status = ?, updated_at = ?
          WHERE section_id = ? AND deleted_at IS NULL RETURNING *`
      )
      .get(input.title, input.objective, input.status, input.updatedAt, input.sectionId) as
      | SectionTable
      | undefined
  },

  tombstone(database: Database.Database, sectionId: string, deletedAt: string): boolean {
    const result = database
      .prepare(
        `UPDATE sections SET deleted_at = ?, updated_at = ?
          WHERE section_id = ? AND deleted_at IS NULL`
      )
      .run(deletedAt, deletedAt, sectionId)
    return result.changes === 1
  },

  removeMaterialization(database: Database.Database, sectionId: string): void {
    database.prepare('DELETE FROM section_materializations WHERE section_id = ?').run(sectionId)
  },

  parkSiblings(
    database: Database.Database,
    manuscriptId: string,
    parentSectionId: string | null
  ): void {
    if (parentSectionId === null) {
      database
        .prepare(
          `UPDATE sections SET position = position + ?
            WHERE manuscript_id = ? AND parent_section_id IS NULL AND deleted_at IS NULL`
        )
        .run(SectionRepository.POSITION_OFFSET, manuscriptId)
      return
    }
    database
      .prepare(
        `UPDATE sections SET position = position + ?
          WHERE manuscript_id = ? AND parent_section_id = ? AND deleted_at IS NULL`
      )
      .run(SectionRepository.POSITION_OFFSET, manuscriptId, parentSectionId)
  },

  normalizeSiblings(
    database: Database.Database,
    rows: readonly Pick<SectionTable, 'section_id'>[],
    movedId?: string,
    parentSectionId?: string | null
  ): void {
    rows.forEach((row, position) => {
      if (row.section_id === movedId) {
        database
          .prepare(
            `UPDATE sections SET parent_section_id = ?, position = ?
              WHERE section_id = ? AND deleted_at IS NULL`
          )
          .run(parentSectionId ?? null, position, row.section_id)
        return
      }
      database
        .prepare('UPDATE sections SET position = ? WHERE section_id = ? AND deleted_at IS NULL')
        .run(position, row.section_id)
    })
  },

  parkAllPositions(database: Database.Database, manuscriptId: string): void {
    database
      .prepare(
        `UPDATE sections SET position = position + ?
          WHERE manuscript_id = ? AND deleted_at IS NULL`
      )
      .run(SectionRepository.POSITION_OFFSET, manuscriptId)
  }
}
