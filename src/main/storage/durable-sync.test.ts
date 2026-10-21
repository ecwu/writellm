import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { isUnsupportedDirectorySyncError, readBounded, writeDurable } from './durable-sync'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('durable sync', () => {
  it('treats Windows directory fsync EPERM as unsupported without hiding POSIX permission errors', () => {
    const error = Object.assign(new Error('operation not permitted'), { code: 'EPERM' })

    expect(isUnsupportedDirectorySyncError(error, 'win32')).toBe(true)
    expect(isUnsupportedDirectorySyncError(error, 'darwin')).toBe(false)
    expect(isUnsupportedDirectorySyncError(error, 'linux')).toBe(false)
  })

  it.each(['EINVAL', 'ENOTSUP', 'EBADF'])('accepts portable unsupported code %s', (code) => {
    expect(
      isUnsupportedDirectorySyncError(Object.assign(new Error('unsupported'), { code }), 'linux')
    ).toBe(true)
  })

  it('reads bounded files and preserves the caller-specific validation message', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'writellm-durable-file-'))
    directories.push(directory)
    const path = join(directory, 'input.txt')
    await writeFile(path, 'bounded', 'utf8')

    await expect(readBounded(path, 32)).resolves.toEqual(Buffer.from('bounded'))
    await expect(
      readBounded(path, 2, { invalidMessage: 'Normalizer input file size is invalid' })
    ).rejects.toThrow('Normalizer input file size is invalid')
  })

  it('creates durable files without replacing existing output', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'writellm-durable-file-'))
    directories.push(directory)
    const path = join(directory, 'output.bin')

    await writeDurable(path, Buffer.from('first'))
    await expect(readFile(path)).resolves.toEqual(Buffer.from('first'))
    await expect(writeDurable(path, Buffer.from('second'))).rejects.toMatchObject({
      code: 'EEXIST'
    })
    await expect(readFile(path)).resolves.toEqual(Buffer.from('first'))
  })
})
