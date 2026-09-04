import { mkdir, mkdtemp, realpath, rm, symlink, truncate, writeFile } from 'node:fs/promises'
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
  betterBibtexAttachmentPaths,
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
  it('rejects Better BibTeX JSON-RPC responses larger than 4 MiB', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(
      async () => new Response('x', { headers: { 'content-length': String(4 * 1024 * 1024 + 1) } })
    ) as typeof fetch
    try {
      await expect(betterBibtexAttachmentPaths('large')).rejects.toThrow('4 MiB')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

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
    const projectSessionId = '55555555-5555-4555-8555-555555555555'
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
    const pdfPaths = await Promise.all(
      Array.from({ length: 505 }, async (_, index) => {
        const path = join(parent, `paper-${index}.pdf`)
        await writeFile(path, `%PDF-1.7\nunified reference ${index}`)
        return path
      })
    )
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
    const resolveAttachmentPaths = vi.fn(async () => pdfPaths)
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
      projectSessionId,
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

    const capacityPlan = await service.prepareImport({
      projectId,
      projectSessionId,
      connectorId: snapshot.connector.connectorId,
      candidateIds: new Set([candidateId ?? '']),
      includePdf: true
    })
    for (const path of pdfPaths.slice(0, 6)) await truncate(path, 190 * 1024 * 1024)
    await expect(
      service.confirmImport({
        projectId,
        previewId: capacityPlan.previewId,
        selections: [
          {
            candidateId: candidateId ?? '',
            targetReferenceId: null,
            primaryAttachmentId: capacityPlan.items[0]?.attachments[0]?.attachmentId ?? null,
            supplementAttachmentIds:
              capacityPlan.items[0]?.attachments.slice(1, 6).map((item) => item.attachmentId) ?? []
          }
        ]
      })
    ).rejects.toThrow('1 GiB')
    expect(library.list()).toHaveLength(0)
    for (const [index, path] of pdfPaths.slice(0, 6).entries()) {
      await writeFile(path, `%PDF-1.7\nunified reference ${index}`)
    }

    const plan = await service.prepareImport({
      projectId,
      projectSessionId,
      connectorId: snapshot.connector.connectorId,
      candidateIds: new Set([candidateId ?? '']),
      includePdf: true
    })
    expect(resolveAttachmentPaths).toHaveBeenCalledTimes(2)
    expect(plan.items[0]).toMatchObject({ pdfStatus: 'available' })
    expect(plan.items[0]?.attachments).toHaveLength(20)
    expect(plan.items[0]?.nextAttachmentCursor).not.toBeNull()
    const firstCursor = plan.items[0]?.nextAttachmentCursor ?? ''
    const nextPage = await service.importAttachmentsPage({
      projectId,
      projectSessionId,
      previewId: plan.previewId,
      candidateId: candidateId ?? '',
      cursor: firstCursor
    })
    expect(nextPage.attachments).toHaveLength(20)
    await expect(
      service.importAttachmentsPage({
        projectId,
        projectSessionId,
        previewId: plan.previewId,
        candidateId: candidateId ?? '',
        cursor: firstCursor
      })
    ).resolves.toEqual(nextPage)
    const attachmentIds = new Set([
      ...(plan.items[0]?.attachments.map((attachment) => attachment.attachmentId) ?? []),
      ...nextPage.attachments.map((attachment) => attachment.attachmentId)
    ])
    let nextCursor = nextPage.nextAttachmentCursor
    while (nextCursor !== null) {
      const page = await service.importAttachmentsPage({
        projectId,
        projectSessionId,
        previewId: plan.previewId,
        candidateId: candidateId ?? '',
        cursor: nextCursor
      })
      for (const attachment of page.attachments) attachmentIds.add(attachment.attachmentId)
      nextCursor = page.nextAttachmentCursor
    }
    expect(attachmentIds).toHaveLength(505)
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(new Date(plan.expiresAt).getTime() + 1)
    await expect(
      service.importAttachmentsPage({
        projectId,
        projectSessionId,
        previewId: plan.previewId,
        candidateId: candidateId ?? '',
        cursor: firstCursor
      })
    ).rejects.toThrow('unavailable, expired, or invalid')
    dateNow.mockRestore()
    await expect(
      service.importAttachmentsPage({
        projectId: '77777777-7777-4777-8777-777777777777',
        projectSessionId,
        previewId: plan.previewId,
        candidateId: candidateId ?? '',
        cursor: firstCursor
      })
    ).rejects.toThrow('unavailable, expired, or invalid')
    await expect(
      service.importAttachmentsPage({
        projectId,
        projectSessionId,
        previewId: plan.previewId,
        candidateId: candidateId ?? '',
        cursor: '88888888-8888-4888-8888-888888888888'
      })
    ).rejects.toThrow('unavailable, expired, or invalid')
    await expect(
      service.importAttachmentsPage({
        projectId,
        projectSessionId: '44444444-4444-4444-8444-444444444444',
        previewId: plan.previewId,
        candidateId: candidateId ?? '',
        cursor: firstCursor
      })
    ).rejects.toThrow('unavailable, expired, or invalid')
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
    await expect(
      service.importAttachmentsPage({
        projectId,
        projectSessionId,
        previewId: plan.previewId,
        candidateId: candidateId ?? '',
        cursor: firstCursor
      })
    ).rejects.toThrow('unavailable, expired, or invalid')
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
