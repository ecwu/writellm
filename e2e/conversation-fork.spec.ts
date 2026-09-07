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

test(
  'forks complete replies without model work, navigates sources and restores frozen branches',
  scenario('agent.conversation-fork', ['@packaged']),
  async ({ testRoot }, testInfo) => {
    const requests: string[] = []
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const raw = Buffer.concat(chunks).toString('utf8')
      const body = JSON.parse(raw) as {
        tools?: unknown[]
        messages?: Array<{ role: string; content: unknown }>
      }
      if (body.tools?.length) requests.push(raw)
      const last = JSON.stringify(
        body.messages?.findLast((message) => message.role === 'user')?.content ?? ''
      )
      complete(
        response,
        body.tools?.length
          ? last.includes('different-angle')
            ? 'Branch answer'
            : last.includes('future-question')
              ? 'Future answer'
              : 'Original answer'
          : 'Fork source'
      )
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const userData = join(testRoot, 'fork-data')
    const launched = await launchApp({ userData, dialogPaths: [testRoot] })
    let current = launched
    try {
      await launched.page.evaluate(
        async (port) => {
          const presetId = 'custom:fork-fixture'
          await window.desktop.providers.saveAgentPreset({
            presetId,
            name: 'Fork Fixture',
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
            apiKey: 'fork-fixture-key'
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
      await create.getByLabel('Project name').fill('Conversation fork')
      await create.getByRole('button', { name: 'Choose location' }).click()
      await expectActiveProject(page, 'Conversation fork')
      await page.getByRole('button', { name: 'Manuscript', exact: true }).click()
      await page.getByRole('button', { name: 'Agent', exact: true }).click()
      const panel = page.getByTestId('agent-panel')
      const timeline = panel.getByTestId('agent-event-timeline')
      const send = async (text: string) => {
        await panel.getByLabel('Agent message').fill(text)
        await panel.getByRole('button', { name: 'Send', exact: true }).click()
      }

      await send('original-question')
      await expect(timeline.getByText('Original answer', { exact: true })).toBeVisible()
      const forkButtons = timeline.getByRole('button', { name: '从这里分叉', exact: true })
      await expect(forkButtons).toHaveCount(1)
      await send('future-question')
      await expect(timeline.getByText('Future answer', { exact: true })).toBeVisible()
      await expect(forkButtons).toHaveCount(2)
      await panel.getByLabel('Agent message').fill('Keep original draft')
      const beforeFork = requests.length
      await forkButtons.first().focus()
      await forkButtons.first().press('Enter')
      await expect(timeline.getByText('从这里开始新分支', { exact: true })).toBeVisible()
      await expect(timeline.getByText('Future answer', { exact: true })).toHaveCount(0)
      await expect(panel.getByLabel('Agent message')).toHaveValue('')
      await expect(panel.getByLabel('Agent message')).toBeFocused()
      expect(requests).toHaveLength(beforeFork)
      await send('different-angle')
      await expect(timeline.getByText('Branch answer', { exact: true })).toBeVisible()
      await expect(forkButtons).toHaveCount(2)
      expect(requests.at(-1)).toContain('original-question')
      expect(requests.at(-1)).toContain('Original answer')
      expect(requests.at(-1)).not.toContain('future-question')
      expect(requests.at(-1)).not.toContain('Future answer')
      await panel.getByRole('button', { name: /^分叉自：/ }).click()
      await expect(timeline.getByText('Future answer', { exact: true })).toBeVisible()
      await expect(panel.getByLabel('Agent message')).toHaveValue('Keep original draft')
      await expect(timeline.getByText('Branch answer', { exact: true })).toHaveCount(0)
      // Create another child and fork its inherited reply, with no additional model requests.
      const count = requests.length
      await forkButtons.first().click()
      await expect(panel.getByRole('button', { name: /^分叉自：/ })).toBeVisible()
      await expect(panel.getByLabel('Agent message')).toBeFocused()
      await forkButtons.first().click()
      await expect(panel.getByRole('button', { name: /^分叉自：.*分支/ })).toBeVisible()
      await expect(panel.getByLabel('Agent message')).toBeFocused()
      expect(requests).toHaveLength(count)
      await page.screenshot({ path: testInfo.outputPath('conversation-fork.png') })
      await launched.app.close()
      current = await launchApp({ userData })
      await current.page
        .getByRole('button', { name: 'Open Conversation fork', exact: true })
        .click()
      await expectActiveProject(current.page, 'Conversation fork')
      await current.page.getByRole('button', { name: 'Agent', exact: true }).click()
      const restored = current.page.getByTestId('agent-panel')
      await expect(restored.getByText('从这里开始新分支', { exact: true })).toBeVisible()
      await expect(restored.getByText('Original answer', { exact: true })).toBeVisible()
      await expect(restored.getByText('Future answer', { exact: true })).toHaveCount(0)
      await restored.getByRole('button', { name: /^分叉自：/ }).click()
      await expect(restored.getByText('从这里开始新分支', { exact: true })).toBeVisible()
      const replaced = await current.page.evaluate(async () => {
        const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
          ?.projectSessionId
        if (!projectSessionId) throw new Error('Missing project')
        const root = (await window.desktop.agent.listSessions({ projectSessionId })).find(
          (session) => !session.fork
        )
        if (!root?.messageEdit?.targetEventId) throw new Error('Missing original session')
        const history = await window.desktop.agent.listEvents({
          projectSessionId,
          agentSessionId: root.agentSessionId
        })
        const target = history.events.findLast((event) => event.type === 'assistant_message')
        if (!target) throw new Error('Missing source reply')
        const child = await window.desktop.agent.forkConversation({
          projectSessionId,
          sourceSessionId: root.agentSessionId,
          targetEventId: target.agentEventId,
          requestId: crypto.randomUUID()
        })
        return {
          projectSessionId,
          rootId: root.agentSessionId,
          childId: child.agentSessionId,
          edit: root.messageEdit
        }
      })
      await restored.getByTestId('agent-conversation-switcher').click()
      await current.page.getByTestId(`agent-session-${replaced.childId}`).click()
      await expect(restored.getByText('Future answer', { exact: true })).toBeVisible()
      await current.page.evaluate(async (input) => {
        if (!input.edit.targetEventId) throw new Error('Missing edit target')
        await window.desktop.agent.editLastMessageAndRestart({
          projectSessionId: input.projectSessionId,
          agentSessionId: input.rootId,
          targetEventId: input.edit.targetEventId,
          expectedThroughSequence: input.edit.throughSequence,
          content: 'replacement-angle',
          editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
        })
      }, replaced)
      await expect
        .poll(() =>
          current.page.evaluate(
            async (input) =>
              (
                await window.desktop.agent.getSession({
                  projectSessionId: input.projectSessionId,
                  agentSessionId: input.rootId
                })
              ).workflowState,
            replaced
          )
        )
        .toBe('idle')
      await current.page.evaluate(async (input) => {
        await window.desktop.agent.archiveSession({
          projectSessionId: input.projectSessionId,
          agentSessionId: input.rootId
        })
      }, replaced)
      await expect(restored.getByText('Future answer', { exact: true })).toBeVisible()
      await restored.getByRole('button', { name: /^分叉自：/ }).click()
      await expect(
        restored.getByText('来源消息已被替换，当前显示来源会话。分支历史保持不变。', {
          exact: true
        })
      ).toBeVisible()
      expect(
        await current.page.evaluate(
          async (input) =>
            (
              await window.desktop.agent.getSession({
                projectSessionId: input.projectSessionId,
                agentSessionId: input.rootId
              })
            ).status,
          replaced
        )
      ).toBe('archived')
    } finally {
      await current.app.close()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
)
