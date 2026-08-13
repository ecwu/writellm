import type { Logger } from 'pino'
import { extractBoundedZip, type ExtractedBoundedZipFile } from '../storage/bounded-zip-extractor'

const allowedExtensions = new Set([
  '.md',
  '.json',
  '.html',
  '.tex',
  '.pdf',
  '.docx',
  '.pptx',
  '.xlsx',
  '.png',
  '.jpg',
  '.jpeg',
  '.jp2',
  '.gif',
  '.webp',
  '.bmp',
  '.tif',
  '.tiff',
  '.svg'
])

export type ExtractedMineruFile = ExtractedBoundedZipFile

export interface ExtractMineruArchiveOptions {
  archivePath: string
  destinationRoot: string
  manifestPrefix?: string
  maxFiles?: number
  maxExpandedBytes?: number
  maxFileBytes?: number
  log?: Pick<Logger, 'info' | 'warn' | 'error'>
}

export interface ExtractMineruArchiveResult {
  files: ExtractedMineruFile[]
  expandedByteSize: number
}

export function extractMineruArchive(
  options: ExtractMineruArchiveOptions
): Promise<ExtractMineruArchiveResult> {
  return extractBoundedZip({
    ...options,
    label: 'MinerU archive',
    allowedExtensions
  })
}
