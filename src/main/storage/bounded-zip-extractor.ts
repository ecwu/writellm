import { createHash } from 'node:crypto'
import { mkdir, open, rm } from 'node:fs/promises'
import { dirname, extname, isAbsolute, relative, resolve, win32 } from 'node:path'
import type { Logger } from 'pino'
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
  log?: Pick<Logger, 'info' | 'warn' | 'error'>
}

export interface ExtractBoundedZipResult {
  files: ExtractedBoundedZipFile[]
  expandedByteSize: number
}

export async function extractBoundedZip(
  options: ExtractBoundedZipOptions
): Promise<ExtractBoundedZipResult> {
  const startedAt = Date.now()
  try {
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
      if (zip.entryCount > maxFiles * 2) {
        throw failure(options, 'too_many_entries', 'has too many entries')
      }
      for await (const entry of zip.eachEntry()) {
        const relativePath = validateEntry(entry, options)
        if (relativePath === null) continue
        if (seen.has(relativePath)) {
          throw failure(options, 'duplicate_paths', 'contains duplicate paths', relativePath)
        }
        seen.add(relativePath)
        if (files.length >= maxFiles) {
          throw failure(options, 'too_many_files', 'has too many files', relativePath)
        }
        if (entry.uncompressedSize > maxFileBytes) {
          throw failure(options, 'file_too_large', 'entry exceeds the per-file limit', relativePath)
        }
        declaredTotal += entry.uncompressedSize
        if (declaredTotal > maxExpandedBytes) {
          throw failure(
            options,
            'expanded_size_exceeded',
            'exceeds the expanded-size limit',
            relativePath
          )
        }
        if (
          entry.uncompressedSize > 0 &&
          (entry.compressedSize === 0 ||
            entry.uncompressedSize / entry.compressedSize > maxCompressionRatio)
        ) {
          throw failure(
            options,
            'unsafe_compression_ratio',
            'entry has an unsafe compression ratio',
            relativePath
          )
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
              throw failure(
                options,
                'expanded_beyond_declared',
                'expanded beyond its declared limits',
                relativePath
              )
            }
            hash.update(bytes)
            await output.write(bytes)
          }
          if (byteSize !== entry.uncompressedSize) {
            throw failure(
              options,
              'size_mismatch',
              'entry size did not match its declaration',
              relativePath
            )
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
    if (files.length === 0) {
      throw failure(options, 'no_supported_files', 'contains no supported files')
    }
    options.log?.info(
      {
        event: 'storage.bounded_zip.extracted',
        label: options.label,
        fileCount: files.length,
        expandedByteSize: actualTotal,
        durationMs: Date.now() - startedAt
      },
      'Bounded zip extraction completed'
    )
    return { files, expandedByteSize: actualTotal }
  } catch (err) {
    if (!isBoundedZipRejection(err)) {
      options.log?.error(
        {
          event: 'storage.bounded_zip.failed',
          err,
          label: options.label,
          durationMs: Date.now() - startedAt
        },
        'Bounded zip extraction failed'
      )
    }
    throw err
  }
}

function validateEntry(entry: Entry, options: ExtractBoundedZipOptions): string | null {
  if (entry.isEncrypted() || !entry.canDecodeFileData()) {
    throw failure(
      options,
      'encrypted_or_unsupported_entry',
      'contains an encrypted or unsupported entry',
      entry.fileName.normalize('NFC').slice(0, 1_024)
    )
  }
  if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
    throw failure(
      options,
      'unsupported_compression_method',
      'uses an unsupported compression method',
      entry.fileName.normalize('NFC').slice(0, 1_024)
    )
  }
  const name = entry.fileName.normalize('NFC')
  if (
    validateFileName(name) !== null ||
    name.includes('\\') ||
    name.includes('\0') ||
    isAbsolute(name) ||
    win32.isAbsolute(name)
  ) {
    throw failure(options, 'unsafe_path', 'contains an unsafe path', name.slice(0, 1_024))
  }
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff
  const unixFileType = unixMode & 0o170000
  if (unixFileType === 0o120000) {
    throw failure(options, 'symbolic_link', 'contains a symbolic link', name.slice(0, 1_024))
  }
  const directory = name.endsWith('/') || unixFileType === 0o040000
  if (directory) return null
  if (unixFileType !== 0 && unixFileType !== 0o100000) {
    throw failure(options, 'non_regular_file', 'contains a non-regular file', name.slice(0, 1_024))
  }
  const normalized = name.split('/').filter(Boolean).join('/')
  if (normalized.length === 0 || normalized.length > 1_024) {
    throw failure(options, 'invalid_path_length', 'path length is invalid', name.slice(0, 1_024))
  }
  const extension = extname(normalized).toLowerCase()
  if (!options.allowedExtensions.has(extension)) {
    throw failure(
      options,
      'unexpected_file_type',
      `contains an unexpected file type (${extension === '' ? 'no extension' : extension})`,
      normalized
    )
  }
  return normalized
}

function containedPath(root: string, entryPath: string, options: ExtractBoundedZipOptions): string {
  const destination = resolve(root, ...entryPath.split('/'))
  const fromRoot = relative(resolve(root), destination)
  if (fromRoot === '' || fromRoot.startsWith('..') || isAbsolute(fromRoot)) {
    throw failure(options, 'path_escapes_root', 'path escapes the extraction root', entryPath)
  }
  return destination
}

function prefixPath(prefix: string | undefined, path: string): string {
  return prefix === undefined ? path : `${prefix.replace(/\/$/u, '')}/${path}`
}

function failure(
  options: ExtractBoundedZipOptions,
  reason: string,
  message: string,
  entryName?: string
): Error {
  options.log?.warn(
    {
      event: 'storage.bounded_zip.rejected',
      label: options.label,
      reason,
      ...(entryName === undefined ? {} : { entryName })
    },
    'Bounded zip extraction rejected an archive'
  )
  const error = new Error(`${options.label} ${message}`)
  ;(error as Error & { boundedZipRejection?: boolean }).boundedZipRejection = true
  return error
}

function isBoundedZipRejection(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err as Error & { boundedZipRejection?: boolean }).boundedZipRejection === true
  )
}
