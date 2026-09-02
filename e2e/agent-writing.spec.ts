import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'
import { ZipFile } from 'yazl'
import { expect, expectActiveProject, launchApp, scenario, sectionEditor, test } from './fixtures'

function makeMinimalPdf(): string {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '<< /Length 52 >>\nstream\nBT\n/F1 24 Tf\n100 700 Td\n(Agent evidence) Tj\nET\nendstream',
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
  for (const offset of offsets.slice(1)) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return pdf
}

async function evidenceZip(): Promise<Buffer> {
  const text = 'Evidence says durable systems preserve traceable revisions.'
  const zip = new ZipFile()
  zip.addBuffer(
    Buffer.from(
      JSON.stringify([
        {
          type: 'text',
          text,
          page_idx: 0,
          bbox: [10, 20, 900, 80]
        }
      ])
    ),
    'content_list.json'
  )
  zip.addBuffer(Buffer.from(text), 'full.md')
  zip.end()
  const chunks: Buffer[] = []
  for await (const chunk of zip.outputStream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

async function configureProvider(
  page: Page,
  input: { sectionName: RegExp; role: 'agent' | 'mineru'; baseUrl: string; model: string }
): Promise<void> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await settings.getByRole('option', { name: input.sectionName }).click()
  if (input.role === 'agent') {
    await settings.getByRole('button', { name: 'Add provider' }).click()
    const addProvider = page.getByRole('dialog', { name: 'Add provider' })
    await addProvider.getByLabel('Provider name').fill('E2E Agent')
    await addProvider.getByRole('button', { name: 'Continue' }).click()
    await settings.getByLabel('Base URL').fill(input.baseUrl)
    await settings.getByLabel('API key').fill('e2e-secret')
    await settings.getByRole('button', { name: 'Save provider' }).click()
    await expect(settings.getByRole('heading', { name: 'E2E Agent' })).toBeVisible()
    await settings.getByRole('button', { name: 'Fetch E2E Agent models' }).click()
    await expect(settings.getByText(/1 models · current/)).toBeVisible()
    await page.keyboard.press('Escape')
    return
  }
  await settings.getByLabel('Base URL').fill(input.baseUrl)
  await settings.getByLabel('Model ID').fill(input.model)
  await settings.getByLabel('API key or token').fill('e2e-secret')
  await settings.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(settings.getByLabel('API key or token')).toHaveAttribute('placeholder', /Stored/)
  await page.keyboard.press('Escape')
}

async function createProject(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Create project', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create project' })
  await dialog.getByLabel('Project name').fill(name)
  await dialog.getByRole('button', { name: 'Choose location' }).click()
  await expectActiveProject(page, name)
}

async function closeProject(page: Page): Promise<void> {
  await page.getByRole('menuitem', { name: 'Project', exact: true }).click()
  await page
    .getByRole('menuitem', { name: 'Close project and return to chooser', exact: true })
    .click()
}

function sendToolCall(
  response: ServerResponse,
  input: { responseId: string; toolCallId: string; name: string; args: unknown; text?: string }
): void {
  sendSse(response, [
    {
      id: input.responseId,
      object: 'chat.completion.chunk',
      created: 1,
      model: 'writer-model-resolved',
      choices: [
        {
          index: 0,
          delta: {
            role: 'assistant',
            ...(input.text === undefined ? {} : { content: input.text }),
            tool_calls: [
              {
                index: 0,
                id: input.toolCallId,
                type: 'function',
                function: { name: input.name, arguments: JSON.stringify(input.args) }
              }
            ]
          },
          finish_reason: null
        }
      ]
    },
    {
      id: input.responseId,
      object: 'chat.completion.chunk',
      created: 1,
      model: 'writer-model-resolved',
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 59_000, completion_tokens: 8, total_tokens: 59_008 }
    }
  ])
}

function sendCompletion(response: ServerResponse, text: string): void {
  sendSse(response, [
    {
      id: 'agent-final-response',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'writer-model-resolved',
      choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }]
    },
    {
      id: 'agent-final-response',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'writer-model-resolved',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 59_000, completion_tokens: 9, total_tokens: 59_009 }
    }
  ])
}

