import { mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  inspectSelectedSource,
  readStableSource,
  shouldRefreshBibliographyWatch
} from './bibliography-connector-service'

describe('bibliography connector source boundary', () => {
  it('accepts only bounded regular JSON/BibTeX files and reads stable content', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'writellm-bibliography-'))
    const source = join(directory, 'library.json')
    await writeFile(source, '[{"id":"key","type":"article","title":"Paper"}]')
    await expect(inspectSelectedSource(source)).resolves.toMatchObject({
      path: await realpath(source),
      format: 'better-csl-json'
    })
    await expect(readStableSource(source)).resolves.toContain('Paper')
  })

  it('rejects symlink sources and unknown extensions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'writellm-bibliography-'))
    const source = join(directory, 'library.json')
    const linked = join(directory, 'linked.json')
    await writeFile(source, '[]')
    await symlink(source, linked)
    await expect(inspectSelectedSource(linked)).rejects.toThrow('non-symbolic-link')
    const unknown = join(directory, 'library.txt')
    await writeFile(unknown, '[]')
    await expect(inspectSelectedSource(unknown)).rejects.toThrow('unsupported')
  })

  it('refreshes exact-file change and rename events used for unlink/recreate replacement', () => {
    for (const event of ['change', 'rename']) {
      expect(shouldRefreshBibliographyWatch(event, 'library.json', 'library.json')).toBe(true)
      expect(
        shouldRefreshBibliographyWatch(event, Buffer.from('library.json'), 'library.json')
      ).toBe(true)
    }
    expect(shouldRefreshBibliographyWatch('rename', 'other.json', 'library.json')).toBe(false)
    expect(shouldRefreshBibliographyWatch('change', null, 'library.json')).toBe(false)
    expect(shouldRefreshBibliographyWatch('unknown', 'library.json', 'library.json')).toBe(false)
  })

  it('rejects a source whose size or mtime does not settle before reading', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'writellm-bibliography-changing-'))
    const source = join(directory, 'library.json')
    await writeFile(source, '[]')
    const reading = readStableSource(source)
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
    await writeFile(source, '[{"id":"later"}]')
    await expect(reading).rejects.toThrow('still changing')
  })
})
