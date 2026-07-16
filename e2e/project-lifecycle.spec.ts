import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { expect, launchApp, test } from './fixtures'

async function clickAndExpectProject(
  page: Page,
  action: string,
  displayName: string,
  projectName?: string
): Promise<void> {
  if (action === 'Switch project') {
    await page.getByRole('menuitem', { name: 'Project', exact: true }).click()
    await page.getByRole('menuitem', { name: action, exact: true }).click()
  } else {
    await page.getByRole('button', { name: action, exact: true }).click()
  }
  if (projectName !== undefined) {
    const dialog = page.getByRole('dialog', { name: 'Create project' })
    await dialog.getByLabel('Project name').fill(projectName)
    await dialog.getByRole('button', { name: 'Choose location' }).click()
  }
  await expect(page.getByRole('heading', { name: displayName, exact: true })).toBeVisible()
  await expect(page.getByText('Open', { exact: true })).toBeVisible()
}

async function closeProject(page: Page): Promise<void> {
  await page.getByRole('menuitem', { name: 'Project', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Close project', exact: true }).click()
}

async function clickRecentAndExpectProject(page: Page, displayName: string): Promise<void> {
  await page.getByRole('button', { name: `Open ${displayName}`, exact: true }).click()
  await expect(page.getByRole('heading', { name: displayName, exact: true })).toBeVisible()
  await expect(page.getByText('Open', { exact: true })).toBeVisible()
}

async function closeApp(app: ElectronApplication): Promise<void> {
  await app.close()
}

async function expectWindowMaximized(app: ElectronApplication, maximized: boolean): Promise<void> {
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMaximized())
    )
    .toBe(maximized)
}

async function manuallyRestoreWindow(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.unmaximize())
  await expectWindowMaximized(app, false)
}

