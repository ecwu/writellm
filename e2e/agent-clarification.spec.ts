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
  await addProvider.getByLabel('Provider name').fill('Clarification Agent')
  await addProvider.getByRole('button', { name: 'Continue' }).click()
  await settings.getByLabel('Base URL').fill(baseUrl)
  await settings.getByLabel('API key').fill('clarification-e2e-secret')
  await settings.getByRole('button', { name: 'Save provider' }).click()
  await settings.getByRole('button', { name: 'Fetch Clarification Agent models' }).click()
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
  input: { responseId: string; toolCallId: string; args: unknown }
): void {
  sendSse(response, [
    {
      id: input.responseId,
      object: 'chat.completion.chunk',
      created: 1,
      model: 'clarification-model-resolved',
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
                function: { name: 'ask_user', arguments: JSON.stringify(input.args) }
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
      model: 'clarification-model-resolved',
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 10, completion_tokens: 6, total_tokens: 16 }
    }
  ])
}

function sendCompletion(response: ServerResponse, text: string): void {
  sendSse(response, [
    {
      id: 'clarification-completion',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'clarification-model-resolved',
      choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }]
    },
    {
      id: 'clarification-completion',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'clarification-model-resolved',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 }
    }
  ])
}

function sendSse(response: ServerResponse, chunks: unknown[]): void {
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    'x-request-id': 'clarification-e2e-request'
  })
  for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`)
  response.end('data: [DONE]\n\n')
}

test(
  'answers in the same run, stops an unanswered wait, and restores it as read-only history',
  scenario('agent.user-clarification', ['@critical', '@packaged']),
  async ({ testRoot }) => {
    let agentCall = 0
    const providerBodies: unknown[] = []
    const server = createServer((request, response) => {
      if (request.method === 'GET' && request.url === '/v1/models') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end('{"data":[{"id":"clarification-model","displayName":"Clarification model"}]}')
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
          sendCompletion(response, 'Clarification workflow')
          return
        }
        providerBodies.push(body)
        agentCall += 1
        if (agentCall === 1) {
          sendToolCall(response, {
            responseId: 'clarification-question-response',
            toolCallId: 'clarification-question-tool',
            args: {
              questions: [
                {
                  id: 'scope',
                  header: 'Scope',
                  question: 'Which scope should the revision use?',
                  options: [
                    {
                      label: 'Conclusion (Recommended)',
                      description: 'Revise only the ending.'
                    },
                    { label: 'Document', description: 'Revise the full manuscript.' }
                  ]
                },
                {
                  id: 'tone',
                  header: 'Tone',
                  question: 'Which tone should the revision use?',
                  options: [
                    { label: 'Formal (Recommended)', description: 'Use a restrained voice.' },
                    { label: 'Conversational', description: 'Use an approachable voice.' }
                  ]
                }
              ]
            }
          })
          return
        }
        if (agentCall === 2) {
          sendCompletion(response, 'I will revise the conclusion in a precise, warm voice.')
          return
        }
        if (agentCall === 3) {
          sendToolCall(response, {
            responseId: 'clarification-stop-response',
            toolCallId: 'clarification-stop-tool',
            args: {
              questions: [
                {
                  id: 'direction',
                  header: 'Direction',
                  question: 'Which direction should the next pass use?',
                  options: [
                    { label: 'A (Recommended)', description: 'Use direction A.' },
                    { label: 'B', description: 'Use direction B.' }
                  ]
                }
              ]
            }
          })
          return
        }
        sendCompletion(response, 'Unexpected continuation')
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const port = (server.address() as AddressInfo).port
    const userData = join(testRoot, 'user-data')
    const launched = await launchApp({
      userData,
      dialogPaths: [testRoot]
    })
    let restarted: typeof launched | undefined
    try {
      await configureAgentProvider(launched.page, `http://127.0.0.1:${port}/v1`)
      await createProject(launched.page, 'Clarification workflow')
      await launched.page.getByRole('button', { name: 'Agent', exact: true }).click()
      const panel = launched.page.getByTestId('agent-panel')
      await panel.getByTestId('agent-conversation-menu').click()
      await launched.page.getByRole('menuitem', { name: 'Details', exact: true }).click()
      const details = launched.page.getByRole('dialog', { name: 'Agent details' })
      await details.getByLabel('Agent model').click()
      const picker = launched.page.getByTestId('agent-model-picker')
      await picker.getByRole('option', { name: /Clarification Agent/ }).click()
      await picker.getByRole('option', { name: /Clarification model/ }).click()
      await launched.page.keyboard.press('Escape')

      await panel
        .getByLabel('Agent message')
        .fill('Revise the ending after confirming scope and tone.')
      await panel.getByRole('button', { name: 'Send', exact: true }).click()
      const questionnaire = panel.getByTestId('agent-questionnaire')
      await expect(questionnaire).toBeVisible()
      await expect(panel.getByTestId('agent-status')).toContainText('Waiting for your answer')
      await expect(panel.getByTestId('agent-conversation-switcher')).toBeEnabled()
      await panel.getByTestId('agent-conversation-switcher').click()
      await expect(launched.page.getByText('Needs answer', { exact: true })).toBeVisible()
      await panel.getByTestId('agent-conversation-switcher').click()
      await expect(launched.page.getByText('Needs answer', { exact: true })).toBeHidden()
      await expect(questionnaire.getByRole('progressbar')).toHaveText('Question 1 of 2')
      const conclusion = questionnaire.getByRole('radio', { name: /Conclusion \(Recommended\)/ })
      await expect(async () => {
        if (!(await conclusion.isChecked())) {
          await conclusion.press('Space')
        }
        await expect(conclusion).toBeChecked({ timeout: 2_000 })
      }).toPass({ timeout: 60_000 })
      await conclusion.press('Enter')
      await expect(questionnaire.getByRole('progressbar')).toHaveText('Question 2 of 2')
      await questionnaire.getByRole('button', { name: 'Previous' }).click()
      await expect(questionnaire.getByRole('progressbar')).toHaveText('Question 1 of 2')
      await expect(conclusion).toBeChecked()
      await questionnaire.getByRole('button', { name: 'Next' }).click()
      const formal = questionnaire.getByRole('radio', { name: /Formal \(Recommended\)/ })
      await formal.check()
      await questionnaire.getByLabel('Another answer for Tone').fill('Precise but warm')
      await expect(formal).not.toBeChecked()
      await questionnaire.getByRole('button', { name: 'Answer' }).click()

      await expect(
        panel
          .getByText('I will revise the conclusion in a precise, warm voice.', { exact: true })
          .filter({ visible: true })
          .first()
      ).toBeVisible({ timeout: 20_000 })
      await expect(
        panel
          .getByText('Agent asked · You answered', { exact: true })
          .filter({ visible: true })
          .first()
      ).toBeVisible()
      await expect(
        panel
          .getByText('Conclusion (Recommended)', { exact: true })
          .filter({ visible: true })
          .first()
      ).toBeVisible()
      await expect(
        panel.getByText('Precise but warm', { exact: true }).filter({ visible: true }).first()
      ).toBeVisible()
      expect(JSON.stringify(providerBodies[1])).toContain('WRITELLM_USER_CLARIFICATION')
      expect(JSON.stringify(providerBodies[1])).toContain('Precise but warm')

      await panel.getByLabel('Agent message').fill('Ask for the next direction.')
      await panel.getByRole('button', { name: 'Send', exact: true }).click()
      await expect(questionnaire).toBeVisible()
      await expect(panel.getByTestId('agent-status')).toContainText('Waiting for your answer')
      await questionnaire.getByRole('button', { name: 'Stop' }).click()
      await expect(panel.getByText('Stopped', { exact: false })).toBeVisible({ timeout: 20_000 })
      expect(agentCall).toBe(3)

      const stoppedTruth = await launched.page.evaluate(async () => {
        const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
          ?.projectSessionId
        if (projectSessionId === undefined) throw new Error('Project session missing after Stop')
        const session = (await window.desktop.agent.listSessions({ projectSessionId }))[0]
        if (session === undefined) throw new Error('Agent session missing after Stop')
        return {
          session,
          runs: await window.desktop.agent.listRuns({
            projectSessionId,
            agentSessionId: session.agentSessionId
          })
        }
      })
      expect(stoppedTruth.session.workflowState).toBe('idle')
      expect(stoppedTruth.runs.map((run) => run.status).sort()).toEqual([
        'completed',
        'interrupted'
      ])

      await launched.app.close()
      restarted = await launchApp({ userData })
      await restarted.page
        .getByRole('button', { name: 'Open Clarification workflow', exact: true })
        .click()
      await expectActiveProject(restarted.page, 'Clarification workflow')
      await restarted.page.getByRole('button', { name: 'Agent', exact: true }).click()
      const restoredPanel = restarted.page.getByTestId('agent-panel')
      const restoredQuestionnaire = restoredPanel.getByTestId('agent-questionnaire')
      await expect(restoredQuestionnaire).toHaveCount(0)
      await expect(
        restoredPanel.getByText('Clarification ended without an answer', { exact: true })
      ).toHaveCount(1)
      await expect(restoredPanel.getByTestId('agent-status')).toContainText('Ready')
      const restartTruth = await restarted.page.evaluate(async () => {
        const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
          ?.projectSessionId
        if (projectSessionId === undefined) throw new Error('Project session missing after restart')
        const session = (await window.desktop.agent.listSessions({ projectSessionId }))[0]
        if (session === undefined) throw new Error('Agent session missing after restart')
        return {
          session,
          runs: await window.desktop.agent.listRuns({
            projectSessionId,
            agentSessionId: session.agentSessionId
          })
        }
      })
      expect(restartTruth.session.workflowState).toBe('idle')
      expect(restartTruth.runs.map((run) => run.status).sort()).toEqual([
        'completed',
        'interrupted'
      ])
    } finally {
      const current = restarted ?? launched
      const stop = current.page.getByRole('button', { name: 'Stop', exact: true })
      if (await stop.isVisible().catch(() => false)) await stop.click().catch(() => undefined)
      await current.app.close().catch(() => undefined)
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
)