function sendSse(response: ServerResponse, chunks: unknown[]): void {
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    'x-request-id': 'agent-e2e-request'
  })
  for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`)
  response.end('data: [DONE]\n\n')
}

test(
  'surfaces an exhausted Agent diagnostic and starts a fresh run for later messages',
  scenario('agent.request-retry', ['@critical']),
  async ({ testRoot }) => {
    test.setTimeout(180_000)
    const exhaustedPrompt = `Exhaust this request and preserve its diagnostic. ${'Bounded context. '.repeat(80)}`
    const afterExhaustionPrompt =
      'Recover after the failed request with a fresh user run and finish this note.'
    const partialPrompt = `Keep the partial response visible and report the stream failure. ${'Stable context. '.repeat(80)}`
    const afterPartialPrompt =
      'Start a new run after the interrupted stream and finish this follow-up note.'
    const agentBodies: string[] = []
    const server = createServer((request, response) => {
      if (request.method === 'GET' && request.url === '/v1/models') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end('{"data":[{"id":"writer-model","displayName":"Writer model"}]}')
        return
      }
      if (request.method === 'POST' && request.url?.endsWith('/chat/completions')) {
        const chunks: Buffer[] = []
        request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        request.on('end', () => {
          const body = Buffer.concat(chunks).toString()
          if (body.includes('Create a concise title for the delimited')) {
            sendCompletion(response, 'Request diagnostic evidence')
            return
          }
          agentBodies.push(body)
          if (agentBodies.length <= 5) {
            response.writeHead(503, {
              'content-type': 'application/json',
              'retry-after': '0'
            })
            response.end(JSON.stringify({ error: { message: 'Temporary Agent outage' } }))
            return
          }
          if (agentBodies.length === 6) {
            sendCompletion(response, 'Recovered after a normal run following exhaustion.')
            return
          }
          if (agentBodies.length === 7) {
            response.writeHead(200, {
              'content-type': 'text/event-stream',
              'cache-control': 'no-cache'
            })
            response.write(
              `data: ${JSON.stringify({
                id: 'agent-interrupted-response',
                object: 'chat.completion.chunk',
                created: 1,
                model: 'writer-model-resolved',
                choices: [
                  {
                    index: 0,
                    delta: { role: 'assistant', content: 'Interrupted partial response.' },
                    finish_reason: null
                  }
                ]
              })}\n\n`
            )
            setTimeout(() => response.destroy(), 100)
            return
          }
          sendCompletion(response, 'Recovered after a normal run following stream interruption.')
        })
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
    const launched = await launchApp({
      userData: join(testRoot, 'user-data'),
      dialogPaths: [testRoot]
    })
    try {
      await createProject(launched.page, 'Agent diagnostic recovery')
      await configureProvider(launched.page, {
        sectionName: /^Agent API/,
        role: 'agent',
        baseUrl: `http://127.0.0.1:${port}/v1`,
        model: 'writer-model'
      })
      await launched.page.getByTestId('agent-menubar-trigger').click()
      const panel = launched.page.getByTestId('agent-panel')
      await panel.getByTestId('agent-model-selector').click()
      const picker = launched.page.getByTestId('agent-model-picker')
      await picker.getByRole('option', { name: /E2E Agent/ }).click()
      await picker.getByRole('option', { name: /Writer model/ }).click()
      const composer = panel.getByLabel('Agent message')
      const send = panel.getByRole('button', { name: 'Send', exact: true })

      await composer.fill(exhaustedPrompt)
      await send.click()
      await expect(panel.getByText(/Temporary Agent outage/i).last()).toBeVisible({
        timeout: 30_000
      })
      await expect(panel.getByRole('button', { name: 'Retry request', exact: true })).toHaveCount(0)
      await expect(panel.getByRole('button', { name: 'Continue', exact: true })).toHaveCount(0)

      await composer.fill(afterExhaustionPrompt)
      await expect(send).toBeEnabled({ timeout: 30_000 })
      await send.click()
      await expect(
        panel.getByText('Recovered after a normal run following exhaustion.', { exact: true })
      ).toBeVisible({ timeout: 30_000 })

      await composer.fill(partialPrompt)
      await expect(send).toBeEnabled({ timeout: 30_000 })
      await send.click()
      await expect(panel.getByText('Interrupted partial response.', { exact: true })).toBeVisible()
      await expect(
        panel.getByText(/terminated|stream ended without a terminal event/i).last()
      ).toBeVisible({ timeout: 30_000 })
      await expect(panel.getByRole('button', { name: 'Retry request', exact: true })).toHaveCount(0)
      await expect(panel.getByRole('button', { name: 'Continue', exact: true })).toHaveCount(0)

      await composer.fill(afterPartialPrompt)
      await expect(send).toBeEnabled({ timeout: 30_000 })
      await send.click()
      await expect(
        panel.getByText('Recovered after a normal run following stream interruption.', {
          exact: true
        })
      ).toBeVisible({ timeout: 30_000 })

      expect(agentBodies).toHaveLength(8)
      expect(agentBodies[5]).not.toBe(agentBodies[0])
      expect(agentBodies[5]).toContain(afterExhaustionPrompt)
      expect(agentBodies[7]).not.toBe(agentBodies[6])
      expect(agentBodies[7]).toContain(afterPartialPrompt)
      const durableMessages = await launched.page.evaluate(async () => {
        const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
          ?.projectSessionId
        if (projectSessionId === undefined) throw new Error('Project session missing')
        const session = (await window.desktop.agent.listSessions({ projectSessionId }))[0]
        if (session === undefined) throw new Error('Agent session missing')
        const page = await window.desktop.agent.listEvents({
          projectSessionId,
          agentSessionId: session.agentSessionId
        })
        return page.events
          .filter((event) => event.type === 'user_message')
          .map((event) => event.payload.content)
      })
      expect(
        durableMessages.filter((message) =>
          message.includes('Exhaust this request and preserve its diagnostic.')
        )
      ).toHaveLength(1)
      expect(
        durableMessages.filter((message) => message.includes(afterExhaustionPrompt))
      ).toHaveLength(1)
      expect(
        durableMessages.filter((message) =>
          message.includes('Keep the partial response visible and report the stream failure.')
        )
      ).toHaveLength(1)
      expect(
        durableMessages.filter((message) => message.includes(afterPartialPrompt))
      ).toHaveLength(1)
    } finally {
      await launched.app.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
)

