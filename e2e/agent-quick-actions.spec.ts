import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { expect, expectActiveProject, launchApp, scenario, sectionEditor, test } from './fixtures'

test(
  'runs an exact selection quick action through the normal Agent conversation',
  scenario('agent.selection-quick-actions'),
  async ({ testRoot }) => {
    const agentRequests: unknown[] = []
    const server = createServer((request, response) => {
      if (request.method === 'GET' && request.url === '/v1/models') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end('{"data":[{"id":"quick-writer","displayName":"Quick Writer"}]}')
        return
      }
      if (request.method === 'POST' && request.url === '/v1/chat/completions') {
        const chunks: Buffer[] = []
        request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        request.on('end', () => {
          const body = JSON.parse(Buffer.concat(chunks).toString()) as {
            messages?: Array<{ role?: string; content?: unknown }>
          }
          if (JSON.stringify(body).includes('Create a concise title for the delimited')) {
            sendCompletion(response, 'Evidence review')
            return
          }
          agentRequests.push(body)
          sendCompletion(
            response,
            'The selected claim is clear but has no linked project evidence. Review completed; no manuscript change is proposed.'
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
    const launched = await launchApp({
      userData: join(testRoot, 'user-data'),
      dialogPaths: [testRoot]
    })
    try {
      await configureAgentProvider(launched.page, `http://127.0.0.1:${port}/v1`)
      await createProject(launched.page, 'Quick action project')
      await launched.page.getByLabel('Section title').fill('Evidence notes')
      await launched.page.getByLabel('Section title').press('Tab')
      const editor = sectionEditor(launched.page)
      await editor.fill('This exact claim needs evidence.')
      await launched.page.keyboard.press('ControlOrMeta+s')

      await launched.page.getByTestId('agent-menubar-trigger').click()
      const panel = launched.page.getByTestId('agent-panel')
      await panel.getByTestId('agent-conversation-menu').click()
      await launched.page.getByRole('menuitem', { name: 'Details', exact: true }).click()
      const details = launched.page.getByRole('dialog', { name: 'Agent details' })
      await details.getByLabel('Agent model').click()
      const modelPicker = launched.page.getByTestId('agent-model-picker')
      await modelPicker.getByRole('option', { name: /Quick action Agent/ }).click()
      await modelPicker.getByRole('option', { name: /Quick Writer/ }).click()
      await details.getByRole('button', { name: 'Close', exact: true }).click()
      await panel.getByRole('button', { name: 'Close writing agent' }).click()

      await editor.click()
      await editor.selectText()
      await expect(
        launched.page.getByRole('button', { name: 'Open Agent quick actions' })
      ).toBeVisible()
      await launched.page.keyboard.press('ControlOrMeta+Shift+k')
      await expect(
        launched.page.getByRole('menu', { name: 'Open Agent quick actions' })
      ).toBeVisible()
      await launched.page.getByRole('menuitem', { name: /Check evidence/ }).dispatchEvent('click')

      await expect(panel).toBeVisible()
      await expect(panel.getByText('Quick action · Check evidence', { exact: true })).toBeVisible()
      await expect(panel.getByText('Captured selection', { exact: true })).toBeVisible()
      await expect(
        panel.getByText('This exact claim needs evidence.', { exact: true })
      ).toBeVisible()
      await expect(
        panel.getByText(
          'The selected claim is clear but has no linked project evidence. Review completed; no manuscript change is proposed.',
          { exact: true }
        )
      ).toBeVisible()
      await expect(panel.getByTestId('agent-status')).toContainText('Ready')
      await expect(panel.getByRole('button', { name: /Apply/ })).toHaveCount(0)

      const truth = await launched.page.evaluate(async () => {
        const project = (await window.desktop.projects.lifecycle()).activeProject
        if (project === undefined) throw new Error('Project is not open')
        const session = (
          await window.desktop.agent.listSessions({ projectSessionId: project.projectSessionId })
        )[0]
        if (session === undefined) throw new Error('Agent session is missing')
        const runs = await window.desktop.agent.listRuns({
          projectSessionId: project.projectSessionId,
          agentSessionId: session.agentSessionId
        })
        const proposals = await window.desktop.agent.listProposals({
          projectSessionId: project.projectSessionId,
          agentSessionId: session.agentSessionId
        })
        return { session, runs, proposals }
      })
      expect(truth.runs[0]?.editorContext).toMatchObject({
        selectedText: 'This exact claim needs evidence.',
        selectedBlockIds: expect.arrayContaining([expect.any(String)])
      })
      expect(truth.proposals).toEqual([])
      expect(agentRequests).toHaveLength(1)
      const requestText = JSON.stringify(agentRequests[0])
      expect(requestText).toContain('QUICK_ACTION_SELECTION')
      expect(requestText).toContain('This exact claim needs evidence.')
      expect(requestText).toContain('review-only response with no proposal is a successful outcome')
    } finally {
      await launched.app.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
)

function sendCompletion(response: ServerResponse, content: string): void {
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache'
  })
  const chunks = [
    {
      id: 'quick-action-response',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'quick-writer',
      choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }]
    },
    {
      id: 'quick-action-response',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'quick-writer',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 20, completion_tokens: 12, total_tokens: 32 }
    }
  ]
  for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`)
  response.end('data: [DONE]\n\n')
}

async function configureAgentProvider(
  page: import('@playwright/test').Page,
  baseUrl: string
): Promise<void> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await settings.getByRole('option', { name: /^Agent API/ }).click()
  await settings.getByRole('button', { name: 'Add provider' }).click()
  const addProvider = page.getByRole('dialog', { name: 'Add provider' })
  await addProvider.getByLabel('Provider name').fill('Quick action Agent')
  await addProvider.getByRole('button', { name: 'Continue' }).click()
  await settings.getByLabel('Base URL').fill(baseUrl)
  await settings.getByLabel('API key').fill('e2e-secret')
  await settings.getByRole('button', { name: 'Save provider' }).click()
  await settings.getByRole('button', { name: 'Fetch Quick action Agent models' }).click()
  await expect(settings.getByText(/1 models · current/)).toBeVisible()
  await page.keyboard.press('Escape')
}

async function createProject(page: import('@playwright/test').Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Create project', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create project' })
  await dialog.getByLabel('Project name').fill(name)
  await dialog.getByRole('button', { name: 'Choose location' }).click()
  await expectActiveProject(page, name)
}
