import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it } from 'vitest'
import { KnowledgeImportService } from '../knowledge/knowledge-import-service'
import { initializeProjectDatabase } from '../project/project-database'
import { ReferenceLibraryService } from './reference-library-service'
import { parseReferenceSource } from './reference-import-parser'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

describe('ReferenceLibraryService', () => {
  it('creates and links a stable incomplete reference for a newly stored Knowledge file', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'writellm-reference-knowledge-'))
    temporaryDirectories.push(parent)
    const projectRoot = join(parent, 'project')
    await mkdir(projectRoot)
    const projectId = '019c6a5c-8d34-7a8e-a602-3d37a52dc098'
    const database = await initializeProjectDatabase({
      projectRoot,
      manifest: {
        format: 'writellm-project',
        formatVersion: 1,
        projectId,
        createdAt: '2026-08-31T00:00:00.000Z'
      },
      applicationVersion: '1.0.0-test',
      log: pino({ level: 'silent' })
    })
    const references = new ReferenceLibraryService({ database, log: pino({ level: 'silent' }) })
    const imports = new KnowledgeImportService({
      projectRoot,
      projectId,
      database,
      log: pino({ level: 'silent' }),
      onStored: (item) => {
        references.ensureIncompleteForKnowledge(item)
      }
    })
    const source = join(parent, 'New evidence.pdf')
    await writeFile(source, '%PDF-1.7\nnew evidence')
    const [item] = await imports.importPaths([source])

    expect(references.list()).toMatchObject([
      {
        referenceId: item?.knowledgeItemId,
        citationKey: `doc-${item?.knowledgeItemId.replaceAll('-', '')}`,
        title: 'New evidence.pdf',
        metadataCompleteness: 'incomplete',
        knowledgeItemIds: [item?.knowledgeItemId]
      }
    ])
    database.close()
  })

  it('imports selected metadata only and keeps the project key stable across synchronization', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'writellm-reference-library-'))
    temporaryDirectories.push(parent)
    const projectRoot = join(parent, 'project')
    await mkdir(projectRoot)
    const database = await initializeProjectDatabase({
      projectRoot,
      manifest: {
        format: 'writellm-project',
        formatVersion: 1,
        projectId: '019c6a5c-8d34-7a8e-a602-3d37a52dc099',
        createdAt: '2026-08-31T00:00:00.000Z'
      },
      applicationVersion: '1.0.0-test',
      log: pino({ level: 'silent' })
    })
    const service = new ReferenceLibraryService({ database, log: pino({ level: 'silent' }) })
    const connector = {
      connectorId: '019c6a5c-8d34-7a8e-a602-3d37a52dc100',
      sourceName: 'library.json',
      sourceFormat: 'better-csl-json' as const,
      state: 'ready' as const,
      lastSnapshotSha256: null,
      lastErrorCode: null,
      lastRefreshedAt: null,
      updatedAt: '2026-08-31T00:00:00.000Z'
    }
    const initial = parseReferenceSource(
      JSON.stringify([
        {
          id: 'upstream-1',
          'citation-key': 'smith2024',
          type: 'article-journal',
          title: 'Initial title',
          author: [{ family: 'Smith' }],
          issued: { 'date-parts': [[2024]] }
        }
      ]),
      'better-csl-json'
    )
    const snapshot = service.synchronizeSnapshot({
      connector,
      source: initial,
      sourceFormat: 'better-csl-json'
    })
    service.importCandidates({
      connectorId: connector.connectorId,
      sourceFormat: 'better-csl-json',
      source: initial,
      candidateIds: new Set([snapshot.candidates[0]?.candidateId ?? ''])
    })
    expect(service.list()).toMatchObject([
      {
        citationKey: 'smith2024',
        title: 'Initial title',
        evidenceAvailable: false,
        knowledgeItemIds: []
      }
    ])

    const changed = parseReferenceSource(
      JSON.stringify([
        {
          id: 'upstream-1',
          'citation-key': 'upstream-renamed-key',
          type: 'article-journal',
          title: 'Synchronized title',
          author: [{ family: 'Smith' }],
          issued: { 'date-parts': [[2025]] }
        }
      ]),
      'better-csl-json'
    )
    service.synchronizeSnapshot({
      connector,
      source: changed,
      sourceFormat: 'better-csl-json'
    })
    expect(service.list()).toMatchObject([
      {
        citationKey: 'smith2024',
        title: 'Initial title',
        syncStatus: 'relink_required'
      }
    ])
    database.close()
  })
})
