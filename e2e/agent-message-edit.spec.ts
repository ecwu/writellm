import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { expect, expectActiveProject, launchApp, scenario, test } from './fixtures'

function complete(response: ServerResponse, content: string): void {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.end(
    `data: ${JSON.stringify({
      id: 'edit-answer',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'edit-writer',
      choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 }
    })}\n\ndata: [DONE]\n\n`
  )
}

function tool(response: ServerResponse, name: string, args: unknown): void {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.end(
    `data: ${JSON.stringify({
      id: `edit-${name}`,
      object: 'chat.completion.chunk',
      created: 1,
      model: 'edit-writer',
      choices: [
        {
          index: 0,
          delta: {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: `call-${name}`,
                type: 'function',
                function: { name, arguments: JSON.stringify(args) }
              }
            ]
          },
          finish_reason: 'tool_calls'
        }
      ],
      usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 }
    })}\n\ndata: [DONE]\n\n`
  )
}

test(
  'copies messages, edits after stopping, invalidates proposals and blocks edits after writes',
  scenario('agent.message-copy-edit', ['@packaged']),
  async ({ testRoot }, testInfo) => {
    const requests: Record<string, string[]> = {}
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const raw = Buffer.concat(chunks).toString('utf8')
      const body = JSON.parse(raw) as {
        messages?: Array<{ role: string; content: unknown }>
        tools?: unknown[]
      }
      const prompt = JSON.stringify(
        body.messages?.findLast((message) => message.role === 'user')?.content ?? ''
      )
      const marker = [
        'copy-original',
        'copy-revised',
        'hold-stream',
        'after-stop',
        'pending-change',
        'after-proposal',
        'apply-change'
      ].find((value) => prompt.includes(value))
      if (marker === undefined || !body.tools?.length) {
        complete(response, 'Conversation title')
        return
      }
      requests[marker] ??= []
      requests[marker].push(raw)
      if (marker === 'hold-stream') {
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.write(
          `data: ${JSON.stringify({
            id: 'stream-answer',
            object: 'chat.completion.chunk',
            created: 1,
            model: 'edit-writer',
            choices: [
              {
                index: 0,
                delta: { role: 'assistant', content: 'Streaming **partial** answer' },
                finish_reason: null
              }
            ]
          })}\n\n`
        )
        return
      }
      if (marker === 'pending-change' || marker === 'apply-change') {
        if (requests[marker].length === 1) {
          tool(response, 'activate_tool_groups', { groups: ['brief'] })
          return
        }
        if (requests[marker].length === 2) {
          tool(response, 'submit_brief_change', {
            changes: { title: marker === 'pending-change' ? 'Superseded brief' : 'Applied brief' }
          })
          return
        }
      }
      complete(
        response,
        marker === 'copy-original' ? '**Original answer**\nSecond line' : `Answer for ${marker}.`
      )
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const launched = await launchApp({
      userData: join(testRoot, 'edit-data'),
      dialogPaths: [testRoot]
    })
    try {
      await launched.page.evaluate(
        async (port) => {
          const presetId = 'custom:edit-fixture'
          await window.desktop.providers.saveAgentPreset({
            presetId,
            name: 'Edit Fixture',
            baseUrl: `http://127.0.0.1:${port}/v1`,
            api: 'openai-completions',
            authMode: 'api_key'
          })
          await window.desktop.providers.saveAgentManualModel({
            presetId,
            model: {
              id: 'edit-writer',
              name: 'Edit Writer',
              api: 'openai-completions',
              reasoning: false,
              input: ['text'],
              contextWindow: 262_144,
              maxTokens: 16_384
            }
          })
          await window.desktop.providers.setAgentCredential({
            presetId,
            apiKey: 'edit-fixture-key'
          })
          await window.desktop.providers.setAgentDefault({ presetId, modelId: 'edit-writer' })
        },
        (server.address() as AddressInfo).port
      )
      const page = launched.page
      const browserWindow = await launched.app.browserWindow(page)
      await browserWindow.evaluate((window) => {
        window.unmaximize()
        window.setContentSize(1680, 900)
      })
      await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(1680)
      await page.getByRole('button', { name: 'Create project', exact: true }).click()
      const create = page.getByRole('dialog', { name: 'Create project' })
      await create.getByLabel('Project name').fill('Message editing')
      await create.getByRole('button', { name: 'Choose location' }).click()
      await expectActiveProject(page, 'Message editing')
      await page.getByRole('button', { name: 'Manuscript', exact: true }).click()
      await page.getByRole('button', { name: 'Agent', exact: true }).click()
      const panel = page.getByTestId('agent-panel')
      const timeline = panel.getByTestId('agent-event-timeline')
      const send = async (text: string) => {
        await panel.getByLabel('Agent message').fill(text)
        await panel.getByRole('button', { name: 'Send', exact: true }).click()
      }
      const edit = panel.getByRole('button', { name: 'Edit message', exact: true })
      const waitEditable = () => expect(edit).toHaveAttribute('aria-disabled', 'false')
      await send('copy-original\nUser second line')
      await expect(timeline.getByText('Original answer', { exact: true })).toBeVisible()
      await waitEditable()
      const actions = timeline.getByTestId('agent-message-actions')
      await panel.getByLabel('Agent message').focus()
      await page.mouse.move(0, 0)
      await expect(actions.first()).toHaveCSS('opacity', '0')
      await expect(actions.last()).toHaveCSS('opacity', '0')
      await timeline.getByText('copy-original\nUser second line', { exact: true }).hover()
      await expect(actions.first()).toHaveCSS('opacity', '1')
      await expect(actions.last()).toHaveCSS('opacity', '0')
      await timeline.getByText('Original answer', { exact: true }).hover()
      await expect(actions.first()).toHaveCSS('opacity', '0')
      await expect(actions.last()).toHaveCSS('opacity', '1')
      await page.mouse.move(0, 0)
      await edit.focus()
      await expect(actions.first()).toHaveCSS('opacity', '1')
      await timeline.getByRole('button', { name: 'Copy message', exact: true }).first().click()
      await expect
        .poll(() => launched.app.evaluate(({ clipboard }) => clipboard.readText()))
        .toBe('copy-original\nUser second line')
      await timeline.getByRole('button', { name: 'Copy message', exact: true }).last().click()
      await expect
        .poll(() => launched.app.evaluate(({ clipboard }) => clipboard.readText()))
        .toBe('**Original answer**\nSecond line')

      // Exercise clipboard failure and retry without exporting content through a test-only API.
      await page.evaluate(() => {
        const original = navigator.clipboard.writeText.bind(navigator.clipboard)
        let fail = true
        navigator.clipboard.writeText = async (text) => {
          if (fail) {
            fail = false
            throw new DOMException('Fixture clipboard unavailable', 'NotAllowedError')
          }
          await original(text)
        }
      })
      await timeline
        .getByRole('button', { name: /Copy message|Copied/, exact: true })
        .last()
        .click()
      await expect(timeline.getByText('Copy failed. Try again.')).toBeVisible()
      await timeline.getByRole('button', { name: 'Copy message', exact: true }).last().click()
      await expect(timeline.getByText('Copy failed. Try again.')).toHaveCount(0)

      await edit.click()
      const editor = panel.getByLabel('Edit sent message')
      await expect(editor).toHaveValue('copy-original\nUser second line')
      await editor.fill('   ')
      await expect(panel.getByRole('button', { name: 'Save and restart' })).toBeDisabled()
      await editor.press('Escape')
      await expect(editor).toHaveCount(0)
      await expect(timeline.getByText('Original answer', { exact: true })).toBeVisible()
      await edit.click()
      await editor.fill('copy-revised\nNew second line')
      const resizeHandle = page.locator('[data-separator]').last()
      await expect(resizeHandle).toBeVisible()
      const initialWidth = await panel.evaluate((node) => node.clientWidth)
      const handleBox = await resizeHandle.boundingBox()
      if (handleBox === null) throw new Error('Missing Agent resize handle')
      await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
      await page.mouse.down()
      await page.mouse.move(handleBox.x - 40, handleBox.y + handleBox.height / 2, { steps: 4 })
      await page.mouse.up()
      await expect
        .poll(() => panel.evaluate((node) => node.clientWidth))
        .toBeGreaterThan(initialWidth)
      await editor.scrollIntoViewIfNeeded()
      await panel.screenshot({ path: testInfo.outputPath('agent-message-editor.png') })

      await editor.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
      await expect(timeline.getByText('Answer for copy-revised.', { exact: true })).toBeVisible()
      await expect(timeline.getByText('Original answer', { exact: true })).toHaveCount(0)
      expect(requests['copy-revised'][0]).not.toContain('copy-original')
      expect(requests['copy-revised'][0]).not.toContain('Original answer')
      await waitEditable()

      await send('hold-stream')
      await expect(timeline.getByText('Streaming', { exact: false })).toBeVisible()
      await expect(edit).toHaveAttribute('aria-disabled', 'true')
      await timeline.getByRole('button', { name: 'Copy message', exact: true }).last().click()
      await expect
        .poll(() => launched.app.evaluate(({ clipboard }) => clipboard.readText()))
        .toBe('Streaming **partial** answer')
      await panel.getByRole('button', { name: 'Stop', exact: true }).click()
      await waitEditable()
      await edit.click()
      await editor.fill('after-stop')
      await panel.getByRole('button', { name: 'Save and restart' }).click()
      await expect(timeline.getByText('Answer for after-stop.', { exact: true })).toBeVisible()
      expect(requests['after-stop'][0]).not.toContain('Streaming **partial**')
      expect(requests['after-stop'][0]).toContain('copy-revised')
      await waitEditable()

      await send('pending-change')
      await expect(panel.getByText('Review required', { exact: true })).toBeVisible()
      await waitEditable()
      await edit.click()
      await editor.fill('after-proposal')
      await panel.getByRole('button', { name: 'Save and restart' }).click()
      await expect(timeline.getByText('Answer for after-proposal.', { exact: true })).toBeVisible()
      await expect(panel.getByText('Review required', { exact: true })).toHaveCount(0)
      await waitEditable()
      await send('apply-change')
      await expect(panel.getByText('Review required', { exact: true })).toBeVisible()
      await page.evaluate(async () => {
        const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
          ?.projectSessionId
        if (projectSessionId === undefined) throw new Error('No project')
        const session = (await window.desktop.agent.listSessions({ projectSessionId }))[0]
        const proposals = await window.desktop.agent.listProposals({
          projectSessionId,
          agentSessionId: session.agentSessionId
        })
        if (proposals.length !== 1) throw new Error('Superseded proposal remained actionable')
        await window.desktop.agent.approveProposal({
          projectSessionId,
          agentSessionId: session.agentSessionId,
          proposalId: proposals[0].proposalId
        })
      })
      await expect(edit).toHaveAttribute('aria-disabled', 'true')
      await edit.focus()
      await expect(page.getByRole('tooltip')).toContainText('changed project content')
      await panel.screenshot({ path: testInfo.outputPath('agent-message-actions.png') })
      const sizes = await panel.evaluate((node) => ({
        client: node.clientWidth,
        scroll: node.scrollWidth
      }))
      expect(sizes.scroll).toBeLessThanOrEqual(sizes.client)
    } finally {
      await launched.app.close()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
)
