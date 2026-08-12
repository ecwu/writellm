import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MANUSCRIPT_LOSS_REPORT_FILE } from '../../shared/contracts/manuscript-export'
import type { SnapshotBarrier } from '../project/project-snapshot'
import { initializeProjectDatabase, type ProjectDatabase } from '../project/project-database'
import type { ProjectManifest } from '../project/project-manifest'
import { ManuscriptAssetService } from './asset-service'
import { createManuscriptExport, validateStagedExport } from './manuscript-export'
import { ManuscriptService } from './manuscript-service'

const roots: string[] = []
const log = pino({ level: 'silent' })
const now = new Date('2026-07-30T12:00:00.000Z')

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('whole-manuscript export', () => {
  it('publishes deterministic native and Markdown packages with verified referenced assets', async () => {
    const fixture = await exportFixture()
    const barrierEvents: string[] = []
    const barrier = recordingBarrier(barrierEvents)
    const firstDestination = join(fixture.parent, 'Native export α')
    const secondDestination = join(fixture.parent, 'Native export β')

    const first = await createManuscriptExport({
      ...fixture.options,
      destination: firstDestination,
      kind: 'native',
      barrier
    })
    const second = await createManuscriptExport({
      ...fixture.options,
      destination: secondDestination,
      kind: 'native',
      barrier: recordingBarrier([])
    })

    expect(first.manifest.content.sha256).toBe(second.manifest.content.sha256)
    expect(first.manifest.assetInventorySha256).toBe(second.manifest.assetInventorySha256)
    expect(first.manifest.assetCount).toBe(1)
    expect(barrierEvents).toEqual([
      'pause-mutations',
      'flush',
      'pause-publishers',
      'resume-publishers',
      'resume-mutations'
    ])
    const native = await readFile(join(firstDestination, 'manuscript.json'), 'utf8')
    expect(native).toContain(fixture.asset.logicalUrl)
    expect(native).not.toContain(fixture.projectRoot)
    await expect(
      readFile(join(firstDestination, first.manifest.assets[0]?.relativePath ?? 'missing'))
    ).resolves.toEqual(fixture.imageBytes)
    await expect(validateStagedExport(firstDestination)).resolves.toEqual(first.manifest)

    const markdownDestination = join(fixture.parent, 'Markdown export')
    const markdown = await createManuscriptExport({
      ...fixture.options,
      destination: markdownDestination,
      kind: 'markdown',
      barrier: recordingBarrier([])
    })
    const markdownText = await readFile(join(markdownDestination, 'manuscript.md'), 'utf8')
    expect(markdownText).toContain('# Untitled Section')
    expect(markdownText).toContain('Current body [1]')
    expect(markdownText).toContain(
      `![Fixture image](assets/${markdown.manifest.assets[0]?.sha256}.png)`
    )
    expect(markdownText).toContain('```mermaid')
    expect(markdown.lossReport?.losses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'citation_numbering', blockId: 'paragraph' }),
        expect.objectContaining({ code: 'preview_width' })
      ])
    )
    const persistedLossReport = JSON.parse(
      await readFile(join(markdownDestination, MANUSCRIPT_LOSS_REPORT_FILE), 'utf8')
    ) as { losses: Array<{ code: string; blockId: string }> }
    expect(persistedLossReport.losses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'citation_numbering', blockId: 'paragraph' })
      ])
    )
    await expect(validateStagedExport(markdownDestination)).resolves.toEqual(markdown.manifest)

    fixture.database.close()
  })

  it('never overwrites an existing destination and cleans interrupted staging', async () => {
    const fixture = await exportFixture()
    const destination = join(fixture.parent, 'existing')
    await mkdir(destination)
    await writeFile(join(destination, 'owner.txt'), 'keep')
    await expect(
      createManuscriptExport({
        ...fixture.options,
        destination,
        kind: 'native',
        barrier: recordingBarrier([])
      })
    ).rejects.toThrow('Whole-manuscript export failed')
    await expect(readFile(join(destination, 'owner.txt'), 'utf8')).resolves.toBe('keep')

    const interrupted = join(fixture.parent, 'interrupted')
    await expect(
      createManuscriptExport({
        ...fixture.options,
        destination: interrupted,
        kind: 'native',
        barrier: {
          ...recordingBarrier([]),
          pauseFilePublishers: async () => {
            throw new Error('simulated publisher pause failure')
          }
        }
      })
    ).rejects.toThrow('Whole-manuscript export failed')
    await expect(access(interrupted)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(
      (await readdir(fixture.parent)).filter((name) => name.endsWith('.export.partial'))
    ).toEqual([])
    fixture.database.close()
  })

  it('rejects changed bytes, missing revision registration, symbolic paths, and malformed read-back', async () => {
    const changed = await exportFixture()
    await writeFile(
      changed.assetService.absolutePath(changed.assetService.get(changed.asset.assetId)),
      png(9, 9)
    )
    await expect(
      createManuscriptExport({
        ...changed.options,
        destination: join(changed.parent, 'changed'),
        kind: 'native',
        barrier: recordingBarrier([])
      })
    ).rejects.toThrow('Whole-manuscript export failed')
    changed.database.close()

    const missingRegistration = await exportFixture()
    missingRegistration.database.immediate((database) =>
      database.prepare('DELETE FROM section_revision_assets').run()
    )
    await expect(
      createManuscriptExport({
        ...missingRegistration.options,
        destination: join(missingRegistration.parent, 'unregistered'),
        kind: 'native',
        barrier: recordingBarrier([])
      })
    ).rejects.toThrow('Whole-manuscript export failed')
    missingRegistration.database.close()

    const mismatchedMetadata = await exportFixture()
    mismatchedMetadata.database.immediate((database) =>
      database
        .prepare("UPDATE manuscript_assets SET extension = '.jpg' WHERE asset_id = ?")
        .run(mismatchedMetadata.asset.assetId)
    )
    await expect(
      createManuscriptExport({
        ...mismatchedMetadata.options,
        destination: join(mismatchedMetadata.parent, 'mismatched-metadata'),
        kind: 'native',
        barrier: recordingBarrier([])
      })
    ).rejects.toThrow('Whole-manuscript export failed')
    mismatchedMetadata.database.close()

    const linked = await exportFixture()
    const assetDirectory = join(linked.projectRoot, 'manuscript', 'assets')
    const realAssets = join(linked.parent, 'real-assets')
    await rename(assetDirectory, realAssets)
    await symlink(realAssets, assetDirectory)
    await expect(
      createManuscriptExport({
        ...linked.options,
        destination: join(linked.parent, 'linked'),
        kind: 'native',
        barrier: recordingBarrier([])
      })
    ).rejects.toThrow('Whole-manuscript export failed')
    linked.database.close()

    const malformed = await exportFixture()
    const destination = join(malformed.parent, 'malformed')
    await createManuscriptExport({
      ...malformed.options,
      destination,
      kind: 'native',
      barrier: recordingBarrier([])
    })
    await writeFile(join(destination, 'manuscript.json'), '{}\n')
    await expect(validateStagedExport(destination)).rejects.toThrow()
    malformed.database.close()
  })
})

