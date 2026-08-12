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
  await addProvider.getByLabel('Provider name').fill('Concurrent Agent')
  await addProvider.getByRole('button', { name: 'Continue' }).click()
  await settings.getByLabel('Base URL').fill(baseUrl)
  await settings.getByLabel('API key').fill('concurrency-secret')
  await settings.getByRole('button', { name: 'Save provider' }).click()
  await settings.getByRole('button', { name: 'Fetch Concurrent Agent models' }).click()
  await expect(settings.getByText(/1 models · current/)).toBeVisible()
  await page.keyboard.press('Escape')
}

async function createProject(page: Page, projectName: string): Promise<void> {
  await page.getByRole('button', { name: 'Create project', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create project' })
  await dialog.getByLabel('Project name').fill(projectName)
  await dialog.getByRole('button', { name: 'Choose location' }).click()
  await expectActiveProject(page, projectName)
}

function sendCompletion(response: ServerResponse, text: string, responseId: string): void {
  if (response.destroyed) return
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    'x-request-id': responseId
  })
  response.write(
    `data: ${JSON.stringify({
      id: responseId,
      object: 'chat.completion.chunk',
      created: 1,
      model: 'writer-model',
      choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }]
    })}\n\n`
  )
  response.write(
    `data: ${JSON.stringify({
      id: responseId,
      object: 'chat.completion.chunk',
      created: 1,
      model: 'writer-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 }
    })}\n\n`
  )
  response.end('data: [DONE]\n\n')
}

function sendToolCall(
  response: ServerResponse,
  input: { responseId: string; toolCallId: string; name: string; args: unknown; text?: string }
): void {
  if (response.destroyed) return
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    'x-request-id': input.responseId
  })
  response.write(
    `data: ${JSON.stringify({
      id: input.responseId,
      object: 'chat.completion.chunk',
      created: 1,
      model: 'writer-model',
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
    })}\n\n`
  )
  response.write(
    `data: ${JSON.stringify({
      id: input.responseId,
      object: 'chat.completion.chunk',
      created: 1,
      model: 'writer-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 }
    })}\n\n`
  )
  response.end('data: [DONE]\n\n')
}

