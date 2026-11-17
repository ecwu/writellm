import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { expect, launchApp, scenario, test } from './fixtures'
import { createProject } from './helpers/project'
import { prepareSyntheticMicrophone, startSpeechMock } from './helpers/speech'

/** Stub only public metadata. Source discovery still uses the real loopback HTTP path. */
async function installPublicModelCatalog(app: ElectronApplication, baseUrl: string): Promise<void> {
  await app.evaluate((_electron, baseUrl) => {
    const publicUrl = 'https://models.dev/experimental/v2.0/api.json?type=image,transcription'
    const originalFetch = globalThis.fetch
    const evidence = { requests: 0, credentialHeader: false }
    Object.assign(globalThis, { publicModelCatalogEvidence: evidence })
    globalThis.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url === publicUrl) {
        evidence.requests++
        const headers = new Headers(init?.headers)
        evidence.credentialHeader ||= headers.has('authorization') || headers.has('x-goog-api-key')
        return new Response(
          JSON.stringify({
            openai: {
              id: 'openai',
              models: {
                'future-image-model': {
                  id: 'future-image-model',
                  name: 'Future image model',
                  type: 'image',
                  api: { images: { base_url: baseUrl } }
                },
                'future-speech-model': {
                  id: 'future-speech-model',
                  name: 'Future speech model',
                  type: 'transcription',
                  api: { transcriptions: { base_url: baseUrl }, realtime: { base_url: baseUrl } }
                }
              }
            }
          }),
          { headers: { 'content-type': 'application/json' } }
        )
      }
      if (new URL(url).hostname === 'models.dev')
        throw new Error('Unexpected public metadata endpoint')
      return originalFetch(input, init)
    }
  }, baseUrl)
}

async function publicCatalogEvidence(app: ElectronApplication) {
  return app.evaluate(
    () =>
      (
        globalThis as unknown as {
          publicModelCatalogEvidence: { requests: number; credentialHeader: boolean }
        }
      ).publicModelCatalogEvidence
  )
}

const discoveredFixtureModels = [
  { id: 'future-speech-model', name: 'Future speech model' },
  { id: 'future-image-model', name: 'Future image model' },
  { id: 'unclassified-model', name: 'Unclassified model' }
]

async function openProviderSettings(page: Page, name: RegExp) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
  await settings.getByRole('option', { name }).click()
  return settings
}

async function speechCatalog(page: Page) {
  return page.evaluate(
    async () => (await window.desktop.providers.snapshot()).purposeCatalog.speech
  )
}

async function startWithoutCapture(page: Page) {
  return page.evaluate(async () => {
    const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
      ?.projectSessionId
    if (!projectSessionId) throw new Error('Project session missing')
    const started = await window.desktop.speech.start({ projectSessionId })
    return { projectSessionId, recognitionId: started.recognitionId }
  })
}

