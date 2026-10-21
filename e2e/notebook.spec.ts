import { join } from 'node:path'
import { expect, expectActiveProject, launchApp, scenario, test } from './fixtures'
import { createProject, closeProject as closeProjectAndWait } from './helpers/project'

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

      await closeProjectAndWait(launched.page, true)
      await launched.page.getByRole('button', { name: 'Open project', exact: true }).click()
      await expectActiveProject(launched.page, projectName)
      const reopened = await launched.page.evaluate(async () => {
        const sessionId = (await window.desktop.projects.lifecycle()).activeProject
          ?.projectSessionId
        if (sessionId === undefined) throw new Error('Project session missing')
        return {
          sessionId,
          snapshot: await window.desktop.notebook.create({ projectSessionId: sessionId })
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
