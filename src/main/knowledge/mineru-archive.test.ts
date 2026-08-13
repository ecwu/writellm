import { createWriteStream } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { ZipFile } from 'yazl'
import { extractMineruArchive } from './mineru-archive'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })))
})

describe('extractMineruArchive', () => {
  it('manually extracts only supported regular files and returns a hashed manifest inventory', async () => {
    const root = await fixtureRoot()
    const archive = join(root, 'result.zip')
    await createZip(archive, [
      ['full.md', '# Parsed'],
      ['content_list.json', '[]'],
      ['images/figure.png', 'png-bytes'],
      ['layout.pdf', 'pdf-bytes'],
      ['export.docx', 'docx-bytes'],
      ['export.tex', 'tex-bytes']
    ])
    const destination = join(root, 'staging')
    const result = await extractMineruArchive({
      archivePath: archive,
      destinationRoot: destination,
      manifestPrefix: 'raw/extracted'
    })

    expect(result.files.map((file) => file.relativePath)).toEqual([
      'raw/extracted/full.md',
      'raw/extracted/content_list.json',
      'raw/extracted/images/figure.png',
      'raw/extracted/layout.pdf',
      'raw/extracted/export.docx',
      'raw/extracted/export.tex'
    ])
    expect(result.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true)
    expect(await readFile(join(destination, 'full.md'), 'utf8')).toBe('# Parsed')
  })

  it('rejects traversal, symlinks, unexpected types, excessive counts, and expansion limits', async () => {
    const root = await fixtureRoot()
    const traversal = join(root, 'traversal.zip')
    await createZip(traversal, [['aaa.md', 'escape']])
    const bytes = await readFile(traversal)
    await writeFile(
      traversal,
      Buffer.from(bytes.toString('binary').replaceAll('aaa.md', '../x.md'), 'binary')
    )
    await expect(
      extractMineruArchive({ archivePath: traversal, destinationRoot: join(root, 'traversal-out') })
    ).rejects.toThrow()

    const symlink = join(root, 'symlink.zip')
    await createZip(symlink, [['link.md', 'target', 0o120777]])
    await expect(
      extractMineruArchive({ archivePath: symlink, destinationRoot: join(root, 'symlink-out') })
    ).rejects.toThrow('symbolic link')

    const device = join(root, 'device.zip')
    await createZip(device, [['device.md', 'target', 0o060666]])
    await expect(
      extractMineruArchive({ archivePath: device, destinationRoot: join(root, 'device-out') })
    ).rejects.toThrow('non-regular file')

    const unexpected = join(root, 'unexpected.zip')
    await createZip(unexpected, [['payload.exe', 'bad']])
    await expect(
      extractMineruArchive({
        archivePath: unexpected,
        destinationRoot: join(root, 'unexpected-out')
      })
    ).rejects.toThrow('unexpected file type (.exe)')

    const count = join(root, 'count.zip')
    await createZip(count, [
      ['one.md', '1'],
      ['two.md', '2']
    ])
    await expect(
      extractMineruArchive({
        archivePath: count,
        destinationRoot: join(root, 'count-out'),
        maxFiles: 1
      })
    ).rejects.toThrow('too many')

    const expanded = join(root, 'expanded.zip')
    await createZip(expanded, [['large.md', 'x'.repeat(200)]])
    await expect(
      extractMineruArchive({
        archivePath: expanded,
        destinationRoot: join(root, 'expanded-out'),
        maxExpandedBytes: 100
      })
    ).rejects.toThrow('expanded-size')

    const compressionBomb = join(root, 'compression-bomb.zip')
    await createZip(compressionBomb, [['large.md', 'x'.repeat(100_000)]])
    await expect(
      extractMineruArchive({
        archivePath: compressionBomb,
        destinationRoot: join(root, 'compression-bomb-out'),
        maxExpandedBytes: 200_000
      })
    ).rejects.toThrow('compression ratio')
  })
})

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'writellm-mineru-archive-'))
  directories.push(root)
  return root
}

async function createZip(
  path: string,
  entries: Array<[name: string, content: string, mode?: number]>
): Promise<void> {
  const zip = new ZipFile()
  for (const [name, content, mode] of entries) {
    zip.addBuffer(Buffer.from(content), name, mode === undefined ? {} : { mode })
  }
  zip.end()
  await pipeline(zip.outputStream, createWriteStream(path, { flags: 'wx', mode: 0o600 }))
}
