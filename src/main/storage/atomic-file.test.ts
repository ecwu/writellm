import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { writeAtomicFile } from './atomic-file'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('writeAtomicFile', () => {
  it('publishes durable bytes and runs rename hooks in order', async () => {
    const root = await mkdtemp(join(tmpdir(), 'writellm-atomic-file-'))
    roots.push(root)
    const events: string[] = []
    const destination = join(root, 'nested', 'document.json')

    await expect(
      writeAtomicFile(destination, Buffer.from('next'), {
        beforeRename: () => {
          events.push('before')
        },
        afterRename: () => {
          events.push('after')
        }
      })
    ).resolves.toBe(true)

    await expect(readFile(destination, 'utf8')).resolves.toBe('next')
    expect(events).toEqual(['before', 'after'])
    expect(await readdir(join(root, 'nested'))).toEqual(['document.json'])
  })

  it('removes an unpublished temporary file when the revision becomes stale', async () => {
    const root = await mkdtemp(join(tmpdir(), 'writellm-atomic-file-stale-'))
    roots.push(root)
    const destination = join(root, 'document.md')

    await expect(
      writeAtomicFile(destination, 'stale', { shouldRename: () => false })
    ).resolves.toBe(false)
    await expect(access(destination)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(root)).toEqual([])
  })
})
