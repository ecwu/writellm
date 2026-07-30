import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { expect, expectActiveProject, launchApp, test, WINDOW_PRESENTATION_ENV } from './fixtures'

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
  await expectActiveProject(page, displayName)
}

async function closeProject(page: Page): Promise<void> {
  await page.getByRole('menuitem', { name: 'Project', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Close project', exact: true }).click()
}

async function clickRecentAndExpectProject(page: Page, displayName: string): Promise<void> {
  await page.getByRole('button', { name: `Open ${displayName}`, exact: true }).click()
  await expectActiveProject(page, displayName)
}

async function closeApp(app: ElectronApplication): Promise<void> {
  await app.close()
}

function errorToast(page: Page, message: string) {
  return page.locator('[data-sonner-toast][data-type="error"]').filter({ hasText: message })
}

async function expectWindowMaximized(app: ElectronApplication, maximized: boolean): Promise<void> {
  // macOS may make a hidden BrowserWindow visible when it is maximized. The
  // silent suite deliberately skips that OS presentation assertion; the
  // visible command continues to exercise the product window-state contract.
  if (maximized && process.env[WINDOW_PRESENTATION_ENV] !== 'interactive') return
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
      response.end('{"data":[{"id":"writer-e2e","displayName":"Writer E2E"}]}')
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
      const dialog = first.page.getByRole('dialog', { name: 'Settings' })
      await dialog.getByRole('option', { name: /^Agent API/ }).click()
      const initialAgentCatalog = (
        await first.page.evaluate(() => window.desktop.providers.snapshot())
      ).agentCatalog
      const providerToDisable = initialAgentCatalog.presets.find((preset) => preset.enabled)
      if (providerToDisable === undefined) throw new Error('Expected an enabled Agent provider')
      const providerList = dialog.getByTestId('agent-provider-list')
      await providerList
        .locator(`[data-agent-provider-preset-id="${providerToDisable.presetId}"]`)
        .click()
      const providerEnabledSwitch = dialog.getByRole('switch', {
        name: 'Enabled',
        exact: true
      })
      const settingsClose = dialog.getByRole('button', { name: 'Close settings', exact: true })
      await expect(providerEnabledSwitch).toBeChecked()
      await expect(settingsClose).toBeVisible()
      const [enabledBounds, closeBounds] = await Promise.all([
        providerEnabledSwitch.boundingBox(),
        settingsClose.boundingBox()
      ])
      expect(enabledBounds).not.toBeNull()
      expect(closeBounds).not.toBeNull()
      expect(
        (closeBounds?.x ?? 0) - ((enabledBounds?.x ?? 0) + (enabledBounds?.width ?? 0))
      ).toBeGreaterThanOrEqual(8)
      expect(
        Math.abs(
          (closeBounds?.y ?? 0) +
            (closeBounds?.height ?? 0) / 2 -
            ((enabledBounds?.y ?? 0) + (enabledBounds?.height ?? 0) / 2)
        )
      ).toBeLessThanOrEqual(2)
      await providerEnabledSwitch.click()
      await expect(providerEnabledSwitch).not.toBeChecked()
      await expect(
        dialog.getByRole('heading', { name: providerToDisable.name, exact: true })
      ).toBeVisible()
      const backToProviders = dialog.getByRole('button', { name: 'Back to providers' })
      if (await backToProviders.isVisible()) await backToProviders.click()
      const expectedProviderOrder = await first.page.evaluate(async () => {
        const presets = (await window.desktop.providers.snapshot()).agentCatalog.presets
        return [...presets]
          .sort((left, right) => Number(right.enabled) - Number(left.enabled))
          .map((preset) => preset.presetId)
      })
      await expect
        .poll(() =>
          providerList
            .getByRole('button')
            .evaluateAll((buttons) =>
              buttons.map((button) => button.getAttribute('data-agent-provider-preset-id'))
            )
        )
        .toEqual(expectedProviderOrder)
      const settingsProviderSearch = dialog.getByLabel('Search Agent providers')
      await settingsProviderSearch.fill(providerToDisable.name)
      await expect(providerList.getByRole('button')).toHaveCount(1)
      await expect(providerList.getByRole('button')).toHaveAttribute(
        'data-agent-provider-preset-id',
        providerToDisable.presetId
      )
      await settingsProviderSearch.clear()
      const packagedLogoGlyph = dialog
        .getByRole('button', { name: /Together/ })
        .locator('[data-slot="provider-logo-glyph"]')
      await expect(packagedLogoGlyph).toBeVisible()
      expect(
        await packagedLogoGlyph.evaluate((element) => getComputedStyle(element).maskImage)
      ).not.toBe('none')
      const initialFallback = dialog
        .locator('[data-provider-logo-state="initial"]')
        .filter({ visible: true })
        .first()
      await expect(initialFallback).toHaveText(/^\S$/)
      await expect(initialFallback.locator('[data-slot="provider-logo-glyph"]')).toHaveCount(0)
      await providerList.locator('[data-agent-provider-preset-id="builtin:openai-codex"]').click()
      await dialog.getByRole('button', { name: 'Sign in', exact: true }).click()
      const providerSignIn = first.page.getByRole('dialog', { name: 'Provider sign-in' })
      await expect(providerSignIn).toContainText('Select OpenAI Codex login method:')
      await expect(providerSignIn.getByRole('combobox')).toContainText(
        'Choose an account or login method'
      )
      await providerSignIn.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(providerSignIn).toHaveCount(0)
      const signInErrorToast = errorToast(first.page, 'Provider sign-in did not complete.')
      await expect(signInErrorToast).toContainText('Action failed')
      await expect(dialog).toBeVisible()
      const toaster = first.page.locator('[data-sonner-toaster]')
      await expect(toaster).toHaveAttribute('data-y-position', 'bottom')
      await expect(toaster).toHaveAttribute('data-x-position', 'right')
      await expect(first.page.locator('section[aria-label^="Notifications"]')).toHaveCount(1)
      await expect(toaster).toHaveAttribute(
        'data-sonner-theme',
        await first.page.evaluate(() => document.documentElement.dataset.theme ?? 'light')
      )
      await dialog.getByRole('option', { name: 'General', exact: true }).click()
      await dialog.getByRole('radio', { name: 'Dark', exact: true }).click()
      await expect(toaster).toHaveAttribute('data-sonner-theme', 'dark')
      await dialog.getByRole('option', { name: /^Agent API/ }).click()
      await providerList.locator('[data-agent-provider-preset-id="builtin:openai-codex"]').click()
      await expect(dialog.getByRole('heading', { name: 'OpenAI Codex', exact: true })).toBeVisible()
      await dialog.getByRole('button', { name: 'Sign in', exact: true }).click()
      await expect(providerSignIn).toContainText('Select OpenAI Codex login method:')
      await providerSignIn.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(providerSignIn).toHaveCount(0)
      await expect(signInErrorToast).toHaveCount(1)
      await signInErrorToast.getByRole('button', { name: 'Close toast' }).click()
      await expect(signInErrorToast).toHaveCount(0)
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Back to providers' }).click()
      await dialog.getByRole('button', { name: 'Add provider' }).click()
      const addProvider = first.page.getByRole('dialog', { name: 'Add provider' })
      await addProvider.getByLabel('Provider name').fill('Loopback Agent')
      await addProvider.getByRole('button', { name: 'Continue' }).click()
      await dialog.getByLabel('Base URL').fill(`http://127.0.0.1:${port}/v1`)
      await dialog.getByRole('button', { name: 'Provider logo' }).click()
      await first.page.getByPlaceholder('Search Provider logos…').fill('DeepSeek')
      await first.page.getByRole('option', { name: /DeepSeek deepseek/ }).click()
      await dialog.getByLabel('API key').fill('e2e-secret')
      await dialog.getByRole('button', { name: 'Save provider' }).click()
      await dialog.getByRole('button', { name: 'Fetch Loopback Agent models' }).click()
      await expect(dialog.getByText(/1 models · current/)).toBeVisible()
      await dialog.getByRole('button', { name: 'Add model' }).click()
      const addModel = first.page.getByRole('dialog', { name: 'Add model' })
      await addModel.getByLabel('Model ID').fill('manual-writer')
      await addModel.getByLabel('Display name').fill('Manual Writer')
      await addModel.getByRole('button', { name: 'Advanced model metadata' }).click()
      await addModel.getByLabel('Context window').fill('65536')
      await addModel.getByLabel('Maximum output').fill('4096')
      await addModel.getByRole('switch', { name: 'Reasoning model' }).click()
      await addModel.getByRole('switch', { name: 'Image input' }).click()
      await addModel.getByRole('button', { name: 'Save model' }).click()
      await dialog.getByRole('button', { name: 'Set Manual Writer as default' }).click()
      const discoveredModelSwitch = dialog.getByRole('switch', { name: 'Enable Writer E2E' })
      await discoveredModelSwitch.click()
      await expect(discoveredModelSwitch).not.toBeChecked()
      await expect
        .poll(async () => {
          const catalog = (await first.page.evaluate(() => window.desktop.providers.snapshot()))
            .agentCatalog
          return {
            defaultModel: catalog.defaultSelection?.modelId,
            discoveredEnabled: catalog.presets
              .find((preset) => preset.name === 'Loopback Agent')
              ?.models.find((model) => model.id === 'writer-e2e')?.enabled
          }
        })
        .toEqual({ defaultModel: 'manual-writer', discoveredEnabled: false })
      await expect(dialog.getByText(/2 models · current/)).toBeVisible()
      await dialog.getByLabel('Provider name').fill('Loopback Agent Renamed')
      await expect(
        dialog.getByRole('heading', { name: 'Loopback Agent Renamed', exact: true })
      ).toBeVisible()
      await dialog.getByRole('button', { name: 'Back to providers' }).click()
      await expect(dialog.getByRole('button', { name: /Loopback Agent Renamed/ })).toBeVisible()
      await dialog.getByRole('button', { name: /Loopback Agent Renamed/ }).click()
      await expect(dialog.getByText('Unsaved changes', { exact: true })).toBeVisible()
      await dialog.getByRole('button', { name: 'Save changes' }).click()
      await expect
        .poll(async () => {
          const catalog = (await first.page.evaluate(() => window.desktop.providers.snapshot()))
            .agentCatalog
          return catalog.presets.find((preset) => preset.name === 'Loopback Agent Renamed')
            ?.catalogStatus
        })
        .toBe('current')
      expect(authorizationHeader).toBe('Bearer e2e-secret')
      await first.page.keyboard.press('Escape')

      await first.page.getByRole('button', { name: 'Settings', exact: true }).click()
      const imageDialog = first.page.getByRole('dialog', { name: 'Settings' })
      await imageDialog.getByRole('option', { name: /^Image API/ }).click()
      await expect(imageDialog.getByLabel('Base URL')).toHaveCount(0)
      await expect(imageDialog.getByLabel('Request timeout (milliseconds)')).toHaveCount(0)
      await expect(imageDialog.getByLabel('Model ID')).toHaveText('gemini-3.1-flash-image')
      await imageDialog.getByLabel('Model ID').click()
      await expect(
        first.page.getByRole('option', { name: 'gemini-3.1-flash-lite-image' })
      ).toBeVisible()
      await first.page.getByRole('option', { name: 'gemini-3-pro-image' }).click()
      await imageDialog.getByLabel('Gemini API key').fill('e2e-gemini-secret')
      await imageDialog.getByRole('button', { name: 'Save', exact: true }).click()
      await expect(imageDialog.getByLabel('Gemini API key')).toHaveAttribute(
        'placeholder',
        /Stored/
      )
      await first.page.keyboard.press('Escape')

      await clickAndExpectProject(
        first.page,
        'Create project',
        'Portable no key',
        'Portable no key'
      )
      await first.page.getByRole('button', { name: 'Agent', exact: true }).click()
      const panel = first.page.getByTestId('agent-panel')
      await panel.getByRole('button', { name: 'New', exact: true }).click()
      await expect(panel.getByLabel('Agent model')).toContainText('Manual Writer')
      await expect(
        panel.getByLabel('Agent model').locator('[data-provider-logo-id="deepseek"]')
      ).toBeVisible()
      await panel.getByLabel('Agent model').click()
      const modelPicker = first.page.getByTestId('agent-model-picker')
      await modelPicker.getByRole('button', { name: 'Back to Providers' }).click()
      const providerSearch = modelPicker.getByPlaceholder('Search Providers…')
      await providerSearch.fill('Loopback')
      await providerSearch.press('ArrowDown')
      await providerSearch.press('Enter')
      const modelSearch = modelPicker.getByPlaceholder('Search Loopback Agent Renamed models…')
      await modelSearch.fill('Manual')
      await modelSearch.press('ArrowDown')
      await modelSearch.press('Enter')
      await expect(modelPicker).toHaveCount(0)
      await panel.getByLabel('Close writing agent').click()
    } finally {
      await closeApp(first.app)
    }

    const restarted = await launchApp({ userData })
    try {
      await restarted.page.getByRole('button', { name: 'Settings', exact: true }).click()
      const dialog = restarted.page.getByRole('dialog', { name: 'Settings' })
      await dialog.getByRole('option', { name: /^Agent API/ }).click()
      await dialog.getByRole('button', { name: /Loopback Agent Renamed/ }).click()
      const providerHeading = dialog.getByRole('heading', { name: 'Loopback Agent Renamed' })
      await expect(providerHeading).toBeVisible()
      await expect(
        dialog.locator('[data-provider-logo-id="deepseek"]').filter({ visible: true }).first()
      ).toBeVisible()
      await expect(dialog.getByText(/2 models · current/)).toBeVisible()
      await expect(dialog.getByText(/^Connected/)).toBeVisible()
      const publicCatalog = await restarted.page.evaluate(
        async () => (await window.desktop.providers.snapshot()).agentCatalog
      )
      expect(
        publicCatalog.presets.find((preset) => preset.name === 'Loopback Agent Renamed')
      ).toMatchObject({
        baseUrl: `http://127.0.0.1:${port}/v1`,
        logoId: 'deepseek',
        logoOverrideId: 'deepseek',
        models: expect.arrayContaining([
          expect.objectContaining({ id: 'writer-e2e', enabled: false, source: 'discovered' }),
          expect.objectContaining({
            id: 'manual-writer',
            enabled: true,
            source: 'manual',
            contextWindow: 65_536,
            maxTokens: 4_096,
            reasoning: true,
            input: ['text', 'image']
          })
        ])
      })
      expect(publicCatalog.defaultSelection).toEqual({
        presetId: publicCatalog.presets.find((preset) => preset.name === 'Loopback Agent Renamed')
          ?.presetId,
        modelId: 'manual-writer'
      })
      expect(JSON.stringify(publicCatalog)).not.toContain('e2e-secret')
      await restarted.page.keyboard.press('Escape')

      await restarted.page.getByRole('button', { name: 'Settings', exact: true }).click()
      const imageDialog = restarted.page.getByRole('dialog', { name: 'Settings' })
      await imageDialog.getByRole('option', { name: /^Image API/ }).click()
      await expect(imageDialog.getByLabel('Base URL')).toHaveCount(0)
      await expect(imageDialog.getByLabel('Model ID')).toHaveText('gemini-3-pro-image')
      await expect(imageDialog.getByLabel('Gemini API key')).toHaveValue('')
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
    await expect(first.page.getByRole('heading', { name: 'General' })).toBeVisible()
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
    await expectActiveProject(first.page, 'Alpha project')
    await expect(first.page.locator('.bn-editor').first()).toContainText('Close flush persistence')
    const exportInput = await first.page.evaluate(async () => {
      const lifecycle = await window.desktop.projects.lifecycle()
      const projectSessionId = lifecycle.activeProject?.projectSessionId
      if (!projectSessionId) throw new Error('Project session missing')
      const workspace = await window.desktop.manuscript.workspace({ projectSessionId })
      const sectionId = workspace.sections[0]?.section.sectionId
      if (!sectionId) throw new Error('Section missing')
      const current = await window.desktop.editor.loadSection({ projectSessionId, sectionId })
      return {
        projectSessionId,
        sectionId,
        sectionRevisionId: current.revision.sectionRevisionId,
        contentHash: current.revision.contentHash
      }
    })
    await first.page.evaluate(async (input) => {
      await window.desktop.editor.exportMarkdown({
        ...input,
        markdown: 'Close flush persistence'
      })
      await window.desktop.editor.exportNativeJson({
        projectSessionId: input.projectSessionId,
        sectionId: input.sectionId
      })
    }, exportInput)
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

test('keeps recovery actions inside the alert layout', async ({ testRoot }) => {
  const userData = join(testRoot, 'user-data')
  const missingProject = join(testRoot, 'Missing project.writellm')
  const launched = await launchApp({ userData, dialogPaths: [missingProject] })

  try {
    await launched.page.getByRole('button', { name: 'Open project', exact: true }).click()

    const recoveryAlert = launched.page.getByRole('status').filter({ hasText: 'Recovery required' })
    await expect(recoveryAlert).toBeVisible()

    const actionButtons = recoveryAlert.getByRole('button')
    await expect(actionButtons).toHaveCount(4)

    const layout = await recoveryAlert.evaluate((alert) => {
      const container = alert.getBoundingClientRect()
      const buttons = Array.from(alert.querySelectorAll('button'), (button) => {
        const bounds = button.getBoundingClientRect()
        return {
          left: bounds.left,
          right: bounds.right,
          top: bounds.top,
          bottom: bounds.bottom
        }
      })
      return {
        container: {
          left: container.left,
          right: container.right,
          top: container.top,
          bottom: container.bottom
        },
        buttons
      }
    })

    for (const button of layout.buttons) {
      expect(button.left).toBeGreaterThanOrEqual(layout.container.left)
      expect(button.right).toBeLessThanOrEqual(layout.container.right)
      expect(button.top).toBeGreaterThanOrEqual(layout.container.top)
      expect(button.bottom).toBeLessThanOrEqual(layout.container.bottom)
    }

    for (const [index, button] of layout.buttons.entries()) {
      for (const other of layout.buttons.slice(index + 1)) {
        const overlapsHorizontally =
          Math.min(button.right, other.right) > Math.max(button.left, other.left)
        const overlapsVertically =
          Math.min(button.bottom, other.bottom) > Math.max(button.top, other.top)
        expect(overlapsHorizontally && overlapsVertically).toBe(false)
      }
    }
  } finally {
    await closeApp(launched.app)
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
    await expect(errorToast(launched.page, 'WriteLLM could not create the project')).toContainText(
      'Action failed'
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

test('recovers a stale project lock and reopens the project', async ({ testRoot }) => {
  const userData = join(testRoot, 'user-data')
  const projectName = 'Stale lock project'
  const projectRoot = join(testRoot, `${projectName}.writellm`)
  const creating = await launchApp({ userData, dialogPaths: [testRoot] })

  try {
    await clickAndExpectProject(creating.page, 'Create project', projectName, projectName)
    await closeProject(creating.page)
    await expect(creating.page.getByRole('heading', { name: /Open a workspace/ })).toBeVisible()
  } finally {
    await closeApp(creating.app)
  }

  const ownerToken = '11111111-1111-4111-8111-111111111111'
  const lockDirectory = join(projectRoot, '.writellm', 'write.lock')
  await mkdir(lockDirectory)
  await writeFile(
    join(lockDirectory, `${ownerToken}.json`),
    JSON.stringify({
      ownerToken,
      pid: 1234,
      host: 'stale-e2e-host',
      acquiredAt: '2000-01-01T00:00:00.000Z',
      heartbeatAt: '2000-01-01T00:00:00.000Z'
    })
  )

  const recovering = await launchApp({ userData })
  try {
    await recovering.page.getByRole('button', { name: `Open ${projectName}`, exact: true }).click()

    const recoveryAlert = recovering.page
      .getByRole('status')
      .filter({ hasText: 'Recovery required' })
    await expect(recoveryAlert).toContainText('Another WriteLLM process still holds')
    await recoveryAlert.getByRole('button', { name: 'Recover stale lock', exact: true }).click()

    await expectActiveProject(recovering.page, projectName)
    await expect(recovering.page.locator('.bn-editor').first()).toBeVisible()
  } finally {
    await closeApp(recovering.app)
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
      await expect(errorToast(contender.page, 'WriteLLM could not open the project')).toContainText(
        'Action failed'
      )
      await expect(contender.page.getByRole('heading', { name: /Open a workspace/ })).toBeVisible()
      await expect(
        contender.page.getByRole('status').filter({ hasText: 'Recovery required' })
      ).toBeVisible()
      await expect(
        contender.page.getByRole('button', { name: 'Recover stale lock', exact: true })
      ).toBeVisible()
      await expectActiveProject(owner.page, 'Contended project')
    } finally {
      await closeApp(contender.app)
    }
  } finally {
    await closeApp(owner.app)
  }
})
