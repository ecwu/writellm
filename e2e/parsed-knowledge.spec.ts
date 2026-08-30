import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'
import { expect, expectActiveProject, launchApp, scenario, sectionEditor, test } from './fixtures'
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
  const provider = page.getByRole('dialog', { name: 'Settings' })
  await provider.getByRole('option', { name: /^MinerU API/ }).click()
  await provider.getByLabel('Base URL').fill(`http://127.0.0.1:${port}`)
  await provider.getByLabel('Model ID').fill('pipeline')
  await provider.getByLabel('API key or token').fill('e2e-mineru-token')
  await provider.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(provider.getByLabel('API key or token')).toHaveAttribute('placeholder', /Stored/)
  await page.keyboard.press('Escape')
}

async function configureNotebookAgentProvider(page: Page, baseUrl: string): Promise<void> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await settings.getByRole('option', { name: /^Agent API/ }).click()
  await settings.getByRole('button', { name: 'Add provider' }).click()
  const addProvider = page.getByRole('dialog', { name: 'Add provider' })
  await addProvider.getByLabel('Provider name').fill('Notebook Agent')
  await addProvider.getByRole('button', { name: 'Continue' }).click()
  await settings.getByLabel('Base URL').fill(baseUrl)
  await settings.getByLabel('API key').fill('notebook-e2e-secret')
  await settings.getByRole('button', { name: 'Save provider' }).click()
  await settings.getByRole('button', { name: 'Fetch Notebook Agent models' }).click()
  await expect(settings.getByText(/1 models · current/)).toBeVisible()
  await page.keyboard.press('Escape')
}

function sendNotebookCompletion(response: ServerResponse, text: string): void {
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    'x-request-id': 'notebook-external-response-id'
  })
  for (const chunk of [
    {
      id: 'notebook-external-response-id',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'notebook-model',
      choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }]
    },
    {
      id: 'notebook-external-response-id',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'notebook-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 }
    }
  ]) {
    response.write(`data: ${JSON.stringify(chunk)}\n\n`)
  }
  response.end('data: [DONE]\n\n')
}

function sendNotebookToolCall(
  response: ServerResponse,
  input: { id: string; name: string; arguments: Record<string, unknown> }
): void {
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    'x-request-id': `notebook-${input.id}`
  })
  for (const chunk of [
    {
      id: `notebook-${input.id}`,
      object: 'chat.completion.chunk',
      created: 1,
      model: 'notebook-model',
      choices: [
        {
          index: 0,
          delta: {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: input.id,
                type: 'function',
                function: { name: input.name, arguments: JSON.stringify(input.arguments) }
              }
            ]
          },
          finish_reason: null
        }
      ]
    },
    {
      id: `notebook-${input.id}`,
      object: 'chat.completion.chunk',
      created: 1,
      model: 'notebook-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 30, completion_tokens: 6, total_tokens: 36 }
    }
  ]) {
    response.write(`data: ${JSON.stringify(chunk)}\n\n`)
  }
  response.end('data: [DONE]\n\n')
}

async function startNotebookAgentServer() {
  const requestBodies: unknown[] = []
  const server = createServer((request, response) => {
    if (request.method === 'GET' && request.url === '/v1/models') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{"data":[{"id":"notebook-model","displayName":"Notebook model"}]}')
      return
    }
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404)
      response.end()
      return
    }
    const chunks: Buffer[] = []
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString()) as {
        messages?: Array<{ role?: string; content?: string }>
      }
      requestBodies.push(body)
      const toolResults = body.messages?.filter((message) => message.role === 'tool') ?? []
      if (toolResults.length === 0) {
        sendNotebookToolCall(response, {
          id: 'notebook-search',
          name: 'search_knowledge',
          arguments: { query: 'Normalized body from MinerU', limit: 10, rerank: true }
        })
        return
      }
      if (toolResults.length === 1) {
        const citationId = toolResults[0]?.content?.match(/citation-[a-f0-9]{40}/u)?.[0]
        if (citationId === undefined) {
          response.writeHead(500)
          response.end('missing citation')
          return
        }
        sendNotebookToolCall(response, {
          id: 'notebook-read',
          name: 'read_citations',
          arguments: { citationIds: [citationId] }
        })
        return
      }
      sendNotebookCompletion(response, 'The source says Normalized body from MinerU. [[cite:1]]')
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return { server, port: (server.address() as AddressInfo).port, requestBodies }
}

