import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, expectActiveProject, launchApp, scenario, test } from './fixtures'

async function configureAgentProvider(page: Page, baseUrl: string): Promise<void> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await settings.getByRole('option', { name: /^Agent API/ }).click()
  await settings.getByRole('button', { name: 'Add provider' }).click()
  const addProvider = page.getByRole('dialog', { name: 'Add provider' })
  await addProvider.getByLabel('Provider name').fill('CP50 Agent')
  await addProvider.getByRole('button', { name: 'Continue' }).click()
  await settings.getByLabel('Base URL').fill(baseUrl)
  await settings.getByLabel('API key').fill('cp50-e2e-secret')
  await settings.getByRole('button', { name: 'Save provider' }).click()
  await settings.getByRole('button', { name: 'Fetch CP50 Agent models' }).click()
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

function sendToolCall(
  response: ServerResponse,
  input: { responseId: string; toolCallId: string; name: string; args: unknown }
): void {
  sendSse(response, [
    {
      id: input.responseId,
      object: 'chat.completion.chunk',
      created: 1,
      model: 'cp50-model-resolved',
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
      model: 'cp50-model-resolved',
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
    }
  ])
}

function sendCompletion(response: ServerResponse, text: string): void {
  sendSse(response, [
    {
      id: 'cp50-completion',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'cp50-model-resolved',
      choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }]
    },
    {
      id: 'cp50-completion',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'cp50-model-resolved',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 }
    }
  ])
}

function sendSse(response: ServerResponse, chunks: unknown[]): void {
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    'x-request-id': 'cp50-e2e-request'
  })
  for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`)
  response.end('data: [DONE]\n\n')
}

test(
  'keeps a Brief-and-outline request out of section mutation after approval and diagnostics',
  scenario('agent.cp50-scope-and-preflight', ['@packaged']),
  async ({ testRoot }) => {
    let agentCall = 0
    const providerBodies: unknown[] = []
    const server = createServer((request, response) => {
      if (request.method === 'GET' && request.url === '/v1/models') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end('{"data":[{"id":"cp50-model","displayName":"CP50 model"}]}')
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
        const body = JSON.parse(Buffer.concat(chunks).toString()) as unknown
        const bodyText = JSON.stringify(body)
        if (bodyText.includes('Create a concise title for the delimited')) {
          sendCompletion(response, 'Scoped Brief and outline')
          return
        }
        providerBodies.push(body)
        agentCall += 1
        if (agentCall === 1) {
          sendToolCall(response, {
            responseId: 'cp50-brief-response',
            toolCallId: 'cp50-brief-tool',
            name: 'submit_brief_change',
            args: { changes: { title: 'Scoped architecture brief' } }
          })
          return
        }
        if (agentCall === 2) {
          sendToolCall(response, {
            responseId: 'cp50-outline-response',
            toolCallId: 'cp50-outline-tool',
            name: 'submit_outline_change',
            args: {
              operations: [
                {
                  type: 'createSection',
                  clientRef: 'cp50-conclusion',
                  parent: null,
                  placement: { kind: 'last' },
                  title: 'Conclusion',
                  objective: null,
                  status: 'planned'
                }
              ]
            }
          })
          return
        }
        if (agentCall === 3) {
          sendToolCall(response, {
            responseId: 'cp50-check-response',
            toolCallId: 'cp50-check-tool',
            name: 'check_draft',
            args: { scope: { type: 'manuscript' }, checks: ['empty_sections'] }
          })
          return
        }
        sendCompletion(
          response,
          'The requested Brief and outline changes are applied. No section prose was added.'
        )
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const port = (server.address() as AddressInfo).port
    const projectName = 'CP50 scoped workflow'
    const launched = await launchApp({
      userData: join(testRoot, 'user-data'),
      dialogPaths: [testRoot]
    })
    try {
      await configureAgentProvider(launched.page, `http://127.0.0.1:${port}/v1`)
      await createProject(launched.page, projectName)
      await launched.page.getByRole('button', { name: 'Agent', exact: true }).click()
      const panel = launched.page.getByTestId('agent-panel')
      await panel.getByTestId('agent-conversation-menu').click()
      await launched.page.getByRole('menuitem', { name: 'Details', exact: true }).click()
      const details = launched.page.getByRole('dialog', { name: 'Agent details' })
      await details.getByLabel('Agent model').click()
      const modelPicker = launched.page.getByTestId('agent-model-picker')
      await modelPicker.getByRole('option', { name: /CP50 Agent/ }).click()
      await modelPicker.getByRole('option', { name: /CP50 model/ }).click()
      await launched.page.keyboard.press('Escape')

      await panel
        .getByLabel('Agent message')
        .fill('Update only the manuscript Brief and outline. Do not draft or edit section bodies.')
      await panel.getByRole('button', { name: 'Send', exact: true }).click()
      await expect(panel.getByText('Review required', { exact: true })).toBeVisible()
      await expect(panel.getByTestId('brief-proposal-view')).toBeVisible()
      await panel.getByRole('button', { name: 'Apply & continue', exact: true }).click()
      await expect(panel.getByText('Review required', { exact: true }).last()).toBeVisible()
      await expect.poll(() => agentCall).toBeGreaterThanOrEqual(2)
      await expect(panel.getByTestId('outline-proposal-view')).toBeVisible()
      await panel.getByRole('button', { name: 'Apply & continue', exact: true }).click()
      await expect(
        panel.getByText(
          'The requested Brief and outline changes are applied. No section prose was added.',
          { exact: true }
        )
      ).toBeVisible({ timeout: 20_000 })

      const truth = await launched.page.evaluate(async () => {
        const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
          ?.projectSessionId
        if (projectSessionId === undefined) throw new Error('Project session missing')
        const session = (await window.desktop.agent.listSessions({ projectSessionId }))[0]
        if (session === undefined) throw new Error('Agent session missing')
        const events = (
          await window.desktop.agent.listEvents({
            projectSessionId,
            agentSessionId: session.agentSessionId
          })
        ).events
        return {
          workflowState: session.workflowState,
          preflightFailures: events.filter((event) => event.type === 'tool_preflight_failed'),
          calls: events
            .filter((event) => event.type === 'tool_call')
            .map((event) => ({
              toolName: event.payload.toolName,
              contractVersion: event.payload.contractVersion
            }))
        }
      })
      expect(truth.workflowState).toBe('idle')
      expect(truth.preflightFailures).toEqual([])
      expect(truth.calls).toEqual([
        { toolName: 'submit_brief_change', contractVersion: 9 },
        { toolName: 'submit_outline_change', contractVersion: 9 },
        { toolName: 'check_draft', contractVersion: 9 }
      ])
      expect(truth.calls.some((call) => call.toolName === 'submit_section_change')).toBe(false)
      expect(JSON.stringify(providerBodies)).not.toContain('cp50-e2e-secret')
    } finally {
      await launched.app.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
)
