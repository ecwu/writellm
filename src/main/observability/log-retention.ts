import { readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'

export interface RetentionOptions {
  maxAgeMs: number
  maxTotalBytes: number
  activeFileName: string
  now?: number
}

export async function cleanupLogRetention(
  directory: string,
  options: RetentionOptions
): Promise<{ deleted: string[] }> {
  const now = options.now ?? Date.now()
  const files = await Promise.all(
    (await readdir(directory))
      .filter((name) => name.endsWith('.log') && name !== options.activeFileName)
      .map(async (name) => {
        const info = await stat(join(directory, name))
        return { name, size: info.size, modifiedAt: info.mtimeMs }
      })
  )
  files.sort((left, right) => left.modifiedAt - right.modifiedAt)
  const newestFile = files.at(-1)?.name

  const deleted: string[] = []
  let totalBytes = files.reduce((sum, file) => sum + file.size, 0)
  for (const file of files) {
    if (file.name === newestFile) continue
    if (now - file.modifiedAt <= options.maxAgeMs && totalBytes <= options.maxTotalBytes) continue
    await unlink(join(directory, file.name))
    totalBytes -= file.size
    deleted.push(file.name)
  }
  return { deleted }
}
