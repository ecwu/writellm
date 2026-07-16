import { createHash } from 'node:crypto'
import { mkdir, open, rm } from 'node:fs/promises'
import { dirname, extname, isAbsolute, relative, resolve, win32 } from 'node:path'
import { openPromise, validateFileName, type Entry } from 'yauzl'

const DEFAULT_MAX_FILES = 5_000
const DEFAULT_MAX_EXPANDED_BYTES = 1024 * 1024 * 1024
const DEFAULT_MAX_FILE_BYTES = 256 * 1024 * 1024
const MAX_COMPRESSION_RATIO = 200
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

export interface ExtractedMineruFile {
  relativePath: string
  sha256: string
  byteSize: number
}

export interface ExtractMineruArchiveOptions {
  archivePath: string
  destinationRoot: string
  manifestPrefix?: string
  maxFiles?: number
  maxExpandedBytes?: number
  maxFileBytes?: number
}

export interface ExtractMineruArchiveResult {
  files: ExtractedMineruFile[]
  expandedByteSize: number
}

export async function extractMineruArchive(
  options: ExtractMineruArchiveOptions
): Promise<ExtractMineruArchiveResult> {
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES
  const maxExpandedBytes = options.maxExpandedBytes ?? DEFAULT_MAX_EXPANDED_BYTES
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES
  const zip = await openPromise(options.archivePath, {
    lazyEntries: true,
    decodeStrings: true,
    validateEntrySizes: true,
    strictFileNames: true,
    autoClose: false
  })
  const seen = new Set<string>()
  const files: ExtractedMineruFile[] = []
  let declaredTotal = 0
  let actualTotal = 0
  await mkdir(options.destinationRoot, { recursive: true })
  try {
    if (zip.entryCount > maxFiles * 2) throw new Error('MinerU archive has too many entries')
    for await (const entry of zip.eachEntry()) {
      const relativePath = validateEntry(entry)
      if (relativePath === null) continue
      if (seen.has(relativePath)) throw new Error('MinerU archive contains duplicate paths')
      seen.add(relativePath)
      if (files.length >= maxFiles) throw new Error('MinerU archive has too many files')
      if (entry.uncompressedSize > maxFileBytes) {
        throw new Error('MinerU archive entry exceeds the per-file limit')
      }
      declaredTotal += entry.uncompressedSize
      if (declaredTotal > maxExpandedBytes) {
        throw new Error('MinerU archive exceeds the expanded-size limit')
      }
      if (
        entry.uncompressedSize > 0 &&
        (entry.compressedSize === 0 ||
          entry.uncompressedSize / entry.compressedSize > MAX_COMPRESSION_RATIO)
      ) {
        throw new Error('MinerU archive entry has an unsafe compression ratio')
      }

      const destination = containedPath(options.destinationRoot, relativePath)
      await mkdir(dirname(destination), { recursive: true })
      const source = await zip.openReadStreamPromise(entry)
      const output = await open(destination, 'wx', 0o600)
      const hash = createHash('sha256')
      let byteSize = 0
      try {
        for await (const chunk of source) {
          const bytes = Buffer.from(chunk)
          byteSize += bytes.byteLength
          actualTotal += bytes.byteLength
          if (byteSize > maxFileBytes || actualTotal > maxExpandedBytes) {
            throw new Error('MinerU archive expanded beyond its declared limits')
          }
          hash.update(bytes)
          await output.write(bytes)
        }
        if (byteSize !== entry.uncompressedSize) {
          throw new Error('MinerU archive entry size did not match its declaration')
        }
        await output.sync()
      } catch (err) {
        source.destroy()
        await output.close().catch(() => undefined)
        await rm(destination, { force: true }).catch(() => undefined)
        throw err
      }
      await output.close()
      files.push({
        relativePath: prefixPath(options.manifestPrefix, relativePath),
        sha256: hash.digest('hex'),
        byteSize
      })
    }
  } finally {
    zip.close()
  }
  if (files.length === 0) throw new Error('MinerU archive contains no supported files')
  return { files, expandedByteSize: actualTotal }
}

function validateEntry(entry: Entry): string | null {
  if (entry.isEncrypted() || !entry.canDecodeFileData()) {
    throw new Error('MinerU archive contains an encrypted or unsupported entry')
  }
  if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
    throw new Error('MinerU archive uses an unsupported compression method')
  }
  const name = entry.fileName.normalize('NFC')
  if (
    validateFileName(name) !== null ||
    name.includes('\\') ||
    name.includes('\0') ||
    isAbsolute(name) ||
    win32.isAbsolute(name)
  ) {
    throw new Error('MinerU archive contains an unsafe path')
  }
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff
  const unixFileType = unixMode & 0o170000
  if (unixFileType === 0o120000) throw new Error('MinerU archive contains a symbolic link')
  const directory = name.endsWith('/') || unixFileType === 0o040000
  if (directory) return null
  if (unixFileType !== 0 && unixFileType !== 0o100000) {
    throw new Error('MinerU archive contains a non-regular file')
  }
  const normalized = name.split('/').filter(Boolean).join('/')
  if (normalized.length === 0 || normalized.length > 1_024) {
    throw new Error('MinerU archive path length is invalid')
  }
  const extension = extname(normalized).toLowerCase()
  if (!allowedExtensions.has(extension)) {
    throw new Error(
      `MinerU archive contains an unexpected file type (${extension === '' ? 'no extension' : extension})`
    )
  }
  return normalized
}

function containedPath(root: string, entryPath: string): string {
  const destination = resolve(root, ...entryPath.split('/'))
  const fromRoot = relative(resolve(root), destination)
  if (fromRoot === '' || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw new Error('MinerU archive path escapes the extraction root')
  }
  return destination
}

function prefixPath(prefix: string | undefined, path: string): string {
  return prefix === undefined ? path : `${prefix.replace(/\/$/, '')}/${path}`
}
