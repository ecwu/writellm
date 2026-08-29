import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import {
  expect,
  expectActiveProject,
  launchApp,
  scenario,
  sectionEditor,
  test,
  WINDOW_PRESENTATION_ENV
} from './fixtures'

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

test(
  'configures provider metadata without returning a credential',
  scenario('app.provider-settings-persist-without-secret'),
  async ({ testRoot }) => {
    test.setTimeout(180_000)
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
        const providerToDisable = await first.page.evaluate(async () => {
          const presetId = 'builtin:openai-codex'
          const initial = (await window.desktop.providers.snapshot()).agentCatalog.presets.find(
            (preset) => preset.presetId === presetId
          )
          if (initial === undefined) throw new Error('Expected the packaged OpenAI Codex provider')
          if (!initial.enabled) {
            await window.desktop.providers.setAgentProviderEnabled({ presetId, enabled: true })
          }
          const enabled = (await window.desktop.providers.snapshot()).agentCatalog.presets.find(
            (preset) => preset.presetId === presetId
          )
          if (enabled === undefined || !enabled.enabled) {
            throw new Error('Expected the OpenAI Codex provider to be enabled')
          }
          return enabled
        })
        await first.page.getByRole('button', { name: 'Settings', exact: true }).click()
        const dialog = first.page.getByRole('dialog', { name: 'Settings' })
        await dialog.getByRole('option', { name: /^Agent API/ }).click()
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
        await expect(
          dialog.getByRole('heading', { name: 'OpenAI Codex', exact: true })
        ).toBeVisible()
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
        await expect(imageDialog.getByText('No active source', { exact: true })).toBeVisible()
        await expect(imageDialog.getByRole('button', { name: /^Google Gemini/ })).toBeVisible()
        await expect(imageDialog.getByRole('button', { name: /^Google Vertex AI/ })).toBeVisible()
        await expect(imageDialog.getByRole('button', { name: /^OpenAI/ })).toBeVisible()
        await expect(imageDialog.getByRole('button', { name: /^xAI/ })).toBeVisible()
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
        await expect(imageDialog.getByText('Active: Google Gemini', { exact: true })).toBeVisible()

        await imageDialog.getByRole('button', { name: /^Google Vertex AI/ }).click()
        await expect(imageDialog.getByLabel('Vertex location')).toHaveValue('global')
        await imageDialog.getByLabel('Google Cloud Project ID').fill('e2e-vertex-project')
        await imageDialog.getByLabel('Model ID').click()
        await first.page
          .getByRole('option', { name: /Nano Banana Pro.*gemini-3-pro-image/ })
          .click()
        await expect(imageDialog.getByText('Application Default Credentials')).toBeVisible()
        await expect(imageDialog.getByText(/gcloud auth application-default login/)).toBeVisible()
        await expect(imageDialog.locator('input[type="password"]')).toHaveCount(0)
        await imageDialog.getByRole('button', { name: 'Save', exact: true }).click()
        await expect(imageDialog.getByText('Active: Google Gemini', { exact: true })).toBeVisible()

        await imageDialog.getByRole('button', { name: /^OpenAI/ }).click()
        await expect(imageDialog.locator('input[readonly]')).toHaveValue('gpt-image-2')
        await imageDialog.getByLabel('OpenAI API key').fill('e2e-openai-secret')
        await imageDialog.getByRole('button', { name: 'Save', exact: true }).click()
        await expect(imageDialog.getByLabel('OpenAI API key')).toHaveAttribute(
          'placeholder',
          /Stored/
        )
        await expect(imageDialog.getByText('Active: Google Gemini', { exact: true })).toBeVisible()

        await imageDialog.getByRole('button', { name: /^xAI/ }).click()
        await expect(imageDialog.locator('input[readonly]')).toHaveValue('grok-imagine-image-2.0')
        await imageDialog.getByLabel('xAI API key').fill('e2e-xai-secret')
        await imageDialog.getByRole('button', { name: 'Save', exact: true }).click()

        await imageDialog.getByRole('button', { name: /^Google Vertex AI/ }).click()
        await imageDialog.getByRole('button', { name: 'Make active', exact: true }).click()
        await expect(
          imageDialog.getByText('Active: Google Vertex AI', { exact: true })
        ).toBeVisible()
        await imageDialog.getByRole('button', { name: 'Remove', exact: true }).click()
        const removeVertexProvider = first.page.getByRole('alertdialog', {
          name: 'Remove Google Vertex AI image configuration?'
        })
        await expect(
          removeVertexProvider.getByText(/Local ADC files are not changed/)
        ).toBeVisible()
        await removeVertexProvider.getByRole('button', { name: 'Remove provider' }).click()
        await expect(imageDialog.getByText('No active source', { exact: true })).toBeVisible()
        await expect(
          imageDialog.getByRole('button', { name: /^Google Gemini.*gemini-3-pro-image/ })
        ).toBeVisible()

        await imageDialog.getByLabel('Google Cloud Project ID').fill('e2e-vertex-project')
        await imageDialog.getByLabel('Model ID').click()
        await first.page
          .getByRole('option', { name: /Nano Banana Pro.*gemini-3-pro-image/ })
          .click()
        await imageDialog.getByRole('button', { name: 'Save', exact: true }).click()

        await imageDialog.getByRole('button', { name: /^OpenAI/ }).click()
        await imageDialog.getByRole('button', { name: 'Make active', exact: true }).click()
        await expect(imageDialog.getByText('Active: OpenAI', { exact: true })).toBeVisible()

        await imageDialog.getByRole('button', { name: 'Remove', exact: true }).click()
        const removeImageProvider = first.page.getByRole('alertdialog', {
          name: 'Remove OpenAI image configuration?'
        })
        await removeImageProvider.getByRole('button', { name: 'Remove provider' }).click()
        await expect(imageDialog.getByText('No active source', { exact: true })).toBeVisible()
        await expect
          .poll(async () => {
            const catalog = (await first.page.evaluate(() => window.desktop.providers.snapshot()))
              .imageCatalog
            return {
              activeProviderId: catalog.activeProviderId,
              available: Object.fromEntries(
                catalog.sources.map((source) => [source.providerId, source.available])
              ),
              leakedSecret: /e2e-(?:gemini|vertex|openai|xai)-secret/.test(JSON.stringify(catalog))
            }
          })
          .toEqual({
            activeProviderId: null,
            available: {
              'google-gemini': true,
              'google-vertex': true,
              openai: false,
              xai: true
            },
            leakedSecret: false
          })

        await imageDialog.getByRole('button', { name: /^xAI/ }).click()
        await imageDialog.getByRole('button', { name: 'Make active', exact: true }).click()
        await expect(imageDialog.getByText('Active: xAI', { exact: true })).toBeVisible()
        await first.page.keyboard.press('Escape')

        await clickAndExpectProject(
          first.page,
          'Create project',
          'Portable no key',
          'Portable no key'
        )
        await first.page.getByRole('button', { name: 'Agent', exact: true }).click()
        const panel = first.page.getByTestId('agent-panel')
        await panel.getByTestId('agent-conversation-menu').click()
        await first.page.getByRole('menuitem', { name: 'Details', exact: true }).click()
        const agentDetails = first.page.getByRole('dialog', { name: 'Agent details' })
        await expect(agentDetails.getByLabel('Agent model')).toContainText('Manual Writer')
        await expect(
          agentDetails.getByLabel('Agent model').locator('[data-provider-logo-id="deepseek"]')
        ).toBeVisible()
        await agentDetails.getByLabel('Agent model').click()
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
        await first.page.keyboard.press('Escape')
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
        await expect(imageDialog.getByText('Active: xAI', { exact: true })).toBeVisible()
        await expect(imageDialog.locator('input[readonly]')).toHaveValue('grok-imagine-image-2.0')
        await expect(imageDialog.getByLabel('xAI API key')).toHaveValue('')
        await expect(imageDialog.getByLabel('xAI API key')).toHaveAttribute('placeholder', /Stored/)
        await imageDialog.getByRole('button', { name: /^Google Gemini/ }).click()
        await expect(imageDialog.getByLabel('Model ID')).toHaveText('gemini-3-pro-image')
        await expect(imageDialog.getByLabel('Gemini API key')).toHaveValue('')
        await expect(imageDialog.getByLabel('Gemini API key')).toHaveAttribute(
          'placeholder',
          /Stored/
        )
        await imageDialog.getByRole('button', { name: /^Google Vertex AI/ }).click()
        await expect(imageDialog.getByLabel('Google Cloud Project ID')).toHaveValue(
          'e2e-vertex-project'
        )
        await expect(imageDialog.getByLabel('Model ID')).toContainText('Nano Banana Pro')
        await expect(imageDialog.getByText('Application Default Credentials')).toBeVisible()
        await expect(imageDialog.locator('input[type="password"]')).toHaveCount(0)
        await imageDialog.getByRole('button', { name: /^OpenAI/ }).click()
        await expect(imageDialog.getByLabel('OpenAI API key')).toHaveAttribute(
          'placeholder',
          'Required'
        )
      } finally {
        await closeApp(restarted.app)
      }

      const freshUserData = join(testRoot, 'fresh-provider-user-data')
      await mkdir(freshUserData)
      const portable = await launchApp({ userData: freshUserData, dialogPaths: [portableProject] })
      try {
        await clickAndExpectProject(portable.page, 'Open project', 'Portable no key')
        await expect(sectionEditor(portable.page)).toBeVisible()
      } finally {
        await closeApp(portable.app)
      }
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    }
  }
)

