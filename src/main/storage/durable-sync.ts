import { open } from 'node:fs/promises'

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
