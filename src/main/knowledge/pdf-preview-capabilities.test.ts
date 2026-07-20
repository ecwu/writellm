import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PdfPreviewCapabilities } from './pdf-preview-capabilities'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('PdfPreviewCapabilities', () => {
  it('streams PDF bytes with HEAD, bounded single ranges, and suffix ranges', async () => {
    const root = await mkdtemp(join(tmpdir(), 'writellm-pdf-preview-'))
    roots.push(root)
    const path = join(root, 'source.pdf')
    const bytes = Buffer.from('%PDF-1.7\n0123456789')
    await writeFile(path, bytes)
    const capabilities = new PdfPreviewCapabilities({
      isSessionActive: () => true,
      developmentUrl: 'http://localhost:5173',
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    })
    const issued = capabilities.issue({
      projectSessionId: 'session-1',
      knowledgeItemId: 'item-1',
      absolutePath: path,
      byteSize: bytes.byteLength,
      sourceSha256: 'a'.repeat(64)
    })

    const full = await capabilities.handle(new Request(issued.url))
    expect(full?.status).toBe(200)
    expect(await full?.text()).toBe(bytes.toString())
    const head = await capabilities.handle(new Request(issued.url, { method: 'HEAD' }))
    expect(head?.status).toBe(200)
    expect(await head?.text()).toBe('')
    const range = await capabilities.handle(
      new Request(issued.url, { headers: { Range: 'bytes=5-9' } })
    )
    expect(range?.status).toBe(206)
    expect(await range?.text()).toBe('1.7\n0')
    const suffix = await capabilities.handle(
      new Request(issued.url, { headers: { Range: 'bytes=-5' } })
    )
    expect(await suffix?.text()).toBe('56789')
    const multi = await capabilities.handle(
      new Request(issued.url, { headers: { Range: 'bytes=0-1,3-4' } })
    )
    expect(multi?.status).toBe(416)
  })

  it('revokes stale sessions and rejects a replaced non-PDF file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'writellm-pdf-preview-'))
    roots.push(root)
    const path = join(root, 'source.pdf')
    await writeFile(path, '%PDF-1.7\ncontent')
    let active = true
    const capabilities = new PdfPreviewCapabilities({
      isSessionActive: () => active,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    })
    const issued = capabilities.issue({
      projectSessionId: 'session-1',
      knowledgeItemId: 'item-1',
      absolutePath: path,
      byteSize: Buffer.byteLength('%PDF-1.7\ncontent'),
      sourceSha256: 'b'.repeat(64)
    })
    active = false
    expect((await capabilities.handle(new Request(issued.url)))?.status).toBe(404)
    active = true
    await writeFile(path, 'not a PDF file')
    expect((await capabilities.handle(new Request(issued.url)))?.status).toBe(404)
    capabilities.revoke(issued.previewId, 'session-1')
    expect((await capabilities.handle(new Request(issued.url)))?.status).toBe(404)
  })
})
