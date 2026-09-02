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
  await expect
    .poll(async () => (await page.evaluate(() => window.desktop.projects.lifecycle())).state)
    .toBe('closed')
}

test(
  'keeps Notebook independent from Knowledge and resets it with the project session',
  scenario('notebook.transient-workspace', ['@critical', '@packaged']),
  async ({ testRoot }) => {
    const projectName = 'Transient Notebook'
    const projectRoot = join(testRoot, `${projectName}.writellm`)
    const launched = await launchApp({
      userData: join(testRoot, 'user-data'),
      dialogPaths: [testRoot, projectRoot]
    })
    try {
      await createProject(launched.page, projectName)
      const firstSessionId = await launched.page.evaluate(
        async () => (await window.desktop.projects.lifecycle()).activeProject?.projectSessionId
      )
      expect(firstSessionId).toBeTruthy()

      await launched.page.getByRole('button', { name: 'Knowledge', exact: true }).click()
      await expect(launched.page.getByTestId('knowledge-workspace')).toBeVisible()

      await launched.page.getByRole('button', { name: 'Notebook', exact: true }).click()
      const notebook = launched.page.getByTestId('notebook-workspace')
      await expect(notebook).toBeVisible()
      await expect(notebook.getByText('Add Knowledge sources first', { exact: true })).toBeVisible()
      await expect(notebook.getByRole('button', { name: 'Manage sources' })).toBeVisible()
      await expect(notebook.getByRole('button', { name: 'Ask Notebook' })).toBeDisabled()
      await expect(
        notebook.getByText(
          'WriteLLM does not save this chat. Your model provider receives the question and retrieved passages under its own retention policy.',
          { exact: true }
        )
      ).toBeVisible()

      await notebook.getByRole('button', { name: 'Manage sources' }).click()
      await expect(launched.page.getByTestId('knowledge-workspace')).toBeVisible()
      await launched.page.getByRole('button', { name: 'Notebook', exact: true }).click()
      await expect(launched.page.getByTestId('notebook-workspace')).toBeVisible()

      await closeProject(launched.page)
      await launched.page.getByRole('button', { name: 'Open project', exact: true }).click()
      await expectActiveProject(launched.page, projectName)
      const reopened = await launched.page.evaluate(async () => {
        const sessionId = (await window.desktop.projects.lifecycle()).activeProject
          ?.projectSessionId
        if (sessionId === undefined) throw new Error('Project session missing')
        return {
          sessionId,
          snapshot: await window.desktop.notebook.snapshot({ projectSessionId: sessionId })
        }
      })
      expect(reopened.sessionId).not.toBe(firstSessionId)
      expect(reopened.snapshot.messages).toEqual([])
      expect(reopened.snapshot.sourceScope).toEqual({ mode: 'all', knowledgeItemIds: [] })
    } finally {
      await launched.app.close()
    }
  }
)
