import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
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
  await page.getByRole('menuitem', { name: 'Close project', exact: true }).click()
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
      usage: { prompt_tokens: 21, completion_tokens: 8, total_tokens: 29 }
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
      usage: { prompt_tokens: 34, completion_tokens: 9, total_tokens: 43 }
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
  'completes a grounded Agent proposal workflow and recovers it across reopen',
  scenario('agent.grounded-proposal-workflow', ['@critical', '@packaged']),
  async ({ testRoot }) => {
    const source = join(testRoot, 'agent evidence.pdf')
    await writeFile(source, makeMinimalPdf())
    const zipBytes = await evidenceZip()
    let parseTaskId = ''
    let outlineVersion = 0
    let sectionId = ''
    let agentCall = 0
    let titleCall = 0
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
            const citationId = JSON.stringify(body).match(/citation-[a-f0-9]{40}/)?.[0]
            if (citationId === undefined || sectionId === '') {
              response.writeHead(500, { 'content-type': 'application/json' })
              response.end(JSON.stringify({ error: { message: 'Expanded evidence missing' } }))
              return
            }
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
            })
            return
          }
          if (agentCall === 5) {
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
          if (agentCall === 6) {
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
          if (agentCall === 7) {
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
          if (agentCall === 8) {
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
      await configureProvider(launched.page, {
        sectionName: /^Agent API/,
        role: 'agent',
        baseUrl: `http://127.0.0.1:${port}/v1`,
        model: 'writer-model'
      })
      await createProject(launched.page, projectName)

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
      ;({ outlineVersion, sectionId } = await launched.page.evaluate(async () => {
        const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
          ?.projectSessionId
        if (projectSessionId === undefined) throw new Error('Project session missing')
        const workspace = await window.desktop.manuscript.workspace({ projectSessionId })
        const section = workspace.sections.find((item) => item.section.title === 'Introduction')
        if (section === undefined) throw new Error('Introduction section missing')
        return {
          outlineVersion: workspace.outlineVersion,
          sectionId: section.section.sectionId
        }
      }))

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
      await expect(panel.getByRole('button', { name: 'Set up an Agent model' })).toBeVisible()
      await expect(panel.getByLabel('Agent message')).toHaveCount(0)
      await expect(panel.getByText(/created only when you send it/i)).toBeVisible()
      await panel.getByTestId('agent-conversation-menu').click()
      await launched.page.getByRole('menuitem', { name: 'Details', exact: true }).click()
      const details = launched.page.getByRole('dialog', { name: 'Agent details' })
      await details.getByLabel('Agent model').click()
      const modelPicker = launched.page.getByTestId('agent-model-picker')
      await modelPicker.getByRole('option', { name: /E2E Agent/ }).click()
      await modelPicker.getByRole('option', { name: /Writer model/ }).click()
      await launched.page.keyboard.press('Escape')
      await expect(panel.getByTestId('agent-model-selector')).toContainText('Writer model')
      await expect(panel.getByTestId('agent-thinking-selector')).toBeVisible()
      await expect(panel.getByTestId('agent-approval-selector')).toContainText('Review changes')
      await expect(panel.getByRole('button', { name: 'Choose writing skill' })).toBeVisible()
      await expect(panel.getByLabel('Agent message')).toBeVisible()
      await panel.getByRole('button', { name: /Context:/ }).click()
      await launched.page.getByRole('option', { name: 'This section', exact: true }).click()
      await panel.getByLabel('Agent message').fill('Ground this section in the imported evidence.')
      await panel.getByRole('button', { name: 'Send', exact: true }).click()
      await expect(panel.getByLabel('Generating conversation title')).toBeVisible()
      await expect(panel.getByTestId('agent-conversation-header')).toContainText(
        'Grounded evidence proposal'
      )
      const searchActivity = panel.getByTestId('agent-activity-group').filter({
        hasText: 'Searching sources'
      })
      await expect(searchActivity).toBeVisible()
      const searchedSourcesStep = searchActivity.getByText('Searched sources', { exact: true })
      if (!(await searchedSourcesStep.isVisible())) {
        await searchActivity.getByRole('button').first().click()
      }
      await expect(searchedSourcesStep).toBeVisible()
      await expect(
        panel.getByText(
          'The search found a relevant source. I will check its exact evidence next.',
          {
            exact: true
          }
        )
      ).toBeVisible()
      await expect(panel.getByText('Review required', { exact: true })).toBeVisible()
      await expect(panel.getByText('pending', { exact: true })).toBeVisible({ timeout: 20_000 })
      await expect(panel.getByText('Ready for review', { exact: true }).first()).toBeVisible()
      await expect(panel.getByText('Run failed', { exact: true })).toHaveCount(0)
      await expect(panel.getByLabel('Agent message')).toHaveCount(0)
      await expect(panel.getByLabel('Review feedback')).toBeVisible()
      await expect.poll(() => requestBodies.length).toBe(4)
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
      await expect.poll(() => requestBodies.length).toBe(7)
      await panel.getByRole('button', { name: 'Apply & continue', exact: true }).click()
      await expect(panel.getByText('applied', { exact: true })).toBeVisible()
      await expect(panel.getByText('Applied · continuing', { exact: true })).toBeVisible()
      await expect(panel.getByText('Ready for review', { exact: true })).toHaveCount(0)
      const approvalContinuation =
        'The user approved the proposed section update, and it is now applied. Treat the resulting manuscript state as authoritative. Continue the requested writing task. Verify the updated manuscript and run check_draft when appropriate.'
      await expect(panel.getByText(approvalContinuation, { exact: true })).toHaveCount(0)
      await expect(
        panel.getByText('I found evidence and prepared a reviewable proposal.', { exact: true })
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
      expect(appliedTruth.userMessages.at(-1)).toBe(approvalContinuation)
      expect(appliedTruth.userMessages.at(-1)).not.toContain(appliedTruth.proposal.proposalId)
      expect(appliedTruth.userMessages.at(-1)).not.toContain('{')
      expect(JSON.stringify(requestBodies[4])).toContain('Keep the wording restrained and concise.')
      expect(JSON.stringify(requestBodies[4])).not.toContain(
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

      expect(requestBodies).toHaveLength(8)
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
