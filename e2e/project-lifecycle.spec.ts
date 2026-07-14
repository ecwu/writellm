import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { expect, launchApp, test } from './fixtures'

async function clickAndExpectProject(
  page: Page,
  action: string,
  displayName: string,
  projectName?: string
): Promise<void> {
  await page.getByRole('button', { name: action, exact: true }).click()
  if (projectName !== undefined) {
    const dialog = page.getByRole('dialog', { name: 'Create project' })
    await dialog.getByLabel('Project name').fill(projectName)
    await dialog.getByRole('button', { name: 'Choose location' }).click()
  }
  await expect(page.getByRole('heading', { name: displayName, exact: true })).toBeVisible()
  await expect(page.getByText('Open', { exact: true })).toBeVisible()
}

async function clickRecentAndExpectProject(page: Page, displayName: string): Promise<void> {
  await page.getByRole('button', { name: `Open ${displayName}`, exact: true }).click()
  await expect(page.getByRole('heading', { name: displayName, exact: true })).toBeVisible()
  await expect(page.getByText('Open', { exact: true })).toBeVisible()
}

async function closeApp(app: ElectronApplication): Promise<void> {
  await app.close()
}

async function expectProjectMaximized(app: ElectronApplication): Promise<void> {
  await expect(
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMaximized())
  ).resolves.toBe(true)
}

async function expectProjectWindowed(app: ElectronApplication): Promise<void> {
  await expect(
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMaximized())
  ).resolves.toBe(false)
}