function recordingBarrier(events: string[]): SnapshotBarrier {
  return {
    pauseMutations: async () => {
      events.push('pause-mutations')
    },
    finalEditorFlush: async () => {
      events.push('flush')
    },
    pauseFilePublishers: async () => {
      events.push('pause-publishers')
    },
    resumeFilePublishers: async () => {
      events.push('resume-publishers')
    },
    resumeMutations: async () => {
      events.push('resume-mutations')
    }
  }
}

async function exportFixture(): Promise<{
  parent: string
  projectRoot: string
  database: ProjectDatabase
  assetService: ManuscriptAssetService
  asset: Awaited<ReturnType<ManuscriptAssetService['store']>>
  imageBytes: Buffer
  options: {
    projectRoot: string
    projectId: string
    sourceAppVersion: string
    manuscript: ManuscriptService
    assets: ManuscriptAssetService
    database: ProjectDatabase
    log: typeof log
    now: () => Date
    createId: ReturnType<typeof vi.fn>
  }
}> {
  const parent = await mkdtemp(join(tmpdir(), 'writellm-manuscript-export-'))
  roots.push(parent)
  const projectRoot = join(parent, 'Project with spaces.writellm')
  await mkdir(projectRoot)
  const manifest: ProjectManifest = {
    format: 'writellm-project',
    formatVersion: 1,
    projectId: '019c6a5c-8d34-7a8e-a602-3d37a52dc999',
    createdAt: now.toISOString()
  }
  const database = await initializeProjectDatabase({
    projectRoot,
    manifest,
    applicationVersion: 'export-test',
    initialTitle: 'Export fixture',
    log
  })
  const manuscript = new ManuscriptService({
    database,
    projectId: manifest.projectId,
    log,
    now: () => now
  })
  const assetService = new ManuscriptAssetService({
    projectRoot,
    projectId: manifest.projectId,
    database,
    log,
    now: () => now,
    createId: () => '019c6a5c-8d34-4a8e-a602-3d37a52dc901'
  })
  const imageBytes = png(8, 8)
  const asset = await assetService.store({
    bytes: imageBytes,
    mimeType: 'image/png',
    sourceType: 'upload',
    originalName: 'fixture.png'
  })
  const current = manuscript.assemble().sections[0]
  if (current === undefined) throw new Error('Missing initial section')
  manuscript.appendRevision({
    sectionId: current.section.sectionId,
    baseRevisionId: current.revision.sectionRevisionId,
    baseContentHash: current.revision.contentHash,
    content: [
      {
        id: 'paragraph',
        type: 'paragraph',
        props: {
          backgroundColor: 'default',
          textColor: 'default',
          textAlignment: 'left'
        },
        content: [
          {
            type: 'text',
            text: 'Current body [Source: Export Source, p. 2]',
            styles: { bold: true }
          }
        ],
        children: []
      },
      {
        id: 'image',
        type: 'image',
        props: {
          backgroundColor: 'default',
          textAlignment: 'center',
          name: 'Fixture image',
          url: asset.logicalUrl,
          caption: 'Caption',
          showPreview: true,
          previewWidth: 720
        },
        children: []
      },
      {
        id: 'diagram',
        type: 'mermaid',
        props: {
          textAlignment: 'center',
          source: 'graph TD\nA-->B',
          caption: '',
          previewWidth: 720
        },
        children: []
      }
    ],
    source: 'manual',
    sourceClass: 'manual_checkpoint'
  })
  let stageId = 0
  return {
    parent,
    projectRoot,
    database,
    assetService,
    asset,
    imageBytes,
    options: {
      projectRoot,
      projectId: manifest.projectId,
      sourceAppVersion: '1.0.0-test',
      manuscript,
      assets: assetService,
      database,
      log,
      now: () => now,
      createId: vi.fn(() => `019c6a5c-8d34-4a8e-a602-${String(stageId++).padStart(12, '0')}`)
    }
  }
}

function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(24)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes)
  bytes.write('IHDR', 12, 'ascii')
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}
