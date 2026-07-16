import { createHash } from 'node:crypto'
import { mkdir, open } from 'node:fs/promises'
import { dirname, extname, posix } from 'node:path'
import {
  normalizedKnowledgeBlockSchema,
  type NormalizedKnowledgeBlock
} from '../shared/contracts/knowledge'
import type { MineruUtilityRequest, MineruUtilityResponse } from '../shared/contracts/mineru'

const MAX_CONTENT_LIST_BYTES = 100 * 1024 * 1024
const MAX_BLOCKS = 20_000
const MAX_ASSET_BYTES = 10 * 1024 * 1024

type NormalizeRequest = Extract<MineruUtilityRequest, { operation: 'normalize' }>
type NormalizeResponse = Extract<MineruUtilityResponse, { type: 'normalized' }>

interface RawContentBlock {
  type?: unknown
  text?: unknown
  text_level?: unknown
  page_idx?: unknown
  bbox?: unknown
  img_path?: unknown
  image_caption?: unknown
  image_footnote?: unknown
  table_caption?: unknown
  table_footnote?: unknown
  table_body?: unknown
  list_items?: unknown
  code_body?: unknown
  id?: unknown
  block_id?: unknown
  index?: unknown
  [key: string]: unknown
}

interface AssetRecord {
  relativePath: string
  sha256: string
  byteSize: number
  mimeType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'image/bmp'
  sourceRelativePath: string
}

export async function runKnowledgeNormalizer(
  request: NormalizeRequest
): Promise<NormalizeResponse> {
  const inventory = new Map(request.files.map((file) => [file.relativePath, file]))
  const contentList = chooseContentList(request.files.map((file) => file.relativePath))
  const assets = new Map<string, AssetRecord>()
  const blocks =
    contentList === undefined
      ? await normalizeMarkdownFallback(request, inventory, assets)
      : await normalizeContentList(request, contentList, inventory, assets)
  if (blocks.length === 0) throw new Error('MinerU result contains no readable blocks')
  const blockLines = Buffer.from(`${blocks.map((block) => JSON.stringify(block)).join('\n')}\n`)
  const document = Buffer.from(`${blocks.map(blockMarkdown).filter(Boolean).join('\n\n')}\n`)
  await writeDurable(`${request.stagingPath}/blocks.jsonl`, blockLines)
  await writeDurable(`${request.stagingPath}/document.md`, document)
  return {
    type: 'normalized',
    requestId: request.requestId,
    blocksSha256: sha256(blockLines),
    documentSha256: sha256(document),
    blockCount: blocks.length,
    assets: [...assets.values()].sort((a, b) => a.relativePath.localeCompare(b.relativePath))
  }
}

