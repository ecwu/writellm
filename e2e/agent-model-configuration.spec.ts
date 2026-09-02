import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { expect, expectActiveProject, launchApp, scenario, test } from './fixtures'

test(
  'uses edited model metadata without reselection and reports truncated responses',
  scenario('agent.current-model-configuration'),
  async ({ testRoot }) => {
    const budgets: Record<string, number[]> = {}
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const body: {
        messages?: Array<{ role: string; content: unknown }>
        tools?: unknown[]
        max_tokens?: number
        max_completion_tokens?: number
      } = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      const lastUser = [...(body.messages ?? [])]
        .reverse()
        .find((message) => message.role === 'user')
      const prompt = JSON.stringify(lastUser?.content ?? '')
      const marker = [
        'configuration-first',
        'configuration-updated',
        'configuration-truncated'
      ].find((candidate) => prompt.includes(candidate))
      // Auxiliary title requests contain the conversation too; only the interactive request has tools.
      if (marker !== undefined && Array.isArray(body.tools) && body.tools.length > 0) {
        budgets[marker] ??= []
        budgets[marker].push(body.max_tokens ?? body.max_completion_tokens ?? 0)
      }
      const truncated = marker === 'configuration-truncated'
      const content = truncated ? 'Starting the unfinished draft.' : 'Fixture response complete.'
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(
        `data: ${JSON.stringify({
          id: 'configuration-response',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'manual-writer',
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content },
              finish_reason: truncated ? 'length' : 'stop'
            }
          ],
          usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 }
        })}\n\ndata: [DONE]\n\n`
      )
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const launched = await launchApp({
      userData: join(testRoot, 'model-config-data'),
      dialogPaths: [testRoot]
    })
    try {
      const port = (server.address() as AddressInfo).port
      await launched.page.evaluate(async (port) => {
        const presetId = 'custom:configuration-fixture'
        await window.desktop.providers.saveAgentPreset({
          presetId,
          name: 'Configuration Fixture',
          baseUrl: `http://127.0.0.1:${port}/v1`,
          api: 'openai-completions',
          authMode: 'api_key'
        })
        await window.desktop.providers.saveAgentManualModel({
          presetId,
          model: {
            id: 'manual-writer',
            name: 'Initial Writer',
            api: 'openai-completions',
            reasoning: false,
            input: ['text'],
            contextWindow: 262_144,
            maxTokens: 16_384
          }
        })
        await window.desktop.providers.setAgentCredential({
          presetId,
          apiKey: 'configuration-fixture-key'
        })
        await window.desktop.providers.setAgentDefault({ presetId, modelId: 'manual-writer' })
      }, port)
      await launched.page.getByRole('button', { name: 'Create project', exact: true }).click()
      const create = launched.page.getByRole('dialog', { name: 'Create project' })
      await create.getByLabel('Project name').fill('Model configuration')
      await create.getByRole('button', { name: 'Choose location' }).click()
      await expectActiveProject(launched.page, 'Model configuration')
      await launched.page.getByRole('button', { name: 'Agent', exact: true }).click()
      const panel = launched.page.getByTestId('agent-panel')
      await expect(panel.getByTestId('agent-model-selector')).toContainText('Initial Writer')
      await panel.getByLabel('Agent message').fill('configuration-first')
      await panel.getByRole('button', { name: 'Send', exact: true }).click()
      await expect.poll(() => budgets['configuration-first']).toEqual([16_384])
      await expect(panel.getByTestId('agent-status')).toContainText('Ready')

      await launched.page.getByRole('button', { name: 'Settings', exact: true }).click()
      const settings = launched.page.getByRole('dialog', { name: 'Settings' })
      await settings.getByRole('option', { name: /^Agent API/ }).click()
      await settings.getByRole('button', { name: /Configuration Fixture/ }).click()
      await settings.getByRole('button', { name: 'Edit Initial Writer' }).click()
      const edit = launched.page.getByRole('dialog', { name: 'Edit model' })
      await edit.getByLabel('Display name').fill('Updated Writer')
      await edit.getByRole('button', { name: 'Advanced model metadata' }).click()
      await edit.getByLabel('Context window').fill('1048576')
      await edit.getByLabel('Maximum output').fill('65536')
      await edit.getByRole('switch', { name: 'Reasoning model' }).click()
      await edit.getByRole('button', { name: 'Save model' }).click()
      await expect(edit).toHaveCount(0)
      await launched.page.keyboard.press('Escape')
      await expect(panel.getByTestId('agent-model-selector')).toContainText('Updated Writer')
      await panel.getByLabel('Agent message').fill('configuration-updated')
      await panel.getByRole('button', { name: 'Send', exact: true }).click()
      await expect.poll(() => budgets['configuration-updated']).toEqual([65_536])
      await expect(panel.getByTestId('agent-status')).toContainText('Ready')
      const runs = await launched.page.evaluate(async () => {
        const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
          ?.projectSessionId
        if (projectSessionId === undefined) throw new Error('Project session missing')
        const session = (await window.desktop.agent.listSessions({ projectSessionId }))[0]
        if (session === undefined) throw new Error('Agent session missing')
        return window.desktop.agent.listRuns({
          projectSessionId,
          agentSessionId: session.agentSessionId
        })
      })
      expect(runs[0]?.modelLimits).toMatchObject({
        contextWindowTokens: 1_048_576,
        outputLimitTokens: 65_536
      })
      expect(runs[1]?.modelLimits).toMatchObject({
        contextWindowTokens: 262_144,
        outputLimitTokens: 16_384
      })

      await panel.getByLabel('Agent message').fill('configuration-truncated')
      await panel.getByRole('button', { name: 'Send', exact: true }).click()
      await expect(
        panel.getByText(/The model response was cut off by the output limit/).first()
      ).toBeVisible()
      await expect
        .poll(async () =>
          launched.page.evaluate(async () => {
            const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
              ?.projectSessionId
            if (projectSessionId === undefined) throw new Error('Project session missing')
            const session = (await window.desktop.agent.listSessions({ projectSessionId }))[0]
            if (session === undefined) throw new Error('Agent session missing')
            const [run] = await window.desktop.agent.listRuns({
              projectSessionId,
              agentSessionId: session.agentSessionId
            })
            return { status: run?.status, errorCode: run?.errorCode }
          })
        )
        .toEqual({ status: 'failed', errorCode: 'output_limit_reached' })
      expect(budgets['configuration-truncated']).toEqual([65_536])
    } finally {
      await launched.app.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
)
