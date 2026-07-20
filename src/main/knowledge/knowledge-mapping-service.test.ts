import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizedKnowledgeBlockSchema } from '../../shared/contracts/knowledge'
import { KnowledgeMappingService } from './knowledge-mapping-service'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('KnowledgeMappingService', () => {
  it('keeps caption regions separate and reports exact Unicode coverage', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'writellm-knowledge-mapping-'))
    roots.push(projectRoot)
    const revisionRoot = join(projectRoot, 'revision')
    await mkdir(join(revisionRoot, 'raw', 'extracted'), { recursive: true })
    const geometryBytes = Buffer.from(
      JSON.stringify({ pdf_info: [{ page_idx: 0, page_size: [1000, 1000] }] })
    )
    const geometryHash = sha256(geometryBytes)
    const manifest = {
      schemaVersion: 1,
      parseRevisionId: '22222222-2222-4222-8222-222222222222',
      knowledgeItemId: '11111111-1111-4111-8111-111111111111',
      sourceSha256: 'a'.repeat(64),
      providerId: 'mineru',
      providerApiVersion: 'v4',
      providerFingerprint: 'b'.repeat(64),
      modelVersion: 'pipeline',
      remoteTaskId: 'task-1',
      archive: { relativePath: 'raw/provider-result.zip', sha256: 'c'.repeat(64), byteSize: 1 },
      files: [
        {
          relativePath: 'raw/extracted/middle.json',
          sha256: geometryHash,
          byteSize: geometryBytes.byteLength
        }
      ],
      createdAt: '2026-07-19T00:00:00.000Z'
    }
    const manifestBytes = Buffer.from(JSON.stringify(manifest))
    await writeFile(join(revisionRoot, 'manifest.json'), manifestBytes)
    await writeFile(join(revisionRoot, 'raw', 'extracted', 'middle.json'), geometryBytes)
    const block0 = normalizedKnowledgeBlockSchema.parse({
      id: 'kb_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ordinal: 0,
      type: 'image',
      text: 'abcd',
      headingPath: [],
      page: 0,
      bbox: [0, 0, 100, 100],
      sourceProviderBlockId: 'provider,1',
      assetRefs: ['images/figure.png'],
      contentHash: 'd'.repeat(64)
    })
    const block1 = normalizedKnowledgeBlockSchema.parse({
      id: 'kb_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      ordinal: 1,
      type: 'caption',
      text: '世界ef',
      headingPath: [],
      page: 0,
      bbox: [0, 0, 100, 100],
      sourceProviderBlockId: 'provider,1',
      assetRefs: ['images/figure.png'],
      contentHash: 'e'.repeat(64)
    })
    const inspect = vi.fn(async () => ({
      state: 'ready' as const,
      activeIndexGenerationId: 'index-1',
      activeEmbeddingGenerationId: null,
      chunks: [
        {
          chunkId: 'chunk-1',
          ordinal: 0,
          text: 'abcd\n\n世界ef',
          headingPath: [],
          sourceBlockStart: 0,
          sourceBlockEnd: 1,
          sources: [
            {
              blockId: block0.id,
              blockOrdinal: 0,
              blockType: block0.type,
              page: 0,
              bbox: block0.bbox ?? null,
              providerBlockId: block0.sourceProviderBlockId ?? null,
              segmentStart: 2,
              segmentEnd: 8
            },
            {
              blockId: block1.id,
              blockOrdinal: 1,
              blockType: block1.type,
              page: 0,
              bbox: block1.bbox ?? null,
              providerBlockId: block1.sourceProviderBlockId ?? null,
              segmentStart: 2,
              segmentEnd: 8
            }
          ],
          embedding: null
        }
      ]
    }))
    const service = new KnowledgeMappingService({
      projectRoot,
      database: {
        immediate: (callback: (database: unknown) => unknown) =>
          callback({
            prepare: () => ({
              get: () => ({ relative_path: 'revision', manifest_sha256: sha256(manifestBytes) })
            })
          })
      } as never,
      normalization: {
        detail: vi.fn(async () => ({
          active: {
            parseRevisionId: manifest.parseRevisionId,
            blocks: [block0, block1]
          }
        }))
      } as never,
      index: { inspectKnowledgeMapping: inspect } as never,
      log: { info: vi.fn(), error: vi.fn() }
    })

    const result = await service.page(manifest.knowledgeItemId, 0)
    expect(result.state).toBe('ready')
    expect(result.geometry).toEqual({ width: 1000, height: 1000, origin: 'top-left' })
    expect(result.regions).toHaveLength(2)
    expect(result.regions[0]?.normalizedBlockIds).toEqual([block0.id])
    expect(result.regions[1]?.normalizedBlockIds).toEqual([block1.id])
    expect(result.regions[1]?.regionId).toBe(`block:${block1.id}`)
    expect(result.regions[1]?.bbox).toBeNull()
    expect(result.chunks[0]?.coverages[0]).toMatchObject({
      totalCharacters: 4,
      coveredCharacters: 2,
      coverageRatio: 0.5
    })
  })

  it('recovers page provenance from a verified prefixed content list for legacy blocks', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'writellm-knowledge-mapping-legacy-'))
    roots.push(projectRoot)
    const revisionRoot = join(projectRoot, 'revision')
    await mkdir(join(revisionRoot, 'raw', 'extracted'), { recursive: true })
    const contentListBytes = Buffer.from(
      JSON.stringify([
        { type: 'text', text: 'Legacy located block', page_idx: 0, bbox: [10, 20, 110, 120] }
      ])
    )
    const geometryBytes = Buffer.from(
      JSON.stringify({ pdf_info: [{ page_idx: 0, page_size: [612, 792] }] })
    )
    const contentListPath = 'raw/extracted/task-123_content_list.json'
    const geometryPath = 'raw/extracted/layout.json'
    const manifest = {
      schemaVersion: 1,
      parseRevisionId: '22222222-2222-4222-8222-222222222222',
      knowledgeItemId: '11111111-1111-4111-8111-111111111111',
      sourceSha256: 'a'.repeat(64),
      providerId: 'mineru',
      providerApiVersion: 'v4',
      providerFingerprint: 'b'.repeat(64),
      modelVersion: 'vlm',
      remoteTaskId: 'task-legacy',
      archive: { relativePath: 'raw/provider-result.zip', sha256: 'c'.repeat(64), byteSize: 1 },
      files: [
        {
          relativePath: contentListPath,
          sha256: sha256(contentListBytes),
          byteSize: contentListBytes.byteLength
        },
        {
          relativePath: geometryPath,
          sha256: sha256(geometryBytes),
          byteSize: geometryBytes.byteLength
        }
      ],
      createdAt: '2026-07-19T00:00:00.000Z'
    }
    const manifestBytes = Buffer.from(JSON.stringify(manifest))
    await writeFile(join(revisionRoot, 'manifest.json'), manifestBytes)
    await writeFile(join(revisionRoot, contentListPath), contentListBytes)
    await writeFile(join(revisionRoot, geometryPath), geometryBytes)
    const block = normalizedKnowledgeBlockSchema.parse({
      id: 'kb_cccccccccccccccccccccccccccccccc',
      ordinal: 0,
      type: 'paragraph',
      text: 'Legacy located block',
      markdown: 'Legacy located block',
      headingPath: [],
      assetRefs: [],
      contentHash: 'd'.repeat(64)
    })
    const inspect = vi.fn(async () => ({
      state: 'ready' as const,
      activeIndexGenerationId: 'index-legacy',
      activeEmbeddingGenerationId: 'embedding-legacy',
      chunks: [
        {
          chunkId: 'chunk-legacy',
          ordinal: 0,
          text: block.text ?? '',
          headingPath: [],
          sourceBlockStart: 0,
          sourceBlockEnd: 0,
          sources: [
            {
              blockId: block.id,
              blockOrdinal: block.ordinal,
              blockType: block.type,
              page: null,
              bbox: null,
              providerBlockId: null,
              segmentStart: 0,
              segmentEnd: Array.from(block.text ?? '').length
            }
          ],
          embedding: null
        }
      ]
    }))
    const service = new KnowledgeMappingService({
      projectRoot,
      database: {
        immediate: (callback: (database: unknown) => unknown) =>
          callback({
            prepare: () => ({
              get: () => ({ relative_path: 'revision', manifest_sha256: sha256(manifestBytes) })
            })
          })
      } as never,
      normalization: {
        detail: vi.fn(async () => ({
          active: { parseRevisionId: manifest.parseRevisionId, blocks: [block] }
        }))
      } as never,
      index: { inspectKnowledgeMapping: inspect } as never,
      log: { info: vi.fn(), error: vi.fn() }
    })

    const result = await service.page(manifest.knowledgeItemId, 0)
    expect(inspect).toHaveBeenCalledWith(manifest.knowledgeItemId, manifest.parseRevisionId, 0, [0])
    expect(result.geometry).toEqual({ width: 1000, height: 1000, origin: 'top-left' })
    expect(result.regions).toEqual([
      expect.objectContaining({
        normalizedBlockIds: [block.id],
        pageIndex: 0,
        bbox: [10, 20, 110, 120]
      })
    ])
    expect(result.chunks).toHaveLength(1)
    expect(result.chunks[0]?.coverages).toHaveLength(1)
  })
})

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}