test(
  'runs two Agent conversations concurrently and controls them independently',
  scenario('agent.multi-conversation-concurrency', ['@critical', '@packaged']),
  async ({ testRoot }) => {
    const pendingAgentResponses: ServerResponse[] = []
    let titleCount = 0
    let targetSectionId = ''
    const server = createServer((request, response) => {
      if (request.method === 'GET' && request.url === '/v1/models') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end('{"data":[{"id":"writer-model","displayName":"Writer model"}]}')
        return
      }
      if (request.method === 'POST' && request.url === '/v1/chat/completions') {
        const chunks: Buffer[] = []
        request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        request.on('end', () => {
          const body = Buffer.concat(chunks).toString()
          if (body.includes('Create a concise title for the delimited')) {
            titleCount += 1
            sendCompletion(response, `Parallel conversation ${titleCount}`, `title-${titleCount}`)
            return
          }
          pendingAgentResponses.push(response)
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
      await createProject(launched.page, 'Concurrent Agent project')
      await launched.page.getByLabel('Section title').fill('Current section')
      await launched.page.getByLabel('Section title').press('Tab')
      await launched.page.getByRole('button', { name: 'Edit outline', exact: true }).click()
      const outline = launched.page.getByRole('dialog', { name: 'Outline editor' })
      await outline.getByRole('button', { name: 'New section', exact: true }).click()
      const createSection = launched.page.getByRole('dialog', { name: 'Create section' })
      await createSection.getByLabel('Section title').fill('Background Agent target')
      await createSection.getByRole('button', { name: 'Create', exact: true }).click()
      await expect(createSection).not.toBeVisible()
      await outline.getByRole('button', { name: 'Done', exact: true }).click()
      await expect(outline).not.toBeVisible()
      targetSectionId = await launched.page.evaluate(async () => {
        const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
          ?.projectSessionId
        if (projectSessionId === undefined) throw new Error('Project session missing')
        const workspace = await window.desktop.manuscript.workspace({ projectSessionId })
        const target = workspace.sections.find(
          (item) => item.section.title === 'Background Agent target'
        )
        if (target === undefined) throw new Error('Background Agent target missing')
        return target.section.sectionId
      })
      await launched.page.getByRole('button', { name: 'Agent', exact: true }).click()
      const panel = launched.page.getByTestId('agent-panel')
      await panel.getByTestId('agent-conversation-menu').click()
      await launched.page.getByRole('menuitem', { name: 'Details', exact: true }).click()
      const details = launched.page.getByRole('dialog', { name: 'Agent details' })
      await details.getByLabel('Agent model').click()
      const modelPicker = launched.page.getByTestId('agent-model-picker')
      await modelPicker.getByRole('option', { name: /Concurrent Agent/ }).click()
      await modelPicker.getByRole('option', { name: /Writer model/ }).click()
      await launched.page.keyboard.press('Escape')

      await panel.getByLabel('Agent message').fill('Keep the first conversation running.')
      await panel.getByRole('button', { name: 'Send', exact: true }).click()
      await expect.poll(() => pendingAgentResponses.length).toBe(1)
      await expect(panel.getByTestId('agent-status')).toContainText(/Preparing|Loading|Writing/)

      await panel.getByTestId('agent-conversation-switcher').click()
      await launched.page.getByRole('option', { name: 'New conversation', exact: true }).click()
      await panel.getByLabel('Agent message').fill('Run the second conversation independently.')
      await panel.getByRole('button', { name: 'Send', exact: true }).click()
      await expect.poll(() => pendingAgentResponses.length).toBe(2)

      await panel.getByTestId('agent-conversation-switcher').click()
      await expect(launched.page.getByText('Working', { exact: true })).toHaveCount(2)
      await launched.page.getByRole('option', { name: /Parallel conversation 1/ }).click()

      const secondResponse = pendingAgentResponses[1]
      if (secondResponse === undefined) throw new Error('Second Agent response was not pending')
      sendToolCall(secondResponse, {
        responseId: 'parallel-background-proposal',
        toolCallId: 'parallel-background-tool',
        name: 'submit_section_change',
        text: 'I will prepare the background section change for review.',
        args: {
          sectionId: targetSectionId,
          operations: [
            {
              type: 'insertTextBlocks',
              anchor: null,
              placement: 'end',
              blocks: [{ blockType: 'paragraph', text: 'Background Agent draft.' }]
            }
          ],
          citationIds: []
        }
      })
      await expect
        .poll(() =>
          launched.page.evaluate(async () => {
            const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
              ?.projectSessionId
            if (projectSessionId === undefined) return false
            const sessions = await window.desktop.agent.listSessions({ projectSessionId })
            return sessions.some((session) => session.workflowState === 'awaiting_review')
          })
        )
        .toBe(true)
      await expect(launched.page.getByLabel('Section title')).toHaveValue('Current section')

      await panel.getByRole('button', { name: 'Stop', exact: true }).click()
      await expect(panel.getByTestId('agent-status')).toContainText('Ready')

      await panel.getByTestId('agent-conversation-switcher').click()
      await launched.page.getByRole('option', { name: /Parallel conversation 2/ }).click()
      await expect(panel.getByText('Review required', { exact: true })).toBeVisible()
      await panel.getByRole('button', { name: 'More review actions' }).click()
      await launched.page.getByRole('menuitem', { name: 'Reject proposal', exact: true }).click()
      await expect(panel.getByText('rejected', { exact: true })).toBeVisible()
      await expect(panel.getByTestId('agent-status')).toContainText('Ready')
      await expect(launched.page.getByLabel('Section title')).toHaveValue('Current section')
    } finally {
      await launched.app.close()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    }
  }
)
