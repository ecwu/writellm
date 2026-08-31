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
      onStored: (item, context) => {
        if (context.ensureIncompleteReference) references.ensureIncompleteForKnowledge(item)
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

    const completion = parseReferenceSource(
      JSON.stringify([
        {
          id: 'completed-local',
          'citation-key': 'upstream-local-key',
          type: 'article-journal',
          title: 'Completed local evidence',
          author: [{ family: 'Wu' }],
          issued: { 'date-parts': [[2026]] }
        }
      ]),
      'better-csl-json'
    )
    const completionItem = completion.items[0]
    if (completionItem === undefined) throw new Error('Completion fixture did not parse')
    references.materializeCandidate({
      connectorId: '44444444-4444-4444-8444-444444444444',
      sourceFormat: 'better-csl-json',
      sourceItem: completionItem,
      targetReferenceId: item?.knowledgeItemId ?? null
    })
    expect(references.list()[0]).toMatchObject({
      referenceId: item?.knowledgeItemId,
      citationKey: `doc-${item?.knowledgeItemId.replaceAll('-', '')}`,
      title: 'Completed local evidence',
      syncStatus: 'synced'
    })

    const bibliographyPdf = join(parent, 'Bibliography evidence.pdf')
    await writeFile(bibliographyPdf, '%PDF-1.7\nbibliography evidence')
    const imported = await imports.importPathWithIdentity(bibliographyPdf, {
      ensureIncompleteReference: false
    })
    expect(references.list()).toHaveLength(1)
    const parsed = parseReferenceSource(
      JSON.stringify([
        {
          id: 'unified-import',
          'citation-key': 'unified2026',
          type: 'article-journal',
          title: 'Unified import',
          author: [{ family: 'Wu' }],
          issued: { 'date-parts': [[2026]] }
        }
      ]),
      'better-csl-json'
    )
    const parsedItem = parsed.items[0]
    if (parsedItem === undefined) throw new Error('Bibliography fixture did not parse')
    const referenceId = references.materializeCandidate({
      connectorId: '55555555-5555-4555-8555-555555555555',
      sourceFormat: 'better-csl-json',
      sourceItem: parsedItem,
      targetReferenceId: null
    })
    expect(
      references.attachKnowledgeFailClosed(referenceId, imported.knowledgeItemId, 'primary')
    ).toMatchObject({ state: 'linked' })
    expect(references.list()).toHaveLength(2)
    expect(
      references.list().find((reference) => reference.referenceId === referenceId)
    ).toMatchObject({
      citationKey: 'unified2026',
      title: 'Unified import',
      knowledgeItemIds: [imported.knowledgeItemId]
    })
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
    const existingReferenceId = service.list()[0]?.referenceId
    expect(existingReferenceId).toBeDefined()
    const changedItem = changed.items[0]
    if (changedItem === undefined) throw new Error('Changed fixture did not parse')
    service.materializeCandidate({
      connectorId: connector.connectorId,
      sourceFormat: 'better-csl-json',
      sourceItem: changedItem,
      targetReferenceId: existingReferenceId ?? null
    })
    expect(service.list()).toMatchObject([
      {
        referenceId: existingReferenceId,
        citationKey: 'smith2024',
        title: 'Synchronized title',
        syncStatus: 'synced'
      }
    ])
    database.close()
  })
})
