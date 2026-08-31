import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { Logger } from 'pino'
import type { KnowledgeItem } from '../../shared/contracts/knowledge'
import {
  bibliographyImportCandidateSchema,
  bibliographyImportIssueSchema,
  referenceItemSchema,
  referenceListResultSchema,
  type BibliographyConnector,
  type BibliographyImportTarget,
  type BibliographySnapshot,
  type CslItem,
  type ReferenceItem,
  type ReferenceSettings
} from '../../shared/contracts/references'
import type { ProjectDatabase } from '../project/project-database'
import {
  containerTitle,
  createCitationKey,
  issuedYear,
  type ParsedReferenceSource,
  type ParsedReferenceSourceItem
} from './reference-import-parser'

type ReferenceLog = Pick<Logger, 'info' | 'warn' | 'error'>

export class ReferenceLibraryService {
  readonly #database: ProjectDatabase
  readonly #log: ReferenceLog

  constructor(options: { database: ProjectDatabase; log: ReferenceLog }) {
    this.#database = options.database
    this.#log = options.log
  }

  ensureIncompleteForKnowledge(item: KnowledgeItem): ReferenceItem {
    const referenceId = item.knowledgeItemId
    const citationKey = `doc-${item.knowledgeItemId.replaceAll('-', '').toLowerCase()}`
    const now = new Date().toISOString()
    this.#database.immediate((database) => {
      database
        .prepare(
          `INSERT OR IGNORE INTO reference_items (
             reference_id, citation_key, csl_type, title, container_title, issued_year,
             doi, isbn, url, csl_json, metadata_completeness, created_at, updated_at
           ) VALUES (?, ?, 'document', ?, NULL, NULL, NULL, NULL, NULL, ?, 'incomplete', ?, ?)`
        )
        .run(
          referenceId,
          citationKey,
          item.displayName,
          JSON.stringify({ id: citationKey, type: 'document', title: item.displayName }),
          now,
          now
        )
      database
        .prepare(
          `INSERT OR IGNORE INTO knowledge_reference_links (
             reference_id, knowledge_item_id, relationship, created_at
           ) VALUES (?, ?, 'primary', ?)`
        )
        .run(referenceId, item.knowledgeItemId, now)
    })
    const created = this.list().find((reference) => reference.referenceId === referenceId)
    if (created === undefined) throw new Error('Incomplete Knowledge reference was not created')
    this.#log.info(
      {
        event: 'reference.knowledge_incomplete.created',
        referenceId,
        knowledgeItemId: item.knowledgeItemId
      },
      'Incomplete reference ensured for Knowledge item'
    )
    return created
  }

  list(query = ''): ReferenceItem[] {
    return this.#database.immediate((database) => {
      const normalizedQuery = query.trim().toLocaleLowerCase()
      const rows = database
        .prepare(
          `SELECT item.*,
                  COALESCE(binding.sync_status, 'unbound') AS sync_status,
                  EXISTS (
                    SELECT 1 FROM knowledge_reference_links AS link
                    JOIN active_parse_revisions AS active USING (knowledge_item_id)
                    WHERE link.reference_id = item.reference_id
                  ) AS evidence_available
             FROM reference_items AS item
             LEFT JOIN reference_import_bindings AS binding USING (reference_id)
            WHERE ? = ''
               OR lower(item.title) LIKE '%' || ? || '%'
               OR lower(item.citation_key) LIKE '%' || ? || '%'
               OR lower(COALESCE(item.container_title, '')) LIKE '%' || ? || '%'
               OR CAST(COALESCE(item.issued_year, '') AS TEXT) LIKE '%' || ? || '%'
               OR EXISTS (
                 SELECT 1 FROM reference_creators AS creator
                  WHERE creator.reference_id = item.reference_id
                    AND lower(COALESCE(creator.family_name, creator.literal_name, ''))
                        LIKE '%' || ? || '%'
               )
            ORDER BY lower(item.title), item.citation_key
            LIMIT 10000`
        )
        .all(
          normalizedQuery,
          normalizedQuery,
          normalizedQuery,
          normalizedQuery,
          normalizedQuery,
          normalizedQuery
        ) as ReferenceRow[]
      const creatorStatement = database.prepare(
        `SELECT role, ordinal, given_name, family_name, literal_name
           FROM reference_creators WHERE reference_id = ? ORDER BY role, ordinal`
      )
      const linkStatement = database
        .prepare(
          `SELECT knowledge_item_id FROM knowledge_reference_links
            WHERE reference_id = ? ORDER BY relationship, knowledge_item_id`
        )
        .pluck()
      return referenceListResultSchema.parse(
        rows.map((row) =>
          projectReference(
            row,
            creatorStatement.all(row.reference_id) as CreatorRow[],
            linkStatement.all(row.reference_id) as string[]
          )
        )
      )
    })
  }

  settings(): ReferenceSettings {
    return this.#database.immediate((database) => {
      const row = database
        .prepare(
          `SELECT style_id, locale, custom_style_sha256
             FROM reference_settings WHERE singleton_id = 1`
        )
        .get() as {
        style_id: string
        locale: string
        custom_style_sha256: string | null
      }
      return {
        styleId: row.style_id,
        locale: row.locale,
        customStyleSha256: row.custom_style_sha256
      }
    })
  }

  eligibleImportTargets(): BibliographyImportTarget[] {
    const targets: BibliographyImportTarget[] = []
    for (const reference of this.list()) {
      if (reference.metadataCompleteness === 'incomplete' && reference.syncStatus === 'unbound') {
        targets.push({
          referenceId: reference.referenceId,
          citationKey: reference.citationKey,
          title: reference.title,
          kind: 'complete_incomplete',
          knowledgeItemIds: reference.knowledgeItemIds
        })
      }
      if (reference.syncStatus === 'relink_required') {
        targets.push({
          referenceId: reference.referenceId,
          citationKey: reference.citationKey,
          title: reference.title,
          kind: 'relink',
          knowledgeItemIds: reference.knowledgeItemIds
        })
      }
    }
    return targets
  }

  setSettings(styleId: string, locale: string): ReferenceSettings {
    const now = new Date().toISOString()
    this.#database.immediate((database) => {
      database
        .prepare(
          `UPDATE reference_settings
              SET style_id = ?, locale = ?, custom_style_relative_path = NULL,
                  custom_style_sha256 = NULL, updated_at = ?
            WHERE singleton_id = 1`
        )
        .run(styleId, locale, now)
    })
    return this.settings()
  }

  formattingSettings(): ReferenceSettings & { customStyleRelativePath: string | null } {
    return this.#database.immediate((database) => {
      const row = database
        .prepare(
          `SELECT style_id, locale, custom_style_relative_path, custom_style_sha256
             FROM reference_settings WHERE singleton_id = 1`
        )
        .get() as {
        style_id: string
        locale: string
        custom_style_relative_path: string | null
        custom_style_sha256: string | null
      }
      return {
        styleId: row.style_id,
        locale: row.locale,
        customStyleRelativePath: row.custom_style_relative_path,
        customStyleSha256: row.custom_style_sha256
      }
    })
  }

  setCustomStyle(relativePath: string, sha256: string): ReferenceSettings {
    const now = new Date().toISOString()
    this.#database.immediate((database) => {
      database
        .prepare(
          `UPDATE reference_settings
              SET style_id = ?, custom_style_relative_path = ?, custom_style_sha256 = ?,
                  updated_at = ?
            WHERE singleton_id = 1`
        )
        .run(`custom-${sha256.slice(0, 16)}`, relativePath, sha256, now)
    })
    return this.settings()
  }

  synchronizeSnapshot(options: {
    connector: BibliographyConnector
    source: ParsedReferenceSource
    sourceFormat: 'better-csl-json' | 'bibtex'
  }): BibliographySnapshot {
    for (const issue of options.source.issues) {
      if (issue.cause !== undefined) {
        this.#log.warn(
          {
            event: 'reference.connector_entry.skipped',
            err: issue.cause,
            connectorId: options.connector.connectorId,
            entryIndex: issue.index,
            issueCode: issue.code
          },
          'Bibliography connector entry was skipped'
        )
      }
    }
    const bindingByUpstream = this.#database.immediate((database) => {
      const bindings = database
        .prepare(
          `SELECT reference_id, upstream_key, source_fingerprint
             FROM reference_import_bindings WHERE connector_id = ?`
        )
        .all(options.connector.connectorId) as Array<{
        reference_id: string
        upstream_key: string
        source_fingerprint: string
      }>
      const incoming = new Map(options.source.items.map((item) => [item.upstreamKey, item]))
      const now = new Date().toISOString()
      const transaction = database.transaction(() => {
        for (const binding of bindings) {
          const sourceItem = incoming.get(binding.upstream_key)
          if (sourceItem === undefined) {
            database
              .prepare(
                `UPDATE reference_import_bindings
                    SET sync_status = 'relink_required', updated_at = ?
                  WHERE reference_id = ?`
              )
              .run(now, binding.reference_id)
            continue
          }
          if (binding.source_fingerprint !== sourceItem.fingerprint) {
            updateReferenceMetadata(database, binding.reference_id, sourceItem.item, now)
          }
          database
            .prepare(
              `UPDATE reference_import_bindings
                  SET source_fingerprint = ?, sync_status = 'synced',
                      last_synced_at = ?, updated_at = ?
                WHERE reference_id = ?`
            )
            .run(sourceItem.fingerprint, now, now, binding.reference_id)
        }
      })
      transaction.immediate()
      return new Map(bindings.map((binding) => [binding.upstream_key, binding.reference_id]))
    })
    const reservedKeys = new Set(this.list().map((item) => item.citationKey))
    const candidates = options.source.items.map((sourceItem) => {
      const proposedCitationKey = createCitationKey({ ...sourceItem, reservedKeys })
      reservedKeys.add(proposedCitationKey)
      return bibliographyImportCandidateSchema.parse({
        candidateId: sourceItem.fingerprint,
        upstreamKey: sourceItem.upstreamKey,
        proposedCitationKey,
        title: sourceItem.item.title,
        authors: (sourceItem.item.author ?? []).map(formatCreator),
        containerTitle: containerTitle(sourceItem.item),
        issuedYear: issuedYear(sourceItem.item),
        alreadyImportedReferenceId: bindingByUpstream.get(sourceItem.upstreamKey) ?? null,
        attachmentCount: sourceItem.attachmentPaths.length
      })
    })
    this.#log.info(
      {
        event: 'reference.connector_snapshot.synchronized',
        connectorId: options.connector.connectorId,
        validItemCount: options.source.items.length,
        skippedItemCount: options.source.issues.length,
        importedBindingCount: bindingByUpstream.size
      },
      'Bibliography connector snapshot synchronized'
    )
    return {
      connector: options.connector,
      candidates,
      issues: options.source.issues.map((issue) =>
        bibliographyImportIssueSchema.parse({
          index: issue.index,
          upstreamKey: issue.upstreamKey,
          code: issue.code,
          message: issue.message
        })
      ),
      validItemCount: options.source.items.length,
      skippedItemCount: options.source.issues.length
    }
  }

  importCandidates(options: {
    connectorId: string
    sourceFormat: 'better-csl-json' | 'bibtex'
    source: ParsedReferenceSource
    candidateIds: ReadonlySet<string>
  }): ReferenceItem[] {
    const selected = options.source.items.filter((item) =>
      options.candidateIds.has(item.fingerprint)
    )
    if (selected.length !== options.candidateIds.size) {
      throw new Error('One or more bibliography candidates are stale or unavailable')
    }
    this.#database.immediate((database) => {
      const reservedKeys = new Set(
        database.prepare('SELECT citation_key FROM reference_items').pluck().all() as string[]
      )
      const now = new Date().toISOString()
      const transaction = database.transaction(() => {
        for (const sourceItem of selected) {
          const existing = database
            .prepare(
              `SELECT reference_id FROM reference_import_bindings
                WHERE connector_id = ? AND upstream_key = ?`
            )
            .pluck()
            .get(options.connectorId, sourceItem.upstreamKey)
          if (existing !== undefined) continue
          const referenceId = randomUUID()
          const citationKey = createCitationKey({ ...sourceItem, reservedKeys })
          reservedKeys.add(citationKey)
          insertReference(database, referenceId, citationKey, sourceItem, now)
          database
            .prepare(
              `INSERT INTO reference_import_bindings (
                reference_id, connector_id, upstream_key, source_format, source_fingerprint,
                sync_status, last_synced_at, created_at, updated_at
              ) VALUES (?, ?, ?, ?, ?, 'synced', ?, ?, ?)`
            )
            .run(
              referenceId,
              options.connectorId,
              sourceItem.upstreamKey,
              options.sourceFormat,
              sourceItem.fingerprint,
              now,
              now,
              now
            )
        }
      })
      transaction.immediate()
    })
    this.#log.info(
      {
        event: 'reference.import.completed',
        connectorId: options.connectorId,
        importedCount: selected.length
      },
      'Bibliography References imported'
    )
    return this.list()
  }

  materializeCandidate(options: {
    connectorId: string
    sourceFormat: 'better-csl-json' | 'bibtex'
    sourceItem: ParsedReferenceSourceItem
    targetReferenceId: string | null
  }): string {
    const referenceId = this.#database.immediate((database) => {
      const now = new Date().toISOString()
      const transaction = database.transaction(() => {
        const upstreamOwner = database
          .prepare(
            `SELECT reference_id FROM reference_import_bindings
              WHERE connector_id = ? AND upstream_key = ?`
          )
          .pluck()
          .get(options.connectorId, options.sourceItem.upstreamKey) as string | undefined
        if (upstreamOwner !== undefined) {
          if (options.targetReferenceId !== null && options.targetReferenceId !== upstreamOwner) {
            throw new Error('Bibliography candidate is already bound to another Reference')
          }
          return upstreamOwner
        }

        if (options.targetReferenceId !== null) {
          const target = database
            .prepare(
              `SELECT item.metadata_completeness, binding.connector_id, binding.sync_status
                 FROM reference_items AS item
                 LEFT JOIN reference_import_bindings AS binding USING (reference_id)
                WHERE item.reference_id = ?`
            )
            .get(options.targetReferenceId) as
            | {
                metadata_completeness: 'complete' | 'partial' | 'incomplete'
                connector_id: string | null
                sync_status: 'synced' | 'changed' | 'relink_required' | 'source_unavailable' | null
              }
            | undefined
          const mayComplete =
            target?.metadata_completeness === 'incomplete' && target.connector_id === null
          const mayRelink =
            target?.connector_id === options.connectorId && target.sync_status === 'relink_required'
          if (!mayComplete && !mayRelink) {
            throw new Error('Selected Reference is not eligible for completion or relinking')
          }
          updateReferenceMetadata(database, options.targetReferenceId, options.sourceItem.item, now)
          if (mayRelink) {
            database
              .prepare(
                `UPDATE reference_import_bindings
                    SET upstream_key = ?, source_format = ?, source_fingerprint = ?,
                        sync_status = 'synced', last_synced_at = ?, updated_at = ?
                  WHERE reference_id = ?`
              )
              .run(
                options.sourceItem.upstreamKey,
                options.sourceFormat,
                options.sourceItem.fingerprint,
                now,
                now,
                options.targetReferenceId
              )
          } else {
            database
              .prepare(
                `INSERT INTO reference_import_bindings (
                  reference_id, connector_id, upstream_key, source_format, source_fingerprint,
                  sync_status, last_synced_at, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, 'synced', ?, ?, ?)`
              )
              .run(
                options.targetReferenceId,
                options.connectorId,
                options.sourceItem.upstreamKey,
                options.sourceFormat,
                options.sourceItem.fingerprint,
                now,
                now,
                now
              )
          }
          return options.targetReferenceId
        }

        const reservedKeys = new Set(
          database.prepare('SELECT citation_key FROM reference_items').pluck().all() as string[]
        )
        const createdReferenceId = randomUUID()
        const citationKey = createCitationKey({ ...options.sourceItem, reservedKeys })
        insertReference(database, createdReferenceId, citationKey, options.sourceItem, now)
        database
          .prepare(
            `INSERT INTO reference_import_bindings (
              reference_id, connector_id, upstream_key, source_format, source_fingerprint,
              sync_status, last_synced_at, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'synced', ?, ?, ?)`
          )
          .run(
            createdReferenceId,
            options.connectorId,
            options.sourceItem.upstreamKey,
            options.sourceFormat,
            options.sourceItem.fingerprint,
            now,
            now,
            now
          )
        return createdReferenceId
      })
      return transaction.immediate()
    })
    this.#log.info(
      {
        event: 'reference.import.materialized',
        connectorId: options.connectorId,
        referenceId,
        targetMode: options.targetReferenceId === null ? 'new' : 'existing'
      },
      'Bibliography Reference materialized'
    )
    return referenceId
  }

  attachKnowledgeFailClosed(
    referenceId: string,
    knowledgeItemId: string,
    relationship: 'primary' | 'supplement'
  ): { state: 'linked' | 'already' | 'conflict'; conflictingReferenceId: string | null } {
    const result = this.#database.immediate((database) => {
      const existing = database
        .prepare(
          `SELECT reference_id, relationship FROM knowledge_reference_links
            WHERE knowledge_item_id = ?`
        )
        .get(knowledgeItemId) as
        | { reference_id: string; relationship: 'primary' | 'supplement' }
        | undefined
      if (existing !== undefined && existing.reference_id !== referenceId) {
        return { state: 'conflict' as const, conflictingReferenceId: existing.reference_id }
      }
      const now = new Date().toISOString()
      const transaction = database.transaction(() => {
        if (relationship === 'primary') {
          database
            .prepare(
              `UPDATE knowledge_reference_links SET relationship = 'supplement'
                WHERE reference_id = ? AND relationship = 'primary'`
            )
            .run(referenceId)
        }
        if (existing === undefined) {
          database
            .prepare(
              `INSERT INTO knowledge_reference_links
                (reference_id, knowledge_item_id, relationship, created_at)
               VALUES (?, ?, ?, ?)`
            )
            .run(referenceId, knowledgeItemId, relationship, now)
        } else if (existing.relationship !== relationship) {
          database
            .prepare(
              `UPDATE knowledge_reference_links SET relationship = ?
                WHERE reference_id = ? AND knowledge_item_id = ?`
            )
            .run(relationship, referenceId, knowledgeItemId)
        }
      })
      transaction.immediate()
      return {
        state:
          existing !== undefined && existing.relationship === relationship
            ? ('already' as const)
            : ('linked' as const),
        conflictingReferenceId: null
      }
    })
    this.#log.info(
      {
        event: 'reference.knowledge_attachment.resolved',
        referenceId,
        knowledgeItemId,
        relationship,
        resolution: result.state
      },
      'Knowledge attachment association resolved'
    )
    return result
  }

  referenceIdForBinding(connectorId: string, upstreamKey: string): string | null {
    return this.#database.immediate(
      (database) =>
        (database
          .prepare(
            `SELECT reference_id FROM reference_import_bindings
              WHERE connector_id = ? AND upstream_key = ?`
          )
          .pluck()
          .get(connectorId, upstreamKey) as string | undefined) ?? null
    )
  }

  referenceIdForKnowledge(knowledgeItemId: string): string | null {
    return this.#database.immediate(
      (database) =>
        (database
          .prepare(`SELECT reference_id FROM knowledge_reference_links WHERE knowledge_item_id = ?`)
          .pluck()
          .get(knowledgeItemId) as string | undefined) ?? null
    )
  }

  linkKnowledge(
    referenceId: string,
    knowledgeItemId: string,
    relationship: 'primary' | 'supplement' = 'primary'
  ): void {
    const now = new Date().toISOString()
    this.#database.immediate((database) => {
      const transaction = database.transaction(() => {
        if (relationship === 'primary') {
          database
            .prepare(
              `UPDATE knowledge_reference_links SET relationship = 'supplement'
                WHERE reference_id = ? AND relationship = 'primary'`
            )
            .run(referenceId)
        }
        database
          .prepare(
            `INSERT INTO knowledge_reference_links
              (reference_id, knowledge_item_id, relationship, created_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(knowledge_item_id) DO UPDATE SET
               reference_id = excluded.reference_id,
               relationship = excluded.relationship`
          )
          .run(referenceId, knowledgeItemId, relationship, now)
      })
      transaction.immediate()
    })
    this.#log.info(
      {
        event: 'reference.knowledge_link.completed',
        referenceId,
        knowledgeItemId,
        relationship
      },
      'Knowledge source linked to Reference'
    )
  }
}

