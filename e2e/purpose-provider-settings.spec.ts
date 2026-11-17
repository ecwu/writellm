import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import type { Locator, Page } from '@playwright/test'
import { expect, launchApp, scenario, test } from './fixtures'
import { addParsingMode, addPurposeSource } from './helpers/purpose-providers'

const roles = [
  { role: 'embedding', title: 'Embedding' },
  { role: 'rerank', title: 'Reranking' },
  { role: 'mineru', title: 'Document Parsing' }
] as const

async function openSettings(page: Page, title: string) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
  await settings.getByRole('option', { name: new RegExp(`^${title}`) }).click()
  return settings
}

async function addModel(page: Page, settings: Locator, embedding: boolean) {
  await settings.getByRole('button', { name: 'Add model', exact: true }).click()
  const form = page.getByRole('dialog', { name: 'Add model', exact: true })
  await form.getByLabel('Model ID', { exact: true }).fill('shared-model')
  await form.getByLabel('Model revision', { exact: true }).fill('test-v1')
  if (embedding) await form.getByLabel('Embedding dimensions', { exact: true }).fill('3')
  await form.getByRole('button', { name: 'Save model', exact: true }).click()
  await expect(form).toHaveCount(0)
}

for (const { role, title } of roles) {
  test(
    `${title} binds explicit defaults and connection tests to the selected source`,
    scenario(`providers.purpose-${role}`, ['@packaged']),
    async ({ testRoot }) => {
      const requests: { url: string; authorization?: string }[] = []
      let catalogStatus = 200
      const server = createServer((request, response) => {
        requests.push({ url: request.url ?? '', authorization: request.headers.authorization })
        response.writeHead(catalogStatus, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ code: 0, data: [{ id: 'discovered-embedding' }] }))
      })
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
      })
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
      const userData = join(testRoot, 'user-data')
      const catalog = (page: Page) =>
        page.evaluate(
          async (purpose) => (await window.desktop.providers.snapshot()).purposeCatalog[purpose],
          role
        )
      let launched = await launchApp({ userData })
      try {
        const settings = await openSettings(launched.page, title)
        const selected = settings.getByLabel('Default model', { exact: true })
        for (const label of ['Alpha', 'Beta']) {
          await addPurposeSource(settings, {
            name: label,
            baseUrl: `${origin}/${label.toLowerCase()}`,
            apiKey: `fixture-${label}`,
            mineru: role === 'mineru'
          })
          if (role === 'mineru') await addParsingMode(launched.page, settings, 'Pipeline')
          else await addModel(launched.page, settings, role === 'embedding')
        }
        if (role === 'mineru') await addParsingMode(launched.page, settings, 'VLM')
        const before = await catalog(launched.page)
        expect(before.defaultSelection).toBeNull()
        expect(before.sources).toHaveLength(2)
        expect(JSON.stringify(before)).not.toContain('fixture-')
        expect(requests).toEqual([])
        await selected.click()
        const picker = launched.page.getByRole('dialog', { name: 'Default model' })
        const modelName = role === 'mineru' ? 'Pipeline' : 'shared-model'
        for (const label of ['Alpha', 'Beta']) {
          await expect(
            picker.getByRole('group', { name: label }).getByRole('option', { name: modelName })
          ).toBeVisible()
        }
        await picker
          .getByRole('group', { name: 'Alpha' })
          .getByRole('option', { name: modelName })
          .click()
        if (role === 'embedding') {
          const confirmation = launched.page.getByRole('alertdialog', {
            name: 'Change the default embedding model?'
          })
          await confirmation.getByRole('button', { name: 'Change default' }).click()
        }
        await expect(selected).toContainText('Alpha')
        const alpha = before.sources.find((source) => source.name === 'Alpha')
        expect((await catalog(launched.page)).defaultSelection).toEqual({
          sourceId: alpha?.sourceId,
          configId: alpha?.models[0]?.configId
        })
        expect(requests).toEqual([])
        await settings.getByRole('button', { name: 'Test connection', exact: true }).click()
        await expect.poll(() => requests.length).toBe(1)
        expect(requests[0]).toEqual({
          url: role === 'mineru' ? '/beta/api/v4/extract/task/__writellm_probe__' : '/beta/models',
          authorization: 'Bearer fixture-Beta'
        })
        if (role === 'embedding') {
          const fetchModels = settings.getByRole('button', { name: 'Fetch models', exact: true })
          const beta = async () =>
            (await catalog(launched.page)).sources.find((source) => source.name === 'Beta')
          await fetchModels.click()
          await expect.poll(async () => (await beta())?.catalog.status).toBe('current')
          expect((await beta())?.models.map((model) => model.modelId)).toEqual(['shared-model'])
          catalogStatus = 503
          await fetchModels.click()
          await expect.poll(async () => (await beta())?.catalog.status).toBe('stale')
          expect((await beta())?.modelCandidates.map((model) => model.id)).toEqual([
            'discovered-embedding'
          ])
          await settings.getByRole('button', { name: 'Add model', exact: true }).click()
          const form = launched.page.getByRole('dialog', { name: 'Add model', exact: true })
          await form.getByRole('combobox', { name: 'Choose discovered model' }).click()
          await launched.page.getByRole('option', { name: 'discovered-embedding' }).click()
          await expect(form.getByLabel('Model ID')).toHaveValue('discovered-embedding')
          await form.getByLabel('Embedding dimensions').fill('5')
          await form.getByRole('button', { name: 'Save model', exact: true }).click()
          await expect
            .poll(async () =>
              (await beta())?.models.some(
                (model) =>
                  model.modelId === 'discovered-embedding' && model.embeddingDimension === 5
              )
            )
            .toBe(true)
          expect((await catalog(launched.page)).defaultSelection?.sourceId).toBe(alpha?.sourceId)
          expect(requests).toHaveLength(3)
        }
        await launched.app.close()
        launched = await launchApp({ userData })
        const restarted = await openSettings(launched.page, title)
        await expect(restarted.getByLabel('Default model', { exact: true })).toContainText('Alpha')
        const after = await catalog(launched.page)
        expect(after.defaultSelection?.sourceId).toBe(alpha?.sourceId)
        await restarted.getByRole('switch', { name: new RegExp(`^Enable ${modelName}`) }).click()
        if (role === 'embedding') {
          await launched.page
            .getByRole('alertdialog', { name: 'Disable the default embedding model?' })
            .getByRole('button', { name: 'Disable model', exact: true })
            .click()
        }
        await expect(restarted.getByText('Default model cleared.', { exact: true })).toBeVisible()
        expect((await catalog(launched.page)).defaultSelection).toBeNull()
        expect(requests).toHaveLength(role === 'embedding' ? 3 : 1)
      } finally {
        await launched.app.close()
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        )
      }
    }
  )
}