test('creates, closes, reopens, switches, and reopens after app restart', async ({ testRoot }) => {
  const userData = join(testRoot, 'user-data')
  const alpha = join(testRoot, 'Alpha project.writellm')
  const beta = join(testRoot, 'Beta project.writellm')

  const first = await launchApp({ userData, dialogPaths: [testRoot, testRoot, alpha, beta] })
  try {
    await expect(first.page.getByRole('menubar')).toBeVisible()
    await first.page.getByRole('button', { name: 'Settings', exact: true }).click()
    await expect(first.page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
    await expect(first.page.getByText('API configuration', { exact: true })).toBeVisible()
    await first.page.keyboard.press('Escape')

    await clickAndExpectProject(first.page, 'Create project', 'Alpha project', 'Alpha project')
    await expectProjectMaximized(first.app)
    await expect(first.page.getByRole('menubar')).toBeVisible()
    await first.page.getByRole('button', { name: 'Manuscript', exact: true }).click()
    await expect(first.page.getByText('Untitled section', { exact: true }).first()).toBeVisible()
    const firstAlphaSession = await first.page.evaluate(
      async () => (await window.desktop.projects.lifecycle()).activeProject?.projectSessionId
    )
    await first.page.getByRole('button', { name: 'Close project' }).click()
    await expect(first.page.getByRole('heading', { name: /Open a workspace/ })).toBeVisible()
    await expectProjectWindowed(first.app)
    await clickAndExpectProject(first.page, 'Create project', 'Beta project', 'Beta project')
    await first.page.getByRole('button', { name: 'Close project' }).click()
    await expect(first.page.getByRole('heading', { name: /Open a workspace/ })).toBeVisible()
    await clickAndExpectProject(first.page, 'Open project', 'Alpha project')
    await expectProjectMaximized(first.app)
    const reopenedAlphaSession = await first.page.evaluate(
      async () => (await window.desktop.projects.lifecycle()).activeProject?.projectSessionId
    )
    expect(reopenedAlphaSession).not.toBe(firstAlphaSession)
    await expect(
      first.page.evaluate(async (projectSessionId) => {
        try {
          await window.desktop.projects.close({ projectSessionId })
          return false
        } catch {
          return true
        }
      }, firstAlphaSession as string)
    ).resolves.toBe(true)
    await expect(first.page.getByRole('heading', { name: 'Alpha project' })).toBeVisible()
    await clickAndExpectProject(first.page, 'Switch project', 'Beta project')
    await expectProjectMaximized(first.app)
  } finally {
    await closeApp(first.app)
  }

  const restarted = await launchApp({ userData })
  try {
    await expect(restarted.page.getByRole('heading', { name: /Open a workspace/ })).toBeVisible()
    await expect(
      restarted.page.getByRole('button', { name: 'Open Beta project', exact: true })
    ).toBeVisible()
    await clickRecentAndExpectProject(restarted.page, 'Beta project')
    await expectProjectMaximized(restarted.app)
  } finally {
    await closeApp(restarted.app)
  }
})

test('creates in a non-empty parent and retries after an existing-name conflict', async ({
  testRoot
}) => {
  const parent = join(testRoot, 'Projects')
  const conflict = join(parent, 'Existing.writellm')
  const accepted = join(parent, 'New project.writellm')
  const existingContent = 'do not modify'
  await mkdir(parent)
  await mkdir(conflict)
  await writeFile(join(parent, 'existing.txt'), existingContent)
  await writeFile(join(conflict, 'existing.txt'), existingContent)

  const launched = await launchApp({
    userData: join(testRoot, 'user-data'),
    dialogPaths: [parent, parent]
  })
  try {
    await launched.page.getByRole('button', { name: 'Create project' }).click()
    await launched.page.getByRole('dialog').getByLabel('Project name').fill('Existing')
    await launched.page.getByRole('dialog').getByRole('button', { name: 'Choose location' }).click()
    await expect(launched.page.getByRole('alert')).toContainText(
      'WriteLLM could not create the project'
    )
    await expect(launched.page.getByText('Closed', { exact: true })).toBeVisible()
    await expect(readFile(join(conflict, 'existing.txt'), 'utf8')).resolves.toBe(existingContent)

    await clickAndExpectProject(launched.page, 'Create project', 'New project', 'New project')
    await expect(readFile(join(parent, 'existing.txt'), 'utf8')).resolves.toBe(existingContent)
    await expect(readFile(join(accepted, 'writellm.project.json'), 'utf8')).resolves.toContain(
      'writellm-project'
    )
  } finally {
    await closeApp(launched.app)
  }
})

test('opens a moved root with the stable manifest project ID', async ({ testRoot }) => {
  const userData = join(testRoot, 'user-data')
  const original = join(testRoot, 'Original name.writellm')
  const moved = join(testRoot, 'Moved name.writellm')

  const creating = await launchApp({ userData, dialogPaths: [testRoot] })
  let originalProjectId: string
  try {
    await clickAndExpectProject(creating.page, 'Create project', 'Original name', 'Original name')
    originalProjectId = JSON.parse(
      await readFile(join(original, 'writellm.project.json'), 'utf8')
    ).projectId
  } finally {
    await closeApp(creating.app)
  }

  await rename(original, moved)
  const reopening = await launchApp({ userData, dialogPaths: [moved] })
  try {
    await clickAndExpectProject(reopening.page, 'Open project', 'Moved name')
    const movedProjectId = JSON.parse(
      await readFile(join(moved, 'writellm.project.json'), 'utf8')
    ).projectId
    expect(movedProjectId).toBe(originalProjectId)
  } finally {
    await closeApp(reopening.app)
  }
})

test('rejects lock contention across two application processes', async ({ testRoot }) => {
  const projectRoot = join(testRoot, 'Contended project.writellm')

  const owner = await launchApp({
    userData: join(testRoot, 'owner-user-data'),
    dialogPaths: [testRoot]
  })
  try {
    await clickAndExpectProject(
      owner.page,
      'Create project',
      'Contended project',
      'Contended project'
    )

    const contender = await launchApp({
      userData: join(testRoot, 'contender-user-data'),
      dialogPaths: [projectRoot]
    })
    try {
      await contender.page.getByRole('button', { name: 'Open project' }).click()
      await expect(contender.page.getByRole('alert')).toContainText(
        'WriteLLM could not open the project'
      )
      await expect(contender.page.getByRole('heading', { name: /Open a workspace/ })).toBeVisible()
      await expect(owner.page.getByRole('heading', { name: 'Contended project' })).toBeVisible()
    } finally {
      await closeApp(contender.app)
    }
  } finally {
    await closeApp(owner.app)
  }
})
