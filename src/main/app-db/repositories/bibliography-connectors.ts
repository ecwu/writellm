import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import type { BibliographyConnector } from '../../../shared/contracts/references'
import type { AppDatabase } from '../connection'

export interface BibliographyConnectorAuthority extends BibliographyConnector {
  readonly projectId: string
  readonly sourcePath: string
}

export class BibliographyConnectorRepository {
  constructor(
    private readonly database: AppDatabase,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  findForProject(projectId: string): BibliographyConnectorAuthority | null {
    const row = this.database.immediate(
      (database) =>
        database
          .prepare('SELECT * FROM bibliography_connectors WHERE project_id = ?')
          .get(projectId) as ConnectorRow | undefined
    )
    return row === undefined ? null : projectConnector(row)
  }

  find(connectorId: string): BibliographyConnectorAuthority | null {
    const row = this.database.immediate(
      (database) =>
        database
          .prepare('SELECT * FROM bibliography_connectors WHERE connector_id = ?')
          .get(connectorId) as ConnectorRow | undefined
    )
    return row === undefined ? null : projectConnector(row)
  }

  connect(options: {
    projectId: string
    sourcePath: string
    sourceFormat: 'better-csl-json' | 'bibtex'
  }): BibliographyConnectorAuthority {
    const existing = this.findForProject(options.projectId)
    const connectorId = existing?.connectorId ?? randomUUID()
    const now = this.now()
    this.database.immediate((database) => {
      database
        .prepare(
          `INSERT INTO bibliography_connectors (
            connector_id, project_id, source_path, source_basename, source_format, state,
            last_snapshot_sha256, last_error_code, last_refreshed_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'refreshing', NULL, NULL, NULL, ?, ?)
          ON CONFLICT(project_id) DO UPDATE SET
            source_path = excluded.source_path,
            source_basename = excluded.source_basename,
            source_format = excluded.source_format,
            state = 'refreshing',
            last_snapshot_sha256 = NULL,
            last_error_code = NULL,
            last_refreshed_at = NULL,
            updated_at = excluded.updated_at`
        )
        .run(
          connectorId,
          options.projectId,
          options.sourcePath,
          basename(options.sourcePath),
          options.sourceFormat,
          now,
          now
        )
    })
    const connected = this.find(connectorId)
    if (connected === null) throw new Error('Bibliography connector was not persisted')
    return connected
  }

  recordSuccess(connectorId: string, sourceFingerprint: string): BibliographyConnectorAuthority {
    const now = this.now()
    this.database.immediate((database) => {
      const result = database
        .prepare(
          `UPDATE bibliography_connectors
              SET state = 'ready', last_snapshot_sha256 = ?, last_error_code = NULL,
                  last_refreshed_at = ?, updated_at = ?
            WHERE connector_id = ?`
        )
        .run(sourceFingerprint, now, now, connectorId)
      if (result.changes !== 1) throw new Error('Bibliography connector is unavailable')
    })
    const connector = this.find(connectorId)
    if (connector === null) throw new Error('Bibliography connector is unavailable')
    return connector
  }

  recordFailure(connectorId: string, errorCode: string): BibliographyConnectorAuthority {
    const now = this.now()
    this.database.immediate((database) => {
      const result = database
        .prepare(
          `UPDATE bibliography_connectors
              SET state = 'error', last_error_code = ?, updated_at = ?
            WHERE connector_id = ?`
        )
        .run(errorCode, now, connectorId)
      if (result.changes !== 1) throw new Error('Bibliography connector is unavailable')
    })
    const connector = this.find(connectorId)
    if (connector === null) throw new Error('Bibliography connector is unavailable')
    return connector
  }
}

interface ConnectorRow {
  connector_id: string
  project_id: string
  source_path: string
  source_basename: string
  source_format: 'better-csl-json' | 'bibtex'
  state: 'ready' | 'refreshing' | 'error' | 'disconnected'
  last_snapshot_sha256: string | null
  last_error_code: string | null
  last_refreshed_at: string | null
  created_at: string
  updated_at: string
}

function projectConnector(row: ConnectorRow): BibliographyConnectorAuthority {
  return {
    connectorId: row.connector_id,
    projectId: row.project_id,
    sourcePath: row.source_path,
    sourceName: row.source_basename,
    sourceFormat: row.source_format,
    state: row.state,
    lastSnapshotSha256: row.last_snapshot_sha256,
    lastErrorCode: row.last_error_code,
    lastRefreshedAt: row.last_refreshed_at,
    updatedAt: row.updated_at
  }
}
