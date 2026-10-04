import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { imageFixture } from '../src/workers/agent-image-fixtures.test-support'
import { expect, expectActiveProject, launchApp, scenario, test } from './fixtures'

function complete(response: ServerResponse, content: string): void {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.end(
    `data: ${JSON.stringify({ id: 'image-answer', object: 'chat.completion.chunk', created: 1, model: 'image-writer', choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 123, completion_tokens: 5, total_tokens: 128 } })}\n\ndata: [DONE]\n\n`
  )
}

test(
  'imports selected, dropped and pasted images, preserves history and rejects unsupported models',
  scenario('agent.image-input', ['@packaged']),
  async ({ testRoot }, testInfo) => {
    const imageRequests: string[] = []
    const summaryRequests: string[] = []
    let answer = 0
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const raw = Buffer.concat(chunks).toString('utf8')
      const body = JSON.parse(raw) as { tools?: unknown[]; messages?: unknown[] }
      if (!body.tools?.length) {
        if (raw.includes('data:image')) summaryRequests.push(raw)
        complete(response, 'Image conversation summary')
      } else {
        imageRequests.push(raw)
        complete(response, `Image answer ${++answer}`)
      }
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const png = imageFixture().toString('base64')
    const selectedPath = join(testRoot, 'selected.jpg')
    await writeFile(selectedPath, imageFixture(3, 2, 'jpeg'))
    const launched = await launchApp({
      userData: join(testRoot, 'image-data'),
      dialogPaths: [testRoot]
    })
    try {
      const page = launched.page
      await page.evaluate(
        async (port) => {
          const presetId = 'custom:image-fixture'
          await window.desktop.providers.saveAgentPreset({
            presetId,
            name: 'Image Fixture',
            baseUrl: `http://127.0.0.1:${port}/v1`,
            api: 'openai-completions',
            authMode: 'api_key'
          })
          for (const [id, input] of [
            ['image-writer', ['text', 'image']],
            ['text-writer', ['text']]
          ] as const)
            await window.desktop.providers.saveAgentManualModel({
              presetId,
              model: {
                id,
                name: id,
                api: 'openai-completions',
                reasoning: false,
                input: [...input],
                contextWindow: 262144,
                maxTokens: 8192
              }
            })
          await window.desktop.providers.setAgentCredential({
            presetId,
            apiKey: 'image-fixture-key'
          })
          await window.desktop.providers.setAgentDefault({ presetId, modelId: 'image-writer' })
        },
        (server.address() as AddressInfo).port
      )
      const browserWindow = await launched.app.browserWindow(page)
      await browserWindow.evaluate((window) => {
        window.unmaximize()
        window.setContentSize(1680, 900)
      })
      await page.getByRole('button', { name: 'Create project', exact: true }).click()
      const create = page.getByRole('dialog', { name: 'Create project' })
      await create.getByLabel('Project name').fill('Image input')
      await create.getByRole('button', { name: 'Choose location' }).click()
      await expectActiveProject(page, 'Image input')
      await page.getByRole('button', { name: 'Manuscript', exact: true }).click()
      if (!(await page.getByTestId('agent-panel').isVisible()))
        await page.getByRole('button', { name: 'Agent', exact: true }).click()
      const panel = page.getByTestId('agent-panel')
      const composer = panel.getByLabel('Agent message')
      const draft = panel.locator('[data-align="block-start"] [aria-label="Image attachments"]')
      const timeline = panel.getByTestId('agent-event-timeline')
      // The native dialog seam stays in Main and returns the selected file to the existing handler.
      await launched.app.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
      }, selectedPath)
      await panel.getByTestId('agent-add-menu-trigger').click()
      await page.getByRole('option', { name: /Add images/ }).click()
      await expect(draft.locator('[data-state="done"]')).toHaveCount(1)
      const preview = draft.getByRole('button', { name: 'Preview selected.jpg' })
      await preview.focus()
      await expect(page.getByRole('tooltip')).toContainText('selected.jpg')
      await expect(page.getByRole('tooltip')).toContainText('3 × 2')
      await preview.press('Enter')
      await expect(
        page.getByRole('dialog', { name: 'selected.jpg' }).getByRole('img')
      ).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(preview).toBeFocused()
      await expect(draft.locator('[data-slot="attachment-content"]')).toHaveCount(0)
      const thumbnail = await draft.locator('[data-slot="attachment"]').boundingBox()
      expect(thumbnail?.width).toBe(80)
      expect(thumbnail?.height).toBe(80)
      const drop = async (names: string[]) =>
        panel.evaluate(
          (element, { names, png }) => {
            const transfer = new DataTransfer()
            for (const name of names)
              transfer.items.add(
                new File(
                  [Uint8Array.from(atob(png), (character) => character.charCodeAt(0))],
                  name,
                  { type: 'image/png' }
                )
              )
            element.dispatchEvent(
              new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })
            )
          },
          { names, png }
        )
      await drop(['dropped.png'])
      await expect(draft.locator('[data-state="done"]')).toHaveCount(2)
      await launched.app.evaluate(async ({ clipboard, ClipboardItem }, data) => {
        await clipboard.write([
          new ClipboardItem({ 'image/png': new Blob([Buffer.from(data, 'base64')]) })
        ])
      }, png)
      await composer.focus()
      await composer.press(process.platform === 'darwin' ? 'Meta+V' : 'Control+V')
      await expect(draft.locator('[data-state="done"]')).toHaveCount(3)
      // Exercise the native clipboard fallback when Chromium supplies no image File.
      await composer.evaluate((element) =>
        element.dispatchEvent(
          new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: new DataTransfer()
          })
        )
      )
      await expect(draft.locator('[data-state="done"]')).toHaveCount(4)
      await draft.getByRole('button', { name: 'Remove Pasted image' }).last().click()
      await expect(draft.locator('[data-state="done"]')).toHaveCount(3)
      await drop(['fourth.png'])
      await expect(draft.locator('[data-state="done"]')).toHaveCount(4)
      await drop(['fifth.png'])
      await expect(panel.getByText('Each message accepts up to four images.')).toBeVisible()
      await expect(draft.locator('[data-state="done"]')).toHaveCount(4)
      await draft.getByRole('button', { name: 'Remove fourth.png' }).click()
      await expect(draft.locator('[data-state="done"]')).toHaveCount(3)
      await expect(panel.getByRole('button', { name: 'Send', exact: true })).toBeEnabled()
      await composer.fill('Can you see these pictures?')
      await panel.screenshot({ path: testInfo.outputPath('agent-image-composer.png') })
      await page.evaluate(() => document.documentElement.classList.add('dark'))
      await panel.screenshot({ path: testInfo.outputPath('agent-image-composer-dark.png') })
      await page.evaluate(() => document.documentElement.classList.remove('dark'))
      await composer.fill('')
      await panel.getByRole('button', { name: 'Send', exact: true }).click()
      await expect(timeline.getByText('Image answer 1', { exact: true })).toBeVisible()
      await expect(draft).toHaveCount(0)
      await expect(timeline.getByRole('img')).toHaveCount(3)
      const imageMessage = timeline.locator('[data-slot="message"][data-align="end"]').first()
      await expect(imageMessage.locator('[data-slot="bubble"]')).toHaveCount(0)
      const historyImage = imageMessage.getByRole('img', { name: 'selected.jpg' })
      await expect(historyImage).toBeVisible()
      const historyBox = await imageMessage
        .locator('[data-slot="attachment"]')
        .first()
        .boundingBox()
      expect(historyBox?.width).toBeCloseTo(160, 0)
      expect(historyBox?.height).toBeCloseTo(160 / 1.5, 0)
      await expect(historyImage).toHaveCSS('object-fit', 'contain')
      expect(imageRequests[0].match(/data:image\/png;base64,/g)).toHaveLength(3)
      const edit = panel.getByRole('button', { name: 'Edit message', exact: true })
      await expect(edit).toHaveAttribute('aria-disabled', 'false')
      await edit.click()
      await panel.getByLabel('Edit sent message').fill('Edited image question')
      await panel.getByRole('button', { name: 'Save and restart' }).click()
      await expect(timeline.getByText('Image answer 2', { exact: true })).toBeVisible()
      await expect(imageMessage.locator('[data-slot="bubble-content"]')).toHaveText(
        'Edited image question'
      )
      await expect(imageMessage.locator('[data-slot="bubble"] img')).toHaveCount(0)
      await imageMessage.scrollIntoViewIfNeeded()
      await panel.screenshot({ path: testInfo.outputPath('agent-image-history.png') })
      await page.evaluate(() => document.documentElement.classList.add('dark'))
      await panel.screenshot({ path: testInfo.outputPath('agent-image-history-dark.png') })
      await page.evaluate(() => document.documentElement.classList.remove('dark'))
      expect(imageRequests[1].match(/data:image\/png;base64,/g)).toHaveLength(3)
      await expect(edit).toHaveAttribute('aria-disabled', 'false')
      await composer.fill('Remember the pictures')
      await panel.getByRole('button', { name: 'Send', exact: true }).click()
      await expect(timeline.getByText('Image answer 3', { exact: true })).toBeVisible()
      expect(imageRequests[2].match(/data:image\/png;base64,/g)).toHaveLength(3)
      await expect(edit).toHaveAttribute('aria-disabled', 'false')
      const scope = await page.evaluate(async () => {
        const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
          ?.projectSessionId
        if (!projectSessionId) throw new Error('Missing image project')
        const session = (await window.desktop.agent.listSessions({ projectSessionId }))[0]
        return { projectSessionId, agentSessionId: session.agentSessionId }
      })
      await page.evaluate(async (scope) => {
        await window.desktop.agent.compactSession(scope)
      }, scope)
      await expect.poll(() => summaryRequests.length).toBeGreaterThan(0)
      await expect(panel.getByTestId('agent-status')).not.toContainText('Summarizing')
      expect(summaryRequests[0].match(/data:image\/png;base64,/g)).toHaveLength(3)
      // Pause the native selection in Main while the renderer changes conversations.
      await launched.app.evaluate(({ dialog }, path) => {
        const testGlobal = globalThis as typeof globalThis & { finishAgentImageDialog?: () => void }
        dialog.showOpenDialog = async () => {
          await new Promise<void>((resolve) => {
            testGlobal.finishAgentImageDialog = resolve
          })
          return { canceled: false, filePaths: [path] }
        }
      }, selectedPath)
      await composer.fill('Original conversation draft')
      await panel.getByTestId('agent-add-menu-trigger').click()
      await page.getByRole('option', { name: /Add images/ }).click()
      await expect(draft.locator('[data-state="processing"]')).toHaveCount(1)
      await expect(panel.getByRole('button', { name: 'Send', exact: true })).toBeDisabled()
      await panel.getByTestId('agent-conversation-switcher').click()
      await page.getByRole('option', { name: 'New conversation', exact: true }).click()
      await composer.fill('Other conversation draft')
      await expect(draft).toHaveCount(0)
      await launched.app.evaluate(() => {
        const finish = (globalThis as typeof globalThis & { finishAgentImageDialog?: () => void })
          .finishAgentImageDialog
        if (!finish) throw new Error('Missing pending image selection')
        finish()
      })
      await expect(draft).toHaveCount(0)
      await panel.getByTestId('agent-conversation-switcher').click()
      await page.getByTestId(`agent-session-${scope.agentSessionId}`).click()
      await expect(composer).toHaveValue('Original conversation draft')
      await expect(draft.locator('[data-state="done"]')).toHaveCount(1)
      await draft.getByRole('button', { name: 'Remove selected.jpg' }).click()
      await drop(['model-check.png'])
      await expect(draft.locator('[data-state="done"]')).toHaveCount(1)
      await composer.fill('Keep this draft')
      await composer.evaluate((element) => {
        const transfer = new DataTransfer()
        transfer.items.add(new File(['not an image'], 'corrupt.png', { type: 'image/png' }))
        element.dispatchEvent(
          new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer })
        )
      })
      await expect(draft.locator('[data-state="error"]')).toHaveCount(1)
      await expect(draft.locator('[data-state="done"]')).toHaveCount(1)
      await expect(composer).toHaveValue('Keep this draft')
      await draft.getByRole('button', { name: 'Remove corrupt.png' }).click()
      await page.evaluate(async (scope) => {
        await window.desktop.agent.setModelSelection({
          ...scope,
          selection: { presetId: 'custom:image-fixture', modelId: 'text-writer' }
        })
      }, scope)
      await composer.fill('Keep this draft')
      await panel.getByRole('button', { name: 'Send', exact: true }).click()
      await expect(panel.getByText(/does not support image input/)).toBeVisible()
      await expect(composer).toHaveValue('Keep this draft')
      await expect(draft.locator('[data-state="done"]')).toHaveCount(1)
      const size = await panel.evaluate((element) => ({
        client: element.clientWidth,
        scroll: element.scrollWidth
      }))
      expect(size.scroll).toBeLessThanOrEqual(size.client)
      await panel.screenshot({ path: testInfo.outputPath('agent-image-model-error.png') })
    } finally {
      await launched.app.close()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
)
