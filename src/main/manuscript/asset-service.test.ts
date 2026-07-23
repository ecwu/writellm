import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BlockNoteDocument } from '../../shared/contracts/manuscript'
import { initializeProjectDatabase } from '../project/project-database'
import type { ProjectManifest } from '../project/project-manifest'
import {
  ManuscriptAssetService,
  recordRevisionAssetReferences,
  validateImageBytes
} from './asset-service'

const roots: string[] = []
const log = pino({ level: 'silent' })

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('ManuscriptAssetService', () => {
  it('validates, atomically publishes, references, and eventually cleans project images', async () => {
    const root = await mkdtemp(join(tmpdir(), 'writellm-assets-'))
    roots.push(root)
    const projectRoot = join(root, 'project')
    await mkdir(projectRoot)
    const manifest: ProjectManifest = {
      format: 'writellm-project',
      formatVersion: 1,
      projectId: '019c6a5c-8d34-7a8e-a602-3d37a52dc901',
      createdAt: '2026-07-22T00:00:00.000Z'
    }
    const database = await initializeProjectDatabase({
      projectRoot,
      manifest,
      applicationVersion: 'asset-test',
      log
    })
    let now = new Date('2026-07-22T00:00:00.000Z')
    const enqueue = vi.fn()
    const service = new ManuscriptAssetService({
      projectRoot,
      projectId: manifest.projectId,
      database,
      jobs: { enqueue } as never,
      log,
      now: () => now
    })
    const bytes = png(32, 24)
    const asset = await service.store({
      bytes,
      mimeType: 'image/png',
      sourceType: 'upload',
      originalName: 'figure.png'
    })
    const row = service.get(asset.assetId)
    expect(await readFile(service.absolutePath(row))).toEqual(bytes)
    expect(row.relative_path).toMatch(/^manuscript\/assets\/[0-9a-f]{64}\.png$/)
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'artifact_cleanup',
        payload: { cleanupId: `manuscript-asset:${asset.assetId}` }
      })
    )

    const revisionId = database.immediate((native) =>
      String(native.prepare('SELECT current_revision_id FROM sections LIMIT 1').pluck().get())
    )
    const document: BlockNoteDocument = [
      {
        id: 'image-block',
        type: 'image',
        props: {
          url: asset.logicalUrl,
          name: 'Accessible description',
          caption: 'Visible caption',
          textAlignment: 'center',
          showPreview: true,
          previewWidth: 720
        },
        content: undefined,
        children: []
      }
    ]
    database.immediate((native) =>
      recordRevisionAssetReferences(native, revisionId, document, now.toISOString())
    )
    now = new Date('2026-07-24T00:00:00.000Z')
    expect(await service.cleanupOrphans()).toBe(0)
    database.immediate((native) => native.prepare('DELETE FROM section_revision_assets').run())
    expect(await service.cleanupOrphans()).toBe(1)
    await expect(access(service.absolutePath(row))).rejects.toMatchObject({ code: 'ENOENT' })
    database.close()
  })

  it('rejects spoofed, oversized, and non-project Markdown image references', async () => {
    expect(() => validateImageBytes(Buffer.from('not a png image'), 'image/png')).toThrow(
      'PNG signature is invalid'
    )
    expect(() => validateImageBytes(png(8_193, 1), 'image/png')).toThrow(
      'Image dimensions are outside the supported range'
    )
    expect(() => validateImageBytes(png(8_000, 8_000), 'image/png')).toThrow(
      'Image dimensions are outside the supported range'
    )

    const { database, service } = await fixture()
    for (const reference of [
      'https://example.test/image.png',
      'data:image/png;base64,AA==',
      '/tmp/image.png',
      '../assets/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png'
    ]) {
      expect(() => service.resolveImportReference(reference)).toThrow()
    }
    database.close()
  })

  it('validates and publishes a generated JPEG with its actual MIME and extension', async () => {
    const { database, service } = await fixture()
    const bytes = jpeg(48, 32)
    const asset = await service.store({
      bytes,
      mimeType: 'image/jpeg',
      sourceType: 'generated',
      generationRequest: {
        prompt: 'JPEG returned by Gemini',
        aspectRatio: 'auto',
        requestedImageSize: '2K',
        effectiveImageSize: '1K'
      }
    })
    const row = service.get(asset.assetId)

    expect(asset.mimeType).toBe('image/jpeg')
    expect(row.relative_path).toMatch(/^manuscript\/assets\/[0-9a-f]{64}\.jpg$/)
    expect(await readFile(service.absolutePath(row))).toEqual(bytes)
    expect(JSON.parse(row.generation_request_json ?? '')).toMatchObject({
      requestedImageSize: '2K',
      effectiveImageSize: '1K'
    })
    expect(() => validateImageBytes(bytes, 'image/png')).toThrow('PNG signature is invalid')
    database.close()
  })

  it('deduplicates concurrent publication without deleting the winning content', async () => {
    const { database, service } = await fixture()
    const bytes = png(40, 30)
    const assets = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        service.store({
          bytes,
          mimeType: 'image/png',
          sourceType: 'upload',
          originalName: `same-${index}.png`
        })
      )
    )
    expect(new Set(assets.map(({ assetId }) => assetId)).size).toBe(1)
    const row = service.get(assets[0]?.assetId ?? '')
    expect(await readFile(service.absolutePath(row))).toEqual(bytes)
    expect(
      database.immediate((native) =>
        native.prepare('SELECT COUNT(*) FROM manuscript_assets').pluck().get()
      )
    ).toBe(1)
    database.close()
  })
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'writellm-assets-'))
  roots.push(root)
  const projectRoot = join(root, 'project')
  await mkdir(projectRoot)
  const manifest: ProjectManifest = {
    format: 'writellm-project',
    formatVersion: 1,
    projectId: '019c6a5c-8d34-7a8e-a602-3d37a52dc902',
    createdAt: '2026-07-22T00:00:00.000Z'
  }
  const database = await initializeProjectDatabase({
    projectRoot,
    manifest,
    applicationVersion: 'asset-test',
    log
  })
  return {
    database,
    service: new ManuscriptAssetService({
      projectRoot,
      projectId: manifest.projectId,
      database,
      log
    })
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

function jpeg(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(13)
  bytes.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x09, 0x08])
  bytes.writeUInt16BE(height, 7)
  bytes.writeUInt16BE(width, 9)
  bytes[11] = 1
  bytes[12] = 0
  return bytes
}
