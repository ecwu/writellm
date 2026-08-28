import { readFile } from 'node:fs/promises'
import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { expect, expectActiveProject, launchApp, scenario, sectionEditor, test } from './fixtures'

async function configureAgentProvider(page: Page, baseUrl: string): Promise<void> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await settings.getByRole('option', { name: /^Agent API/ }).click()
  await settings.getByRole('button', { name: 'Add provider' }).click()
  const addProvider = page.getByRole('dialog', { name: 'Add provider' })
  await addProvider.getByLabel('Provider name').fill('Table Agent')
  await addProvider.getByRole('button', { name: 'Continue' }).click()
  await settings.getByLabel('Base URL').fill(baseUrl)
  await settings.getByLabel('API key').fill('table-e2e-secret')
  await settings.getByRole('button', { name: 'Save provider' }).click()
  await settings.getByRole('button', { name: 'Fetch Table Agent models' }).click()
  await expect(settings.getByText(/1 models · current/)).toBeVisible()
  await page.keyboard.press('Escape')
}

async function createProject(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Create project', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create project' })
  await dialog.getByLabel('Project name').fill(name)
  await dialog.getByRole('button', { name: 'Choose location' }).click()
  await expectActiveProject(page, name)
}

async function openAgentForSection(page: Page): Promise<ReturnType<Page['getByTestId']>> {
  await page.getByTestId('agent-menubar-trigger').click()
  const panel = page.getByTestId('agent-panel')
  if (await panel.getByRole('button', { name: 'Set up an Agent model' }).isVisible()) {
    await panel.getByTestId('agent-conversation-menu').click()
    await page.getByRole('menuitem', { name: 'Details', exact: true }).click()
    const details = page.getByRole('dialog', { name: 'Agent details' })
    await details.getByLabel('Agent model').click()
    const picker = page.getByTestId('agent-model-picker')
    await picker.getByRole('option', { name: /Table Agent/ }).click()
    await picker.getByRole('option', { name: /Table E2E model/ }).click()
    await page.keyboard.press('Escape')
  }
  await panel.getByTestId('agent-add-menu-trigger').click()
  await page.getByRole('option', { name: /This section/ }).click()
  return panel
}

async function startNewConversation(page: Page): Promise<void> {
  const panel = page.getByTestId('agent-panel')
  await panel.getByTestId('agent-conversation-switcher').click()
  await page.getByRole('option', { name: 'New conversation', exact: true }).click()
  await panel.getByTestId('agent-add-menu-trigger').click()
  await page.getByRole('option', { name: /This section/ }).click()
}

async function applyOnly(
  page: Page,
  sectionId: string,
  expectedAppliedCount: number
): Promise<void> {
  const panel = page.getByTestId('agent-panel')
  await expect(panel.getByText('Review required', { exact: true })).toBeVisible()
  const revisionTruth = await page.evaluate(async (expectedSectionId) => {
    const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
      ?.projectSessionId
    if (projectSessionId === undefined) throw new Error('Project session missing')
    const sessions = await window.desktop.agent.listSessions({ projectSessionId })
    const proposals = (
      await Promise.all(
        sessions.map((session) =>
          window.desktop.agent.listProposals({
            projectSessionId,
            agentSessionId: session.agentSessionId
          })
        )
      )
    ).flat()
    const pending = proposals.find((proposal) => proposal.status === 'pending')
    const workspace = await window.desktop.manuscript.workspace({ projectSessionId })
    return {
      proposalBaseRevisionId:
        pending?.payload.kind === 'section_patch' ? pending.payload.mutation.baseRevisionId : null,
      currentRevisionId:
        workspace.sections.find((entry) => entry.section.sectionId === expectedSectionId)?.section
          .currentRevisionId ?? null
    }
  }, sectionId)
  expect(revisionTruth.proposalBaseRevisionId).toBe(revisionTruth.currentRevisionId)
  await panel.getByRole('button', { name: 'More review actions' }).click()
  await page.getByRole('menuitem', { name: 'Apply only', exact: true }).click()
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
          ?.projectSessionId
        if (projectSessionId === undefined) return 0
        const sessions = await window.desktop.agent.listSessions({ projectSessionId })
        const proposals = await Promise.all(
          sessions.map((session) =>
            window.desktop.agent.listProposals({
              projectSessionId,
              agentSessionId: session.agentSessionId
            })
          )
        )
        return proposals.flat().filter((proposal) => proposal.status === 'applied').length
      })
    )
    .toBe(expectedAppliedCount)
}