test(
  'keeps speech sources independent and discovers models without changing the active recording',
  scenario('speech.sources-and-model-discovery', ['@packaged']),
  async ({ testRoot }) => {
    const mock = await startSpeechMock()
    const launched = await launchApp({
      userData: join(testRoot, 'user-data'),
      dialogPaths: [testRoot],
      chromiumArgs: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
    })
    try {
      await installPublicModelCatalog(launched.app, mock.baseUrl)
      await createProject(launched.page, 'Speech sources')
      await prepareSyntheticMicrophone(launched.app, launched.page)
      const settings = await openProviderSettings(launched.page, /^Speech Input/)
      const addModel = settings.getByRole('button', { name: 'Add model', exact: true })
      const modelDialog = launched.page.getByRole('dialog', { name: 'Add model', exact: true })
      const defaultModel = settings.getByLabel('Default model', { exact: true })
      const selectDefault = async (model: string, sourceId: string, configId: string) => {
        await defaultModel.click()
        await launched.page.getByRole('option', { name: model, exact: true }).click()
        await expect
          .poll(async () => (await speechCatalog(launched.page)).defaultSelection)
          .toEqual({ sourceId, configId })
      }
      for (const source of [
        { name: 'Speech alpha', key: 'fixture-alpha' },
        { name: 'Speech beta', key: 'fixture-beta' }
      ]) {
        await settings.getByRole('button', { name: 'Add source', exact: true }).first().click()
        await settings.getByLabel('Source name', { exact: true }).fill(source.name)
        await settings.getByLabel('Base URL', { exact: true }).fill(mock.baseUrl)
        await settings.getByLabel('API key', { exact: true }).fill(source.key)
        await settings.getByRole('button', { name: 'Save source', exact: true }).click()
        await expect(addModel).toBeEnabled()
        if (source.name === 'Speech alpha') {
          await addModel.click()
          await modelDialog.getByRole('radio', { name: 'Realtime', exact: true }).click()
          await modelDialog.getByLabel('Model ID', { exact: true }).fill('alpha-model')
          await modelDialog.getByRole('button', { name: 'Save model', exact: true }).click()
          await expect(modelDialog).toBeHidden()
        }
      }
      const initial = await speechCatalog(launched.page)
      expect(initial.defaultSelection).toBeNull()
      expect(initial.sources.map((source) => source.name).sort()).toEqual([
        'Speech alpha',
        'Speech beta'
      ])
      expect(JSON.stringify(initial)).not.toContain('fixture-alpha')
      expect(JSON.stringify(initial)).not.toContain('fixture-beta')
      const alpha = initial.sources.find((source) => source.name === 'Speech alpha')
      const beta = initial.sources.find((source) => source.name === 'Speech beta')
      if (!alpha || !beta || alpha.models.length !== 1)
        throw new Error('Speech fixture sources missing')
      expect(mock.modelRequests).toHaveLength(0)
      await selectDefault('alpha-model (Realtime)', alpha.sourceId, alpha.models[0].configId)

      mock.setModels(discoveredFixtureModels)
      await settings.getByRole('button', { name: 'Fetch models', exact: true }).click()
      const betaStatus = async () =>
        (await speechCatalog(launched.page)).sources.find(
          (source) => source.sourceId === beta.sourceId
        )
      await expect.poll(async () => (await betaStatus())?.catalog.status).toBe('current')
      expect(mock.modelRequests.at(-1)?.authorization).toBe('Bearer fixture-beta')
      await addModel.click()
      await modelDialog.getByRole('radio', { name: 'Realtime', exact: true }).click()
      await modelDialog.getByLabel('Choose discovered model', { exact: true }).click()
      await expect(launched.page.getByRole('option', { name: /Unclassified model/ })).toBeVisible()
      await expect(launched.page.getByRole('option', { name: /Future image model/ })).toHaveCount(0)
      await launched.page.getByRole('option', { name: /Future speech model/ }).click()
      await expect(modelDialog.getByLabel('Model ID', { exact: true })).toHaveValue(
        'future-speech-model'
      )
      expect((await betaStatus())?.models).toHaveLength(0)
      await modelDialog.getByRole('button', { name: 'Save model', exact: true }).click()
      await expect(modelDialog).toBeHidden()
      const betaModel = (await betaStatus())?.models[0]
      if (!betaModel) throw new Error('Speech beta model missing')
      expect(betaModel).toMatchObject({ modelId: 'future-speech-model', mode: 'realtime' })

      // Discovery and selecting a default do not start recognition.
      expect(mock.connections).toHaveLength(0)
      expect((await betaStatus())?.modelCandidates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'future-speech-model',
            capability: 'transcription',
            metadataSource: 'models.dev'
          }),
          expect.objectContaining({ id: 'unclassified-model', capability: 'unknown' })
        ])
      )
      expect(await publicCatalogEvidence(launched.app)).toEqual({
        requests: 1,
        credentialHeader: false
      })
      // Testing a model on the selected source does not change the default.
      await settings.getByRole('button', { name: 'Test connection', exact: true }).click()
      await expect(settings.getByText('Connection succeeded.', { exact: true })).toBeVisible()
      await expect.poll(() => mock.connections[0]?.closed).toBe(true)
      expect(mock.connections[0]).toMatchObject({
        model: 'future-speech-model',
        authorization: 'Bearer fixture-beta'
      })
      expect((await speechCatalog(launched.page)).defaultSelection?.sourceId).toBe(alpha.sourceId)

      mock.setModels([], 503)
      await settings.getByRole('button', { name: 'Fetch models', exact: true }).click()
      await expect.poll(async () => (await betaStatus())?.catalog.status).toBe('stale')
      const stale = await betaStatus()
      expect(stale?.modelCandidates.map((model) => model.id)).toEqual(
        discoveredFixtureModels.map((model) => model.id)
      )
      expect(stale?.models).toEqual([betaModel])
      expect((await speechCatalog(launched.page)).defaultSelection?.sourceId).toBe(alpha.sourceId)

      const recording = await startWithoutCapture(launched.page)
      await expect.poll(() => mock.connections[1]?.model).toBe('alpha-model')
      expect(mock.connections[1].authorization).toBe('Bearer fixture-alpha')
      await selectDefault('future-speech-model (Realtime)', beta.sourceId, betaModel.configId)
      expect(mock.connections[1].closed).toBe(false)
      expect(mock.connections[1].model).toBe('alpha-model')
      await launched.page.evaluate((identity) => window.desktop.speech.cancel(identity), recording)
      await expect.poll(() => mock.connections[1].closed).toBe(true)
      const next = await startWithoutCapture(launched.page)
      await expect.poll(() => mock.connections[2]?.model).toBe('future-speech-model')
      expect(mock.connections[2].authorization).toBe('Bearer fixture-beta')
      await launched.page.evaluate((identity) => window.desktop.speech.cancel(identity), next)
      await expect.poll(() => mock.connections[2].closed).toBe(true)
      expect(mock.connections.every((connection) => connection.frames.length === 0)).toBe(true)
      expect(mock.files).toHaveLength(0)

      await settings.getByRole('button', { name: 'Remove source', exact: true }).click()
      await launched.page
        .getByRole('alertdialog')
        .getByRole('button', { name: 'Remove source', exact: true })
        .click()
      await expect
        .poll(async () => (await speechCatalog(launched.page)).defaultSelection)
        .toBeNull()
      expect((await speechCatalog(launched.page)).sources.map((source) => source.sourceId)).toEqual(
        [alpha.sourceId]
      )
      await launched.page.keyboard.press('Escape')
      await expect(startWithoutCapture(launched.page)).rejects.toThrow(
        'Set up Speech input in Settings'
      )
      expect(mock.connections).toHaveLength(3)
    } finally {
      await launched.app.close()
      await mock.close()
    }
  }
)

