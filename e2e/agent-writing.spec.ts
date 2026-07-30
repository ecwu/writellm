import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'
import { ZipFile } from 'yazl'
import { expect, expectActiveProject, launchApp, test } from './fixtures'

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
  input: { commandName: RegExp; dialogName: string; baseUrl: string; model: string }
): Promise<void> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('option', { name: input.commandName }).click()
  if (input.dialogName === 'Agent model') {
    const dialog = page.getByRole('dialog', { name: 'Agent models' })
    await dialog.getByLabel('Preset name').fill('E2E Agent')
    await dialog.getByLabel('Base URL').fill(input.baseUrl)
    await dialog.getByLabel('API key (optional for local/keyless endpoints)').fill('e2e-secret')
    await dialog.getByRole('button', { name: 'Add preset' }).click()
    await expect(dialog.getByText('E2E Agent', { exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Refresh E2E Agent models' }).click()
    await expect(dialog.getByText(/1 models · current/)).toBeVisible()
    await dialog.getByRole('button', { name: 'Close', exact: true }).first().click()
    return
  }
  const dialog = page.getByRole('dialog', { name: input.dialogName })
  await dialog.getByLabel('Base URL').fill(input.baseUrl)
  await dialog.getByLabel('Model ID').fill(input.model)
  await dialog.getByLabel('API key or token').fill('e2e-secret')
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog.getByText('Credential stored', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Close', exact: true }).first().click()
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
  input: { responseId: string; toolCallId: string; name: string; args: unknown }
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

test('completes a grounded Agent proposal workflow and recovers it across reopen', async ({
  testRoot
}) => {
  const source = join(testRoot, 'agent evidence.pdf')
  await writeFile(source, makeMinimalPdf())
  const zipBytes = await evidenceZip()
  let parseTaskId = ''
  let outlineVersion = 0
  let sectionId = ''
  let agentCall = 0
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
        requestBodies.push(body)
        agentCall += 1
        if (agentCall === 1) {
          sendToolCall(response, {
            responseId: 'agent-search-response',
            toolCallId: 'agent-search-tool',
            name: 'search_knowledge',
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
        if (agentCall === 2) {
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
            args: { citationIds: [citationId], requests: [] }
          })
          return
        }
        if (agentCall === 3) {
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
                      text: 'Grounded revision from Agent.'
                    }
                  ]
                }
              ],
              citationIds: [citationId]
            }
          })
          return
        }
        if (agentCall === 4) {
          sendCompletion(response, 'I found **evidence** and prepared a reviewable proposal.')
          return
        }
        if (agentCall === 5) {
          sendToolCall(response, {
            responseId: 'agent-brief-response',
            toolCallId: 'agent-brief-tool',
            name: 'submit_brief_change',
            args: {
              changes: { description: 'Updated by Agent and refreshed immediately.' },
              citationIds: []
            }
          })
          return
        }
        if (agentCall === 6) {
          sendToolCall(response, {
            responseId: 'agent-outline-response',
            toolCallId: 'agent-outline-tool',
            name: 'submit_outline_change',
            args: {
              operations: [
                {
                  type: 'createSection',
                  clientRef: 'agent-created-outline-section',
                  parent: null,
                  placement: { kind: 'last' },
                  title: 'Agent-created outline section',
                  objective: 'Verify outline refresh after approval.',
                  status: 'planned'
                }
              ],
              citationIds: []
            }
          })
          return
        }
        if (agentCall === 7) {
          sendToolCall(response, {
            responseId: 'agent-image-response',
            toolCallId: 'agent-image-tool',
            name: 'generate_image',
            args: {
              sectionId,
              anchor: null,
              placement: 'end',
              prompt: 'A restrained technical diagram about durable writing systems.',
              altText: 'Durable writing systems diagram',
              caption: 'Generated diagram',
              aspectRatio: '16:9',
              imageSize: '2K'
            }
          })
          return
        }
        response.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          'x-request-id': 'agent-e2e-interrupted'
        })
        response.write(
          `data: ${JSON.stringify({
            id: 'agent-e2e-interrupted',
            object: 'chat.completion.chunk',
            created: 1,
            model: 'writer-model-resolved',
            choices: [
              {
                index: 0,
                delta: { role: 'assistant', content: 'This response will be stopped.' },
                finish_reason: null
              }
            ]
          })}\n\n`
        )
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
      commandName: /MinerU parser/,
      dialogName: 'MinerU parser',
      baseUrl: `http://127.0.0.1:${port}`,
      model: 'pipeline'
    })
    await configureProvider(launched.page, {
      commandName: /Agent model provider/,
      dialogName: 'Agent model',
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

    await launched.page.locator('#section-title').fill('Introduction')
    await launched.page.locator('#section-title').press('Tab')
    const editor = launched.page.locator('.bn-editor').first()
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
    const agentTriggerBounds = await agentTrigger.boundingBox()
    if (agentTriggerBounds === null) throw new Error('Agent trigger bounds missing')
    const viewportWidth = await launched.page.evaluate(() => window.innerWidth)
    expect(agentTriggerBounds.x + agentTriggerBounds.width).toBeGreaterThan(viewportWidth - 16)
    expect(agentTriggerBounds.y).toBeLessThan(40)
    await agentTrigger.click()
    const panel = launched.page.getByTestId('agent-panel')
    await expect(panel).toBeVisible()
    await expect(panel.getByTestId('agent-session-list')).toBeVisible()
    await expect(launched.page.locator('[data-slot="sheet-content"]')).toHaveCount(0)
    const resizeHandle = launched.page.getByRole('separator').last()
    await expect(resizeHandle).toBeVisible()
    const panelBeforeResize = await panel.boundingBox()
    const handleBounds = await resizeHandle.boundingBox()
    if (panelBeforeResize === null || handleBounds === null)
      throw new Error('Side chat bounds missing')
    await launched.page.mouse.move(
      handleBounds.x + handleBounds.width / 2,
      handleBounds.y + handleBounds.height / 2
    )
    await launched.page.mouse.down()
    await launched.page.mouse.move(handleBounds.x - 60, handleBounds.y + handleBounds.height / 2)
    await launched.page.mouse.up()
    await expect
      .poll(async () => (await panel.boundingBox())?.width ?? 0)
      .toBeGreaterThan(panelBeforeResize.width + 30)
    await panel.getByRole('button', { name: 'New', exact: true }).click()
    await panel.getByLabel('Agent model').click()
    await launched.page.getByRole('option', { name: 'E2E Agent · Writer model' }).click()
    await panel.getByRole('radio', { name: 'Section', exact: true }).click()
    await panel.getByLabel('Agent message').fill('Ground this section in the imported evidence.')
    await panel.getByRole('button', { name: 'Send', exact: true }).click()
    const searchActivity = panel.getByTestId('agent-activity-group').filter({
      hasText: 'Searched knowledge'
    })
    await expect(searchActivity).toBeVisible()
    await expect(panel.getByText('Review required', { exact: true })).toBeVisible()
    await expect(panel.getByText('pending', { exact: true })).toBeVisible({ timeout: 20_000 })
    await expect(panel.getByText('Waiting for review', { exact: true }).first()).toBeVisible()
    await expect(panel.getByText('Run failed', { exact: true })).toHaveCount(0)
    await expect(panel.getByLabel('Agent message')).toBeDisabled()
    await expect(panel.getByRole('button', { name: 'Continue', exact: true })).toHaveCount(0)
    await expect.poll(() => requestBodies.length).toBe(3)
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
    for (const targetWidth of [360, 384, 448, 480, 640, 360]) {
      const currentPanelBounds = await panel.boundingBox()
      const currentHandleBounds = await resizeHandle.boundingBox()
      if (currentPanelBounds === null || currentHandleBounds === null)
        throw new Error('Resizable Agent bounds missing')
      await launched.page.mouse.move(
        currentHandleBounds.x + currentHandleBounds.width / 2,
        currentHandleBounds.y + currentHandleBounds.height / 2
      )
      await launched.page.mouse.down()
      await launched.page.mouse.move(
        currentHandleBounds.x + currentPanelBounds.width - targetWidth,
        currentHandleBounds.y + currentHandleBounds.height / 2
      )
      await launched.page.mouse.up()
      await expect
        .poll(async () => Math.abs(((await panel.boundingBox())?.width ?? 0) - targetWidth))
        .toBeLessThan(12)
      for (const region of [
        panel,
        panel.getByTestId('agent-conversation-header'),
        panel.getByTestId('agent-status'),
        panel.getByTestId('agent-proposal-bubble'),
        panel.getByTestId('agent-composer')
      ]) {
        await expect
          .poll(() => region.evaluate((element) => element.scrollWidth <= element.clientWidth))
          .toBe(true)
      }
      if (targetWidth === 384) {
        await launched.page.evaluate(() => document.documentElement.classList.add('dark'))
        await expect(panel).toBeVisible()
        await expect
          .poll(() => panel.evaluate((element) => element.scrollWidth <= element.clientWidth))
          .toBe(true)
        await launched.page.evaluate(() => document.documentElement.classList.remove('dark'))
      }
    }
    for (const name of ['Reject', 'Approve & Continue', 'Approve']) {
      const action = panel.getByRole('button', { name, exact: true })
      await expect(action).toBeVisible()
      await expect(action).toBeEnabled()
    }
    const rejectAction = panel.getByRole('button', { name: 'Reject', exact: true })
    await rejectAction.focus()
    await expect(rejectAction).toBeFocused()
    await launched.page.keyboard.press('Tab')
    await expect(
      panel.getByRole('button', { name: 'Approve & Continue', exact: true })
    ).toBeFocused()
    await launched.page.keyboard.press('Tab')
    await expect(panel.getByRole('button', { name: 'Approve', exact: true })).toBeFocused()
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
    await panel.getByRole('button', { name: 'Approve & Continue', exact: true }).click()
    await expect(panel.getByText('applied', { exact: true })).toBeVisible()
    await expect(
      panel.getByText('I found evidence and prepared a reviewable proposal.', { exact: true })
    ).toBeVisible()
    await expect(
      panel.locator('strong').getByText('evidence', { exact: true }).first()
    ).toBeVisible()
    await expect(editor).toContainText('Grounded revision from Agent.')

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
      const proposal = proposals[0]
      if (proposal === undefined) throw new Error('Agent proposal missing')
      const loaded = await window.desktop.editor.loadSection({
        projectSessionId,
        sectionId: expectedSectionId
      })
      return {
        agentSessionId: session.agentSessionId,
        proposal,
        revision: loaded.revision
      }
    }, sectionId)
    expect(appliedTruth.proposal.status).toBe('applied')
    expect(appliedTruth.proposal.payload.preview.citedSources).toHaveLength(1)
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

    await panel.getByRole('radio', { name: 'Project', exact: true }).click()
    await panel.getByLabel('Agent message').fill('Update the manuscript brief purpose.')
    await panel.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(panel.getByText('pending', { exact: true })).toBeVisible()
    await panel.getByRole('button', { name: 'Approve', exact: true }).click()
    await expect(panel.getByText('applied', { exact: true }).last()).toBeVisible()
    await panel.getByRole('button', { name: 'Close writing agent', exact: true }).click()
    await launched.page.getByRole('button', { name: 'Brief', exact: true }).click()
    const refreshedBrief = launched.page.getByRole('dialog', { name: 'Manuscript brief' })
    await expect(refreshedBrief.getByLabel('Purpose')).toHaveValue(
      'Updated by Agent and refreshed immediately.'
    )
    await refreshedBrief.getByRole('button', { name: 'Close', exact: true }).first().click()

    await launched.page.getByRole('button', { name: 'Agent', exact: true }).click()
    await expect(panel.getByTestId('agent-session-list')).toBeVisible()
    await panel.getByRole('button', { name: /Conversation 1/ }).click()
    await panel.getByLabel('Agent message').fill('Add the requested outline section.')
    await panel.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(panel.getByText('pending', { exact: true })).toBeVisible()
    await panel.getByRole('button', { name: 'Approve', exact: true }).click()
    await expect(panel.getByText('applied', { exact: true }).last()).toBeVisible()
    await panel.getByRole('button', { name: 'Close writing agent', exact: true }).click()
    await expect(
      launched.page.getByText('Agent-created outline section', { exact: true })
    ).toBeVisible()

    await launched.page.getByRole('button', { name: 'Agent', exact: true }).click()
    await expect(panel.getByTestId('agent-session-list')).toBeVisible()
    await panel.getByRole('button', { name: /Conversation 1/ }).click()
    await expect(panel.getByText('applied', { exact: true }).first()).toBeVisible()
    await expect(
      panel.getByText('I found evidence and prepared a reviewable proposal.', { exact: true })
    ).toBeVisible()
    await panel.getByRole('button', { name: 'Close writing agent', exact: true }).click()

    await closeProject(launched.page)
    await launched.page.getByRole('button', { name: `Open ${projectName}`, exact: true }).click()
    await expectActiveProject(launched.page, projectName)
    await launched.page.getByRole('button', { name: 'Agent', exact: true }).click()
    await expect(panel.getByTestId('agent-session-list')).toBeVisible()
    await panel.getByRole('button', { name: /Conversation 1/ }).click()
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
        proposal: proposals[0]
      }
    }, appliedTruth.agentSessionId)
    expect(reopenedTruth.sessionIds).toContain(appliedTruth.agentSessionId)
    expect(reopenedTruth.proposal?.status).toBe('applied')

    await panel.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(panel.getByText('undone', { exact: true })).toBeVisible()
    await expect(launched.page.locator('.bn-editor').first()).not.toContainText(
      'Grounded revision from Agent.'
    )
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
      return { proposal: proposals[0], revision: loaded.revision }
    }, sectionId)
    expect(undoneTruth.proposal?.status).toBe('undone')
    expect(undoneTruth.revision).toMatchObject({
      sectionRevisionId: undoneTruth.proposal?.undoRevisionId,
      source: 'undo',
      agentRunId: null,
      agentToolCallId: null,
      agentProposalId: null
    })

    await panel.getByLabel('Agent message').fill('Prepare a reviewable image for this section.')
    await panel.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(panel.getByText('pending', { exact: true }).last()).toBeVisible()
    await expect(panel.getByText('Waiting for review', { exact: true }).first()).toBeVisible()
    await expect(panel.getByLabel('Agent message')).toBeDisabled()
    await expect.poll(() => requestBodies.length).toBe(7)
    const imageWaitingTruth = await launched.page.evaluate(async () => {
      const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
        ?.projectSessionId
      if (projectSessionId === undefined) throw new Error('Project session missing')
      const session = (await window.desktop.agent.listSessions({ projectSessionId }))[0]
      if (session === undefined) throw new Error('Agent session missing')
      const proposals = await window.desktop.agent.listProposals({
        projectSessionId,
        agentSessionId: session.agentSessionId
      })
      const runs = await window.desktop.agent.listRuns({
        projectSessionId,
        agentSessionId: session.agentSessionId
      })
      return {
        workflowState: session.workflowState,
        image: proposals.find((proposal) => proposal.kind === 'generated_image_insert'),
        run: runs[0]
      }
    })
    expect(imageWaitingTruth.workflowState).toBe('awaiting_review')
    expect(imageWaitingTruth.image?.status).toBe('pending')
    expect(imageWaitingTruth.run).toMatchObject({ status: 'completed', errorCode: null })
    await panel.getByRole('button', { name: 'Reject', exact: true }).last().click()
    await expect(panel.getByText('rejected', { exact: true })).toBeVisible()
    await expect(panel.getByLabel('Agent message')).toBeEnabled()

    await panel.getByLabel('Agent message').fill('Start a response that I can stop.')
    await panel.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(panel.getByText(/Working ·/).first()).toBeVisible()
    await expect(panel.getByText('This response will be stopped.', { exact: true })).toBeVisible()
    await panel.getByRole('button', { name: 'Stop', exact: true }).click()
    await expect(panel.getByText(/Stopped by user|Run interrupted/)).toBeVisible()
    await expect(panel.getByText('Idle', { exact: true })).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    await expect(panel.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled()
    await expect(panel.getByText('Agent action failed', { exact: true })).toHaveCount(0)
    await panel.getByRole('button', { name: 'Close writing agent', exact: true }).click()
    await launched.page.getByRole('button', { name: 'Agent', exact: true }).click()
    await expect(panel.getByTestId('agent-session-list')).toBeVisible()
    await panel.getByRole('button', { name: /Conversation 1/ }).click()
    await expect(panel.getByText(/Stopped by user|Run interrupted/)).toBeVisible()
    const interruptedRuns = await launched.page.evaluate(async () => {
      const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
        ?.projectSessionId
      if (projectSessionId === undefined) throw new Error('Project session missing')
      const session = (await window.desktop.agent.listSessions({ projectSessionId }))[0]
      if (session === undefined) throw new Error('Agent session missing')
      return window.desktop.agent.listRuns({
        projectSessionId,
        agentSessionId: session.agentSessionId
      })
    })
    expect(interruptedRuns[0]?.status).toBe('interrupted')
    await panel.getByRole('button', { name: 'Close writing agent', exact: true }).click()
    await browserWindow.evaluate((window) => {
      window.unmaximize()
      window.setContentSize(1280, 700)
    })
    await expect.poll(() => launched.page.evaluate(() => window.innerWidth)).toBe(1280)
    await expect
      .poll(() => launched.page.evaluate(() => window.matchMedia('(min-width: 1280px)').matches))
      .toBe(true)
    await expect(agentTrigger).toHaveAttribute('aria-pressed', 'false')
    await launched.page.getByRole('button', { name: 'Agent', exact: true }).click()
    await expect(agentTrigger).toHaveAttribute('aria-pressed', 'true')
    await expect(panel).toBeVisible()
    await expect(launched.page.getByRole('separator').last()).toBeVisible()
    await expect(launched.page.locator('.bn-editor').first()).toBeVisible()
    await panel.getByRole('button', { name: 'Close writing agent', exact: true }).click()
    await browserWindow.evaluate((window) => window.setContentSize(1279, 700))
    await expect.poll(() => launched.page.evaluate(() => window.innerWidth)).toBeLessThan(1280)
    await expect
      .poll(() => launched.page.evaluate(() => window.matchMedia('(min-width: 1280px)').matches))
      .toBe(false)
    await launched.page.getByRole('button', { name: 'Agent', exact: true }).click()
    await expect(panel).toBeVisible()
    await expect(launched.page.getByTestId('agent-panel-resize-handle')).toBeHidden()
    await expect(launched.page.locator('.bn-editor').first()).not.toBeVisible()
    await panel.getByRole('button', { name: 'Close writing agent', exact: true }).click()
    await browserWindow.evaluate((window) => {
      window.unmaximize()
      window.setContentSize(900, 670)
    })
    await expect.poll(() => launched.page.evaluate(() => window.innerWidth)).toBeLessThan(1280)
    await launched.page.getByRole('button', { name: 'Agent', exact: true }).click()
    await expect(panel.getByTestId('agent-session-list')).toBeVisible()
    await expect(launched.page.locator('.bn-editor').first()).not.toBeVisible()
    await panel.getByRole('button', { name: 'Close writing agent', exact: true }).click()
    await expect(launched.page.locator('.bn-editor').first()).toBeVisible()
    expect(requestBodies).toHaveLength(8)
    expect(JSON.stringify(requestBodies)).not.toContain('e2e-secret')
  } finally {
    await launched.app.close()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    )
  }
})