async function createProject(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Create project', exact: true }).click()
  const create = page.getByRole('dialog', { name: 'Create project' })
  await create.getByLabel('Project name').fill(name)
  await create.getByRole('button', { name: 'Choose location' }).click()
  await expectActiveProject(page, name)
}

async function diagnosticEventCount(page: Page, event: string): Promise<number> {
  return page.evaluate(
    async (eventName) =>
      (await window.desktop.diagnostics.snapshot()).filter((entry) => entry['event'] === eventName)
        .length,
    event
  )
}

async function startSuccessfulMineruServer(zipBytes: Buffer) {
  const stats = { parseTaskId: '', uploadedBytes: 0 }
  let batchCounter = 0
  const batches = new Map<string, { dataId: string; fileName: string }>()
  const server = createServer((request, response) => {
    const port = (server.address() as AddressInfo).port
    if (request.method === 'POST' && request.url === '/api/v4/file-urls/batch') {
      const chunks: Buffer[] = []
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      request.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString()) as {
          files: Array<{ data_id: string; name?: string }>
        }
        stats.parseTaskId = body.files[0]?.data_id ?? ''
        batchCounter += 1
        const batchId = `e2e-batch-${batchCounter}`
        batches.set(batchId, {
          dataId: stats.parseTaskId,
          fileName: body.files[0]?.name ?? 'parsed source.pdf'
        })
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({
            code: 0,
            trace_id: 'e2e-submit-trace',
            data: {
              batch_id: batchId,
              file_urls: [`http://127.0.0.1:${port}/upload?batch=${batchId}&signature=private`]
            }
          })
        )
      })
      return
    }
    if (request.method === 'PUT' && request.url?.startsWith('/upload')) {
      request.on('data', (chunk) => {
        stats.uploadedBytes += Buffer.byteLength(chunk)
      })
      request.on('end', () => {
        response.writeHead(200)
        response.end()
      })
      return
    }
    const batchMatch = request.url?.match(/^\/api\/v4\/extract-results\/batch\/(e2e-batch-\d+)$/u)
    if (request.method === 'GET' && batchMatch !== undefined && batchMatch !== null) {
      const batchId = batchMatch[1] ?? ''
      const batch = batches.get(batchId)
      if (batch === undefined) {
        response.writeHead(404)
        response.end()
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          code: 0,
          trace_id: 'e2e-poll-trace',
          data: {
            batch_id: batchId,
            extract_result: [
              {
                file_name: batch.fileName,
                data_id: batch.dataId,
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
  return { server, port: (server.address() as AddressInfo).port, stats }
}

test(
  'parses, normalizes, and inspects a MinerU document with image provenance',
  scenario('knowledge.parse-preview-search', ['@critical', '@packaged']),
  async ({ testRoot }) => {
    const source = join(testRoot, 'parsed source.pdf')
    await writeFile(source, makeMinimalPdf())
    const mineru = await startSuccessfulMineruServer(await resultZip())
    const notebookAgent = await startNotebookAgentServer()
    const projectName = 'Parsed knowledge viewer'
    const launched = await launchApp({
      userData: join(testRoot, 'user-data'),
      dialogPaths: [testRoot],
      knowledgeDialogPaths: [source]
    })
    try {
      await configureMineruProvider(launched.page, mineru.port)
      await configureNotebookAgentProvider(
        launched.page,
        `http://127.0.0.1:${notebookAgent.port}/v1`
      )
      await createProject(launched.page, projectName)

      await launched.page.getByRole('button', { name: 'Knowledge', exact: true }).click()
      const knowledge = launched.page.getByTestId('knowledge-workspace')
      await expect(knowledge.getByRole('heading', { name: 'Search knowledge' })).toBeVisible()
      await expect(knowledge.getByRole('heading', { name: 'Knowledge base' })).toHaveCount(0)
      await expect
        .poll(() => diagnosticEventCount(launched.page, 'knowledge.summary.loaded'))
        .toBe(1)
      expect(await diagnosticEventCount(launched.page, 'knowledge.blocks_page.loaded')).toBe(0)
      await knowledge.getByTestId('knowledge-upload-button').click()
      const sourceButton = knowledge.getByTestId(/^knowledge-file-/)
      await expect(sourceButton).toBeVisible()
      await expect
        .poll(() => succeededJobCount(launched.page, 'normalize_parse_revision'), {
          timeout: 60_000
        })
        .toBeGreaterThan(0)
      await expect(
        knowledge.getByRole('heading', { name: 'parsed source.pdf', exact: true })
      ).toHaveCount(0)
      expect(await diagnosticEventCount(launched.page, 'knowledge.blocks_page.loaded')).toBe(0)
      await sourceButton.click()
      await expect(
        knowledge.getByRole('heading', { name: 'parsed source.pdf', exact: true })
      ).toBeVisible()
      await expect(knowledge.getByText('Normalized body from MinerU', { exact: true })).toBeVisible(
        {
          timeout: 20_000
        }
      )
      const detailCountAfterSelection = await diagnosticEventCount(
        launched.page,
        'knowledge.blocks_page.loaded'
      )
      expect(detailCountAfterSelection).toBeGreaterThan(0)
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
      await knowledge.getByRole('button', { name: 'More file actions', exact: true }).click()
      await expect(launched.page.getByTestId('knowledge-reparse-file-action')).toBeEnabled()
      await expect(launched.page.getByTestId('knowledge-reembed-file-action')).toBeVisible()
      await launched.page.keyboard.press('Escape')
      const markdownButton = knowledge.getByRole('tab', { name: 'Markdown', exact: true })
      await expect(markdownButton).toHaveCount(1)
      await markdownButton.click()
      await expect(
        knowledge.getByText('Normalized body from MinerU', { exact: true })
      ).toBeVisible()
      await knowledge.getByRole('tab', { name: 'Mapping', exact: true }).click()
      await expect(knowledge.locator('canvas[aria-label="parsed source.pdf, page 1"]')).toBeVisible(
        {
          timeout: 10_000
        }
      )
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
      expect(mineru.stats.uploadedBytes).toBeGreaterThan(0)
      expect(mineru.stats.parseTaskId).not.toBe('')
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
                return result.hits.some((hit) =>
                  hit.snippet.includes('Normalized body from MinerU')
                )
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
      await launched.page.getByRole('button', { name: 'Notebook', exact: true }).click()
      const notebook = launched.page.getByTestId('notebook-workspace')
      await expect(notebook.getByText('1/1', { exact: true })).toBeVisible()
      await notebook.getByTestId('agent-model-selector').click()
      const modelPicker = launched.page.getByTestId('agent-model-effort-picker')
      await modelPicker.getByRole('option', { name: /Model/ }).click()
      await modelPicker.getByRole('option', { name: /Notebook model/ }).click()
      const privateQuestion = 'What exact phrase appears in the normalized body? notebook-q-66'
      const privateAnswer = 'The source says Normalized body from MinerU.'
      await notebook.getByLabel('Ask selected Knowledge sources').fill(privateQuestion)
      const askNotebook = notebook.getByRole('button', { name: 'Ask Notebook' })
      await expect(askNotebook).toBeEnabled()
      await askNotebook.click()
      await expect(notebook.getByText(privateAnswer, { exact: false })).toBeVisible({
        timeout: 20_000
      })
      await notebook.getByRole('button', { name: 'Open citation 1' }).click()
      const notebookCitation = launched.page.getByRole('dialog', { name: 'parsed source.pdf' })
      await expect(notebookCitation.getByText(/Normalized body from MinerU/)).toBeVisible()
      await notebookCitation.getByRole('button', { name: 'Close', exact: true }).click()
      await launched.page.getByRole('button', { name: 'Knowledge', exact: true }).click()
      await expect(launched.page.getByTestId('knowledge-workspace')).toBeVisible()
      await launched.page.getByRole('button', { name: 'Notebook', exact: true }).click()
      await expect(
        launched.page.getByTestId('notebook-workspace').getByText(privateAnswer, { exact: false })
      ).toBeVisible()
      expect(notebookAgent.requestBodies).toHaveLength(3)
      const providerRequest = JSON.stringify(notebookAgent.requestBodies)
      expect(providerRequest).toContain(privateQuestion)
      expect(providerRequest).toContain('Normalized body from MinerU')
      expect(providerRequest).not.toContain('"temperature"')
      expect(
        (
          notebookAgent.requestBodies[0] as { tools?: Array<{ function?: { name?: string } }> }
        ).tools
          ?.map((tool) => tool.function?.name)
          .sort()
      ).toEqual(['read_citations', 'search_knowledge'])

      const projectDatabasePath = join(
        testRoot,
        `${projectName}.writellm`,
        '.writellm',
        'project.sqlite'
      )
      const databaseBytes = Buffer.concat([
        await readFile(projectDatabasePath),
        await readFile(`${projectDatabasePath}-wal`).catch(() => Buffer.alloc(0))
      ]).toString('utf8')
      expect(databaseBytes).not.toContain(privateQuestion)
      expect(databaseBytes).not.toContain(privateAnswer)
      expect(databaseBytes).not.toContain('notebook-external-response-id')
      const diagnostics = await launched.page.evaluate(() => window.desktop.diagnostics.snapshot())
      const diagnosticText = JSON.stringify(diagnostics)
      expect(diagnosticText).not.toContain(privateQuestion)
      expect(diagnosticText).not.toContain(privateAnswer)
      expect(mineru.stats.uploadedBytes).toBeGreaterThan(0)
      expect(mineru.stats.parseTaskId).not.toBe('')
    } finally {
      await launched.app.close()
      await new Promise<void>((resolve, reject) =>
        mineru.server.close((error) => (error ? reject(error) : resolve()))
      )
      await new Promise<void>((resolve, reject) =>
        notebookAgent.server.close((error) => (error ? reject(error) : resolve()))
      )
    }
  }
)

test(
  'rebuilds a missing or corrupt derived search index after a worker crash',
  scenario('knowledge.rebuilds-derived-index', ['@critical', '@packaged']),
  async ({ testRoot }) => {
    const source = join(testRoot, 'parsed source.pdf')
    await writeFile(source, makeMinimalPdf())
    const mineru = await startSuccessfulMineruServer(await resultZip())
    const projectName = 'Recoverable knowledge index'
    const projectRoot = join(testRoot, `${projectName}.writellm`)
    const userData = join(testRoot, 'user-data')
    const crashMarker = join(testRoot, 'index-crashed-once')
    const launched = await launchApp({
      userData,
      dialogPaths: [testRoot],
      knowledgeDialogPaths: [source],
      env: { WRITELLM_E2E_INDEX_CRASH_ONCE: crashMarker }
    })
    let launchedClosed = false
    let reopened: Awaited<ReturnType<typeof launchApp>> | undefined
    let recovered: Awaited<ReturnType<typeof launchApp>> | undefined

    try {
      await configureMineruProvider(launched.page, mineru.port)
      await createProject(launched.page, projectName)
      await launched.page.getByRole('button', { name: 'Knowledge', exact: true }).click()
      const knowledge = launched.page.getByTestId('knowledge-workspace')
      await knowledge.getByTestId('knowledge-upload-button').click()
      await expect(knowledge.getByTestId('knowledge-stat-indexed')).toContainText(/Yes\s*Indexed/, {
        timeout: 60_000
      })
      await expect(readFile(crashMarker)).resolves.toHaveLength(0)
      const publishCountBeforeDelete = await succeededBuildCount(launched.page)

      await launched.app.close()
      launchedClosed = true
      const indexPath = join(projectRoot, '.writellm', 'index.sqlite')
      await rm(indexPath, { force: true })
      await rm(`${indexPath}-wal`, { force: true })
      await rm(`${indexPath}-shm`, { force: true })

      reopened = await launchApp({ userData })
      await reopened.page.getByRole('button', { name: `Open ${projectName}`, exact: true }).click()
      await expectActiveProject(reopened.page, projectName)
      await expect
        .poll(() => succeededBuildCount(reopened?.page), { timeout: 20_000 })
        .toBeGreaterThan(publishCountBeforeDelete)

      const publishCountBeforeCorruption = await succeededBuildCount(reopened.page)
      await reopened.app.close()
      reopened = undefined
      await writeFile(indexPath, 'corrupt derived index')

      recovered = await launchApp({ userData })
      await recovered.page.getByRole('button', { name: `Open ${projectName}`, exact: true }).click()
      await expectActiveProject(recovered.page, projectName)
      await expect
        .poll(() => succeededBuildCount(recovered?.page), { timeout: 60_000 })
        .toBeGreaterThan(publishCountBeforeCorruption)
    } finally {
      if (!launchedClosed) await launched.app.close()
      await reopened?.app.close()
      await recovered?.app.close()
      await new Promise<void>((resolve, reject) =>
        mineru.server.close((error) => (error ? reject(error) : resolve()))
      )
    }
  }
)

test(
  'checks article-level citation coverage and refreshes after manuscript edits',
  scenario('knowledge.citation-coverage'),
  async ({ testRoot }) => {
    const duplicateA = join(testRoot, 'source-a', 'duplicate source.pdf')
    const duplicateB = join(testRoot, 'source-b', 'duplicate source.pdf')
    const unique = join(testRoot, 'unique source.pdf')
    const unused = join(testRoot, 'unused source.pdf')
    await mkdir(join(testRoot, 'source-a'))
    await mkdir(join(testRoot, 'source-b'))
    await writeFile(duplicateA, `${makeMinimalPdf()}\n% duplicate-a`)
    await writeFile(duplicateB, `${makeMinimalPdf()}\n% duplicate-b`)
    await writeFile(unique, `${makeMinimalPdf()}\n% unique`)
    await writeFile(unused, `${makeMinimalPdf()}\n% unused`)
    const mineru = await startSuccessfulMineruServer(await resultZip())
    const projectName = 'Citation coverage checks'
    const launched = await launchApp({
      userData: join(testRoot, 'user-data'),
      dialogPaths: [testRoot],
      knowledgeDialogPaths: [unique, duplicateA, duplicateB, unused]
    })
    try {
      await configureMineruProvider(launched.page, mineru.port)
      await createProject(launched.page, projectName)
      await launched.page.getByRole('button', { name: 'Knowledge', exact: true }).click()
      const knowledge = launched.page.getByTestId('knowledge-workspace')
      for (let index = 0; index < 4; index += 1) {
        await knowledge.getByTestId('knowledge-upload-button').click()
      }
      await expect(knowledge.getByTestId(/^knowledge-file-/)).toHaveCount(4, { timeout: 30_000 })
      await expect(knowledge.getByTestId('knowledge-stat-indexed')).toContainText(/Yes\s*Indexed/, {
        timeout: 60_000
      })

      await launched.page.getByRole('button', { name: 'Manuscript', exact: true }).click()
      const editor = sectionEditor(launched.page)
      await editor.click()
      await launched.page.keyboard.type(
        '[Source: unique source.pdf, p. 1] [Source: duplicate source.pdf] [Source: Missing source.pdf]'
      )
      await launched.page.getByLabel('Section title').focus()
      await launched.page.getByRole('button', { name: 'Checks', exact: true }).click()

      const checks = launched.page.getByTestId('checks-workspace')
      await expect(
        checks.getByRole('heading', { name: 'Knowledge citation coverage' })
      ).toBeVisible()
      const summary = checks.getByRole('region', { name: 'Coverage summary' })
      await expect(summary.getByText('25%', { exact: true }).first()).toBeVisible()
      await expect(summary.getByText('4', { exact: true })).toBeVisible()
      await expect(summary.getByText('1', { exact: true })).toHaveCount(2)
      await expect(summary.getByText('3', { exact: true })).toBeVisible()
      const table = checks.getByRole('table')
      await expect(table.getByText('duplicate source.pdf', { exact: true })).toHaveCount(2)
      await expect(table.getByText('Ambiguous title', { exact: true })).toHaveCount(2)
      await expect(table.getByText('unused source.pdf', { exact: true })).toBeVisible()
      await checks.getByRole('radio', { name: 'Needs attention', exact: true }).click()
      await expect(table.getByText('Missing source.pdf', { exact: true })).toBeVisible()
      await expect(table.getByText('Not indexed', { exact: true })).toBeVisible()

      await launched.page.getByRole('button', { name: 'Manuscript', exact: true }).click()
      await editor.click()
      await launched.page.keyboard.press('End')
      await launched.page.keyboard.type(' [Source: unused source.pdf]')
      await expect(sectionEditor(launched.page)).toContainText('[Source: unused source.pdf]')
      await launched.page.getByLabel('Section title').focus()
      await launched.page.getByRole('button', { name: 'Checks', exact: true }).click()
      await expect(summary.getByText('50%', { exact: true }).first()).toBeVisible()
      await expect(table.getByText('unused source.pdf', { exact: true })).toBeVisible()
      await expect(table.getByText('Cited', { exact: true })).toHaveCount(2)
      await expect(table.getByText('Ambiguous title', { exact: true })).toHaveCount(2)
    } finally {
      await launched.app.close()
      await new Promise<void>((resolve, reject) =>
        mineru.server.close((error) => (error ? reject(error) : resolve()))
      )
    }
  }
)

test(
  'imports with visible progress and supports cancel, retry, open, reveal, and delete',
  scenario('knowledge.import-lifecycle', ['@packaged']),
  async ({ testRoot }) => {
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

      await expect(knowledge.getByText('Normalized body from MinerU', { exact: true })).toBeVisible(
        {
          timeout: 30_000
        }
      )
      await expect(knowledge.getByText('Page 1', { exact: true }).first()).toBeVisible()
      await expect(knowledge.getByAltText('Parsed document image')).toBeVisible()
      await knowledge.getByRole('tab', { name: 'Markdown', exact: true }).click()
      await expect(
        knowledge.getByText('Normalized body from MinerU', { exact: true })
      ).toBeVisible()
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
  }
)

async function succeededBuildCount(
  page: Awaited<ReturnType<typeof launchApp>>['page'] | undefined
) {
  return succeededJobCount(page, 'build_index_generation')
}

async function succeededJobCount(
  page: Awaited<ReturnType<typeof launchApp>>['page'] | undefined,
  type: string
) {
  if (page === undefined) return 0
  return page.evaluate(async (jobType) => {
    const session = (await window.desktop.projects.lifecycle()).activeProject?.projectSessionId
    if (session === undefined) return 0
    const result = await window.desktop.jobs.list({ projectSessionId: session, limit: 100 })
    return result.jobs.filter((job) => job.type === jobType && job.state === 'succeeded').length
  }, type)
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
