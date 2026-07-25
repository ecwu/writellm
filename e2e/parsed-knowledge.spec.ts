import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { readFile, rm, writeFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'
import { expect, expectActiveProject, launchApp, test } from './fixtures'
import { ZipFile } from 'yazl'

function makeMinimalPdf(): string {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '<< /Length 52 >>\nstream\nBT\n/F1 24 Tf\n100 700 Td\n(Hello from PDF) Tj\nET\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xrefOffset = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return pdf
}

async function configureMineruProvider(page: Page, port: number): Promise<void> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('option', { name: /MinerU parser/ }).click()
  const provider = page.getByRole('dialog', { name: 'MinerU parser' })
  await provider.getByLabel('Base URL').fill(`http://127.0.0.1:${port}`)
  await provider.getByLabel('Model ID').fill('pipeline')
  await provider.getByLabel('API key or token').fill('e2e-mineru-token')
  await provider.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(provider.getByText('Credential stored', { exact: true })).toBeVisible()
  await provider.getByRole('button', { name: 'Close', exact: true }).first().click()
}

async function createProject(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Create project', exact: true }).click()
  const create = page.getByRole('dialog', { name: 'Create project' })
  await create.getByLabel('Project name').fill(name)
  await create.getByRole('button', { name: 'Choose location' }).click()
  await expectActiveProject(page, name)
}