test(
  'creates, closes, reopens, switches, and reopens after app restart',
  scenario('project.lifecycle-restart', ['@critical', '@packaged']),
  async ({ testRoot }) => {
    const userData = join(testRoot, 'user-data')
    const alpha = join(testRoot, 'Alpha project.writellm')
    const beta = join(testRoot, 'Beta project.writellm')

    const first = await launchApp({
      userData,
      dialogPaths: [testRoot, testRoot, alpha, beta]
    })
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
      const editor = sectionEditor(first.page)
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
      await expect(sectionEditor(first.page)).toContainText('Close flush persistence')
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
  }
)

test(
  'exports durable whole-manuscript and section artifacts',
  scenario('manuscript.exports-durable', ['@packaged']),
  async ({ testRoot }) => {
    const projectName = 'Durable exports'
    const projectRoot = join(testRoot, `${projectName}.writellm`)
    const nativeManuscriptExport = join(testRoot, 'Native manuscript')
    const markdownManuscriptExport = join(testRoot, 'Markdown manuscript')
    const launched = await launchApp({
      userData: join(testRoot, 'user-data'),
      dialogPaths: [testRoot, nativeManuscriptExport, markdownManuscriptExport]
    })

    try {
      await clickAndExpectProject(launched.page, 'Create project', projectName, projectName)
      await launched.page.getByRole('button', { name: 'Manuscript', exact: true }).click()
      const editor = sectionEditor(launched.page)
      await editor.click()
      await launched.page.keyboard.type('Export final flush')

      await launched.page.getByRole('menuitem', { name: 'Project', exact: true }).click()
      await launched.page
        .getByRole('menuitem', { name: 'Export native manuscript…', exact: true })
        .click()
      const nativeCompletion = launched.page.getByRole('dialog', {
        name: 'Manuscript exported'
      })
      await expect(nativeCompletion).toContainText('Native manuscript')
      await nativeCompletion.getByRole('button', { name: 'Done', exact: true }).click()

      await launched.page.getByRole('menuitem', { name: 'Project', exact: true }).click()
      await launched.page
        .getByRole('menuitem', { name: 'Export Markdown manuscript…', exact: true })
        .click()
      const markdownCompletion = launched.page.getByRole('dialog', {
        name: 'Manuscript exported'
      })
      await expect(markdownCompletion).toContainText('Markdown manuscript')
      await markdownCompletion.getByRole('button', { name: 'Done', exact: true }).click()

      const nativeManifestText = await readFile(
        join(nativeManuscriptExport, 'writellm.manuscript-export.json'),
        'utf8'
      )
      const markdownManifestText = await readFile(
        join(markdownManuscriptExport, 'writellm.manuscript-export.json'),
        'utf8'
      )
      expect(nativeManifestText).not.toContain(projectRoot)
      expect(markdownManifestText).not.toContain(projectRoot)
      await expect(
        readFile(join(nativeManuscriptExport, 'manuscript.json'), 'utf8')
      ).resolves.toContain('Export final flush')
      await expect(
        readFile(join(markdownManuscriptExport, 'manuscript.md'), 'utf8')
      ).resolves.toContain('Export final flush')
      await expect(
        readFile(join(markdownManuscriptExport, 'writellm.loss-report.json'), 'utf8')
      ).resolves.toContain('"formatVersion":1')

      const exportInput = await launched.page.evaluate(async () => {
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
      await launched.page.evaluate(async (input) => {
        await window.desktop.editor.exportMarkdown(input)
        await window.desktop.editor.exportNativeJson({
          projectSessionId: input.projectSessionId,
          sectionId: input.sectionId
        })
      }, exportInput)

      const exportsDirectory = join(projectRoot, 'manuscript', 'exports')
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
      const materializations = await readdir(join(projectRoot, 'manuscript', 'sections'))
      expect(materializations).toHaveLength(1)
    } finally {
      await closeApp(launched.app)
    }
  }
)

test(
  'creates in a non-empty parent and retries after an existing-name conflict',
  scenario('project.create-conflict-preserves-data'),
  async ({ testRoot }) => {
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
      await launched.page
        .getByRole('dialog')
        .getByRole('button', { name: 'Choose location' })
        .click()
      await expect(
        errorToast(launched.page, 'WriteLLM could not create the project')
      ).toContainText('Action failed')
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
  }
)

test(
  'opens a moved root with the stable manifest project ID',
  scenario('project.moved-root-keeps-identity', ['@packaged']),
  async ({ testRoot }) => {
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
  }
)

test(
  'recovers a stale project lock and reopens the project',
  scenario('project.recovers-stale-lock', ['@packaged']),
  async ({ testRoot }) => {
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
      await recovering.page
        .getByRole('button', { name: `Open ${projectName}`, exact: true })
        .click()

      const recoveryAlert = recovering.page
        .getByRole('status')
        .filter({ hasText: 'Recovery required' })
      await expect(recoveryAlert).toContainText('Another WriteLLM process still holds')
      await recoveryAlert.getByRole('button', { name: 'Recover stale lock', exact: true }).click()

      await expectActiveProject(recovering.page, projectName)
      await expect(sectionEditor(recovering.page)).toBeVisible()
    } finally {
      await closeApp(recovering.app)
    }
  }
)

test(
  'rejects lock contention across two application processes',
  scenario('project.rejects-live-lock-contention', ['@packaged']),
  async ({ testRoot }) => {
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
        await expect(
          errorToast(contender.page, 'WriteLLM could not open the project')
        ).toContainText('Action failed')
        await expect(
          contender.page.getByRole('heading', { name: /Open a workspace/ })
        ).toBeVisible()
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
  }
)
