import { describe, expect, it } from 'vitest'
import { normalizedKnowledgeBlockSchema } from '../../shared/contracts/knowledge'
import { mineruRawManifestSchema } from '../../shared/contracts/mineru'
import { recoverMineruBlockProvenance } from './mineru-block-provenance'

describe('recoverMineruBlockProvenance', () => {
  it('uses verified asset identity and leaves duplicate text unresolved', () => {
    const imageSha256 = 'a'.repeat(64)
    const contentListPath = 'raw/extracted/task_content_list.json'
    const manifest = mineruRawManifestSchema.parse({
      schemaVersion: 1,
      parseRevisionId: '22222222-2222-4222-8222-222222222222',
      knowledgeItemId: '11111111-1111-4111-8111-111111111111',
      sourceSha256: 'b'.repeat(64),
      providerId: 'mineru',
      providerApiVersion: 'v4',
      providerFingerprint: 'c'.repeat(64),
      modelVersion: 'vlm',
      remoteTaskId: 'task-1',
      archive: { relativePath: 'raw/provider-result.zip', sha256: 'd'.repeat(64), byteSize: 1 },
      files: [
        { relativePath: contentListPath, sha256: 'e'.repeat(64), byteSize: 1 },
        {
          relativePath: 'raw/extracted/images/figure.jpg',
          sha256: imageSha256,
          byteSize: 1
        }
      ],
      createdAt: '2026-07-19T00:00:00.000Z'
    })
    const duplicateText = normalizedKnowledgeBlockSchema.parse({
      id: 'kb_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      ordinal: 0,
      type: 'paragraph',
      text: 'Repeated text',
      headingPath: [],
      assetRefs: [],
      contentHash: 'f'.repeat(64)
    })
    const image = normalizedKnowledgeBlockSchema.parse({
      id: 'kb_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      ordinal: 1,
      type: 'image',
      headingPath: [],
      assetRefs: [`images/${imageSha256}.jpg`],
      contentHash: '1'.repeat(64)
    })
    const nestedCaption = normalizedKnowledgeBlockSchema.parse({
      id: 'kb_cccccccccccccccccccccccccccccccc',
      ordinal: 2,
      type: 'caption',
      text: 'Figure 1',
      headingPath: [],
      assetRefs: [`images/${imageSha256}.jpg`],
      contentHash: '2'.repeat(64)
    })

    const recovered = recoverMineruBlockProvenance({
      blocks: [duplicateText, image],
      contentListPath,
      contentList: [
        { type: 'text', text: 'Repeated text', page_idx: 0, bbox: [1, 2, 3, 4] },
        { type: 'text', text: 'Repeated text', page_idx: 1, bbox: [5, 6, 7, 8] },
        {
          type: 'image',
          img_path: 'images/figure.jpg',
          image_caption: ['Figure 1'],
          page_idx: 2,
          bbox: [10, 20, 30, 40]
        }
      ],
      manifest
    })

    expect(recovered.has(duplicateText.id)).toBe(false)
    expect(recovered.get(image.id)).toEqual({
      page: 2,
      bbox: [10, 20, 30, 40],
      providerBlockId: null,
      regionIdentity: 'content-list:2'
    })
    expect(recovered.has(nestedCaption.id)).toBe(false)
  })
})
