import { open } from 'node:fs/promises'

export interface ReadBoundedOptions {
  allowEmpty?: boolean
  invalidMessage?: string
}

/** Read one regular file while enforcing an explicit byte bound. */
export async function readBounded(
  path: string,
  maxBytes: number,
  options: ReadBoundedOptions = {}
): Promise<Buffer> {
  const handle = await open(path, 'r')
  try {
    const metadata = await handle.stat()
    if (
      !metadata.isFile() ||
      (!options.allowEmpty && metadata.size <= 0) ||
      metadata.size > maxBytes
    ) {
      throw new Error(options.invalidMessage ?? 'Input file size is invalid')
    }
    return await handle.readFile()
  } finally {
    await handle.close()
  }
}

/** Create and durably write one file without replacing an existing path. */
export async function writeDurable(path: string, bytes: Buffer): Promise<void> {
  const handle = await open(path, 'wx', 0o600)
  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

export async function syncFile(path: string): Promise<void> {
  const handle = await open(path, 'r+')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

export async function syncDirectory(path: string): Promise<void> {
  try {
    const handle = await open(path, 'r')
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  } catch (err) {
    if (isUnsupportedDirectorySyncError(err)) return
    throw err
  }
}

export function isUnsupportedDirectorySyncError(
  error: unknown,
  platform: NodeJS.Platform = process.platform
): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return (
    code === 'EINVAL' ||
    code === 'ENOTSUP' ||
    code === 'EBADF' ||
    (platform === 'win32' && code === 'EPERM')
  )
}