interface ReferenceRow {
  reference_id: string
  citation_key: string
  csl_type: string
  title: string
  container_title: string | null
  issued_year: number | null
  doi: string | null
  isbn: string | null
  url: string | null
  csl_json: string
  metadata_completeness: 'complete' | 'partial' | 'incomplete'
  sync_status: 'unbound' | 'synced' | 'changed' | 'relink_required' | 'source_unavailable'
  evidence_available: number
  created_at: string
  updated_at: string
}

interface CreatorRow {
  role: 'author' | 'editor' | 'translator' | 'container-author'
  ordinal: number
  given_name: string | null
  family_name: string | null
  literal_name: string | null
}

function projectReference(
  row: ReferenceRow,
  creators: CreatorRow[],
  links: string[]
): ReferenceItem {
  return referenceItemSchema.parse({
    referenceId: row.reference_id,
    citationKey: row.citation_key,
    cslType: row.csl_type,
    title: row.title,
    containerTitle: row.container_title,
    issuedYear: row.issued_year,
    doi: row.doi,
    isbn: row.isbn,
    url: row.url,
    csl: JSON.parse(row.csl_json) as unknown,
    creators: creators.map((creator) => ({
      role: creator.role,
      ordinal: creator.ordinal,
      given: creator.given_name,
      family: creator.family_name,
      literal: creator.literal_name
    })),
    metadataCompleteness: row.metadata_completeness,
    syncStatus: row.sync_status,
    evidenceAvailable: row.evidence_available === 1,
    knowledgeItemIds: links,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  })
}