test('parses, normalizes, and inspects a MinerU document with image provenance', async ({
  testRoot
}) => {
  const source = join(testRoot, 'parsed source.pdf')
  await writeFile(source, makeMinimalPdf())
  const zipBytes = await resultZip()
  let parseTaskId = ''
  let uploadedBytes = 0
  const server = createServer((request, response) => {
    const port = (server.address() as AddressInfo).port
    if (request.method === 'POST' && request.url === '/api/v4/file-urls/batch') {
      const chunks: Buffer[] = []
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      request.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString()) as {
          files: Array<{ data_id: string }>
        }
        parseTaskId = body.files[0]?.data_id ?? ''
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({
            code: 0,
            trace_id: 'e2e-submit-trace',
            data: {
              batch_id: 'e2e-batch-1',
              file_urls: [`http://127.0.0.1:${port}/upload?signature=private`]
            }
          })
        )
      })
      return
    }
    if (request.method === 'PUT' && request.url?.startsWith('/upload')) {
      request.on('data', (chunk) => {
        uploadedBytes += Buffer.byteLength(chunk)
      })
      request.on('end', () => {
        response.writeHead(200)
        response.end()
      })
      return
    }
    if (request.method === 'GET' && request.url === '/api/v4/extract-results/batch/e2e-batch-1') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          code: 0,
          trace_id: 'e2e-poll-trace',
          data: {
            batch_id: 'e2e-batch-1',
            extract_result: [
              {
                file_name: 'parsed source.pdf',
                data_id: parseTaskId,
                state: 'done',
                full_zip_url: `http://127.0.0.1:${port}/result.zip`
              }
            ]
          }
        })
      )
      return
    }
    if (request.method === 'GET' && request.url === '/result.zip') {
      response.writeHead(200, {
        'content-type': 'application/zip',
        'content-length': String(zipBytes.byteLength)
      })
      response.end(zipBytes)
      return
    }
    response.writeHead(404)
    response.end()
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = (server.address() as AddressInfo).port
  const projectName = 'Parsed knowledge viewer'
  const crashMarker = join(testRoot, 'index-crashed-once')
  const launched = await launchApp({
    userData: join(testRoot, 'user-data'),
    dialogPaths: [testRoot],
    knowledgeDialogPaths: [source],
    env: { WRITELLM_E2E_INDEX_CRASH_ONCE: crashMarker }
  })
  let firstClosed = false
  let reopened: Awaited<ReturnType<typeof launchApp>> | undefined
  let recovered: Awaited<ReturnType<typeof launchApp>> | undefined
  try {
    await configureMineruProvider(launched.page, port)
    await createProject(launched.page, projectName)

    await launched.page.getByRole('button', { name: 'Knowledge', exact: true }).click()
    const knowledge = launched.page.getByTestId('knowledge-workspace')
    await expect(knowledge.getByRole('heading', { name: 'Search knowledge' })).toBeVisible()
    await expect(knowledge.getByRole('heading', { name: 'Knowledge base' })).toHaveCount(0)
    await knowledge.getByTestId('knowledge-upload-button').click()
    const sourceButton = knowledge.getByTestId(/^knowledge-file-/)
    await expect(sourceButton).toBeVisible()
    await expect(
      knowledge.getByRole('heading', { name: 'parsed source.pdf', exact: true })
    ).toHaveCount(0)
    await sourceButton.click()
    await expect(
      knowledge.getByRole('heading', { name: 'parsed source.pdf', exact: true })
    ).toBeVisible()
    await expect(knowledge.getByText('Normalized body from MinerU', { exact: true })).toBeVisible({
      timeout: 20_000
    })
    const previewProbe = await launched.page.evaluate(async () => {
      const session = (await window.desktop.projects.lifecycle()).activeProject?.projectSessionId
      if (session === undefined) return { error: 'no-session' }
      const item = (await window.desktop.knowledge.list({ projectSessionId: session })).find(
        (candidate) => candidate.extension === 'pdf'
      )
      if (item === undefined) return { error: 'no-item' }
      const preview = await window.desktop.knowledge.createPdfPreview({
        projectSessionId: session,
        knowledgeItemId: item.knowledgeItemId
      })
      const response = await fetch(preview.url, { headers: { Range: 'bytes=0-32' } })
      const body = await response.arrayBuffer()
      await window.desktop.knowledge.releasePdfPreview({
        projectSessionId: session,
        previewId: preview.previewId
      })
      return {
        status: response.status,
        contentType: response.headers.get('content-type'),
        contentLength: body.byteLength
      }
    })
    expect(previewProbe).toMatchObject({ status: 206, contentType: 'application/pdf' })
    await expect(knowledge.getByText('Page 1', { exact: true }).first()).toBeVisible()
    await expect(knowledge.getByAltText('Parsed document image')).toBeVisible()
    const documentDetails = knowledge
      .getByRole('heading', { name: 'parsed source.pdf', exact: true })
      .locator('xpath=ancestor::section')
    await expect(
      documentDetails.getByRole('button', { name: 'Re-embed', exact: true })
    ).toHaveCount(0)
    await expect(documentDetails.getByText('stored', { exact: true })).toHaveCount(0)
    await expect(documentDetails.getByText('Parsed', { exact: true })).toHaveCount(0)
    await knowledge.getByRole('button', { name: 'More file actions', exact: true }).click()
    await expect(launched.page.getByTestId('knowledge-reparse-file-action')).toBeEnabled()
    await expect(launched.page.getByTestId('knowledge-reembed-file-action')).toBeVisible()
    await launched.page.keyboard.press('Escape')
    const markdownButton = knowledge.getByRole('tab', { name: 'Markdown', exact: true })
    await expect(markdownButton).toHaveCount(1)
    await markdownButton.click()
    await expect(knowledge.getByText('Normalized body from MinerU', { exact: true })).toBeVisible()
    await knowledge.getByRole('tab', { name: 'Mapping', exact: true }).click()
    await expect(knowledge.locator('canvas[aria-label="parsed source.pdf, page 1"]')).toBeVisible({
      timeout: 10_000
    })
    await expect(knowledge.getByText('Loading original PDF…', { exact: true })).toHaveCount(0)
    await knowledge.getByRole('button', { name: 'Close document', exact: true }).click()
    await expect(
      knowledge.getByRole('heading', { name: 'parsed source.pdf', exact: true })
    ).toHaveCount(0)
    await expect(knowledge.getByText('Open', { exact: true })).toHaveCount(0)
    await knowledge.getByRole('button', { name: 'Knowledge actions', exact: true }).click()
    await expect(launched.page.getByTestId('knowledge-reparse-all-action')).toBeEnabled()
    await expect(launched.page.getByTestId('knowledge-reembed-all-action')).toBeEnabled()
    await launched.page.keyboard.press('Escape')
    expect(uploadedBytes).toBeGreaterThan(0)
    expect(parseTaskId).not.toBe('')
    await expect
      .poll(
        () =>
          launched.page.evaluate(async () => {
            const session = (await window.desktop.projects.lifecycle()).activeProject
              ?.projectSessionId
            if (session === undefined) return false
            try {
              const result = await window.desktop.knowledge.search({
                projectSessionId: session,
                query: 'Normalized body',
                filters: {
                  knowledgeItemIds: [],
                  fileExtensions: [],
                  parseRevisionIds: []
                },
                limits: { fts: 100, vector: 100, fused: 50, results: 20 },
                rerank: true
              })
              return result.hits.some((hit) => hit.snippet.includes('Normalized body from MinerU'))
            } catch {
              return false
            }
          }),
        { timeout: 20_000 }
      )
      .toBe(true)
    const headerStats = knowledge.getByTestId('knowledge-header-stats')
    await expect(headerStats.getByTestId('knowledge-stat-files')).toContainText(/1\s*Files/)
    await expect(headerStats.getByTestId('knowledge-stat-parsed')).toContainText(/1\s*Parsed/)
    await expect(headerStats.getByTestId('knowledge-stat-blocks')).toContainText(/3\s*Blocks/)
    await expect(headerStats.getByTestId('knowledge-stat-indexed')).toContainText(/Yes\s*Indexed/)
    await expect(headerStats.getByTestId('knowledge-stat-queue')).toContainText(/\d+\s*Queue/)
    await expect(headerStats.getByText('Embeddings', { exact: true })).toHaveCount(0)
    await expect(headerStats.getByText('Failed', { exact: true })).toHaveCount(0)
    await knowledge.getByLabel('Knowledge search query').fill('Normalized body')
    const searchButton = knowledge.getByRole('button', { name: 'Search', exact: true })
    await expect(searchButton).toHaveCount(1)
    await searchButton.click()
    const searchResults = knowledge.getByTestId('knowledge-search-results')
    await expect(searchResults.getByText(/Normalized body from MinerU/)).toBeVisible()
    await expect(knowledge.getByText('rerank: not-configured', { exact: true })).toBeVisible()
    await searchResults.getByRole('button', { name: 'Preview source', exact: true }).click()
    const citation = launched.page.getByRole('dialog', { name: 'parsed source.pdf' })
    await expect(citation.getByText(/Normalized body from MinerU/)).toBeVisible()
    await citation.getByRole('button', { name: 'Close', exact: true }).click()
    await knowledge.getByLabel('Knowledge search query').fill('Image')
    await searchButton.click()
    await expect(searchResults.getByText('1 linked images', { exact: true })).toBeVisible()
    await searchResults.getByRole('button', { name: 'Preview source', exact: true }).click()
    const imageCitation = launched.page.getByRole('dialog', { name: 'parsed source.pdf' })
    await expect(imageCitation.getByAltText(/^Source asset images\/.+\.png$/)).toBeVisible()
    await imageCitation.getByRole('button', { name: 'Close', exact: true }).click()
    await knowledge.getByLabel('Knowledge search query').fill('不存在')
    await searchButton.click()
    await expect(
      knowledge.getByText('rerank: skipped-no-candidates', { exact: true })
    ).toBeVisible()
    await expect(readFile(crashMarker)).resolves.toHaveLength(0)
    const publishCountBeforeDelete = await succeededBuildCount(launched.page)

    await launched.app.close()
    firstClosed = true
    const indexPath = join(testRoot, `${projectName}.writellm`, '.writellm', 'index.sqlite')
    await rm(indexPath, { force: true })
    await rm(`${indexPath}-wal`, { force: true })
    await rm(`${indexPath}-shm`, { force: true })
    reopened = await launchApp({ userData: join(testRoot, 'user-data') })
    await reopened.page.getByRole('button', { name: `Open ${projectName}`, exact: true }).click()
    await expectActiveProject(reopened.page, projectName)
    await expect
      .poll(
        () =>
          reopened?.page.evaluate(async () => {
            const session = (await window.desktop.projects.lifecycle()).activeProject
              ?.projectSessionId
            if (session === undefined) return false
            const result = await window.desktop.jobs.list({ projectSessionId: session, limit: 100 })
            return result.jobs.filter(
              (job) => job.type === 'build_index_generation' && job.state === 'succeeded'
            ).length
          }) ?? 0,
        { timeout: 20_000 }
      )
      .toBeGreaterThan(publishCountBeforeDelete)
    const publishCountBeforeCorruption = await succeededBuildCount(reopened.page)
    await reopened.app.close()
    reopened = undefined
    await writeFile(indexPath, 'corrupt derived index')
    recovered = await launchApp({ userData: join(testRoot, 'user-data') })
    await recovered.page.getByRole('button', { name: `Open ${projectName}`, exact: true }).click()
    await expectActiveProject(recovered.page, projectName)
    await expect
      .poll(() => succeededBuildCount(recovered?.page), { timeout: 20_000 })
      .toBeGreaterThan(publishCountBeforeCorruption)
    expect(uploadedBytes).toBeGreaterThan(0)
  } finally {
    if (!firstClosed) await launched.app.close()
    await reopened?.app.close()
    await recovered?.app.close()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  }
})