test(
  'imports discovered image IDs only after explicit model and size selection',
  scenario('providers.image-model-discovery', ['@packaged']),
  async ({ testRoot }) => {
    const mock = await startSpeechMock()
    const launched = await launchApp({ userData: join(testRoot, 'user-data') })
    try {
      await installPublicModelCatalog(launched.app, mock.baseUrl)
      const saved = await launched.page.evaluate(async (baseUrl) => {
        return window.desktop.providers.saveImageSource({
          source: { providerId: 'openai', name: 'Image catalog fixture', baseUrl },
          apiKey: 'fixture-image'
        })
      }, mock.baseUrl)
      const source = saved.imageCatalog.sources.find(
        (item) => item.name === 'Image catalog fixture'
      )
      if (!source) throw new Error('Image fixture source missing')
      const initialDefault = saved.imageCatalog.defaultSelection
      const settings = await openProviderSettings(launched.page, /^Image Generation/)
      await settings
        .getByTestId('image-source-list')
        .getByRole('button', { name: /^Image catalog fixture/ })
        .click()
      mock.setModels(discoveredFixtureModels)
      await settings.getByRole('button', { name: 'Fetch models', exact: true }).click()
      const catalog = () =>
        launched.page.evaluate(async () => (await window.desktop.providers.snapshot()).imageCatalog)
      await expect.poll(async () => (await catalog()).sources[0]?.catalog.status).toBe('current')
      expect(mock.modelRequests.at(-1)?.authorization).toBe('Bearer fixture-image')
      expect(
        (await catalog()).sources[0].models.some((model) => model.id === 'future-image-model')
      ).toBe(false)
      expect((await catalog()).defaultSelection).toEqual(initialDefault)
      await settings.getByRole('button', { name: 'Add model', exact: true }).click()
      const modelDialog = launched.page.getByRole('dialog', {
        name: 'Add image model',
        exact: true
      })
      await modelDialog.getByLabel('Choose discovered model', { exact: true }).click()
      await expect(launched.page.getByRole('option', { name: /Unclassified model/ })).toBeVisible()
      await expect(launched.page.getByRole('option', { name: /Future speech model/ })).toHaveCount(
        0
      )
      await launched.page.getByRole('option', { name: /Future image model/ }).click()
      await expect(modelDialog.getByLabel('Model ID', { exact: true })).toHaveValue(
        'future-image-model'
      )
      await expect(modelDialog.getByLabel('Supports 2K output', { exact: true })).not.toBeChecked()
      await modelDialog.getByRole('button', { name: 'Save model', exact: true }).click()
      await expect
        .poll(
          async () =>
            (await catalog()).sources[0].models.find((model) => model.id === 'future-image-model')
              ?.source
        )
        .toBe('manual')
      expect(
        (await catalog()).sources[0].models.find((model) => model.id === 'future-image-model')
          ?.imageSizes
      ).toEqual(['1K'])
      expect((await catalog()).defaultSelection).toEqual(initialDefault)
      await settings
        .getByRole('button', { name: 'Set Future image model as default', exact: true })
        .click()
      await expect
        .poll(async () => (await catalog()).defaultSelection)
        .toEqual({ sourceId: source.sourceId, modelId: 'future-image-model' })
      mock.setModels([], 503)
      await settings.getByRole('button', { name: 'Fetch models', exact: true }).click()
      await expect.poll(async () => (await catalog()).sources[0]?.catalog.status).toBe('stale')
      expect((await catalog()).sources[0].modelCandidates.map((model) => model.id)).toEqual(
        discoveredFixtureModels.map((model) => model.id)
      )
      expect((await catalog()).sources[0].modelCandidates).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'future-image-model',
            capability: 'image',
            metadataSource: 'models.dev'
          }),
          expect.objectContaining({ id: 'unclassified-model', capability: 'unknown' })
        ])
      )
      expect(await publicCatalogEvidence(launched.app)).toEqual({
        requests: 1,
        credentialHeader: false
      })
      expect(
        (await catalog()).sources[0].models.find((model) => model.id === 'future-image-model')
          ?.source
      ).toBe('manual')
      expect((await catalog()).defaultSelection).toEqual({
        sourceId: source.sourceId,
        modelId: 'future-image-model'
      })
      expect(JSON.stringify(await catalog())).not.toContain('fixture-image')
      expect(mock.connections).toHaveLength(0)
      expect(mock.files).toHaveLength(0)
    } finally {
      await launched.app.close()
      await mock.close()
    }
  }
)
