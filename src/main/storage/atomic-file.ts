import { randomUUID } from 'node:crypto'
import { link, mkdir, open, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { syncDirectory } from './durable-sync'

export interface AtomicFileOptions {
  mode?: number
  publishWithoutReplacement?: boolean
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
    if (options.publishWithoutReplacement) {
      try {
        await link(temporary, destination)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false
        throw err
      }
    } else {
      await rename(temporary, destination)
    }
    await options.afterRename?.()
    await syncDirectory(dirname(destination))
    return true
  } finally {
    await handle?.close().catch(() => undefined)
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}
