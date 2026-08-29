import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, expectActiveProject, launchApp, scenario, test } from './fixtures'

test(
  'records semantic review issues through the ordinary Agent loop and manages them in Workbench',
  scenario('agent.review-workbench', ['@critical', '@packaged']),
  async ({ testRoot }) => {
    let agentCall = 0
    let sectionId = ''
    let revisionId = ''
    const agentRequests: unknown[] = []
    const server = createServer((request, response) => {
      if (request.method === 'GET' && request.url === '/v1/models') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end('{"data":[{"id":"review-model","displayName":"Review model"}]}')
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
            sendCompletion(response, 'Review opening section')
            return
          }
          agentRequests.push(body)
          agentCall += 1
          if (agentCall === 1) {
            sendToolCall(response, {
              responseId: 'review-activate-response',
              toolCallId: 'review-activate-call',
              name: 'activate_tool_groups',
              args: { groups: ['review'] }
            })
            return
          }
          if (agentCall === 2) {
            sendToolCall(response, {
              responseId: 'review-check-response',
              toolCallId: 'review-check-call',
              name: 'check_draft',
              args: {
                scope: { type: 'manuscript' },
                checks: ['empty_sections', 'writing_rules']
              }
            })
            return
          }
          if (agentCall === 3) {
            sendToolCall(response, {
              responseId: 'review-list-response',
              toolCallId: 'review-list-call',
              name: 'list_review_issues',
              args: {
                statuses: ['open', 'in_progress'],
                priorities: [],
                categories: [],
                limit: 100
              }
            })
            return
          }
          if (agentCall === 4) {
            sendToolCall(response, {
              responseId: 'review-record-response',
              toolCallId: 'review-record-call',
              name: 'record_review_issues',
              args: {
                issues: [
                  {
                    priority: 'P2',
                    category: 'structure',
                    title: 'Opening section needs a clear thesis',
                    description:
                      'The opening section is empty and does not establish the manuscript thesis.',
                    evidence: 'Direct observation of the current opening-section snapshot.',
                    citationIds: [],
                    sourceKind: 'semantic',
                    checkId: null,
                    anchor: { sectionId, revisionId, blockId: null }
                  }
                ]
              }
            })
            return
          }
          sendCompletion(response, 'Recorded one P2 review issue in the durable Problem Set.')
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
      await createProject(launched.page, 'Agent review project')
      ;({ sectionId, revisionId } = await launched.page.evaluate(async () => {
        const project = (await window.desktop.projects.lifecycle()).activeProject
        if (project === undefined) throw new Error('Project is not open')
        const workspace = await window.desktop.manuscript.workspace({
          projectSessionId: project.projectSessionId
        })
        const first = workspace.sections[0]
        if (first === undefined) throw new Error('Opening section is missing')
        return {
          sectionId: first.section.sectionId,
          revisionId: first.revision.sectionRevisionId
        }
      }))

      await launched.page.getByTestId('agent-menubar-trigger').click()
      const panel = launched.page.getByTestId('agent-panel')
      await panel.getByTestId('agent-conversation-menu').click()
      await launched.page.getByRole('menuitem', { name: 'Details', exact: true }).click()
      const details = launched.page.getByRole('dialog', { name: 'Agent details' })
      await details.getByLabel('Agent model').click()
      const modelPicker = launched.page.getByTestId('agent-model-picker')
      await modelPicker.getByRole('option', { name: /Review Agent/ }).click()
      await modelPicker.getByRole('option', { name: /Review model/ }).click()
      await details.getByRole('button', { name: 'Close', exact: true }).click()
      await panel
        .getByLabel('Agent message')
        .fill('Review the manuscript and record every actionable issue in the Problem Set.')
      await panel.getByRole('button', { name: 'Send', exact: true }).click()
      await expect(
        panel.getByText('Recorded one P2 review issue in the durable Problem Set.', { exact: true })
      ).toBeVisible({ timeout: 20_000 })
      await expect(panel.getByTestId('agent-status')).toContainText('Ready')
      expect(agentRequests).toHaveLength(5)
      expect(JSON.stringify(agentRequests[0])).toContain('REVIEW_POLICY')

      await panel.getByRole('button', { name: 'Close writing agent' }).click()
      await launched.page.getByRole('button', { name: /Review Center/u }).click()
      await launched.page.getByRole('tab', { name: 'Agent issues' }).click()
      const issues = launched.page.getByTestId('review-issues-panel')
      await expect(
        issues.getByText('Opening section needs a clear thesis', { exact: true }).first()
      ).toBeVisible()
      await issues
        .getByText('Opening section needs a clear thesis', { exact: true })
        .first()
        .click()
      const detailsRegion = issues.getByRole('region', { name: 'Issue details' })
      await expect(
        detailsRegion.getByText('Direct observation of the current opening-section snapshot.')
      ).toBeVisible()
      await detailsRegion.getByRole('button', { name: 'Go to location', exact: true }).click()
      await expect(launched.page.getByLabel('Section title')).toBeVisible()

      await launched.page.getByRole('button', { name: /Review Center/u }).click()
      await launched.page.getByRole('tab', { name: 'Agent issues' }).click()
      await issues
        .getByText('Opening section needs a clear thesis', { exact: true })
        .first()
        .click()
      await detailsRegion.getByRole('button', { name: 'Dismiss', exact: true }).click()
      await expect(detailsRegion.getByRole('button', { name: 'Reopen', exact: true })).toBeVisible()
      await detailsRegion.getByRole('button', { name: 'Reopen', exact: true }).click()
      await expect(
        detailsRegion.getByRole('button', { name: 'Dismiss', exact: true })
      ).toBeVisible()
      await expect(detailsRegion.getByText(/dismissed/u)).toBeVisible()
      await expect(detailsRegion.getByText(/reopened/u)).toBeVisible()

      const truth = await launched.page.evaluate(async () => {
        const project = (await window.desktop.projects.lifecycle()).activeProject
        if (project === undefined) throw new Error('Project is not open')
        const page = await window.desktop.review.listIssues({
          projectSessionId: project.projectSessionId,
          statuses: [],
          priorities: [],
          categories: [],
          limit: 100
        })
        const issue = page.issues[0]
        if (issue === undefined) throw new Error('Review issue is missing')
        const events = await window.desktop.review.issueEvents({
          projectSessionId: project.projectSessionId,
          issueId: issue.issueId
        })
        return { issue, events }
      })
      expect(truth.issue).toMatchObject({
        sourceKind: 'semantic',
        status: 'open',
        priority: 'P2',
        anchorStatus: 'current',
        sourceAgentSessionId: expect.any(String),
        sourceAgentRunId: expect.any(String)
      })
      expect(truth.events.map((event) => event.eventType)).toEqual(
        expect.arrayContaining(['created', 'dismissed', 'reopened'])
      )
    } finally {
      await launched.app.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
)

function sendToolCall(
  response: ServerResponse,
  input: { responseId: string; toolCallId: string; name: string; args: unknown }
): void {
  sendSse(response, [
    {
      id: input.responseId,
      object: 'chat.completion.chunk',
      created: 1,
      model: 'review-model',
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
      model: 'review-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 }
    }
  ])
}

function sendCompletion(response: ServerResponse, content: string): void {
  sendSse(response, [
    {
      id: 'review-final-response',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'review-model',
      choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }]
    },
    {
      id: 'review-final-response',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'review-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 24, completion_tokens: 10, total_tokens: 34 }
    }
  ])
}

function sendSse(response: ServerResponse, chunks: unknown[]): void {
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    'x-request-id': 'review-agent-e2e-request'
  })
  for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`)
  response.end('data: [DONE]\n\n')
}

async function configureAgentProvider(page: Page, baseUrl: string): Promise<void> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await settings.getByRole('option', { name: /^Agent API/ }).click()
  await settings.getByRole('button', { name: 'Add provider' }).click()
  const addProvider = page.getByRole('dialog', { name: 'Add provider' })
  await addProvider.getByLabel('Provider name').fill('Review Agent')
  await addProvider.getByRole('button', { name: 'Continue' }).click()
  await settings.getByLabel('Base URL').fill(baseUrl)
  await settings.getByLabel('API key').fill('e2e-secret')
  await settings.getByRole('button', { name: 'Save provider' }).click()
  await settings.getByRole('button', { name: 'Fetch Review Agent models' }).click()
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
