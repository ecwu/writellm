import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { expect, launchApp, test } from './fixtures'
import { ZipFile } from 'yazl'

test('parses, normalizes, and inspects a MinerU document with image provenance', async ({
  testRoot
}) => {
  const source = join(testRoot, 'parsed source.pdf')
  await writeFile(source, '%PDF-1.7\nParsed knowledge E2E source')
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
    await launched.page.getByRole('button', { name: 'Settings', exact: true }).click()
    await launched.page.getByRole('option', { name: /MinerU parser/ }).click()
    const provider = launched.page.getByRole('dialog', { name: 'MinerU parser' })
    await provider.getByLabel('Base URL').fill(`http://127.0.0.1:${port}`)
    await provider.getByLabel('Model ID').fill('pipeline')
    await provider.getByLabel('API key or token').fill('e2e-mineru-token')
    await provider.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(provider.getByText('Credential stored', { exact: true })).toBeVisible()
    await provider.getByRole('button', { name: 'Close', exact: true }).first().click()

    await launched.page.getByRole('button', { name: 'Create project', exact: true }).click()
    const create = launched.page.getByRole('dialog', { name: 'Create project' })
    await create.getByLabel('Project name').fill(projectName)
    await create.getByRole('button', { name: 'Choose location' }).click()
    await expect(
      launched.page.getByRole('heading', { name: projectName, exact: true })
    ).toBeVisible()

    await launched.page.getByRole('button', { name: 'Knowledge', exact: true }).click()
    const knowledge = launched.page.getByTestId('knowledge-workspace')
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
    await expect(knowledge.getByText('Page 1', { exact: true }).first()).toBeVisible()
    await expect(knowledge.getByAltText('Parsed document image')).toBeVisible()
    const markdownButton = knowledge.getByRole('button', { name: 'Markdown', exact: true })
    await expect(markdownButton).toHaveCount(1)
    await markdownButton.click()
    await expect(knowledge.getByText('Normalized body from MinerU', { exact: true })).toBeVisible()
    await knowledge.getByRole('button', { name: 'Close document', exact: true }).click()
    await expect(
      knowledge.getByRole('heading', { name: 'parsed source.pdf', exact: true })
    ).toHaveCount(0)
    expect(uploadedBytes).toBeGreaterThan(0)
    expect(parseTaskId).not.toBe('')
    await expect
      .poll(
        () =>
          launched.page.evaluate(async () => {
            const session = (await window.desktop.projects.lifecycle()).activeProject
              ?.projectSessionId
            if (session === undefined) return false
            const result = await window.desktop.jobs.list({ projectSessionId: session, limit: 100 })
            return result.jobs.some(
              (job) => job.type === 'index.publish' && job.state === 'succeeded'
            )
          }),
        { timeout: 20_000 }
      )
      .toBe(true)
    await knowledge.getByLabel('Knowledge search query').fill('Normalized body')
    const searchButton = knowledge.getByRole('button', { name: 'Search', exact: true })
    await expect(searchButton).toHaveCount(1)
    await searchButton.click()
    const searchResults = knowledge.getByTestId('knowledge-search-results')
    await expect(
      searchResults.getByText('Normalized body from MinerU', { exact: true })
    ).toBeVisible()
    await expect(knowledge.getByText('rerank: not-configured', { exact: true })).toBeVisible()
    await searchResults.getByRole('button', { name: 'Preview source', exact: true }).click()
    const citation = launched.page.getByRole('dialog', { name: 'parsed source.pdf' })
    await expect(citation.getByText('Normalized body from MinerU', { exact: true })).toBeVisible()
    await citation.getByRole('button', { name: 'Close', exact: true }).click()
    await knowledge.getByLabel('Knowledge search query').fill('Image')
    await searchButton.click()
    await expect(searchResults.getByText('1 linked images', { exact: true })).toBeVisible()
    await searchResults.getByRole('button', { name: 'Preview source', exact: true }).click()
    const imageCitation = launched.page.getByRole('dialog', { name: 'parsed source.pdf' })
    await expect(imageCitation.getByAltText(/^Source asset images\/.+\.png$/)).toBeVisible()
    await imageCitation.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(readFile(crashMarker)).resolves.toHaveLength(0)
    const publishCountBeforeDelete = await succeededPublishCount(launched.page)

    await launched.app.close()
    firstClosed = true
    const indexPath = join(testRoot, `${projectName}.writellm`, '.writellm', 'index.sqlite')
    await rm(indexPath, { force: true })
    await rm(`${indexPath}-wal`, { force: true })
    await rm(`${indexPath}-shm`, { force: true })
    reopened = await launchApp({ userData: join(testRoot, 'user-data') })
    await reopened.page.getByRole('button', { name: `Open ${projectName}`, exact: true }).click()
    await expect(
      reopened.page.getByRole('heading', { name: projectName, exact: true })
    ).toBeVisible()
    await expect
      .poll(
        () =>
          reopened?.page.evaluate(async () => {
            const session = (await window.desktop.projects.lifecycle()).activeProject
              ?.projectSessionId
            if (session === undefined) return false
            const result = await window.desktop.jobs.list({ projectSessionId: session, limit: 100 })
            return result.jobs.filter(
              (job) => job.type === 'index.publish' && job.state === 'succeeded'
            ).length
          }) ?? 0,
        { timeout: 20_000 }
      )
      .toBeGreaterThan(publishCountBeforeDelete)
    const publishCountBeforeCorruption = await succeededPublishCount(reopened.page)
    await reopened.app.close()
    reopened = undefined
    await writeFile(indexPath, 'corrupt derived index')
    recovered = await launchApp({ userData: join(testRoot, 'user-data') })
    await recovered.page.getByRole('button', { name: `Open ${projectName}`, exact: true }).click()
    await expect(
      recovered.page.getByRole('heading', { name: projectName, exact: true })
    ).toBeVisible()
    await expect
      .poll(() => succeededPublishCount(recovered?.page), { timeout: 20_000 })
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

async function succeededPublishCount(
  page: Awaited<ReturnType<typeof launchApp>>['page'] | undefined
) {
  if (page === undefined) return 0
  return page.evaluate(async () => {
    const session = (await window.desktop.projects.lifecycle()).activeProject?.projectSessionId
    if (session === undefined) return 0
    const result = await window.desktop.jobs.list({ projectSessionId: session, limit: 100 })
    return result.jobs.filter((job) => job.type === 'index.publish' && job.state === 'succeeded')
      .length
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
