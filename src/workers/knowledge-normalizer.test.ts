import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runKnowledgeNormalizer } from './knowledge-normalizer'

const roots: string[] = []
const parseRevisionId = '33333333-3333-4333-8333-333333333333'

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('runKnowledgeNormalizer', () => {
  it('uses a provider-prefixed content list instead of the Markdown fallback', async () => {
    const root = await mkdtemp(join(tmpdir(), 'writellm-normalizer-prefixed-'))
    roots.push(root)
    const extractedRoot = join(root, 'raw', 'extracted')
    const stagingPath = join(root, 'normalization')
    const contentList = Buffer.from(
      JSON.stringify([{ type: 'text', text: 'Located block', page_idx: 2, bbox: [10, 20, 30, 40] }])
    )
    const markdown = Buffer.from('Markdown fallback without provenance')
    await mkdir(extractedRoot, { recursive: true })
    await mkdir(stagingPath, { recursive: true })
    await writeFile(join(extractedRoot, 'task-123_content_list.json'), contentList)
    await writeFile(join(extractedRoot, 'full.md'), markdown)

    await runKnowledgeNormalizer({
      operation: 'normalize',
      requestId: randomUUID(),
      rawRoot: root,
      stagingPath,
      parseRevisionId,
      normalizerVersion: 1,
      files: [
        {
          relativePath: 'raw/extracted/task-123_content_list.json',
          sha256: hash(contentList),
          byteSize: contentList.length
        },
        {
          relativePath: 'raw/extracted/full.md',
          sha256: hash(markdown),
          byteSize: markdown.length
        }
      ]
    })

    const [block] = (await readFile(join(stagingPath, 'blocks.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { text: string; page: number; bbox: number[] })
    expect(block).toMatchObject({
      text: 'Located block',
      page: 2,
      bbox: [10, 20, 30, 40]
    })
  })

  it('rewrites full.md image references to manifest asset paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'writellm-normalizer-'))
    roots.push(root)
    const rawRoot = root
    const extractedRoot = join(root, 'raw', 'extracted')
    const stagingPath = join(root, 'normalization')
    const image = tinyPng()
    const markdown = Buffer.from('![Figure](images/figure.png)\n\n# Parsed document\n')
    await mkdir(join(extractedRoot, 'images'), { recursive: true })
    await mkdir(stagingPath, { recursive: true })
    await writeFile(join(extractedRoot, 'full.md'), markdown)
    await writeFile(join(extractedRoot, 'images', 'figure.png'), image)

    const result = await runKnowledgeNormalizer({
      operation: 'normalize',
      requestId: randomUUID(),
      rawRoot,
      stagingPath,
      parseRevisionId,
      normalizerVersion: 1,
      files: [
        {
          relativePath: 'raw/extracted/full.md',
          sha256: hash(markdown),
          byteSize: markdown.length
        },
        {
          relativePath: 'raw/extracted/images/figure.png',
          sha256: hash(image),
          byteSize: image.length
        }
      ]
    })

    const assetRef = `images/${hash(image)}.png`
    expect(result.assets).toEqual([
      {
        relativePath: assetRef,
        sha256: hash(image),
        byteSize: image.length,
        mimeType: 'image/png',
        sourceRelativePath: 'raw/extracted/images/figure.png'
      }
    ])
    expect(await readFile(join(stagingPath, 'document.md'), 'utf8')).toContain(
      `![Figure](${assetRef})`
    )
    const blocks = (await readFile(join(stagingPath, 'blocks.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { assetRefs: string[] })
    expect(blocks[0]?.assetRefs).toEqual([assetRef])
  })

  it('keeps every nested image caption as a separate block without inheriting image geometry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'writellm-normalizer-captions-'))
    roots.push(root)
    const extractedRoot = join(root, 'raw', 'extracted')
    const stagingPath = join(root, 'normalization')
    const image = tinyPng()
    const contentList = Buffer.from(
      JSON.stringify([
        {
          type: 'image',
          img_path: 'images/figure.png',
          image_caption: ['Figure 1: Overview', 'Source: Example'],
          page_idx: 3,
          bbox: [10, 20, 300, 400]
        }
      ])
    )
    await mkdir(join(extractedRoot, 'images'), { recursive: true })
    await mkdir(stagingPath, { recursive: true })
    await writeFile(join(extractedRoot, 'task_content_list.json'), contentList)
    await writeFile(join(extractedRoot, 'images', 'figure.png'), image)

    await runKnowledgeNormalizer({
      operation: 'normalize',
      requestId: randomUUID(),
      rawRoot: root,
      stagingPath,
      parseRevisionId,
      normalizerVersion: 1,
      files: [
        {
          relativePath: 'raw/extracted/task_content_list.json',
          sha256: hash(contentList),
          byteSize: contentList.length
        },
        {
          relativePath: 'raw/extracted/images/figure.png',
          sha256: hash(image),
          byteSize: image.length
        }
      ]
    })

    const blocks = (await readFile(join(stagingPath, 'blocks.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    expect(blocks.map((block) => block.type)).toEqual(['image', 'caption', 'caption'])
    expect(blocks[0]).toMatchObject({ page: 3, bbox: [10, 20, 300, 400] })
    expect(blocks[1]).not.toHaveProperty('bbox')
    expect(blocks[2]).not.toHaveProperty('bbox')
    expect(blocks[1]?.assetRefs).toEqual(blocks[0]?.assetRefs)
    expect(blocks[2]?.assetRefs).toEqual(blocks[0]?.assetRefs)
  })
})

function hash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function tinyPng(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  )
}
