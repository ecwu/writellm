import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { expect, launchApp, scenario, test } from './fixtures'
import { configureAgentProvider, createProject } from './helpers/project'
import { sendCompletion as sendSharedCompletion } from './helpers/mock-provider-sse'
import { sendToolCall as sendSharedToolCall } from './helpers/mock-provider-sse'

function sendToolCall(
  response: ServerResponse,
  input: { responseId: string; toolCallId: string; sectionId: string }
): void {
  sendSharedToolCall(
    response,
    {
      responseId: input.responseId,
      toolCallId: input.toolCallId,
      name: 'read_section',
      args: { sectionId: input.sectionId, view: 'summary', limit: 3 }
    },
    { model: 'cp51-bounded', requestId: 'cp51-e2e-request' }
  )
}

function sendCompletion(response: ServerResponse, text: string): void {
  sendSharedCompletion(response, text, {
    id: 'cp51-completion',
    model: 'cp51-bounded',
    requestId: 'cp51-e2e-request'
  })
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
      await configureAgentProvider(launched.page, `http://127.0.0.1:${port}/v1`, {
        providerName: 'CP51 Agent',
        apiKey: 'cp51-e2e-secret',
        addModel: {
          id: 'cp51-bounded',
          displayName: 'CP51 bounded context',
          contextWindow: '32768',
          maximumOutput: '4096'
        }
      })
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
          if (saved.ok === false) throw new Error(saved.error.message)
        }
        return ordered.map((item) => item.section.sectionId)
      })

      if (!(await launched.page.getByTestId('agent-panel').isVisible()))
        await launched.page.getByRole('button', { name: 'Agent', exact: true }).click()
      const panel = launched.page.getByTestId('agent-panel')
      await panel.getByLabel('Agent message').fill('Read RQ1, RQ2, and RQ3 in order, then report.')
      await panel.getByRole('button', { name: 'Send', exact: true }).click()
      const finalResponse = panel.getByText(
        'RQ3 remained authoritative and the long read sequence completed.',
        { exact: true }
      )
      await expect(finalResponse).toHaveCount(1, { timeout: 30_000 })
      await expect(finalResponse).toBeVisible()

      expect(agentCall).toBe(4)
      const finalBody = JSON.stringify(providerBodies[3])
      expect(finalBody).toContain('RQ3-AUTHORITATIVE-MARKER')
      expect(finalBody).toContain('blockHash')
      expect(finalBody).toContain('revisionId')
      const finalRequest = providerBodies[3] as {
        messages?: Array<{ role?: string; content?: unknown }>
      }
      const toolContents =
        finalRequest.messages
          ?.filter((message) => message.role === 'tool')
          .map((message) => String(message.content)) ?? []
      expect(toolContents.some((content) => content.includes('RQ3-AUTHORITATIVE-MARKER-3'))).toBe(
        true
      )
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