function insertReference(
  database: Database.Database,
  referenceId: string,
  citationKey: string,
  source: ParsedReferenceSourceItem,
  now: string
): void {
  const item = { ...source.item, id: citationKey, 'citation-key': citationKey }
  database
    .prepare(
      `INSERT INTO reference_items (
        reference_id, citation_key, csl_type, title, container_title, issued_year,
        doi, isbn, url, csl_json, metadata_completeness, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      referenceId,
      citationKey,
      item.type,
      item.title,
      containerTitle(item),
      issuedYear(item),
      item.DOI ?? null,
      Array.isArray(item.ISBN) ? (item.ISBN[0] ?? null) : (item.ISBN ?? null),
      item.URL ?? null,
      JSON.stringify(item),
      completeness(item),
      now,
      now
    )
  replaceCreators(database, referenceId, item)
}

function updateReferenceMetadata(
  database: Database.Database,
  referenceId: string,
  item: CslItem,
  now: string
): void {
  const citationKey = database
    .prepare('SELECT citation_key FROM reference_items WHERE reference_id = ?')
    .pluck()
    .get(referenceId) as string
  const canonical = { ...item, id: citationKey, 'citation-key': citationKey }
  database
    .prepare(
      `UPDATE reference_items
          SET csl_type = ?, title = ?, container_title = ?, issued_year = ?, doi = ?, isbn = ?,
              url = ?, csl_json = ?, metadata_completeness = ?, updated_at = ?
        WHERE reference_id = ?`
    )
    .run(
      canonical.type,
      canonical.title,
      containerTitle(canonical),
      issuedYear(canonical),
      canonical.DOI ?? null,
      Array.isArray(canonical.ISBN) ? (canonical.ISBN[0] ?? null) : (canonical.ISBN ?? null),
      canonical.URL ?? null,
      JSON.stringify(canonical),
      completeness(canonical),
      now,
      referenceId
    )
  replaceCreators(database, referenceId, canonical)
}

function replaceCreators(database: Database.Database, referenceId: string, item: CslItem): void {
  database.prepare('DELETE FROM reference_creators WHERE reference_id = ?').run(referenceId)
  const insert = database.prepare(
    `INSERT INTO reference_creators
      (reference_id, role, ordinal, given_name, family_name, literal_name)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
  for (const role of ['author', 'editor', 'translator', 'container-author'] as const) {
    for (const [ordinal, creator] of (item[role] ?? []).entries()) {
      insert.run(
        referenceId,
        role,
        ordinal,
        creator.given ?? null,
        creator.family ?? null,
        creator.literal ?? null
      )
    }
  }
}

function completeness(item: CslItem): 'complete' | 'partial' {
  return (item.author?.length ?? 0) > 0 && issuedYear(item) !== null ? 'complete' : 'partial'
}

function formatCreator(creator: { given?: string; family?: string; literal?: string }): string {
  return creator.literal ?? [creator.given, creator.family].filter(Boolean).join(' ')
}
