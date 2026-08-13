import { createHash } from 'node:crypto'
import { mkdir, open, rm } from 'node:fs/promises'
import { dirname, extname, isAbsolute, relative, resolve, win32 } from 'node:path'
import { openPromise, validateFileName, type Entry } from 'yauzl'

const DEFAULT_MAX_FILES = 5_000
const DEFAULT_MAX_EXPANDED_BYTES = 1024 * 1024 * 1024
const DEFAULT_MAX_FILE_BYTES = 256 * 1024 * 1024
const DEFAULT_MAX_COMPRESSION_RATIO = 200

export interface ExtractedBoundedZipFile {
  relativePath: string
  sha256: string
  byteSize: number
}

export interface ExtractBoundedZipOptions {
  archivePath: string
  destinationRoot: string
  label: string
  allowedExtensions: ReadonlySet<string>
  manifestPrefix?: string
  maxFiles?: number
  maxExpandedBytes?: number
  maxFileBytes?: number
  maxCompressionRatio?: number
}

export interface ExtractBoundedZipResult {
  files: ExtractedBoundedZipFile[]
  expandedByteSize: number
}

export async function extractBoundedZip(
  options: ExtractBoundedZipOptions
): Promise<ExtractBoundedZipResult> {
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES
  const maxExpandedBytes = options.maxExpandedBytes ?? DEFAULT_MAX_EXPANDED_BYTES
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES
  const maxCompressionRatio = options.maxCompressionRatio ?? DEFAULT_MAX_COMPRESSION_RATIO
  const zip = await openPromise(options.archivePath, {
    lazyEntries: true,
    decodeStrings: true,
    validateEntrySizes: true,
    strictFileNames: true,
    autoClose: false
  })
  const seen = new Set<string>()
  const files: ExtractedBoundedZipFile[] = []
  let declaredTotal = 0
  let actualTotal = 0
  await mkdir(options.destinationRoot, { recursive: true })
  try {
    if (zip.entryCount > maxFiles * 2) throw failure(options, 'has too many entries')
    for await (const entry of zip.eachEntry()) {
      const relativePath = validateEntry(entry, options)
      if (relativePath === null) continue
      if (seen.has(relativePath)) throw failure(options, 'contains duplicate paths')
      seen.add(relativePath)
      if (files.length >= maxFiles) throw failure(options, 'has too many files')
      if (entry.uncompressedSize > maxFileBytes) {
        throw failure(options, 'entry exceeds the per-file limit')
      }
      declaredTotal += entry.uncompressedSize
      if (declaredTotal > maxExpandedBytes) {
        throw failure(options, 'exceeds the expanded-size limit')
      }
      if (
        entry.uncompressedSize > 0 &&
        (entry.compressedSize === 0 ||
          entry.uncompressedSize / entry.compressedSize > maxCompressionRatio)
      ) {
        throw failure(options, 'entry has an unsafe compression ratio')
      }

      const destination = containedPath(options.destinationRoot, relativePath, options)
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
            throw failure(options, 'expanded beyond its declared limits')
          }
          hash.update(bytes)
          await output.write(bytes)
        }
        if (byteSize !== entry.uncompressedSize) {
          throw failure(options, 'entry size did not match its declaration')
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
  if (files.length === 0) throw failure(options, 'contains no supported files')
  return { files, expandedByteSize: actualTotal }
}

function validateEntry(entry: Entry, options: ExtractBoundedZipOptions): string | null {
  if (entry.isEncrypted() || !entry.canDecodeFileData()) {
    throw failure(options, 'contains an encrypted or unsupported entry')
  }
  if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
    throw failure(options, 'uses an unsupported compression method')
  }
  const name = entry.fileName.normalize('NFC')
  if (
    validateFileName(name) !== null ||
    name.includes('\\') ||
    name.includes('\0') ||
    isAbsolute(name) ||
    win32.isAbsolute(name)
  ) {
    throw failure(options, 'contains an unsafe path')
  }
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff
  const unixFileType = unixMode & 0o170000
  if (unixFileType === 0o120000) throw failure(options, 'contains a symbolic link')
  const directory = name.endsWith('/') || unixFileType === 0o040000
  if (directory) return null
  if (unixFileType !== 0 && unixFileType !== 0o100000) {
    throw failure(options, 'contains a non-regular file')
  }
  const normalized = name.split('/').filter(Boolean).join('/')
  if (normalized.length === 0 || normalized.length > 1_024) {
    throw failure(options, 'path length is invalid')
  }
  const extension = extname(normalized).toLowerCase()
  if (!options.allowedExtensions.has(extension)) {
    throw failure(
      options,
      `contains an unexpected file type (${extension === '' ? 'no extension' : extension})`
    )
  }
  return normalized
}

function containedPath(root: string, entryPath: string, options: ExtractBoundedZipOptions): string {
  const destination = resolve(root, ...entryPath.split('/'))
  const fromRoot = relative(resolve(root), destination)
  if (fromRoot === '' || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw failure(options, 'path escapes the extraction root')
  }
  return destination
}

function prefixPath(prefix: string | undefined, path: string): string {
  return prefix === undefined ? path : `${prefix.replace(/\/$/u, '')}/${path}`
}

function failure(options: ExtractBoundedZipOptions, message: string): Error {
  return new Error(`${options.label} ${message}`)
}
