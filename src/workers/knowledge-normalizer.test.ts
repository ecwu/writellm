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
