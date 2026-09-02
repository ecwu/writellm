import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, expectActiveProject, launchApp, scenario, test } from './fixtures'

async function createProject(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Create project', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create project' })
  await dialog.getByLabel('Project name').fill(name)
  await dialog.getByRole('button', { name: 'Choose location' }).click()
  await expectActiveProject(page, name)
}

async function closeProject(page: Page): Promise<void> {
  await page.getByRole('menuitem', { name: 'Project', exact: true }).click()
  await page
    .getByRole('menuitem', { name: 'Close project and return to chooser', exact: true })
    .click()
}

async function currentProjectSessionId(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
      ?.projectSessionId
    if (projectSessionId === undefined) throw new Error('Project session missing')
    return projectSessionId
  })
}

test(
  'remembers explicit Thinking choices while keeping existing conversations isolated',
  scenario('agent.thinking-level-memory'),
  async ({ testRoot }) => {
    const userData = join(testRoot, 'thinking-user-data')
    const launched = await launchApp({ userData, dialogPaths: [testRoot, testRoot] })
    try {
      await launched.page.evaluate(async () => {
        const initial = (await window.desktop.providers.snapshot()).agentCatalog
        const preset = initial.presets.find(
          (candidate) =>
            candidate.kind === 'builtin' &&
            candidate.authMethods.includes('api_key') &&
            candidate.models.some((model) => model.supportedThinkingLevels.includes('high'))
        )
        const model = preset?.models.find((candidate) =>
          candidate.supportedThinkingLevels.includes('high')
        )
        if (preset === undefined || model === undefined) {
          throw new Error('Expected a packaged Pi reasoning model with API-key authentication')
        }
        if (!preset.enabled) {
          await window.desktop.providers.setAgentProviderEnabled({
            presetId: preset.presetId,
            enabled: true
          })
        }
        if (!model.enabled) {
          await window.desktop.providers.setAgentModelEnabled({
            presetId: preset.presetId,
            modelId: model.id,
            enabled: true
          })
        }
        await window.desktop.providers.setAgentCredential({
          presetId: preset.presetId,
          apiKey: 'e2e-virtual-credential'
        })
        await window.desktop.providers.setAgentDefault({
          presetId: preset.presetId,
          modelId: model.id
        })
        return { presetId: preset.presetId, modelId: model.id }
      })

      await createProject(launched.page, 'Thinking Alpha')
      await launched.page.getByRole('button', { name: 'Agent', exact: true }).click()
      const panel = launched.page.getByTestId('agent-panel')
      await panel.getByTestId('agent-conversation-menu').click()
      await launched.page.getByRole('menuitem', { name: 'Details', exact: true }).click()
      let details = launched.page.getByRole('dialog', { name: 'Agent details' })
      let thinking = details.getByTestId('agent-thinking-selector')
      await expect(thinking).toHaveAttribute('aria-label', 'Thinking level: Medium')

      await thinking.focus()
      await launched.page.keyboard.press('Enter')
      await expect(launched.page.getByTestId('agent-thinking-menu')).toBeVisible()
      await launched.page.getByRole('menuitemradio', { name: 'High', exact: true }).click()
      await expect(thinking).toHaveAttribute('aria-label', 'Thinking level: High')
      const alphaProjectSessionId = await currentProjectSessionId(launched.page)
      const firstSessionId = await launched.page.evaluate(async (projectSessionId) => {
        const sessions = await window.desktop.agent.listSessions({ projectSessionId })
        const session = sessions[0]
        if (session === undefined) throw new Error('First conversation missing')
        return session.agentSessionId
      }, alphaProjectSessionId)

      await launched.page.keyboard.press('Escape')
      await expect(panel.getByTestId('agent-model-selector')).toContainText(/high/)
      await panel.getByTestId('agent-conversation-switcher').click()
      await launched.page.getByRole('option', { name: 'New conversation', exact: true }).click()
      await panel.getByTestId('agent-conversation-menu').click()
      await launched.page.getByRole('menuitem', { name: 'Details', exact: true }).click()
      details = launched.page.getByRole('dialog', { name: 'Agent details' })
      thinking = details.getByTestId('agent-thinking-selector')
      await expect(thinking).toHaveAttribute('aria-label', 'Thinking level: High')
      await thinking.click()
      await launched.page.getByRole('menuitemradio', { name: 'Low', exact: true }).click()
      await expect(thinking).toHaveAttribute('aria-label', 'Thinking level: Low')
      await expect
        .poll(() =>
          launched.page.evaluate(
            async ({ projectSessionId, firstAgentSessionId }) => {
              const sessions = await window.desktop.agent.listSessions({ projectSessionId })
              return {
                first: sessions.find((session) => session.agentSessionId === firstAgentSessionId)
                  ?.thinkingLevel,
                newest: sessions[0]?.thinkingLevel
              }
            },
            { projectSessionId: alphaProjectSessionId, firstAgentSessionId: firstSessionId }
          )
        )
        .toEqual({ first: 'high', newest: 'low' })

      await launched.page.keyboard.press('Escape')
      await panel.getByLabel('Close writing agent').click()
      await closeProject(launched.page)
      await createProject(launched.page, 'Thinking Beta')
      await launched.page.getByRole('button', { name: 'Agent', exact: true }).click()
      await panel.getByTestId('agent-conversation-menu').click()
      await launched.page.getByRole('menuitem', { name: 'Details', exact: true }).click()
      await expect(
        launched.page
          .getByRole('dialog', { name: 'Agent details' })
          .getByTestId('agent-thinking-selector')
      ).toHaveAttribute('aria-label', 'Thinking level: Low')
      const betaProjectSessionId = await currentProjectSessionId(launched.page)
      await expect(
        launched.page.evaluate(async (projectSessionId) => {
          return window.desktop.agent.listSessions({ projectSessionId })
        }, betaProjectSessionId)
      ).resolves.toEqual([])

      await launched.page.reload()
      await expectActiveProject(launched.page, 'Thinking Beta')
      await expect(
        launched.page.evaluate(async (projectSessionId) => {
          return window.desktop.agent.listSessions({ projectSessionId })
        }, betaProjectSessionId)
      ).resolves.toEqual([])
    } finally {
      await launched.app.close()
    }
  }
)
