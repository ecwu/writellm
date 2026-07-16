import { randomUUID } from 'node:crypto'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface AtomicFileOptions {
  mode?: number
  shouldRename?(): boolean | Promise<boolean>
  beforeRename?(): void | Promise<void>
  afterRename?(): void | Promise<void>
}

/** Write, fsync, and publish one file while preserving the original failure. */
export async function writeAtomicFile(
  destination: string,
  bytes: Buffer | string,
  options: AtomicFileOptions = {}
): Promise<boolean> {
  await mkdir(dirname(destination), { recursive: true })
  const temporary = `${destination}.${randomUUID()}.tmp`
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(temporary, 'wx', options.mode ?? 0o600)
    await handle.writeFile(bytes)
    await handle.sync()
    await handle.close()
    handle = undefined
    await options.beforeRename?.()
    const shouldRename = (await options.shouldRename?.()) ?? true
    if (!shouldRename) return false
    await rename(temporary, destination)
    await options.afterRename?.()
    const directory = await open(dirname(destination), 'r')
    try {
      await directory.sync()
    } finally {
      await directory.close()
    }
    return true
  } finally {
    await handle?.close().catch(() => undefined)
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}