async function waitForStableSectionRevision(page: Page, sectionId: string): Promise<void> {
  let priorRevisionId = ''
  let stableReads = 0
  await expect
    .poll(
      async () => {
        const revisionId = await page.evaluate(async (expectedSectionId) => {
          const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
            ?.projectSessionId
          if (projectSessionId === undefined) return ''
          return (
            await window.desktop.editor.loadSection({
              projectSessionId,
              sectionId: expectedSectionId
            })
          ).revision.sectionRevisionId
        }, sectionId)
        stableReads = revisionId !== '' && revisionId === priorRevisionId ? stableReads + 1 : 0
        priorRevisionId = revisionId
        return stableReads
      },
      { intervals: [250, 250, 250, 250, 250] }
    )
    .toBeGreaterThanOrEqual(2)
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
      model: 'table-e2e-model',
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
      model: 'table-e2e-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 }
    }
  ])
}

function sendCompletion(response: ServerResponse, text: string): void {
  sendSse(response, [
    {
      id: 'table-e2e-completion',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'table-e2e-model',
      choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }]
    },
    {
      id: 'table-e2e-completion',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'table-e2e-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 }
    }
  ])
}

function sendSse(response: ServerResponse, chunks: unknown[]): void {
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    'x-request-id': 'table-e2e-request'
  })
  for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`)
  response.end('data: [DONE]\n\n')
}

function tableHash(bodyText: string, blockId: string): string {
  const escaped = blockId.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const normalized = bodyText.replaceAll('\\', '')
  const match = normalized.match(
    new RegExp(`"blockId"\\s*:\\s*"${escaped}"\\s*,\\s*"blockHash"\\s*:\\s*"([a-f0-9]{64})"`, 'u')
  )
  if (match?.[1] === undefined) throw new Error('Table read hash missing from Agent continuation')
  return match[1]
}

test(
  'creates, edits, reopens, exports, and safely conflicts an Agent-authored table',
  scenario('agent.table-authoring-publication', ['@packaged']),
  async ({ testRoot }) => {
    const projectName = 'Agent table E2E'
    const projectRoot = join(testRoot, `${projectName}.writellm`)
    const markdownExport = join(testRoot, 'Table Markdown')
    const pdfExport = join(testRoot, 'Table PDF')
    const latexExport = join(testRoot, 'Table LaTeX')
    let sectionId = ''
    let tableBlockId = ''
    let agentCall = 0
    const server = createServer((request, response) => {
      if (request.method === 'GET' && request.url === '/v1/models') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end('{"data":[{"id":"table-e2e-model","displayName":"Table E2E model"}]}')
        return
      }
      if (request.method !== 'POST' || !request.url?.endsWith('/chat/completions')) {
        response.writeHead(404)
        response.end()
        return
      }
      const chunks: Buffer[] = []
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      request.on('end', () => {
        const bodyText = Buffer.concat(chunks).toString()
        if (bodyText.includes('Create a concise title for the delimited')) {
          sendCompletion(response, 'Agent table update')
          return
        }
        agentCall += 1
        if (agentCall === 1) {
          sendToolCall(response, {
            responseId: 'table-read-section',
            toolCallId: 'table-read-section-tool',
            name: 'read_section',
            args: { sectionId, view: 'summary', limit: 20 }
          })
          return
        }
        if (agentCall === 2) {
          sendToolCall(response, {
            responseId: 'table-insert',
            toolCallId: 'table-insert-tool',
            name: 'submit_section_change',
            args: {
              sectionId,
              operations: [
                {
                  type: 'insertTable',
                  anchor: null,
                  placement: 'end',
                  table: {
                    clientRef: 'metrics-table',
                    headerRows: 1,
                    headerCols: 1,
                    rows: [
                      [
                        'Metric',
                        {
                          content: [{ type: 'text', text: 'Value', styles: {} }],
                          textAlignment: 'right'
                        }
                      ],
                      ['Accuracy', '0.91']
                    ]
                  }
                }
              ],
              citationIds: []
            }
          })
          return
        }
        if (agentCall === 3 || agentCall === 5) {
          sendToolCall(response, {
            responseId: `table-read-${agentCall}`,
            toolCallId: `table-read-tool-${agentCall}`,
            name: 'read_section',
            args: { sectionId, view: 'table', blockId: tableBlockId, rowOffset: 0, rowLimit: 20 }
          })
          return
        }
        if (agentCall === 4) {
          sendToolCall(response, {
            responseId: 'table-edit',
            toolCallId: 'table-edit-tool',
            name: 'submit_section_change',
            args: {
              sectionId,
              operations: [
                {
                  type: 'editTable',
                  target: {
                    blockId: tableBlockId,
                    expectedBlockHash: tableHash(bodyText, tableBlockId)
                  },
                  operations: [
                    { type: 'setCell', row: 1, column: 1, cell: '0.95' },
                    { type: 'insertRows', index: 2, rows: [['Latency', '12 ms']] },
                    { type: 'setColumnAlignment', column: 1, textAlignment: 'right' }
                  ]
                }
              ],
              citationIds: []
            }
          })
          return
        }
        if (agentCall === 6) {
          sendToolCall(response, {
            responseId: 'table-stale-edit',
            toolCallId: 'table-stale-edit-tool',
            name: 'submit_section_change',
            args: {
              sectionId,
              operations: [
                {
                  type: 'editTable',
                  target: {
                    blockId: tableBlockId,
                    expectedBlockHash: tableHash(bodyText, tableBlockId)
                  },
                  operations: [{ type: 'setCell', row: 1, column: 1, cell: '0.99' }]
                }
              ],
              citationIds: []
            }
          })
          return
        }
        response.writeHead(500, { 'content-type': 'application/json' })
        response.end('{"error":{"message":"Unexpected table Agent request"}}')
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const port = (server.address() as AddressInfo).port
    const launched = await launchApp({
      userData: join(testRoot, 'user-data'),
      dialogPaths: [testRoot, projectRoot, markdownExport, pdfExport, latexExport]
    })
    try {
      await configureAgentProvider(launched.page, `http://127.0.0.1:${port}/v1`)
      await createProject(launched.page, projectName)
      sectionId = await launched.page.evaluate(async () => {
        const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
          ?.projectSessionId
        if (projectSessionId === undefined) throw new Error('Project session missing')
        const workspace = await window.desktop.manuscript.workspace({ projectSessionId })
        const section = workspace.sections[0]
        if (section === undefined) throw new Error('Section missing')
        const saved = await window.desktop.editor.saveSectionDocument({
          projectSessionId,
          sectionId: section.section.sectionId,
          baseRevisionId: section.revision.sectionRevisionId,
          baseContentHash: section.revision.contentHash,
          document: [
            {
              id: 'table-baseline',
              type: 'paragraph',
              props: {
                backgroundColor: 'default',
                textColor: 'default',
                textAlignment: 'left'
              },
              content: [{ type: 'text', text: 'Table baseline.', styles: {} }],
              children: []
            }
          ]
        })
        if (!saved.ok) throw new Error('Initial table section save conflicted')
        return section.section.sectionId
      })
      await launched.page.reload()
      await expectActiveProject(launched.page, projectName)
      await expect(sectionEditor(launched.page)).toContainText('Table baseline.')

      const panel = await openAgentForSection(launched.page)
      await panel.getByLabel('Agent message').fill('Create a compact metrics table.')
      await panel.getByRole('button', { name: 'Send', exact: true }).click()
      await expect(panel.getByTestId('table-diff-view')).toContainText('0×0 → 2×2')
      await applyOnly(launched.page, sectionId, 1)
      await waitForStableSectionRevision(launched.page, sectionId)
      await expect
        .poll(() =>
          launched.page.evaluate(async (expectedSectionId) => {
            const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
              ?.projectSessionId
            if (projectSessionId === undefined) return null
            const loaded = await window.desktop.editor.loadSection({
              projectSessionId,
              sectionId: expectedSectionId
            })
            return loaded.revision.content.find((block) => block.type === 'table')?.id ?? null
          }, sectionId)
        )
        .not.toBeNull()
      tableBlockId = await launched.page.evaluate(async (expectedSectionId) => {
        const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
          ?.projectSessionId
        if (projectSessionId === undefined) throw new Error('Project session missing')
        const loaded = await window.desktop.editor.loadSection({
          projectSessionId,
          sectionId: expectedSectionId
        })
        const table = loaded.revision.content.find((block) => block.type === 'table')
        if (table === undefined) throw new Error('Agent table missing')
        return table.id
      }, sectionId)
      await expect(sectionEditor(launched.page)).toContainText('Accuracy')

      await launched.page.reload()
      await expectActiveProject(launched.page, projectName)
      await expect(sectionEditor(launched.page)).toContainText('Accuracy')
      await launched.page.getByTestId('agent-menubar-trigger').click()
      await startNewConversation(launched.page)
      await panel.getByLabel('Agent message').fill('Update the score and add the latency row.')
      await panel.getByRole('button', { name: 'Send', exact: true }).click()
      await expect(panel.getByTestId('table-diff-view')).toContainText('2×2 → 3×2')
      await expect(panel.getByTestId('table-diff-view')).toContainText('12 ms')
      await applyOnly(launched.page, sectionId, 2)
      await waitForStableSectionRevision(launched.page, sectionId)
      await expect(sectionEditor(launched.page)).toContainText('0.95')
      await expect(sectionEditor(launched.page)).toContainText('Latency')

      await launched.page.reload()
      await expectActiveProject(launched.page, projectName)
      await expect(sectionEditor(launched.page)).toContainText('0.95')
      await launched.page.getByTestId('agent-menubar-trigger').click()
      await startNewConversation(launched.page)
      await panel.getByLabel('Agent message').fill('Change the accuracy once more.')
      await panel.getByRole('button', { name: 'Send', exact: true }).click()
      await expect(panel.getByTestId('table-diff-view')).toContainText('0.99')
      await launched.page.evaluate(
        async ({ expectedSectionId, expectedTableId }) => {
          const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
            ?.projectSessionId
          if (projectSessionId === undefined) throw new Error('Project session missing')
          const loaded = await window.desktop.editor.loadSection({
            projectSessionId,
            sectionId: expectedSectionId
          })
          const document = structuredClone(loaded.revision.content)
          const table = document.find((block) => block.id === expectedTableId)
          if (table?.type !== 'table') throw new Error('Manual table missing')
          const cell = table.content.rows[1]?.cells[1]
          if (cell === null || typeof cell !== 'object' || Array.isArray(cell)) {
            throw new Error('Manual table cell missing')
          }
          cell.content = [{ type: 'text', text: 'manual value', styles: {} }]
          const saved = await window.desktop.editor.saveSectionDocument({
            projectSessionId,
            sectionId: expectedSectionId,
            baseRevisionId: loaded.revision.sectionRevisionId,
            baseContentHash: loaded.revision.contentHash,
            document
          })
          if (!saved.ok) throw new Error('Concurrent manual table save conflicted')
        },
        { expectedSectionId: sectionId, expectedTableId: tableBlockId }
      )
      await launched.page.reload()
      await expectActiveProject(launched.page, projectName)
      await expect(sectionEditor(launched.page)).toContainText('manual value')
      await launched.page.getByTestId('agent-menubar-trigger').click()
      await expect(
        panel.getByRole('button', { name: 'Refresh proposal', exact: true })
      ).toBeVisible()
      await panel.getByRole('button', { name: 'Refresh proposal', exact: true }).click()
      await expect(panel.getByText('conflicted', { exact: true })).toBeVisible()

      await launched.page.getByRole('menuitem', { name: 'Project', exact: true }).click()
      await launched.page.getByRole('menuitem', { name: 'Close project', exact: true }).click()
      await launched.page.getByRole('button', { name: 'Open project', exact: true }).click()
      await expectActiveProject(launched.page, projectName)
      await expect(sectionEditor(launched.page)).toContainText('manual value')
      await expect(sectionEditor(launched.page)).toContainText('12 ms')

      const exportResults = await launched.page.evaluate(async () => {
        const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
          ?.projectSessionId
        if (projectSessionId === undefined) throw new Error('Project session missing')
        const results = []
        for (const kind of ['markdown', 'pdf', 'latex'] as const) {
          results.push(await window.desktop.projects.exportManuscript({ projectSessionId, kind }))
        }
        return results
      })
      expect(exportResults.every((result) => result.created)).toBe(true)
      await expect(readFile(join(markdownExport, 'manuscript.md'), 'utf8')).resolves.toContain(
        'manual value'
      )
      await expect(readFile(join(markdownExport, 'manuscript.md'), 'utf8')).resolves.toContain(
        '12 ms'
      )
      await expect(readFile(join(latexExport, 'manuscript.tex'), 'utf8')).resolves.toContain(
        'manual value'
      )
      const pdfBytes = await readFile(join(pdfExport, 'manuscript.pdf'))
      const pdfLoadingTask = getDocument({ data: new Uint8Array(pdfBytes) })
      const pdf = await pdfLoadingTask.promise
      const pdfText = (
        await Promise.all(
          Array.from({ length: pdf.numPages }, async (_, index) => {
            const page = await pdf.getPage(index + 1)
            const content = await page.getTextContent()
            return content.items.flatMap((item) => ('str' in item ? [item.str] : [])).join(' ')
          })
        )
      ).join(' ')
      expect(pdfText).toContain('manual value')
      expect(pdfText).toContain('12 ms')
      await pdfLoadingTask.destroy()
      expect(agentCall).toBe(6)
    } finally {
      await launched.app.close()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    }
  }
)