test('configures provider metadata without returning a credential', async ({ testRoot }) => {
  let authorizationHeader: string | undefined
  const server = createServer((request, response) => {
    authorizationHeader = request.headers.authorization
    if (request.url === '/v1/models' && authorizationHeader === 'Bearer e2e-secret') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{"data":[]}')
      return
    }
    response.writeHead(401, { 'content-type': 'application/json' })
    response.end('{"error":"unauthorized"}')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = (server.address() as AddressInfo).port
  try {
    const userData = join(testRoot, 'provider-user-data')
    const portableProject = join(testRoot, 'Portable no key.writellm')
    await mkdir(userData)
    const first = await launchApp({ userData, dialogPaths: [testRoot] })
    try {
      await first.page.getByRole('button', { name: 'Settings', exact: true }).click()
      await first.page.getByRole('option', { name: /Agent model provider/ }).click()
      const dialog = first.page.getByRole('dialog', { name: 'Agent model' })
      await expect(dialog).toBeVisible()
      await dialog.getByLabel('Base URL').fill(`http://127.0.0.1:${port}/v1`)
      await dialog.getByLabel('Model ID').fill('writer-e2e')
      await dialog.getByLabel('API key or token').fill('e2e-secret')
      await dialog.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(dialog.getByText('Credential stored', { exact: true })).toBeVisible()
      await dialog.getByRole('button', { name: 'Test connection' }).click()
      await expect(dialog.getByText('Connected', { exact: true })).toBeVisible()
      await expect(dialog.getByText(/Connection succeeded\. \(\d+ ms\)/)).toBeVisible()
      expect(authorizationHeader).toBe('Bearer e2e-secret')
      await dialog.getByRole('button', { name: 'Close', exact: true }).first().click()
      await clickAndExpectProject(
        first.page,
        'Create project',
        'Portable no key',
        'Portable no key'
      )
    } finally {
      await closeApp(first.app)
    }

    const restarted = await launchApp({ userData })
    try {
      await restarted.page.getByRole('button', { name: 'Settings', exact: true }).click()
      await restarted.page.getByRole('option', { name: /Agent model provider/ }).click()
      const dialog = restarted.page.getByRole('dialog', { name: 'Agent model' })
      await expect(dialog.getByLabel('Base URL')).toHaveValue(`http://127.0.0.1:${port}/v1`)
      await expect(dialog.getByLabel('Model ID')).toHaveValue('writer-e2e')
      await expect(dialog.getByLabel('API key or token')).toHaveValue('')
    } finally {
      await closeApp(restarted.app)
    }

    const freshUserData = join(testRoot, 'fresh-provider-user-data')
    await mkdir(freshUserData)
    const portable = await launchApp({ userData: freshUserData, dialogPaths: [portableProject] })
    try {
      await clickAndExpectProject(portable.page, 'Open project', 'Portable no key')
      await expect(portable.page.locator('.bn-editor').first()).toBeVisible()
    } finally {
      await closeApp(portable.app)
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
})

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

    await expectWindowMaximized(first.app, true)
    await manuallyRestoreWindow(first.app)
    await clickAndExpectProject(first.page, 'Create project', 'Alpha project', 'Alpha project')
    await expectWindowMaximized(first.app, false)
    await expect(first.page.getByRole('menubar')).toBeVisible()
    await first.page.getByRole('button', { name: 'Manuscript', exact: true }).click()
    await expect(first.page.getByText('Untitled Section', { exact: true }).first()).toBeVisible()
    const editor = first.page.locator('.bn-editor').first()
    await expect(editor).toBeVisible()
    await editor.click()
    await first.page.keyboard.type('Close flush persistence')
    const firstAlphaSession = await first.page.evaluate(
      async () => (await window.desktop.projects.lifecycle()).activeProject?.projectSessionId
    )
    await closeProject(first.page)
    await expect(first.page.getByRole('heading', { name: /Open a workspace/ })).toBeVisible()
    await expectWindowMaximized(first.app, false)
    await clickAndExpectProject(first.page, 'Create project', 'Beta project', 'Beta project')
    await expectWindowMaximized(first.app, false)
    await closeProject(first.page)
    await expect(first.page.getByRole('heading', { name: /Open a workspace/ })).toBeVisible()
    await expectWindowMaximized(first.app, false)
    await clickAndExpectProject(first.page, 'Open project', 'Alpha project')
    await expectWindowMaximized(first.app, false)
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
    await expect(first.page.locator('.bn-editor').first()).toContainText('Close flush persistence')
    await first.page.getByRole('button', { name: 'Markdown', exact: true }).click()
    await first.page.getByRole('button', { name: 'Native JSON', exact: true }).click()
    const exportsDirectory = join(alpha, 'manuscript', 'exports')
    await expect
      .poll(async () => {
        const names = await readdir(exportsDirectory)
        return {
          markdown: names.some((name) => name.endsWith('.md')),
          native: names.some((name) => name.endsWith('.blocknote.json')),
          temporary: names.some((name) => name.endsWith('.tmp'))
        }
      })
      .toEqual({ markdown: true, native: true, temporary: false })
    const exportNames = await readdir(exportsDirectory)
    const markdownName = exportNames.find((name) => name.endsWith('.md'))
    const nativeName = exportNames.find((name) => name.endsWith('.blocknote.json'))
    expect(markdownName).toBeDefined()
    expect(nativeName).toBeDefined()
    await expect(
      readFile(join(exportsDirectory, markdownName as string), 'utf8')
    ).resolves.toContain('Close flush persistence')
    await expect(readFile(join(exportsDirectory, nativeName as string), 'utf8')).resolves.toContain(
      'Close flush persistence'
    )
    const materializations = await readdir(join(alpha, 'manuscript', 'sections'))
    expect(materializations).toHaveLength(1)
    await expect(
      readFile(join(alpha, 'manuscript', 'sections', materializations[0] as string), 'utf8')
    ).resolves.toContain('writellm-blocknote-section')
    await clickAndExpectProject(first.page, 'Switch project', 'Beta project')
    await expectWindowMaximized(first.app, false)
  } finally {
    await closeApp(first.app)
  }

  const restarted = await launchApp({ userData })
  try {
    await expectWindowMaximized(restarted.app, true)
    await expect(restarted.page.getByRole('heading', { name: /Open a workspace/ })).toBeVisible()
    await expect(
      restarted.page.getByRole('button', { name: 'Open Beta project', exact: true })
    ).toBeVisible()
    await manuallyRestoreWindow(restarted.app)
    await clickRecentAndExpectProject(restarted.page, 'Beta project')
    await expectWindowMaximized(restarted.app, false)
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