test('imports with visible progress and supports cancel, retry, open, reveal, and delete', async ({
  testRoot
}) => {
  const source = join(testRoot, 'lifecycle source.pdf')
  await writeFile(source, '%PDF-1.7\nLifecycle knowledge source')
  const zipBytes = await resultZip()
  let remoteState: 'running' | 'failed' | 'done' = 'running'
  let batchCounter = 0
  let uploadedBytes = 0
  const batches = new Map<string, string>()
  const server = createServer((request, response) => {
    const port = (server.address() as AddressInfo).port
    if (request.method === 'POST' && request.url === '/api/v4/file-urls/batch') {
      const chunks: Buffer[] = []
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      request.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString()) as {
          files: Array<{ data_id: string }>
        }
        batchCounter += 1
        const batchId = `lifecycle-batch-${batchCounter}`
        batches.set(batchId, body.files[0]?.data_id ?? '')
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({
            code: 0,
            trace_id: 'lifecycle-submit-trace',
            data: {
              batch_id: batchId,
              file_urls: [`http://127.0.0.1:${port}/upload?signature=private`]
            }
          })
        )
      })
      return
    }
    if (request.method === 'PUT' && request.url?.startsWith('/upload')) {
      request.on('data', (chunk) => {
        uploadedBytes += Buffer.byteLength(chunk)
      })
      request.on('end', () => {
        response.writeHead(200)
        response.end()
      })
      return
    }
    const pollMatch =
      request.method === 'GET'
        ? request.url?.match(/^\/api\/v4\/extract-results\/batch\/(.+)$/)
        : undefined
    if (pollMatch) {
      const batchId = decodeURIComponent(pollMatch[1] as string)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          code: 0,
          trace_id: 'lifecycle-poll-trace',
          data: {
            batch_id: batchId,
            extract_result: [
              {
                file_name: 'lifecycle source.pdf',
                data_id: batches.get(batchId) ?? '',
                state: remoteState,
                ...(remoteState === 'done'
                  ? { full_zip_url: `http://127.0.0.1:${port}/result.zip` }
                  : {})
              }
            ]
          }
        })
      )
      return
    }
    if (request.method === 'GET' && request.url === '/result.zip') {
      response.writeHead(200, {
        'content-type': 'application/zip',
        'content-length': String(zipBytes.byteLength)
      })
      response.end(zipBytes)
      return
    }
    response.writeHead(404)
    response.end()
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = (server.address() as AddressInfo).port
  const projectName = 'Knowledge lifecycle'
  const launched = await launchApp({
    userData: join(testRoot, 'user-data'),
    dialogPaths: [testRoot],
    knowledgeDialogPaths: [source]
  })
  try {
    await configureMineruProvider(launched.page, port)
    await createProject(launched.page, projectName)

    await launched.page.getByRole('button', { name: 'Knowledge', exact: true }).click()
    const knowledge = launched.page.getByTestId('knowledge-workspace')
    await knowledge.getByTestId('knowledge-upload-button').click()

    const sourceButton = knowledge.getByTestId(/^knowledge-file-/)
    await expect(sourceButton).toHaveCount(1)
    await expect(knowledge.getByText('1 files in this project', { exact: true })).toBeVisible()
    await expect(knowledge.getByText('Parse with MinerU', { exact: true }).first()).toBeVisible({
      timeout: 20_000
    })
    await sourceButton.click()
    await expect(
      knowledge.getByRole('heading', { name: 'lifecycle source.pdf', exact: true })
    ).toBeVisible()
    await expect(knowledge.getByText('Parsing in progress', { exact: true })).toBeVisible({
      timeout: 20_000
    })
    await expect(knowledge.getByText(/Current stage: /)).toBeVisible()

    await knowledge.getByRole('button', { name: 'Stop parsing', exact: true }).click()
    await expect(knowledge.getByText('Not parsed yet', { exact: true })).toBeVisible({
      timeout: 20_000
    })
    await expect(
      knowledge.getByRole('button', { name: 'Start parsing', exact: true })
    ).toBeVisible()

    remoteState = 'failed'
    await knowledge.getByRole('button', { name: 'Start parsing', exact: true }).click()
    await expect(knowledge.getByText('Parsing failed', { exact: true })).toBeVisible({
      timeout: 30_000
    })
    remoteState = 'done'
    await knowledge.getByRole('button', { name: 'Retry parsing', exact: true }).click()

    await expect(knowledge.getByText('Normalized body from MinerU', { exact: true })).toBeVisible({
      timeout: 30_000
    })
    await expect(knowledge.getByText('Page 1', { exact: true }).first()).toBeVisible()
    await expect(knowledge.getByAltText('Parsed document image')).toBeVisible()
    await knowledge.getByRole('tab', { name: 'Markdown', exact: true }).click()
    await expect(knowledge.getByText('Normalized body from MinerU', { exact: true })).toBeVisible()
    await knowledge.getByRole('tab', { name: 'Content', exact: true }).click()
    await expect(knowledge.getByAltText('Parsed document image')).toBeVisible()

    await launched.app.evaluate(({ shell }) => {
      const recorder = { revealed: [] as string[], opened: [] as string[] }
      ;(
        globalThis as unknown as { __writellmShellRecorder: typeof recorder }
      ).__writellmShellRecorder = recorder
      shell.showItemInFolder = (path: string) => {
        recorder.revealed.push(path)
      }
      shell.openPath = (path: string) => {
        recorder.opened.push(path)
        return Promise.resolve('')
      }
    })
    const recordedShellPaths = (): Promise<{ revealed: string[]; opened: string[] }> =>
      launched.app.evaluate(
        () =>
          (
            globalThis as unknown as {
              __writellmShellRecorder: { revealed: string[]; opened: string[] }
            }
          ).__writellmShellRecorder
      )
    await knowledge.getByRole('button', { name: 'More file actions', exact: true }).click()
    await launched.page.getByRole('menuitem', { name: 'Show in Finder', exact: true }).click()
    await expect.poll(async () => (await recordedShellPaths()).revealed.length).toBe(1)
    await knowledge.getByRole('button', { name: 'More file actions', exact: true }).click()
    await launched.page.getByRole('menuitem', { name: 'Open file', exact: true }).click()
    await expect.poll(async () => (await recordedShellPaths()).opened.length).toBe(1)
    const shellPaths = await recordedShellPaths()
    expect(shellPaths.revealed[0]?.includes(join('knowledge', 'originals'))).toBe(true)
    expect(shellPaths.revealed[0]?.endsWith('lifecycle source.pdf')).toBe(true)
    expect(shellPaths.opened[0]?.endsWith('lifecycle source.pdf')).toBe(true)
    expect(uploadedBytes).toBeGreaterThan(0)
    expect(batchCounter).toBe(3)

    await knowledge.getByRole('button', { name: 'More file actions', exact: true }).click()
    await launched.page.getByRole('menuitem', { name: 'Delete source', exact: true }).click()
    await expect(sourceButton).toHaveCount(0)
    await expect(knowledge.getByText('No files yet.', { exact: true })).toBeVisible()
    await expect
      .poll(() =>
        launched.page.evaluate(async () => {
          const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
            ?.projectSessionId
          if (projectSessionId === undefined) return -1
          return (await window.desktop.knowledge.list({ projectSessionId })).length
        })
      )
      .toBe(0)
  } finally {
    await launched.app.close()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  }
})