test(
  'completes a grounded Agent proposal workflow and recovers it across reopen',
  scenario('agent.grounded-proposal-workflow', ['@critical', '@packaged']),
  async ({ testRoot }) => {
    test.setTimeout(180_000)
    const source = join(testRoot, 'agent evidence.pdf')
    await writeFile(source, makeMinimalPdf())
    const zipBytes = await evidenceZip()
    let parseTaskId = ''
    let outlineVersion = 0
    let sourceSectionId = ''
    let sectionId = ''
    let agentCall = 0
    let titleCall = 0
    let compactionCall = 0
    const requestBodies: unknown[] = []
    const server = createServer((request, response) => {
      const port = (server.address() as AddressInfo).port
      if (request.method === 'GET' && request.url === '/v1/models') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end('{"data":[{"id":"writer-model","displayName":"Writer model"}]}')
        return
      }
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
              trace_id: 'agent-e2e-submit',
              data: {
                batch_id: 'agent-e2e-batch',
                file_urls: [`http://127.0.0.1:${port}/upload?signature=private`]
              }
            })
          )
        })
        return
      }
      if (request.method === 'PUT' && request.url?.startsWith('/upload')) {
        request.resume()
        request.on('end', () => {
          response.writeHead(200)
          response.end()
        })
        return
      }
      if (
        request.method === 'GET' &&
        request.url === '/api/v4/extract-results/batch/agent-e2e-batch'
      ) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({
            code: 0,
            trace_id: 'agent-e2e-poll',
            data: {
              batch_id: 'agent-e2e-batch',
              extract_result: [
                {
                  file_name: 'agent evidence.pdf',
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
      if (request.method === 'POST' && request.url?.endsWith('/chat/completions')) {
        const chunks: Buffer[] = []
        request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        request.on('end', () => {
          const body = JSON.parse(Buffer.concat(chunks).toString()) as unknown
          if (JSON.stringify(body).includes('Create a concise title for the delimited')) {
            titleCall += 1
            setTimeout(
              () =>
                sendCompletion(
                  response,
                  titleCall === 1 ? 'Grounded evidence proposal' : 'Grounded evidence revision'
                ),
              500
            )
            return
          }
          if (JSON.stringify(body).includes('WRITELLM_PRIOR_EVENTS')) {
            compactionCall += 1
            sendCompletion(
              response,
              '- Objective\nPreserve the grounded writing task.\n- Active constraints\nKeep citations authoritative.\n- Decisions and rationale\nUse verified project evidence.\n- Verified progress\nA grounded proposal was applied.\n- Proposal outcomes\nThe section proposal was applied.\n- Evidence and citation IDs\nRetain the recorded citation ID.\n- Active work and blockers\nNone.\n- Next actions\nContinue from the current manuscript.\n- Critical references\nThe project evidence record.'
            )
            return
          }
          requestBodies.push(body)
          agentCall += 1
          if (agentCall === 1) {
            response.writeHead(503, {
              'content-type': 'application/json',
              'retry-after': '0'
            })
            response.end(JSON.stringify({ error: { message: 'Temporary Agent outage' } }))
            return
          }
          if (agentCall === 2) {
            sendToolCall(response, {
              responseId: 'agent-search-response',
              toolCallId: 'agent-search-tool',
              name: 'search_knowledge',
              text: 'I will search the project sources for evidence that can support this section.',
              args: {
                query: 'durable systems',
                knowledgeItemIds: [],
                fileExtensions: [],
                parseRevisionIds: [],
                limit: 10,
                rerank: false
              }
            })
            return
          }
          if (agentCall === 3) {
            const citationId = JSON.stringify(body).match(/citation-[a-f0-9]{40}/)?.[0]
            if (citationId === undefined) {
              response.writeHead(500, { 'content-type': 'application/json' })
              response.end(JSON.stringify({ error: { message: 'Grounding context missing' } }))
              return
            }
            sendToolCall(response, {
              responseId: 'agent-citation-response',
              toolCallId: 'agent-citation-tool',
              name: 'read_citations',
              text: 'The search found a relevant source. I will check its exact evidence next.',
              args: { citationIds: [citationId], requests: [] }
            })
            return
          }
          if (agentCall === 4) {
            sendToolCall(response, {
              responseId: 'agent-section-activation-response',
              toolCallId: 'agent-section-activation-tool',
              name: 'activate_tool_groups',
              args: { groups: ['section'] }
            })
            return
          }
          if (agentCall === 5) {
            const citationId = JSON.stringify(body).match(/citation-[a-f0-9]{40}/)?.[0]
            if (citationId === undefined || sectionId === '') {
              response.writeHead(500, { 'content-type': 'application/json' })
              response.end(JSON.stringify({ error: { message: 'Expanded evidence missing' } }))
              return
            }
            setTimeout(
              () =>
                sendToolCall(response, {
                  responseId: 'agent-proposal-response',
                  toolCallId: 'agent-proposal-tool',
                  name: 'submit_section_change',
                  text: 'The source supports a bounded revision. I will prepare it for review.',
                  args: {
                    sectionId,
                    operations: [
                      {
                        type: 'insertTextBlocks',
                        anchor: null,
                        placement: 'end',
                        blocks: [
                          {
                            clientRef: 'grounded-paragraph',
                            blockType: 'paragraph',
                            text: 'Grounded revision from Agent. [Source: agent evidence.pdf, p. 1]'
                          }
                        ]
                      }
                    ],
                    citationIds: [citationId]
                  }
                }),
              1_500
            )
            return
          }
          if (agentCall === 6) {
            sendToolCall(response, {
              responseId: 'agent-revision-search-response',
              toolCallId: 'agent-revision-search-tool',
              name: 'search_knowledge',
              text: 'I will re-check the sources before revising the rejected proposal.',
              args: {
                query: 'durable systems',
                knowledgeItemIds: [],
                fileExtensions: [],
                parseRevisionIds: [],
                limit: 10,
                rerank: false
              }
            })
            return
          }
          if (agentCall === 7) {
            const citationId = JSON.stringify(body).match(/citation-[a-f0-9]{40}/)?.[0]
            if (citationId === undefined || sectionId === '') {
              response.writeHead(500, { 'content-type': 'application/json' })
              response.end(JSON.stringify({ error: { message: 'Revision context missing' } }))
              return
            }
            sendToolCall(response, {
              responseId: 'agent-revision-citation-response',
              toolCallId: 'agent-revision-citation-tool',
              name: 'read_citations',
              text: 'The source is still relevant. I will verify the evidence before revising.',
              args: { citationIds: [citationId], requests: [] }
            })
            return
          }
          if (agentCall === 8) {
            sendToolCall(response, {
              responseId: 'agent-revision-section-activation-response',
              toolCallId: 'agent-revision-section-activation-tool',
              name: 'activate_tool_groups',
              args: { groups: ['section'] }
            })
            return
          }
          if (agentCall === 9) {
            const citationId = JSON.stringify(body).match(/citation-[a-f0-9]{40}/)?.[0]
            if (citationId === undefined || sectionId === '') {
              response.writeHead(500, { 'content-type': 'application/json' })
              response.end(JSON.stringify({ error: { message: 'Re-expanded evidence missing' } }))
              return
            }
            sendToolCall(response, {
              responseId: 'agent-revision-response',
              toolCallId: 'agent-revision-tool',
              name: 'submit_section_change',
              text: 'The feedback is addressed and the evidence is verified. I will prepare the revision.',
              args: {
                sectionId,
                operations: [
                  {
                    type: 'insertTextBlocks',
                    anchor: null,
                    placement: 'end',
                    blocks: [
                      {
                        clientRef: 'revised-grounded-paragraph',
                        blockType: 'paragraph',
                        text: 'Grounded revision from Agent. [Source: agent evidence.pdf, p. 1]'
                      }
                    ]
                  }
                ],
                citationIds: [citationId]
              }
            })
            return
          }
          if (agentCall === 10) {
            sendCompletion(response, 'I found **evidence** and prepared a reviewable proposal.')
            return
          }
          response.writeHead(500, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ error: { message: 'Unexpected Agent request' } }))
        })
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
    const projectName = 'Agent grounded writing'
    const launched = await launchApp({
      userData: join(testRoot, 'user-data'),
      dialogPaths: [testRoot],
      knowledgeDialogPaths: [source]
    })
    try {
      await configureProvider(launched.page, {
        sectionName: /^MinerU API/,
        role: 'mineru',
        baseUrl: `http://127.0.0.1:${port}`,
        model: 'pipeline'
      })
      await createProject(launched.page, projectName)

      await launched.page.getByTestId('agent-menubar-trigger').click()
      const setupPanel = launched.page.getByTestId('agent-panel')
      await expect(setupPanel.getByTestId('agent-model-recovery')).toBeVisible()
      await setupPanel.getByTestId('agent-model-selector').click()
      await expect(
        launched.page.getByTestId('agent-model-picker').getByRole('option', { name: /E2E Agent/ })
      ).toHaveCount(0)
      await launched.page.keyboard.press('Escape')
      await configureProvider(launched.page, {
        sectionName: /^Agent API/,
        role: 'agent',
        baseUrl: `http://127.0.0.1:${port}/v1`,
        model: 'writer-model'
      })
      await expect(setupPanel.getByTestId('agent-model-recovery')).toBeVisible()
      await expect(
        setupPanel.getByText('Choose an Agent model to start this conversation.')
      ).toBeVisible()
      await setupPanel.getByTestId('agent-model-selector').click()
      await expect(
        launched.page.getByTestId('agent-model-picker').getByRole('option', { name: /E2E Agent/ })
      ).toBeVisible()
      await launched.page.keyboard.press('Escape')
      await setupPanel.getByLabel('Close writing agent').click()

      await launched.page.getByRole('button', { name: 'Brief', exact: true }).click()
      const brief = launched.page.getByRole('dialog', { name: 'Manuscript brief' })
      await brief.getByLabel('Title').fill('Grounded systems note')
      await brief
        .getByLabel('Purpose')
        .fill('Write a source-backed section with traceable revisions.')
      await brief.getByRole('button', { name: 'Save brief' }).click()
      await expect(brief.getByText('Saved', { exact: true })).toBeVisible()
      await brief.getByRole('button', { name: 'Close', exact: true }).first().click()

      await launched.page.getByLabel('Section title').fill('Introduction')
      await launched.page.getByLabel('Section title').press('Tab')
      const editor = sectionEditor(launched.page)
      await editor.click()
      await launched.page.keyboard.type('Initial draft with a durable claim.')
      await launched.page.keyboard.press('ControlOrMeta+s')
      await expect(launched.page.getByText('Saved', { exact: true }).last()).toBeVisible()

      await launched.page.getByRole('button', { name: 'Edit outline', exact: true }).click()
      const outline = launched.page.getByRole('dialog', { name: 'Outline editor' })
      await outline.getByRole('button', { name: 'New section', exact: true }).click()
      const createSection = launched.page.getByRole('dialog', { name: 'Create section' })
      await createSection.getByLabel('Section title').fill('Agent revision target')
      await createSection.getByRole('button', { name: 'Create', exact: true }).click()
      await expect(createSection).not.toBeVisible()
      const createdSection = outline
        .getByTestId(/^outline-editor-section-/)
        .filter({ hasText: 'Agent revision target' })
      await createdSection.locator('button[id^="outline-tree-item-"]').click()
      await expect(createdSection).toHaveAttribute('aria-selected', 'true')
      await outline.getByRole('button', { name: 'Open in editor', exact: true }).click()
      await expect(outline).not.toBeVisible()
      await expect(launched.page.getByLabel('Section title')).toHaveValue('Agent revision target')
      await editor.click()
      await launched.page.keyboard.type('Target section baseline.')
      await launched.page.keyboard.press('ControlOrMeta+s')
      await expect(launched.page.getByText('Saved', { exact: true }).last()).toBeVisible()
      await launched.page
        .getByTestId(/^outline-section-/)
        .filter({ hasText: 'Introduction' })
        .click()
      await expect(launched.page.getByLabel('Section title')).toHaveValue('Introduction')

      await launched.page.getByRole('button', { name: 'Knowledge', exact: true }).click()
      const knowledge = launched.page.getByTestId('knowledge-workspace')
      await knowledge.getByTestId('knowledge-upload-button').click()
      await expect
        .poll(
          () =>
            launched.page.evaluate(async () => {
              const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
                ?.projectSessionId
              if (projectSessionId === undefined) return false
              try {
                const result = await window.desktop.knowledge.search({
                  projectSessionId,
                  query: 'durable systems',
                  filters: { knowledgeItemIds: [], fileExtensions: [], parseRevisionIds: [] },
                  limits: { fts: 100, vector: 100, fused: 50, results: 20 },
                  rerank: false
                })
                return result.hits.some((hit) => hit.snippet.includes('traceable revisions'))
              } catch {
                return false
              }
            }),
          { timeout: 20_000 }
        )
        .toBe(true)

      await launched.page.getByRole('button', { name: 'Manuscript', exact: true }).click()
      ;({ outlineVersion, sourceSectionId, sectionId } = await launched.page.evaluate(async () => {
        const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
          ?.projectSessionId
        if (projectSessionId === undefined) throw new Error('Project session missing')
        const workspace = await window.desktop.manuscript.workspace({ projectSessionId })
        const source = workspace.sections.find((item) => item.section.title === 'Introduction')
        const target = workspace.sections.find(
          (item) => item.section.title === 'Agent revision target'
        )
        if (source === undefined || target === undefined) throw new Error('Agent sections missing')
        return {
          outlineVersion: workspace.outlineVersion,
          sourceSectionId: source.section.sectionId,
          sectionId: target.section.sectionId
        }
      }))

      await editor.click()
      await launched.page.keyboard.type(
        ` Unsaved before Agent follow.${' Additional source-section text.'.repeat(80)}`
      )

      const browserWindow = await launched.app.browserWindow(launched.page)
      await browserWindow.evaluate((window) => {
        window.unmaximize()
        window.setContentSize(1680, 900)
      })
      await expect.poll(() => launched.page.evaluate(() => window.innerWidth)).toBeGreaterThan(1279)
      const agentTrigger = launched.page.getByTestId('agent-menubar-trigger')
      await expect(agentTrigger).toBeVisible()
      await expect(launched.page.getByRole('button', { name: 'Agent', exact: true })).toHaveCount(1)
      await agentTrigger.click()
      const panel = launched.page.getByTestId('agent-panel')
      await expect(panel).toBeVisible()
      await expect(panel.getByTestId('agent-model-recovery')).toBeVisible()
      await expect(
        panel.getByText('Choose an Agent model to start this conversation.')
      ).toBeVisible()
      await expect(panel.getByLabel('Agent message')).toHaveCount(0)
      await expect(panel.getByText(/created only when you send it/i)).toBeVisible()
      await panel.getByTestId('agent-model-selector').click()
      const modelPicker = launched.page.getByTestId('agent-model-picker')
      await modelPicker.getByRole('option', { name: /E2E Agent/ }).click()
      await modelPicker.getByRole('option', { name: /Writer model/ }).click()
      await expect(panel.getByTestId('agent-model-selector')).toContainText('Writer model')
      const approvalSelector = panel.getByTestId('agent-approval-selector')
      await expect(approvalSelector).toContainText('Manual')
      await expect(approvalSelector.locator('svg')).toHaveCount(1)
      await expect(panel.getByTestId('agent-add-menu-trigger')).toBeVisible()
      const modelSelector = panel.getByTestId('agent-model-selector')
      const modeSelector = panel.getByTestId('agent-interaction-mode-selector')
      const agentMessage = panel.getByLabel('Agent message')
      await expect(modeSelector).toContainText('Write')
      await expect(agentMessage).toHaveAttribute('placeholder', 'Describe the change you want…')
      await modeSelector.click()
      await launched.page.getByRole('menuitemradio', { name: /Ask Read and answer/ }).click()
      await expect(modeSelector).toContainText('Ask')
      await expect(agentMessage).toHaveAttribute('placeholder', 'Ask about this manuscript…')
      await expect(approvalSelector).toBeDisabled()
      await modeSelector.click()
      await launched.page.getByRole('menuitemradio', { name: /Plan Build a writing plan/ }).click()
      await expect(modeSelector).toContainText('Plan')
      await expect(agentMessage).toHaveAttribute('placeholder', 'Describe what you want to plan…')
      await expect(approvalSelector).toBeDisabled()
      await modeSelector.click()
      await launched.page
        .getByRole('menuitemradio', { name: /Write Propose manuscript changes/ })
        .click()
      await expect(modeSelector).toContainText('Write')
      await expect(approvalSelector).toBeEnabled()
      const sendButton = panel.getByRole('button', { name: 'Send', exact: true })
      await expect(sendButton).toHaveAttribute('title', 'Send')
      await expect(sendButton).toHaveClass(/rounded-full/)
      await expect(sendButton.locator('svg')).toHaveClass(/lucide-arrow-up/)
      await expect(sendButton).toHaveText('')
      const [approvalBox, modelBox, modeBox, sendBox] = await Promise.all([
        approvalSelector.boundingBox(),
        modelSelector.boundingBox(),
        modeSelector.boundingBox(),
        sendButton.boundingBox()
      ])
      if (approvalBox === null || modelBox === null || modeBox === null || sendBox === null) {
        throw new Error('Agent composer controls must have visible bounds')
      }
      expect(approvalBox.x + approvalBox.width).toBeLessThanOrEqual(modelBox.x)
      expect(modelBox.x + modelBox.width).toBeLessThanOrEqual(modeBox.x)
      expect(modeBox.x + modeBox.width).toBeLessThanOrEqual(sendBox.x)
      await expect(panel.getByLabel('Agent message')).toBeVisible()
      const screenshotDirectory = process.env.WRITELLM_CP48_SCREENSHOT_DIR
      if (screenshotDirectory !== undefined) {
        await mkdir(screenshotDirectory, { recursive: true })
        await launched.page.screenshot({
          path: join(screenshotDirectory, 'cp48-agent-composer.png'),
          animations: 'disabled'
        })
      }
      const modelEffortPicker = launched.page.getByTestId('agent-model-effort-picker')
      await expect(async () => {
        if (!(await modelEffortPicker.isVisible())) {
          await modelSelector.click()
        }
        await expect(modelEffortPicker).toBeVisible({ timeout: 2_000 })
      }).toPass({ timeout: 60_000 })
      await expect(
        modelEffortPicker.getByRole('option', { name: /Model Writer model/ })
      ).toBeVisible({ timeout: 60_000 })
      await expect(
        modelEffortPicker.getByRole('option', { name: /Effort Unavailable/ })
      ).toBeVisible({ timeout: 60_000 })
      if (screenshotDirectory !== undefined) {
        await launched.page.screenshot({
          path: join(screenshotDirectory, 'cp48-agent-model-effort.png'),
          animations: 'disabled'
        })
      }
      await launched.page.keyboard.press('Escape')
      await panel.getByTestId('agent-approval-selector').click()
      await expect(
        launched.page.getByRole('menuitemradio', {
          name: /Manual Review every proposed manuscript change/
        })
      ).toBeVisible()
      await expect(
        launched.page.getByRole('menuitemradio', {
          name: /Write Auto Apply writing changes automatically; review Brief and rules/
        })
      ).toBeVisible()
      await expect(
        launched.page.getByRole('menuitemradio', {
          name: /YOLO Apply every proposed change automatically without review/
        })
      ).toBeVisible()
      if (screenshotDirectory !== undefined) {
        await launched.page.screenshot({
          path: join(screenshotDirectory, 'cp48-agent-approval.png'),
          animations: 'disabled'
        })
      }
      await launched.page.keyboard.press('Escape')
      await expect(
        launched.page.getByRole('menuitemradio', {
          name: /Manual Review every proposed manuscript change/
        })
      ).not.toBeVisible()
      const slashMenu = launched.page.getByTestId('agent-slash-menu')
      const sectionOption = slashMenu.getByRole('option', { name: /This section/ })
      await expect(async () => {
        if (!(await sectionOption.isVisible())) {
          await agentMessage.fill('')
          await agentMessage.fill('/section')
        }
        await expect(slashMenu).toBeVisible({ timeout: 2_000 })
        await expect(sectionOption).toBeVisible({ timeout: 2_000 })
      }).toPass({ timeout: 60_000 })
      if (screenshotDirectory !== undefined) {
        await launched.page.screenshot({
          path: join(screenshotDirectory, 'cp48-agent-slash-menu.png'),
          animations: 'disabled'
        })
      }
      const sectionChip = panel
        .getByTestId('agent-composer-context-chips')
        .getByRole('button', { name: 'This section', exact: true })
      await expect(async () => {
        if (!(await sectionChip.isVisible())) {
          if (!(await sectionOption.isVisible())) {
            await agentMessage.fill('')
            await agentMessage.fill('/section')
            await expect(sectionOption).toBeVisible({ timeout: 2_000 })
          }
          await sectionOption.click()
        }
        await expect(sectionChip).toBeEnabled({ timeout: 2_000 })
      }).toPass({ timeout: 60_000 })
      await expect(slashMenu).not.toBeVisible()
      await expect(agentMessage).toHaveValue('')
      await expect(sectionChip).toBeEnabled()
      const addContextButton = panel.getByTestId('agent-add-menu-trigger')
      await expect(addContextButton).toBeEnabled({ timeout: 60_000 })
      const wholeManuscriptChip = panel
        .getByTestId('agent-composer-context-chips')
        .getByRole('button', { name: 'Whole manuscript', exact: true })
      const wholeManuscriptOption = launched.page.getByRole('option', {
        name: /Whole manuscript/
      })
      await expect(async () => {
        if (!(await wholeManuscriptChip.isVisible())) {
          if (!(await wholeManuscriptOption.isVisible())) {
            await addContextButton.click()
          }
          await wholeManuscriptOption.click()
        }
        await expect(wholeManuscriptChip).toBeEnabled({ timeout: 2_000 })
      }).toPass({ timeout: 60_000 })
      await agentMessage.fill('Ground the Agent revision target section in the imported evidence.')
      await expect(sendButton).toBeEnabled()
      await expect(panel.getByTestId('agent-context-usage')).toHaveCount(0)
      if (screenshotDirectory !== undefined) {
        await launched.page.screenshot({
          path: join(screenshotDirectory, 'cp48-agent-composer-ready.png'),
          animations: 'disabled'
        })
      }
      await sendButton.click()
      await expect(panel.getByLabel('Generating conversation title')).toBeVisible()
      await expect(panel.getByTestId('agent-conversation-header')).toContainText(
        'Grounded evidence proposal'
      )
      // Wait for the run to stop auto-expanding its newest activity group
      // before opening and inspecting an earlier completed group.
      await expect(panel.getByText('Review required', { exact: true })).toBeVisible({
        timeout: 30_000
      })
      const searchActivity = panel.getByTestId('agent-activity-group').filter({
        hasText: 'Searching sources'
      })
      await expect(searchActivity).toBeVisible()
      const searchedSourcesStep = searchActivity.getByText('Searched sources', { exact: true })
      await expect(searchActivity).toHaveAttribute('data-state', 'closed')
      await searchActivity.getByRole('button').first().focus()
      await launched.page.keyboard.press('Enter')
      await expect(searchActivity).toHaveAttribute('data-state', 'open')
      await expect(searchedSourcesStep).toBeVisible()
      await expect(
        panel.getByText(
          'The search found a relevant source. I will check its exact evidence next.',
          {
            exact: true
          }
        )
      ).toBeVisible()
      const conversationSwitcher = panel.getByTestId('agent-conversation-switcher')
      await conversationSwitcher.focus()
      await expect(conversationSwitcher).toBeFocused()
      await expect(launched.page.getByLabel('Section title')).toHaveValue('Agent revision target')
      const sourceTruth = await launched.page.evaluate(async (expectedSourceSectionId) => {
        const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
          ?.projectSessionId
        if (projectSessionId === undefined) throw new Error('Project session missing')
        const preview = await window.desktop.manuscript.preview({ projectSessionId })
        return JSON.stringify(
          preview.sections.find((item) => item.section.sectionId === expectedSourceSectionId)
            ?.revision.content
        )
      }, sourceSectionId)
      expect(sourceTruth).toContain('Unsaved before Agent follow.')
      await expect(panel.getByText('Review required', { exact: true })).toBeVisible()
      await expect(panel.getByTestId('agent-review-attention')).toBeVisible()
      await expect(panel.getByText('pending', { exact: true })).toBeVisible({ timeout: 20_000 })
      await expect(panel.getByText('Ready for review', { exact: true }).first()).toBeVisible()
      await expect(panel.getByText('Run failed', { exact: true })).toHaveCount(0)
      await expect(panel.getByLabel('Agent message')).toHaveCount(0)
      await expect(panel.getByLabel('Review feedback')).toBeVisible()
      await expect.poll(() => requestBodies.length).toBe(5)
      expect(JSON.stringify(requestBodies[0])).toContain('Before the first substantial tool phase')
      const waitingTruth = await launched.page.evaluate(async () => {
        const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
          ?.projectSessionId
        if (projectSessionId === undefined) throw new Error('Project session missing')
        const session = (await window.desktop.agent.listSessions({ projectSessionId }))[0]
        if (session === undefined) throw new Error('Agent session missing')
        const runs = await window.desktop.agent.listRuns({
          projectSessionId,
          agentSessionId: session.agentSessionId
        })
        return { workflowState: session.workflowState, run: runs[0] }
      })
      expect(waitingTruth.workflowState).toBe('awaiting_review')
      expect(waitingTruth.run).toMatchObject({ status: 'completed', errorCode: null })
      await expect(panel.getByText('openai-compatible', { exact: true })).toHaveCount(0)
      await expect(panel.getByText('writer-model', { exact: true })).toHaveCount(0)
      await expect(panel.getByText('Before → After', { exact: true })).toBeVisible()
      const proposalDetails = panel.getByRole('button', {
        name: 'View proposal details',
        exact: true
      })
      await expect(proposalDetails).toHaveAttribute('aria-expanded', 'true')
      const proposalDiff = panel.getByTestId('agent-proposal-diff')
      await expect(proposalDiff).toHaveAttribute('data-layout', 'unified')
      await panel.getByRole('radio', { name: 'Split', exact: true }).click()
      await expect(proposalDiff).toHaveAttribute('data-layout', 'split')
      await expect(panel.getByText('Before', { exact: true })).toBeVisible()
      await expect(panel.getByText('After', { exact: true })).toBeVisible()
      await expect(
        panel.getByRole('button', { name: 'Request changes', exact: true })
      ).toBeDisabled()
      await expect(
        panel.getByRole('button', { name: 'Apply & continue', exact: true })
      ).toBeEnabled()
      await expect(panel.getByRole('button', { name: 'More review actions' })).toBeEnabled()
      await panel.getByRole('radio', { name: 'Unified', exact: true }).click()
      await expect(proposalDiff).toHaveAttribute('data-layout', 'unified')
      const sourceAttachment = panel
        .locator('[data-testid^="agent-proposal-"] [data-slot="attachment"]')
        .filter({ hasText: 'agent evidence.pdf' })
        .first()
      await sourceAttachment.scrollIntoViewIfNeeded()
      await expect(sourceAttachment.getByText('agent evidence.pdf', { exact: true })).toBeVisible()
      await expect(sourceAttachment.getByText('Page 1', { exact: true })).toBeVisible()
      await expect
        .poll(() => panel.evaluate((element) => element.scrollWidth <= element.clientWidth))
        .toBe(true)
      await panel.getByLabel('Review feedback').fill('Keep the wording restrained and concise.')
      await expect(
        panel.getByRole('button', { name: 'Request changes', exact: true })
      ).toBeEnabled()
      await panel.getByRole('button', { name: 'Request changes', exact: true }).click()
      await expect(
        panel.getByText('Keep the wording restrained and concise.', { exact: true })
      ).toBeVisible()
      await expect(panel.getByText('Review required', { exact: true }).last()).toBeVisible()
      await expect.poll(() => requestBodies.length).toBe(9)
      await expect(searchActivity.first()).toHaveAttribute('data-state', 'open')
      await expect(proposalDetails.first()).toHaveAttribute('aria-expanded', 'false')
      await expect(proposalDetails.last()).toHaveAttribute('aria-expanded', 'true')
      await panel.getByRole('button', { name: 'Apply & continue', exact: true }).click()
      await expect(panel.getByText('applied', { exact: true })).toBeVisible()
      await expect(proposalDetails.last()).toHaveAttribute('aria-expanded', 'false')
      await expect(searchActivity.first()).toHaveAttribute('data-state', 'open')
      await expect(panel.getByText('Applied · continuing', { exact: true })).toBeVisible()
      await expect(panel.getByText('Ready for review', { exact: true })).toHaveCount(0)
      const approvalContinuation = `<AUTHORITATIVE_REVIEW_STATE instructionSemantics="true">
The user approved the proposed Section update, and it is now applied. Treat the resulting manuscript state as authoritative.
</AUTHORITATIVE_REVIEW_STATE>

<CURRENT_USER_REQUEST instructionSemantics="true">
Continue only the original user request that remains unresolved after this approved proposal. Approval authorizes this reviewed proposal only: do not add a new artifact, section, mutation kind, completeness check, or section-body draft unless the original request explicitly required it. If the original request is now complete, report the applied or satisfied outcome and stop.
</CURRENT_USER_REQUEST>`
      await expect(panel.getByText(approvalContinuation, { exact: true })).toHaveCount(0)
      await expect(
        panel
          .getByText('I found evidence and prepared a reviewable proposal.', { exact: true })
          .first()
      ).toBeVisible()
      await expect(
        panel.locator('strong').getByText('evidence', { exact: true }).first()
      ).toBeVisible()
      await expect(editor).toContainText('Grounded revision from Agent.')
      const inlineCitation = editor.getByRole('button', {
        name: 'Preview source: agent evidence.pdf'
      })
      await expect(inlineCitation).toBeVisible()
      await inlineCitation.focus()
      await expect(inlineCitation).toBeFocused()
      await launched.page.keyboard.press('Enter')
      const sourcePreview = launched.page.getByRole('dialog', { name: 'agent evidence.pdf' })
      await expect(sourcePreview).toBeVisible()
      await expect(
        sourcePreview.getByText(/durable systems preserve traceable revisions/)
      ).toBeVisible()
      await sourcePreview.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(inlineCitation).toBeFocused()
      await inlineCitation.click()
      await expect(sourcePreview).toBeVisible()
      await sourcePreview.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(inlineCitation).toBeFocused()

      const appliedTruth = await launched.page.evaluate(async (expectedSectionId) => {
        const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
          ?.projectSessionId
        if (projectSessionId === undefined) throw new Error('Project session missing')
        const sessions = await window.desktop.agent.listSessions({ projectSessionId })
        const session = sessions[0]
        if (session === undefined) throw new Error('Agent session missing')
        const proposals = await window.desktop.agent.listProposals({
          projectSessionId,
          agentSessionId: session.agentSessionId
        })
        const proposal = proposals.find((candidate) => candidate.status === 'applied')
        if (proposal === undefined) throw new Error('Agent proposal missing')
        const eventPage = await window.desktop.agent.listEvents({
          projectSessionId,
          agentSessionId: session.agentSessionId
        })
        const retryCounts = eventPage.events.flatMap((event) => {
          if (event.type !== 'assistant_message') return []
          return [event.payload.metadata.retryCount]
        })
        const userMessages = eventPage.events.flatMap((event) => {
          if (event.type !== 'user_message') return []
          return [event.payload.content]
        })
        const loaded = await window.desktop.editor.loadSection({
          projectSessionId,
          sectionId: expectedSectionId
        })
        return {
          agentSessionId: session.agentSessionId,
          proposal,
          revision: loaded.revision,
          retryCounts,
          userMessages,
          workflowState: session.workflowState
        }
      }, sectionId)
      expect(appliedTruth.proposal.status).toBe('applied')
      expect(appliedTruth.workflowState).toBe('idle')
      await expect(panel.getByLabel('Agent message')).toBeVisible()
      const contextUsageIndicator = panel.getByTestId('agent-context-usage')
      await expect(contextUsageIndicator).toBeVisible()
      await expect(contextUsageIndicator).toHaveAttribute('role', 'progressbar')
      await expect(contextUsageIndicator).toHaveAttribute('aria-valuenow', '45')
      await contextUsageIndicator.focus()
      await expect(contextUsageIndicator).toBeFocused()
      const contextUsageTooltip = launched.page.getByRole('tooltip')
      await expect(contextUsageTooltip).toContainText('Context window')
      await expect(contextUsageTooltip).toContainText('45% used (55% left)')
      await expect(contextUsageTooltip).toContainText('59k / 131k tokens used')
      await modelSelector.focus()
      await expect(contextUsageTooltip).not.toBeVisible()
      await expect
        .poll(async () => {
          const [approvalBox, ringBox, modelBox, sendBox] = await Promise.all([
            approvalSelector.boundingBox(),
            contextUsageIndicator.boundingBox(),
            modelSelector.boundingBox(),
            sendButton.boundingBox()
          ])
          if (approvalBox === null || ringBox === null || modelBox === null || sendBox === null) {
            return false
          }
          return (
            approvalBox.x + approvalBox.width <= ringBox.x &&
            ringBox.x + ringBox.width <= modelBox.x &&
            modelBox.x + modelBox.width <= sendBox.x
          )
        })
        .toBe(true)
      const contextScreenshotDirectory = process.env.WRITELLM_CP55_SCREENSHOT_DIR
      if (contextScreenshotDirectory !== undefined) {
        await mkdir(contextScreenshotDirectory, { recursive: true })
        await launched.page.screenshot({
          path: join(contextScreenshotDirectory, 'cp55-agent-context-usage.png'),
          animations: 'disabled'
        })
        await contextUsageIndicator.focus()
        await expect(contextUsageTooltip).toBeVisible()
        await launched.page.screenshot({
          path: join(contextScreenshotDirectory, 'cp55-agent-context-usage-tooltip.png'),
          animations: 'disabled'
        })
        await modelSelector.focus()
      }
      expect(appliedTruth.userMessages.at(-1)).toBe(approvalContinuation)
      expect(appliedTruth.userMessages.at(-1)).not.toContain(appliedTruth.proposal.proposalId)
      expect(appliedTruth.userMessages.at(-1)).not.toContain('{')
      expect(JSON.stringify(requestBodies[5])).toContain('Keep the wording restrained and concise.')
      expect(JSON.stringify(requestBodies[5])).not.toContain(
        'Revise the rejected proposal from the stored review feedback.'
      )
      expect(appliedTruth.proposal.payload.preview.citedSources).toHaveLength(1)
      expect(appliedTruth.retryCounts).toContain(1)
      expect(appliedTruth.revision).toMatchObject({
        sectionRevisionId: appliedTruth.proposal.appliedRevisionId,
        source: 'agent',
        sourceClass: 'agent_accepted',
        agentRunId: appliedTruth.proposal.agentRunId,
        agentToolCallId: appliedTruth.proposal.agentToolCallId,
        agentProposalId: appliedTruth.proposal.proposalId
      })

      const initialAgentRequest = requestBodies[0] as {
        messages?: Array<{ content?: unknown }>
      }
      expect(
        initialAgentRequest.messages?.some(
          (message) =>
            typeof message.content === 'string' &&
            message.content.includes(`"outlineVersion":${outlineVersion}`)
        )
      ).toBe(true)

      await panel.getByRole('button', { name: 'Close writing agent', exact: true }).click()

      await closeProject(launched.page)
      await launched.page.getByRole('button', { name: `Open ${projectName}`, exact: true }).click()
      await expectActiveProject(launched.page, projectName)
      await launched.page.getByRole('button', { name: 'Agent', exact: true }).click()
      await expect(launched.page.getByLabel('Section title')).toHaveValue('Introduction')
      await expect(panel.getByTestId('agent-conversation-switcher')).toContainText(
        'Grounded evidence proposal'
      )
      await expect(panel.getByText('applied', { exact: true }).first()).toBeVisible()
      const reopenedTruth = await launched.page.evaluate(async (expectedAgentSessionId) => {
        const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
          ?.projectSessionId
        if (projectSessionId === undefined) throw new Error('Project session missing')
        const sessions = await window.desktop.agent.listSessions({ projectSessionId })
        const proposals = await window.desktop.agent.listProposals({
          projectSessionId,
          agentSessionId: expectedAgentSessionId
        })
        return {
          sessionIds: sessions.map((session) => session.agentSessionId),
          proposal: proposals.find((proposal) => proposal.status === 'applied')
        }
      }, appliedTruth.agentSessionId)
      expect(reopenedTruth.sessionIds).toContain(appliedTruth.agentSessionId)
      expect(reopenedTruth.proposal?.status).toBe('applied')

      await panel.getByTestId('agent-conversation-menu').click()
      await launched.page
        .getByRole('menuitem', { name: 'Summarize earlier conversation', exact: true })
        .click()
      const compactionDialog = launched.page.getByRole('alertdialog', {
        name: 'Summarize earlier conversation?'
      })
      await expect(compactionDialog).toContainText('lossy context checkpoint')
      await compactionDialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(compactionDialog).not.toBeVisible()
      await agentMessage.fill('/compact')
      const compactOption = launched.page
        .getByTestId('agent-slash-menu')
        .getByRole('option', { name: /Compact conversation/ })
      await expect(compactOption).toBeVisible()
      await compactOption.click()
      await expect(panel.getByText('Earlier conversation summarized · manual')).toBeVisible()
      await expect(panel.getByLabel('Agent message')).toHaveValue('')
      await panel.getByText('Earlier conversation summarized · manual').click()
      await expect(
        panel.getByText('AI-generated context checkpoint, not manuscript authority.')
      ).toBeVisible()
      await expect(launched.page.getByLabel('Section title')).toHaveValue('Introduction')
      expect(compactionCall).toBe(1)

      await panel.getByRole('button', { name: 'Undo', exact: true }).click()
      await expect(panel.getByText('undone', { exact: true })).toBeVisible()
      await expect(sectionEditor(launched.page)).not.toContainText('Grounded revision from Agent.')
      const undoneTruth = await launched.page.evaluate(async (expectedSectionId) => {
        const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
          ?.projectSessionId
        if (projectSessionId === undefined) throw new Error('Project session missing')
        const sessions = await window.desktop.agent.listSessions({ projectSessionId })
        const session = sessions[0]
        if (session === undefined) throw new Error('Agent session missing')
        const proposals = await window.desktop.agent.listProposals({
          projectSessionId,
          agentSessionId: session.agentSessionId
        })
        const loaded = await window.desktop.editor.loadSection({
          projectSessionId,
          sectionId: expectedSectionId
        })
        return {
          proposal: proposals.find((proposal) => proposal.status === 'undone'),
          revision: loaded.revision
        }
      }, sectionId)
      expect(undoneTruth.proposal?.status).toBe('undone')
      expect(undoneTruth.revision).toMatchObject({
        sectionRevisionId: undoneTruth.proposal?.undoRevisionId,
        source: 'undo',
        agentRunId: null,
        agentToolCallId: null,
        agentProposalId: null
      })

      expect(requestBodies).toHaveLength(10)
      expect(JSON.stringify(requestBodies)).not.toContain('e2e-secret')

      await panel.getByTestId('agent-conversation-switcher').click()
      let currentConversation = launched.page.getByTestId(
        `agent-session-${appliedTruth.agentSessionId}`
      )
      await currentConversation.getByLabel(/Conversation actions/).click()
      await launched.page.getByRole('menuitem', { name: 'Regenerate title', exact: true }).click()
      await expect(panel.getByTestId('agent-conversation-switcher')).toContainText(
        'Grounded evidence revision'
      )

      await panel.getByTestId('agent-conversation-switcher').click()
      currentConversation = launched.page.getByTestId(
        `agent-session-${appliedTruth.agentSessionId}`
      )
      await currentConversation.getByLabel(/Conversation actions/).click()
      await launched.page.getByRole('menuitem', { name: 'Archive', exact: true }).click()
      await panel.getByTestId('agent-conversation-switcher').click()
      await launched.page.getByTestId(`agent-session-${appliedTruth.agentSessionId}`).click()
      await expect(
        panel.getByText('Archived conversations are read only.', { exact: true })
      ).toBeVisible()
      await expect(panel.getByLabel('Agent message')).toHaveCount(0)
      await panel.getByRole('button', { name: 'Restore', exact: true }).click()
      await expect(panel.getByLabel('Agent message')).toBeVisible()
      await expect(panel.getByLabel('Agent message')).toBeEnabled()
      expect(titleCall).toBe(2)
    } finally {
      await launched.app.close()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    }
  }
)