async function normalizeContentList(
  request: NormalizeRequest,
  contentList: string,
  inventory: Map<string, { relativePath: string; sha256: string; byteSize: number }>,
  assets: Map<string, AssetRecord>
): Promise<NormalizedKnowledgeBlock[]> {
  const record = inventory.get(contentList)
  if (record === undefined) throw new Error('Content-list inventory record is missing')
  const bytes = await readBounded(`${request.rawRoot}/${contentList}`, MAX_CONTENT_LIST_BYTES)
  if (sha256(bytes) !== record.sha256) throw new Error('MinerU content list hash does not match')
  const raw = JSON.parse(bytes.toString('utf8')) as unknown
  if (!Array.isArray(raw) || raw.length > MAX_BLOCKS) {
    throw new Error('MinerU content list shape or block count is invalid')
  }
  const blocks: NormalizedKnowledgeBlock[] = []
  const headingPath: string[] = []
  for (const value of raw) {
    if (blocks.length >= MAX_BLOCKS) throw new Error('Normalized block count exceeds the limit')
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('MinerU content block is invalid')
    }
    const item = value as RawContentBlock
    const mapped = mapType(item)
    const text = blockText(item, mapped)
    const markdown = blockMarkdownFromRaw(item, mapped, text)
    const assetRefs: string[] = []
    if (typeof item.img_path === 'string' && item.img_path.length > 0) {
      assetRefs.push(
        await copyAsset({
          assetPath: item.img_path,
          contentList,
          rawRoot: request.rawRoot,
          inventory,
          stagingPath: request.stagingPath,
          assets
        })
      )
    }
    const level = headingLevel(item)
    if (mapped === 'heading' && text !== undefined) {
      headingPath.splice(level - 1)
      headingPath[level - 1] = text
    }
    const providerId = providerBlockId(item)
    const ordinal = blocks.length
    const contentHash = sha256(
      Buffer.from(JSON.stringify({ mapped, text, markdown, headingPath, assetRefs }))
    )
    blocks.push(
      normalizedKnowledgeBlockSchema.parse({
        id: stableBlockId(request.parseRevisionId, ordinal, providerId, contentHash),
        ordinal,
        type: mapped,
        ...(text === undefined ? {} : { text }),
        ...(markdown === undefined ? {} : { markdown }),
        headingPath: [...headingPath],
        ...(page(item) === undefined ? {} : { page: page(item) }),
        ...(bbox(item) === undefined ? {} : { bbox: bbox(item) }),
        ...(providerId === undefined ? {} : { sourceProviderBlockId: providerId }),
        assetRefs,
        contentHash
      })
    )
    for (const caption of captionTexts(item)) {
      if (blocks.length >= MAX_BLOCKS) throw new Error('Normalized block count exceeds the limit')
      const ordinal = blocks.length
      const captionHash = sha256(Buffer.from(caption))
      blocks.push(
        normalizedKnowledgeBlockSchema.parse({
          id: stableBlockId(request.parseRevisionId, ordinal, providerId, captionHash),
          ordinal,
          type: 'caption',
          text: caption,
          markdown: caption,
          headingPath: [...headingPath],
          ...(page(item) === undefined ? {} : { page: page(item) }),
          ...(bbox(item) === undefined ? {} : { bbox: bbox(item) }),
          ...(providerId === undefined ? {} : { sourceProviderBlockId: providerId }),
          assetRefs,
          contentHash: captionHash
        })
      )
    }
  }
  return blocks
}