async function succeededBuildCount(
  page: Awaited<ReturnType<typeof launchApp>>['page'] | undefined
) {
  if (page === undefined) return 0
  return page.evaluate(async () => {
    const session = (await window.desktop.projects.lifecycle()).activeProject?.projectSessionId
    if (session === undefined) return 0
    const result = await window.desktop.jobs.list({ projectSessionId: session, limit: 100 })
    return result.jobs.filter(
      (job) => job.type === 'build_index_generation' && job.state === 'succeeded'
    ).length
  })
}

async function resultZip(): Promise<Buffer> {
  const zip = new ZipFile()
  zip.addBuffer(
    Buffer.from(
      JSON.stringify([
        {
          type: 'text',
          text: 'Normalized body from MinerU',
          page_idx: 0,
          bbox: [10, 20, 900, 80]
        },
        {
          type: 'text',
          text: '这是中文检索测试',
          page_idx: 0,
          bbox: [10, 82, 900, 140]
        },
        {
          type: 'image',
          img_path: 'images/figure.png',
          page_idx: 0,
          bbox: [20, 100, 800, 700]
        }
      ])
    ),
    'content_list.json'
  )
  zip.addBuffer(Buffer.from('Normalized body from MinerU'), 'full.md')
  zip.addBuffer(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    ),
    'images/figure.png'
  )
  zip.end()
  const chunks: Buffer[] = []
  for await (const chunk of zip.outputStream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}
