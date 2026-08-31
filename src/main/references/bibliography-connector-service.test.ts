import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import pino from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openAppDatabase } from '../app-db/connection'
import { BibliographyConnectorRepository } from '../app-db/repositories/bibliography-connectors'
import { KnowledgeImportService } from '../knowledge/knowledge-import-service'
import { initializeProjectDatabase } from '../project/project-database'
import { ReferenceLibraryService } from './reference-library-service'
import {
  BibliographyConnectorService,
  inspectSelectedSource,
  readStableSource,
  shouldRefreshBibliographyWatch
} from './bibliography-connector-service'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

describe('bibliography connector source boundary', () => {
  it('accepts only bounded regular JSON/BibTeX files and reads stable content', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'writellm-bibliography-'))
    const source = join(directory, 'library.json')
    await writeFile(source, '[{"id":"key","type":"article","title":"Paper"}]')
    await expect(inspectSelectedSource(source)).resolves.toMatchObject({
      path: await realpath(source),
      format: 'better-csl-json'
    })
    await expect(readStableSource(source)).resolves.toContain('Paper')
  })

  it('rejects symlink sources and unknown extensions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'writellm-bibliography-'))
    const source = join(directory, 'library.json')
    const linked = join(directory, 'linked.json')
    await writeFile(source, '[]')
    await symlink(source, linked)
    await expect(inspectSelectedSource(linked)).rejects.toThrow('non-symbolic-link')
    const unknown = join(directory, 'library.txt')
    await writeFile(unknown, '[]')
    await expect(inspectSelectedSource(unknown)).rejects.toThrow('unsupported')
  })

  it('refreshes exact-file change and rename events used for unlink/recreate replacement', () => {
    for (const event of ['change', 'rename']) {
      expect(shouldRefreshBibliographyWatch(event, 'library.json', 'library.json')).toBe(true)
      expect(
        shouldRefreshBibliographyWatch(event, Buffer.from('library.json'), 'library.json')
      ).toBe(true)
    }
    expect(shouldRefreshBibliographyWatch('rename', 'other.json', 'library.json')).toBe(false)
    expect(shouldRefreshBibliographyWatch('change', null, 'library.json')).toBe(false)
    expect(shouldRefreshBibliographyWatch('unknown', 'library.json', 'library.json')).toBe(false)
  })

  it('rejects a source whose size or mtime does not settle before reading', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'writellm-bibliography-changing-'))
    const source = join(directory, 'library.json')
    await writeFile(source, '[]')
    const reading = readStableSource(source)
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
    await writeFile(source, '[{"id":"later"}]')
    await expect(reading).rejects.toThrow('still changing')
  })

  it('queries Better BibTeX only during explicit PDF review and imports without an orphan Reference', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'writellm-reference-unified-'))
    temporaryDirectories.push(parent)
    const projectRoot = join(parent, 'project')
    await mkdir(projectRoot)
    const projectId = '66666666-6666-4666-8666-666666666666'
    const log = pino({ level: 'silent' })
    const appDatabase = await openAppDatabase({
      path: join(parent, 'app.sqlite'),
      applicationVersion: '1.0.0-test',
      log
    })
    const projectDatabase = await initializeProjectDatabase({
      projectRoot,
      manifest: {
        format: 'writellm-project',
        formatVersion: 1,
        projectId,
        createdAt: '2026-08-31T00:00:00.000Z'
      },
      applicationVersion: '1.0.0-test',
      log
    })
    const library = new ReferenceLibraryService({ database: projectDatabase, log })
    const imports = new KnowledgeImportService({
      projectRoot,
      projectId,
      database: projectDatabase,
      log,
      onStored: (item, context) => {
        if (context.ensureIncompleteReference) library.ensureIncompleteForKnowledge(item)
      }
    })
    const pdfPath = join(parent, 'paper.pdf')
    await writeFile(pdfPath, '%PDF-1.7\nunified reference')
    const sourcePath = join(parent, 'library.json')
    await writeFile(
      sourcePath,
      JSON.stringify([
        {
          id: 'paper',
          'citation-key': 'paper2026',
          type: 'article-journal',
          title: 'Unified Reference',
          author: [{ family: 'Wu' }],
          issued: { 'date-parts': [[2026]] }
        }
      ])
    )
    const resolveAttachmentPaths = vi.fn(async () => [pdfPath])
    const service = new BibliographyConnectorService({
      repository: new BibliographyConnectorRepository(appDatabase),
      log,
      resolveLibrary: (requestedProjectId) => (requestedProjectId === projectId ? library : null),
      resolveKnowledgeImports: (requestedProjectId) =>
        requestedProjectId === projectId ? imports : null,
      resolveAttachmentPaths
    })

    const snapshot = await service.connect(projectId, sourcePath)
    let candidateId = snapshot.candidates[0]?.candidateId
    expect(candidateId).toBeDefined()
    expect(resolveAttachmentPaths).not.toHaveBeenCalled()
    const stalePlan = await service.prepareImport({
      projectId,
      connectorId: snapshot.connector.connectorId,
      candidateIds: new Set([candidateId ?? '']),
      includePdf: false
    })
    expect(resolveAttachmentPaths).not.toHaveBeenCalled()
    await writeFile(
      sourcePath,
      JSON.stringify([
        {
          id: 'paper',
          'citation-key': 'paper2026',
          type: 'article-journal',
          title: 'Unified Reference Updated',
          author: [{ family: 'Wu' }],
          issued: { 'date-parts': [[2026]] }
        }
      ])
    )
    const refreshed = await service.refresh(snapshot.connector.connectorId, projectId)
    await expect(
      service.confirmImport({
        projectId,
        previewId: stalePlan.previewId,
        selections: [
          {
            candidateId: candidateId ?? '',
            targetReferenceId: null,
            primaryAttachmentId: null,
            supplementAttachmentIds: []
          }
        ]
      })
    ).rejects.toThrow('snapshot changed')
    candidateId = refreshed.candidates[0]?.candidateId

    const plan = await service.prepareImport({
      projectId,
      connectorId: snapshot.connector.connectorId,
      candidateIds: new Set([candidateId ?? '']),
      includePdf: true
    })
    expect(resolveAttachmentPaths).toHaveBeenCalledOnce()
    expect(plan.items[0]).toMatchObject({ pdfStatus: 'available' })
    const result = await service.confirmImport({
      projectId,
      previewId: plan.previewId,
      selections: [
        {
          candidateId: candidateId ?? '',
          targetReferenceId: null,
          primaryAttachmentId: plan.items[0]?.attachments[0]?.attachmentId ?? null,
          supplementAttachmentIds: []
        }
      ]
    })
    expect(result.outcomes).toMatchObject([{ state: 'complete', errorCode: null }])
    expect(library.list()).toMatchObject([
      {
        citationKey: 'paper2026',
        title: 'Unified Reference Updated',
        knowledgeItemIds: [expect.any(String)]
      }
    ])
    expect(library.list().some((reference) => reference.citationKey.startsWith('doc-'))).toBe(false)

    service.close()
    projectDatabase.close()
    appDatabase.close()
  })
})
