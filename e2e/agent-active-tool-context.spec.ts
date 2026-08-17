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
  await addProvider.getByLabel('Provider name').fill('CP51 Agent')
  await addProvider.getByRole('button', { name: 'Continue' }).click()
  await settings.getByLabel('Base URL').fill(baseUrl)
  await settings.getByLabel('API key').fill('cp51-e2e-secret')
  await settings.getByRole('button', { name: 'Save provider' }).click()
  await settings.getByRole('button', { name: 'Fetch CP51 Agent models' }).click()
  await expect(settings.getByText(/1 models · current/)).toBeVisible()
  await settings.getByRole('button', { name: 'Add model' }).click()
  const addModel = page.getByRole('dialog', { name: 'Add model' })
  await addModel.getByLabel('Model ID').fill('cp51-bounded')
  await addModel.getByLabel('Display name').fill('CP51 bounded context')
  await addModel.getByRole('button', { name: 'Advanced model metadata' }).click()
  await addModel.getByLabel('Context window').fill('32768')
  await addModel.getByLabel('Maximum output').fill('4096')
  await addModel.getByRole('button', { name: 'Save model' }).click()
  await settings.getByRole('button', { name: 'Set CP51 bounded context as default' }).click()
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
  input: { responseId: string; toolCallId: string; sectionId: string }
): void {
  sendSse(response, [
    {
      id: input.responseId,
      object: 'chat.completion.chunk',
      created: 1,
      model: 'cp51-bounded',
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
                function: {
                  name: 'read_section',
                  arguments: JSON.stringify({
                    sectionId: input.sectionId,
                    view: 'summary',
                    limit: 3
                  })
                }
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
      model: 'cp51-bounded',
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
    }
  ])
}

function sendCompletion(response: ServerResponse, text: string): void {
  sendSse(response, [
    {
      id: 'cp51-completion',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'cp51-bounded',
      choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }]
    },
    {
      id: 'cp51-completion',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'cp51-bounded',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 }
    }
  ])
}

function sendSse(response: ServerResponse, chunks: unknown[]): void {
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    'x-request-id': 'cp51-e2e-request'
  })
  for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`)
  response.end('data: [DONE]\n\n')
}

test(
  'keeps the newest long section read authoritative across Pi context pruning',
  scenario('agent.active-tool-context-recovery', ['@packaged']),
  async ({ testRoot }) => {
    let agentCall = 0
    let sectionIds: string[] = []
    const providerBodies: unknown[] = []
    const server = createServer((request, response) => {
      if (request.method === 'GET' && request.url === '/v1/models') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end('{"data":[{"id":"cp51-discovered","displayName":"CP51 discovered"}]}')
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
          sendCompletion(response, 'Long section context')
          return
        }
        providerBodies.push(body)
        const sectionId = sectionIds[agentCall]
        agentCall += 1
        if (sectionId !== undefined) {
          sendToolCall(response, {
            responseId: `cp51-read-response-${agentCall}`,
            toolCallId: `cp51-read-tool-${agentCall}`,
            sectionId
          })
          return
        }
        sendCompletion(response, 'RQ3 remained authoritative and the long read sequence completed.')
      })
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
      await createProject(launched.page, 'CP51 long context')
      sectionIds = await launched.page.evaluate(async () => {
        const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
          ?.projectSessionId
        if (projectSessionId === undefined) throw new Error('Project session missing')
        let workspace = await window.desktop.manuscript.workspace({ projectSessionId })
        for (const [position, title] of ['RQ2', 'RQ3'].entries()) {
          workspace = await window.desktop.manuscript.createSection({
            projectSessionId,
            create: {
              baseOutlineVersion: workspace.outlineVersion,
              parentSectionId: null,
              position: position + 1,
              title,
              objective: null,
              status: 'drafting'
            }
          })
        }
        const ordered = [...workspace.sections].sort(
          (left, right) => left.section.position - right.section.position
        )
        for (const [sectionIndex, item] of ordered.entries()) {
          const marker = `RQ${sectionIndex + 1}-AUTHORITATIVE-MARKER`
          const current = await window.desktop.editor.loadSection({
            projectSessionId,
            sectionId: item.section.sectionId
          })
          const document = Array.from({ length: 3 }, (_, blockIndex) => ({
            id: `rq${sectionIndex + 1}-block-${blockIndex + 1}`,
            type: 'paragraph' as const,
            props: {
              backgroundColor: 'default' as const,
              textColor: 'default' as const,
              textAlignment: 'left' as const
            },
            content: [
              {
                type: 'text' as const,
                text: `${marker}-${blockIndex + 1} ${'context '.repeat(400)}`,
                styles: {}
              }
            ],
            children: []
          }))
          const saved = await window.desktop.editor.saveSectionDocument({
            projectSessionId,
            sectionId: item.section.sectionId,
            baseRevisionId: current.revision.sectionRevisionId,
            baseContentHash: current.revision.contentHash,
            document
          })
          if (!saved.ok) throw new Error(saved.error.message)
        }
        return ordered.map((item) => item.section.sectionId)
      })

      await launched.page.getByRole('button', { name: 'Agent', exact: true }).click()
      const panel = launched.page.getByTestId('agent-panel')
      await panel.getByLabel('Agent message').fill('Read RQ1, RQ2, and RQ3 in order, then report.')
      await panel.getByRole('button', { name: 'Send', exact: true }).click()
      await expect(
        panel.getByText('RQ3 remained authoritative and the long read sequence completed.', {
          exact: true
        })
      ).toBeVisible({ timeout: 30_000 })

      expect(agentCall).toBe(4)
      const finalBody = JSON.stringify(providerBodies[3])
      expect(finalBody).toContain('RQ3-AUTHORITATIVE-MARKER')
      expect(finalBody).toContain('blockHash')
      expect(finalBody).toContain('revisionId')
      expect(finalBody).toContain('historical_projection')
      const finalRequest = providerBodies[3] as {
        messages?: Array<{ role?: string; content?: unknown }>
      }
      const toolContents =
        finalRequest.messages
          ?.filter((message) => message.role === 'tool')
          .map((message) => String(message.content)) ?? []
      expect(toolContents.some((content) => content.includes('active_batch_retry'))).toBe(false)
      expect(finalBody).not.toContain('cp51-e2e-secret')
      await expect(
        panel.getByText('Reading context was too large to continue safely', { exact: true })
      ).toHaveCount(0)
    } finally {
      await launched.app.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
)
