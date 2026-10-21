import { pressAppShortcut } from './application-menu'
import { agentToggle } from './application-menu'
import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { expect, launchApp, scenario, sectionEditor, test } from './fixtures'
import { configureAgentProvider, createProject } from './helpers/project'
import { sendCompletion as sendSharedCompletion } from './helpers/mock-provider-sse'

test(
  'runs an exact selection quick action through the normal Agent conversation',
  scenario('agent.selection-quick-actions'),
  async ({ testRoot }) => {
    const agentRequests: unknown[] = []
    const server = createServer((request, response) => {
      if (request.method === 'GET' && request.url === '/v1/models') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end('{"data":[{"id":"quick-writer","displayName":"Quick Writer"}]}')
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
            sendCompletion(response, 'Evidence review')
            return
          }
          agentRequests.push(body)
          sendCompletion(
            response,
            'The selected claim is clear but has no linked project evidence. Review completed; no manuscript change is proposed.'
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
    const launched = await launchApp({
      userData: join(testRoot, 'user-data'),
      dialogPaths: [testRoot]
    })
    try {
      await configureAgentProvider(launched.page, `http://127.0.0.1:${port}/v1`, {
        providerName: 'Quick action Agent',
        apiKey: 'e2e-secret'
      })
      await createProject(launched.page, 'Quick action project')
      await launched.page.getByLabel('Section title').fill('Evidence notes')
      await launched.page.getByLabel('Section title').press('Tab')
      const editor = sectionEditor(launched.page)
      await editor.fill('This exact claim needs evidence.')
      await pressAppShortcut(launched.page, 'ControlOrMeta+s')

      if ((await agentToggle(launched.page).getAttribute('aria-pressed')) !== 'true')
        await agentToggle(launched.page).click()
      const panel = launched.page.getByTestId('agent-panel')
      await panel.getByTestId('agent-conversation-menu').click()
      await launched.page.getByRole('menuitem', { name: 'Details', exact: true }).click()
      const details = launched.page.getByRole('dialog', { name: 'Agent details' })
      await details.getByLabel('Agent model').click()
      const modelPicker = launched.page.getByTestId('agent-model-picker')
      await modelPicker.getByRole('option', { name: /Quick action Agent/ }).click()
      await modelPicker.getByRole('option', { name: /Quick Writer/ }).click()
      await details.getByRole('button', { name: 'Close', exact: true }).click()
      const composer = panel.locator('#agent-message')
      await expect(composer).toBeVisible()
      await composer.focus()
      for (const modifier of ['Control', 'Meta']) {
        for (const extra of ['', 'Shift+', 'Alt+', 'Alt+Shift+']) {
          for (const key of ['b', 'j']) {
            await composer.press(`${modifier}+${extra}${key}`)
            await expect(
              launched.page.getByRole('button', { name: 'Move Outline', exact: true })
            ).toBeVisible()
            await expect(agentToggle(launched.page)).toHaveAttribute('aria-pressed', 'true')
          }
        }
      }
      await composer.fill('')
      await launched.page.getByRole('button', { name: 'Close writing agent' }).click()

      const quickActionTrigger = launched.page.getByRole('button', {
        name: 'Open Agent quick actions'
      })
      const selectClaim = async (): Promise<void> => {
        await editor.locator('p').first().click()
        await launched.page.keyboard.press(
          process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Home'
        )
        await launched.page.keyboard.press(
          process.platform === 'darwin' ? 'Meta+Shift+ArrowRight' : 'Shift+End'
        )
        await expect
          .poll(() => launched.page.evaluate(() => window.getSelection()?.toString()))
          .toBe('This exact claim needs evidence.')
        await expect(quickActionTrigger).toBeVisible()
      }
      const quickActions = launched.page.getByRole('menu', {
        name: 'Quick AI actions',
        exact: true
      })

      await editor.click()
      await selectClaim()
      // An extra modifier is not the quick-action shortcut.
      await pressAppShortcut(launched.page, 'ControlOrMeta+Alt+Shift+k')
      await expect(launched.page.getByRole('menuitem', { name: /Check evidence/ })).toHaveCount(0)

      await selectClaim()
      // Restore editor focus and selection before dispatching each Chromium shortcut.
      await expect(async () => {
        await selectClaim()
        await expect(editor).toBeFocused()
        await pressAppShortcut(launched.page, 'ControlOrMeta+Shift+k')
        await expect(quickActions).toBeVisible({ timeout: 1_000 })
      }).toPass()
      await launched.page.keyboard.press('Escape')
      await expect(quickActions).toBeHidden()

      // A mouse click on the toolbar trigger must keep the toolbar and its menu mounted.
      await selectClaim()
      await quickActionTrigger.click()
      await expect(quickActions).toBeVisible()
      await launched.page.getByRole('menuitem', { name: /Check evidence/ }).click()

      await expect(panel).toBeVisible()
      await expect(panel.getByText('Quick action · Check evidence', { exact: true })).toBeVisible()
      await expect(panel.getByText('Captured selection', { exact: true })).toBeVisible()
      await expect(
        panel.getByText('This exact claim needs evidence.', { exact: true })
      ).toBeVisible()
      await expect(
        panel.getByText(
          'The selected claim is clear but has no linked project evidence. Review completed; no manuscript change is proposed.',
          { exact: true }
        )
      ).toBeVisible()
      await expect(panel.getByTestId('agent-status')).toContainText('Ready')
      await expect(panel.getByRole('button', { name: /Apply/ })).toHaveCount(0)

      const truth = await launched.page.evaluate(async () => {
        const project = (await window.desktop.projects.lifecycle()).activeProject
        if (project === undefined || project === null) throw new Error('Project is not open')
        const session = (
          await window.desktop.agent.listSessions({ projectSessionId: project.projectSessionId })
        )[0]
        if (session === undefined) throw new Error('Agent session is missing')
        const runs = await window.desktop.agent.listRuns({
          projectSessionId: project.projectSessionId,
          agentSessionId: session.agentSessionId
        })
        const proposals = await window.desktop.agent.listProposals({
          projectSessionId: project.projectSessionId,
          agentSessionId: session.agentSessionId
        })
        return { session, runs, proposals }
      })
      expect(truth.runs[0]?.editorContext).toMatchObject({
        selectedText: 'This exact claim needs evidence.',
        selectedBlockIds: expect.arrayContaining([expect.any(String)])
      })
      expect(truth.proposals).toEqual([])
      expect(agentRequests).toHaveLength(1)
      const requestText = JSON.stringify(agentRequests[0])
      expect(requestText).toContain('QUICK_ACTION_SELECTION')
      expect(requestText).toContain('This exact claim needs evidence.')
      expect(requestText).toContain('review-only response with no proposal is a successful outcome')
    } finally {
      await launched.app.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
)

function sendCompletion(response: ServerResponse, content: string): void {
  sendSharedCompletion(response, content, {
    id: 'quick-action-response',
    model: 'quick-writer',
    requestId: null,
    promptTokens: 20,
    completionTokens: 12
  })
}