async function normalizeMarkdownFallback(
  request: NormalizeRequest,
  inventory: Map<string, { relativePath: string; sha256: string; byteSize: number }>,
  assets: Map<string, AssetRecord>
): Promise<NormalizedKnowledgeBlock[]> {
  const markdownFile = request.files.find((file) => file.relativePath.endsWith('/full.md'))
  if (markdownFile === undefined)
    throw new Error('MinerU result lacks content_list.json and full.md')
  const bytes = await readBounded(
    `${request.rawRoot}/${markdownFile.relativePath}`,
    MAX_CONTENT_LIST_BYTES
  )
  if (sha256(bytes) !== inventory.get(markdownFile.relativePath)?.sha256) {
    throw new Error('MinerU Markdown hash does not match')
  }
  const sections = bytes
    .toString('utf8')
    .split(/\n{2,}/)
    .map((value) => value.trim())
    .filter(Boolean)
  if (sections.length > MAX_BLOCKS) throw new Error('MinerU Markdown has too many blocks')
  const headingPath: string[] = []
  const blocks: NormalizedKnowledgeBlock[] = []
  for (const [ordinal, markdown] of sections.entries()) {
    const heading = /^(#{1,6})\s+(.+)$/.exec(markdown)
    const type = heading === null ? 'paragraph' : 'heading'
    const text = heading?.[2] ?? markdown.replaceAll(/[*_`>#]/g, '').trim()
    if (heading !== null) {
      const level = heading[1]?.length ?? 1
      headingPath.splice(level - 1)
      headingPath[level - 1] = text
    }
    const rewritten = await rewriteMarkdownAssets({
      markdown,
      markdownPath: markdownFile.relativePath,
      rawRoot: request.rawRoot,
      inventory,
      stagingPath: request.stagingPath,
      assets
    })
    const contentHash = sha256(
      Buffer.from(
        JSON.stringify({
          type,
          text,
          markdown: rewritten.markdown,
          headingPath,
          assets: rewritten.assetRefs
        })
      )
    )
    blocks.push(
      normalizedKnowledgeBlockSchema.parse({
        id: stableBlockId(request.parseRevisionId, ordinal, undefined, contentHash),
        ordinal,
        type,
        text,
        markdown: rewritten.markdown,
        headingPath: [...headingPath],
        assetRefs: rewritten.assetRefs,
        contentHash
      })
    )
  }
  return blocks
}

async function rewriteMarkdownAssets(input: {
  markdown: string
  markdownPath: string
  rawRoot: string
  inventory: Map<string, { relativePath: string; sha256: string; byteSize: number }>
  stagingPath: string
  assets: Map<string, AssetRecord>
}): Promise<{ markdown: string; assetRefs: string[] }> {
  const pattern = /!\[([^\]]*)\]\((<[^>]+>|[^)\s]+)(\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\)/g
  const assetRefs: string[] = []
  let output = ''
  let lastIndex = 0
  for (const match of input.markdown.matchAll(pattern)) {
    const start = match.index ?? 0
    output += input.markdown.slice(lastIndex, start)
    const sourcePath = (match[2] ?? '').replace(/^<|>$/g, '')
    if (sourcePath.length === 0 || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(sourcePath)) {
      output += match[0]
      lastIndex = start + match[0].length
      continue
    }
    const assetRef = await copyAsset({
      assetPath: sourcePath,
      contentList: input.markdownPath,
      rawRoot: input.rawRoot,
      inventory: input.inventory,
      stagingPath: input.stagingPath,
      assets: input.assets
    })
    assetRefs.push(assetRef)
    output += `![${match[1] ?? ''}](${assetRef}${match[3] ?? ''})`
    lastIndex = start + match[0].length
  }
  output += input.markdown.slice(lastIndex)
  return { markdown: output, assetRefs: [...new Set(assetRefs)] }
}

function chooseContentList(paths: string[]): string | undefined {
  return paths.find((path) => /(?:^|\/)content_list\.json$/.test(path))
}

function mapType(item: RawContentBlock): NormalizedKnowledgeBlock['type'] {
  const type = typeof item.type === 'string' ? item.type : 'other'
  if (type === 'text') return headingLevel(item) > 0 ? 'heading' : 'paragraph'
  if (type === 'title') return 'heading'
  if (type === 'list') return 'list'
  if (type === 'table') return 'table'
  if (type === 'equation') return 'formula'
  if (type === 'image' || type === 'chart') return 'image'
  if (type.includes('caption')) return 'caption'
  return 'other'
}

function blockText(
  item: RawContentBlock,
  type: NormalizedKnowledgeBlock['type']
): string | undefined {
  const candidate =
    typeof item.text === 'string'
      ? item.text
      : type === 'table' && typeof item.table_body === 'string'
        ? item.table_body
        : typeof item.code_body === 'string'
          ? item.code_body
          : flattenText(item.list_items)
  const normalized = candidate?.normalize('NFC').trim()
  return normalized === undefined || normalized.length === 0
    ? undefined
    : normalized.slice(0, 2_000_000)
}

function blockMarkdownFromRaw(
  item: RawContentBlock,
  type: NormalizedKnowledgeBlock['type'],
  text: string | undefined
): string | undefined {
  if (text === undefined) return undefined
  if (type === 'heading') return `${'#'.repeat(Math.min(6, headingLevel(item)))} ${text}`
  if (type === 'list')
    return text
      .split('\n')
      .map((line) => `- ${line}`)
      .join('\n')
  return text
}

function blockMarkdown(block: NormalizedKnowledgeBlock): string {
  if (block.type === 'image' && block.assetRefs[0] !== undefined) {
    return `![${block.text ?? 'Parsed image'}](${block.assetRefs[0]})`
  }
  return block.markdown ?? block.text ?? ''
}

function headingLevel(item: RawContentBlock): number {
  if (typeof item.text_level === 'number' && Number.isInteger(item.text_level)) {
    return Math.min(6, Math.max(0, item.text_level))
  }
  return item.type === 'title' ? 1 : 0
}

function page(item: RawContentBlock): number | undefined {
  return typeof item.page_idx === 'number' && Number.isInteger(item.page_idx) && item.page_idx >= 0
    ? item.page_idx
    : undefined
}

function bbox(item: RawContentBlock): [number, number, number, number] | undefined {
  if (
    !Array.isArray(item.bbox) ||
    item.bbox.length !== 4 ||
    !item.bbox.every((value) => typeof value === 'number' && Number.isFinite(value))
  )
    return undefined
  return item.bbox as [number, number, number, number]
}

function providerBlockId(item: RawContentBlock): string | undefined {
  const value = item.block_id ?? item.id ?? item.index
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  return String(value).slice(0, 256)
}

function captionTexts(item: RawContentBlock): string[] {
  return [item.image_caption, item.image_footnote, item.table_caption, item.table_footnote]
    .flatMap((value) => (Array.isArray(value) ? value : []))
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.normalize('NFC').trim().slice(0, 2_000_000))
}

function flattenText(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return undefined
  return value.flatMap((item) => (typeof item === 'string' ? [item] : [])).join('\n')
}

async function copyAsset(input: {
  assetPath: string
  contentList: string
  rawRoot: string
  inventory: Map<string, { relativePath: string; sha256: string; byteSize: number }>
  stagingPath: string
  assets: Map<string, AssetRecord>
}): Promise<string> {
  if (input.assetPath.includes('\\') || input.assetPath.startsWith('/')) {
    throw new Error('MinerU asset path is unsafe')
  }
  const sourceRelativePath = posix.normalize(
    posix.join(posix.dirname(input.contentList), input.assetPath)
  )
  if (!sourceRelativePath.startsWith('raw/extracted/') || sourceRelativePath.includes('/../')) {
    throw new Error('MinerU asset path escapes the raw result')
  }
  const record = input.inventory.get(sourceRelativePath)
  if (record === undefined || record.byteSize <= 0 || record.byteSize > MAX_ASSET_BYTES) {
    throw new Error('MinerU asset is missing or exceeds the viewer limit')
  }
  const extension = extname(sourceRelativePath).toLowerCase()
  const mimeType = imageMime(extension)
  const relativePath = `images/${record.sha256}${extension}`
  if (!input.assets.has(relativePath)) {
    const bytes = await readBounded(`${input.rawRoot}/${sourceRelativePath}`, MAX_ASSET_BYTES)
    if (bytes.byteLength !== record.byteSize || sha256(bytes) !== record.sha256) {
      throw new Error('MinerU asset hash or size does not match')
    }
    validateImageBytes(bytes, extension)
    const destination = `${input.stagingPath}/${relativePath}`
    await mkdir(dirname(destination), { recursive: true })
    await writeDurable(destination, bytes)
    input.assets.set(relativePath, {
      relativePath,
      sha256: record.sha256,
      byteSize: record.byteSize,
      mimeType,
      sourceRelativePath
    })
  }
  return relativePath
}

function imageMime(extension: string): AssetRecord['mimeType'] {
  const values: Record<string, AssetRecord['mimeType']> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp'
  }
  const value = values[extension]
  if (value === undefined) throw new Error('MinerU asset type is unsupported')
  return value
}

function validateImageBytes(bytes: Buffer, extension: string): void {
  const valid =
    (extension === '.png' &&
      bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    ((extension === '.jpg' || extension === '.jpeg') &&
      bytes[0] === 0xff &&
      bytes[1] === 0xd8 &&
      bytes[2] === 0xff) ||
    (extension === '.gif' && ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString())) ||
    (extension === '.webp' &&
      bytes.subarray(0, 4).toString() === 'RIFF' &&
      bytes.subarray(8, 12).toString() === 'WEBP') ||
    (extension === '.bmp' && bytes.subarray(0, 2).toString() === 'BM')
  if (!valid) throw new Error('MinerU asset content does not match its image extension')
}

function stableBlockId(
  parseRevisionId: string,
  ordinal: number,
  providerId: string | undefined,
  contentHash: string
): string {
  return `kb_${sha256(Buffer.from(`${parseRevisionId}\0${ordinal}\0${providerId ?? ''}\0${contentHash}`)).slice(0, 32)}`
}

async function readBounded(path: string, maxBytes: number): Promise<Buffer> {
  const handle = await open(path, 'r')
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes) {
      throw new Error('Normalizer input file size is invalid')
    }
    return await handle.readFile()
  } finally {
    await handle.close()
  }
}

async function writeDurable(path: string, bytes: Buffer): Promise<void> {
  const handle = await open(path, 'wx', 0o600)
  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}
