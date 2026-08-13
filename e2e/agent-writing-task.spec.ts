import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, expectActiveProject, launchApp, scenario, test } from './fixtures'

test(
  'keeps an Agent-created writing task stable across archive, project close, and app restart',
  scenario('agent.writing-task-identity', ['@critical', '@packaged']),
  async ({ testRoot }) => {
    const firstStepRef = '019d0000-0000-7000-8000-000000000301'
    const secondStepRef = '019d0000-0000-7000-8000-000000000302'
    let agentCall = 0
    const server = createServer((request, response) => {
      if (request.method === 'GET' && request.url === '/v1/models') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end('{"data":[{"id":"task-model","displayName":"Task model"}]}')
        return
      }
      if (request.method === 'POST' && request.url === '/v1/chat/completions') {
        const chunks: Buffer[] = []
        request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        request.on('end', () => {
          const body = JSON.parse(Buffer.concat(chunks).toString())
          if (JSON.stringify(body).includes('Create a concise title for the delimited')) {
            sendCompletion(response, 'Revise two sections')
            return
          }
          agentCall += 1
          if (agentCall === 1) {
            sendToolCall(response, {
              name: 'create_writing_task',
              args: {
                objective: 'Revise two manuscript sections coherently.',
                steps: [
                  { clientRef: firstStepRef, title: 'Inspect the manuscript structure' },
                  { clientRef: secondStepRef, title: 'Revise and verify both sections' }
                ]
              }
            })
            return
          }
          if (agentCall === 3) {
            sendToolCall(response, { name: 'get_writing_task', args: {} })
            return
          }
          if (agentCall === 4) {
            sendToolCall(response, {
              name: 'submit_brief_change',
              args: {
                changes: {
                  additionalInstructions: 'Keep both section revisions coherent.'
                },
                citationIds: []
              }
            })
            return
          }
          sendCompletion(
            response,
            agentCall === 2
              ? 'The durable writing task is ready with two bounded steps.'
              : 'The existing writing task resumed in the same conversation.'
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
    const userData = join(testRoot, 'user-data')
    const first = await launchApp({ userData, dialogPaths: [testRoot] })
    let identity: { taskId: string; stepIds: string[]; agentSessionId: string } | undefined
    try {
      await configureAgentProvider(first.page, `http://127.0.0.1:${port}/v1`)
      await createProject(first.page, 'Writing task project')
      await selectAgentModel(first.page)
      const panel = first.page.getByTestId('agent-panel')
      await panel
        .getByLabel('Agent message')
        .fill('Create a writing task to revise two sections, then wait for my review.')
      await panel.getByRole('button', { name: 'Send', exact: true }).click()
      await expect(
        panel.getByText('The durable writing task is ready with two bounded steps.', {
          exact: true
        })
      ).toBeVisible({ timeout: 20_000 })
      const task = panel.getByTestId('agent-writing-task')
      await expect(task.getByText('Revise two manuscript sections coherently.')).toBeVisible()
      await expect(task.getByText('Plan v1', { exact: true })).toBeVisible()
      await expect(task.getByText(/Inspect the manuscript structure/u)).toBeVisible()
      await expect(task.getByText(/Revise and verify both sections/u)).toBeVisible()

      await task.getByRole('button', { name: 'Revise writing task plan' }).click()
      const taskDialog = first.page.getByRole('dialog', { name: 'Revise writing task' })
      await taskDialog.getByLabel('Objective').fill('Revise and verify the manuscript coherently.')
      await taskDialog.getByLabel('Step 1', { exact: true }).fill('Inspect structure and evidence')
      await taskDialog.getByRole('button', { name: 'Add step' }).click()
      await taskDialog
        .getByLabel('Step 3', { exact: true })
        .fill('Confirm the final manuscript state')
      await taskDialog.getByRole('button', { name: 'Save plan' }).click()
      await expect(taskDialog).not.toBeVisible()
      await expect(task.getByText('Plan v2', { exact: true })).toBeVisible()
      await expect(task.getByText('Revise and verify the manuscript coherently.')).toBeVisible()
      await expect(task.getByText(/Confirm the final manuscript state/u)).toBeVisible()

      await task.getByRole('button', { name: 'Resume writing task' }).click()
      await expect(panel.getByText('Review required', { exact: true })).toBeVisible({
        timeout: 20_000
      })
      const changeSet = panel.getByTestId('agent-writing-change-set')
      await expect(changeSet).toBeVisible()
      await changeSet.getByText('Task change set', { exact: true }).click()
      await expect(changeSet.getByText('Project brief', { exact: true })).toBeVisible()
      await expect(changeSet.getByText('pending 1', { exact: true })).toBeVisible()
      await expect(
        changeSet.getByText('Update the manuscript brief', { exact: true })
      ).toBeVisible()
      await changeSet.getByRole('checkbox', { name: 'Select Update the manuscript brief' }).click()
      await changeSet.getByRole('button', { name: 'Reject selected' }).click()
      const rejectDialog = first.page.getByRole('dialog', { name: 'Reject selected proposals' })
      await rejectDialog
        .getByLabel('Reason')
        .fill('Preserve this outcome for change-set recovery verification.')
      await rejectDialog.getByRole('button', { name: 'Reject 1' }).click()
      await expect(rejectDialog).not.toBeVisible()
      await expect(changeSet.getByText('Batch complete', { exact: true })).toBeVisible()
      await expect(changeSet.getByText('rejected 1', { exact: true })).toBeVisible()

      identity = await first.page.evaluate(async () => {
        const project = (await window.desktop.projects.lifecycle()).activeProject
        if (project === undefined) throw new Error('Project is not open')
        const session = (
          await window.desktop.agent.listSessions({ projectSessionId: project.projectSessionId })
        )[0]
        if (session?.writingTask === undefined || session.writingTask === null) {
          throw new Error('Writing task is missing')
        }
        const latestRun = (
          await window.desktop.agent.listRuns({
            projectSessionId: project.projectSessionId,
            agentSessionId: session.agentSessionId
          })
        )[0]
        if (
          latestRun?.writingTaskId !== session.writingTask.taskId ||
          latestRun.writingTaskStepId !== session.writingTask.progress.currentStepId
        ) {
          throw new Error('Resumed run is not correlated to the exact active writing task step')
        }
        return {
          taskId: session.writingTask.taskId,
          stepIds: session.writingTask.plan.steps.map((step) => step.stepId),
          agentSessionId: session.agentSessionId
        }
      })
      expect(new Set(identity.stepIds).size).toBe(3)

      const archived = await first.page.evaluate(async (agentSessionId) => {
        const project = (await window.desktop.projects.lifecycle()).activeProject
        if (project === undefined) throw new Error('Project is not open')
        await window.desktop.agent.archiveSession({
          projectSessionId: project.projectSessionId,
          agentSessionId
        })
        return (
          await window.desktop.agent.listSessions({
            projectSessionId: project.projectSessionId,
            status: 'archived'
          })
        )[0]
      }, identity.agentSessionId)
      expect(archived?.writingTask?.taskId).toBe(identity.taskId)
      await first.page.evaluate(async (agentSessionId) => {
        const project = (await window.desktop.projects.lifecycle()).activeProject
        if (project === undefined) throw new Error('Project is not open')
        await window.desktop.agent.restoreSession({
          projectSessionId: project.projectSessionId,
          agentSessionId
        })
      }, identity.agentSessionId)
    } finally {
      await first.app.close()
    }

    const restarted = await launchApp({ userData })
    try {
      await restarted.page
        .getByRole('button', { name: 'Open Writing task project', exact: true })
        .click()
      await expectActiveProject(restarted.page, 'Writing task project')
      const restored = await restarted.page.evaluate(async () => {
        const project = (await window.desktop.projects.lifecycle()).activeProject
        if (project === undefined) throw new Error('Project is not open')
        return (
          await window.desktop.agent.listSessions({ projectSessionId: project.projectSessionId })
        )[0]?.writingTask
      })
      expect(restored).toMatchObject({
        taskId: identity?.taskId,
        planVersion: 2,
        plan: { steps: identity?.stepIds.map((stepId) => ({ stepId })) }
      })
      await restarted.page.getByTestId('agent-menubar-trigger').click()
      await expect(restarted.page.getByTestId('agent-writing-task')).toContainText(
        'Revise and verify the manuscript coherently.'
      )
      const restoredChangeSet = restarted.page.getByTestId('agent-writing-change-set')
      await expect(restoredChangeSet).toBeVisible()
      await restoredChangeSet.getByText('Task change set', { exact: true }).click()
      await expect(restoredChangeSet.getByText('rejected 1', { exact: true })).toBeVisible()
    } finally {
      await restarted.app.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
)

function sendToolCall(response: ServerResponse, input: { name: string; args: unknown }): void {
  sendSse(response, [
    {
      id: 'writing-task-tool-response',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'task-model',
      choices: [
        {
          index: 0,
          delta: {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: `writing-task-${input.name}`,
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
      id: 'writing-task-tool-response',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'task-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 }
    }
  ])
}

function sendCompletion(response: ServerResponse, content: string): void {
  sendSse(response, [
    {
      id: 'writing-task-final-response',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'task-model',
      choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }]
    },
    {
      id: 'writing-task-final-response',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'task-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 24, completion_tokens: 10, total_tokens: 34 }
    }
  ])
}

function sendSse(response: ServerResponse, chunks: unknown[]): void {
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`)
  response.end('data: [DONE]\n\n')
}

async function configureAgentProvider(page: Page, baseUrl: string): Promise<void> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await settings.getByRole('option', { name: /^Agent API/ }).click()
  await settings.getByRole('button', { name: 'Add provider' }).click()
  const addProvider = page.getByRole('dialog', { name: 'Add provider' })
  await addProvider.getByLabel('Provider name').fill('Task Agent')
  await addProvider.getByRole('button', { name: 'Continue' }).click()
  await settings.getByLabel('Base URL').fill(baseUrl)
  await settings.getByLabel('API key').fill('e2e-secret')
  await settings.getByRole('button', { name: 'Save provider' }).click()
  await settings.getByRole('button', { name: 'Fetch Task Agent models' }).click()
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

async function selectAgentModel(page: Page): Promise<void> {
  await page.getByTestId('agent-menubar-trigger').click()
  const panel = page.getByTestId('agent-panel')
  await panel.getByTestId('agent-conversation-menu').click()
  await page.getByRole('menuitem', { name: 'Details', exact: true }).click()
  const details = page.getByRole('dialog', { name: 'Agent details' })
  await details.getByLabel('Agent model').click()
  const modelPicker = page.getByTestId('agent-model-picker')
  await modelPicker.getByRole('option', { name: /Task Agent/ }).click()
  await modelPicker.getByRole('option', { name: /Task model/ }).click()
  await details.getByRole('button', { name: 'Close', exact: true }).click()
}
