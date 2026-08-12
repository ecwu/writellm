import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { expect, expectActiveProject, launchApp, scenario, sectionEditor, test } from './fixtures'

const SKILL_FIXTURE_ENV = 'WRITELLM_E2E_SKILL_FIXTURE_PATH'

test(
  'keeps a global skill across projects and snapshots an explicit invocation',
  scenario('agent.global-writing-skill'),
  async ({ testRoot }) => {
    const requests: unknown[] = []
    let autoSkillUri: string | undefined
    const server = createServer((request, response) => {
      if (request.method === 'GET' && request.url === '/v1/models') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end('{"data":[{"id":"writer-model","displayName":"Writer model"}]}')
        return
      }
      if (request.method === 'POST' && request.url === '/v1/chat/completions') {
        const chunks: Buffer[] = []
        request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        request.on('end', () => {
          const body = JSON.parse(Buffer.concat(chunks).toString()) as {
            messages?: Array<{ role?: string; content?: unknown }>
          }
          if (JSON.stringify(body).includes('Create a concise title for the delimited')) {
            sendCompletion(response, 'Short draft writing')
            return
          }
          requests.push(body)
          const lastMessage = body.messages?.at(-1)
          if (
            lastMessage?.role === 'user' &&
            JSON.stringify(lastMessage.content).includes('Use Auto writing skill.')
          ) {
            if (autoSkillUri === undefined) throw new Error('Auto Skill URI is missing')
            sendToolCall(response, autoSkillUri)
            return
          }
          const content =
            lastMessage?.role === 'tool'
              ? 'An Auto skill fixture draft.'
              : 'A global skill fixture draft.'
          if (JSON.stringify(lastMessage?.content).includes('Write a short draft.')) {
            setTimeout(() => sendCompletion(response, content), 1_500)
            return
          }
          sendCompletion(response, content)
        })
        return
      }
      response.writeHead(404)
      response.end()
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const port = (server.address() as AddressInfo).port
    const launched = await launchApp({
      userData: join(testRoot, 'user-data'),
      dialogPaths: [testRoot, testRoot],
      env: {
        [SKILL_FIXTURE_ENV]: join(process.cwd(), 'e2e/fixtures/writing-skill')
      }
    })
    try {
      await configureAgentProvider(launched.page, `http://127.0.0.1:${port}/v1`)

      await launched.page.getByRole('button', { name: 'Settings', exact: true }).click()
      const settings = launched.page.getByRole('dialog', { name: 'Settings' })
      await settings.getByRole('option', { name: 'Writing Skills' }).click()
      await expect(settings.getByRole('switch', { name: 'Enable e2e-writing' })).toBeVisible()
      await expect(settings.getByText('CCF Visual Composer', { exact: true })).toBeVisible()
      await expect(settings.getByText('CCF Paper Reviewer', { exact: true })).toBeVisible()
      await expect(settings.getByText('CCF Integrity Auditor', { exact: true })).toBeVisible()
      await expect(settings.getByText('Nature Statistics', { exact: true })).toBeVisible()
      await launched.page.keyboard.press('Escape')

      await createProject(launched.page, 'Skill project one')
      await closeProject(launched.page)
      await createProject(launched.page, 'Skill project two')
      await expect
        .poll(() =>
          launched.page.evaluate(async () => {
            const skill = (await window.desktop.skills.snapshot()).installed.find(
              (candidate) => candidate.name === 'e2e-writing'
            )
            return skill?.displayStatus
          })
        )
        .toBe('ready')

      await launched.page.getByLabel('Section title').fill('Draft')
      await launched.page.getByLabel('Section title').press('Tab')
      await sectionEditor(launched.page).fill('Starting text.')
      await launched.page.keyboard.press('ControlOrMeta+s')

      await launched.page.getByTestId('agent-menubar-trigger').click()
      const panel = launched.page.getByTestId('agent-panel')
      await panel.getByTestId('agent-conversation-menu').click()
      await launched.page.getByRole('menuitem', { name: 'Details', exact: true }).click()
      let details = launched.page.getByRole('dialog', { name: 'Agent details' })
      await details.getByLabel('Agent model').click()
      const modelPicker = launched.page.getByTestId('agent-model-picker')
      await modelPicker.getByRole('option', { name: /E2E Agent/ }).click()
      await modelPicker.getByRole('option', { name: /Writer model/ }).click()
      await details.getByRole('button', { name: 'Choose writing skill' }).click()
      await launched.page.getByRole('option', { name: /e2e-writing/ }).click()
      await details.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(details).toBeHidden()
      await panel.getByLabel('Agent message').fill('Write a short draft.')
      await panel.getByRole('button', { name: 'Send', exact: true }).click()

      const runStatus = panel.getByTestId('agent-status')
      await expect(runStatus).toContainText(
        /Loading writing guidance|Preparing the next step|Writing an update/
      )
      await expect(runStatus.locator('[data-slot="badge"]')).toHaveCount(0)
      await panel.getByTestId('agent-conversation-menu').click()
      await launched.page.getByRole('menuitem', { name: 'Details', exact: true }).click()
      details = launched.page.getByRole('dialog', { name: 'Agent details' })
      await expect(details).toContainText('E2E Agent · Writer model')
      await expect(details).toContainText('Thinking')
      await expect(details).toContainText('e2e-writing')
      await details.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(details).toBeHidden()

      await expect(panel.getByText('A global skill fixture draft.', { exact: true })).toBeVisible()
      await panel.getByRole('button', { name: 'Close writing agent' }).click()
      await launched.page.getByTestId('agent-menubar-trigger').click()
      await expect(panel.getByTestId('agent-conversation-switcher')).toContainText(
        'Short draft writing'
      )
      await panel.getByTestId('agent-conversation-menu').click()
      await launched.page.getByRole('menuitem', { name: 'Details', exact: true }).click()
      details = launched.page.getByRole('dialog', { name: 'Agent details' })
      await expect(details.getByRole('button', { name: 'Choose writing skill' })).toContainText(
        'e2e-writing'
      )
      await details.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(details).toBeHidden()
      await panel.getByLabel('Agent message').fill('Write a second short draft.')
      await panel.getByRole('button', { name: 'Send', exact: true }).click()
      await expect(panel.getByText('A global skill fixture draft.', { exact: true })).toHaveCount(2)
      const truth = await launched.page.evaluate(async () => {
        const project = (await window.desktop.projects.lifecycle()).activeProject
        if (project === undefined) throw new Error('Project is not open')
        const session = (
          await window.desktop.agent.listSessions({
            projectSessionId: project.projectSessionId
          })
        )[0]
        if (session === undefined) throw new Error('Agent session is missing')
        return (
          await window.desktop.agent.listRuns({
            projectSessionId: project.projectSessionId,
            agentSessionId: session.agentSessionId
          })
        )[0]
      })
      expect(truth?.skillSnapshot).toMatchObject({
        mode: 'explicit',
        routingStatus: 'selected',
        primary: { name: 'e2e-writing', commit: 'e'.repeat(40) }
      })
      expect(requests).toHaveLength(2)
      for (const request of requests) {
        const requestText = JSON.stringify(request)
        expect(requestText).toContain('global skill fixture')
        expect(requestText).toContain('writellm://skills/')
        expect(requestText).not.toContain('agent-skills')
      }

      const installedSkill = (
        await launched.page.evaluate(() => window.desktop.skills.snapshot())
      ).installed.find((candidate) => candidate.name === 'e2e-writing')
      if (installedSkill === undefined) throw new Error('Installed E2E writing skill is missing')
      autoSkillUri = `writellm://skills/${encodeURIComponent(installedSkill.skillId)}/${installedSkill.commit}/SKILL.md`

      await panel.getByTestId('agent-conversation-switcher').click()
      await launched.page.getByRole('option', { name: 'New conversation', exact: true }).click()
      await panel.getByTestId('agent-conversation-menu').click()
      await launched.page.getByRole('menuitem', { name: 'Details', exact: true }).click()
      details = launched.page.getByRole('dialog', { name: 'Agent details' })
      await expect(details.getByRole('button', { name: 'Choose writing skill' })).toContainText(
        'Auto'
      )
      await details.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(details).toBeHidden()
      await panel.getByLabel('Agent message').fill('Use Auto writing skill.')
      await panel.getByRole('button', { name: 'Send', exact: true }).click()
      await expect(panel.getByText('An Auto skill fixture draft.', { exact: true })).toBeVisible()

      const autoTruth = await launched.page.evaluate(async () => {
        const project = (await window.desktop.projects.lifecycle()).activeProject
        if (project === undefined) throw new Error('Project is not open')
        const session = (
          await window.desktop.agent.listSessions({
            projectSessionId: project.projectSessionId
          })
        )[0]
        if (session === undefined) throw new Error('Auto Agent session is missing')
        return (
          await window.desktop.agent.listRuns({
            projectSessionId: project.projectSessionId,
            agentSessionId: session.agentSessionId
          })
        )[0]
      })
      expect(autoTruth?.skillSnapshot).toMatchObject({
        mode: 'auto',
        routingStatus: 'selected',
        primary: { name: 'e2e-writing', commit: 'e'.repeat(40) }
      })
      expect(requests).toHaveLength(4)
      expect(JSON.stringify(requests[2])).toContain(autoSkillUri)
      expect(JSON.stringify(requests[3])).toContain('WRITELLM_SKILL_GUIDANCE')
    } finally {
      await launched.app.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
)

function sendToolCall(response: ServerResponse, uri: string): void {
  sendSse(response, [
    {
      id: 'auto-skill-tool-call',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'writer-model',
      choices: [
        {
          index: 0,
          delta: {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: 'read-auto-writing-skill',
                type: 'function',
                function: { name: 'read_writing_skill', arguments: JSON.stringify({ uri }) }
              }
            ]
          },
          finish_reason: null
        }
      ]
    },
    {
      id: 'auto-skill-tool-call',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'writer-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 20, completion_tokens: 6, total_tokens: 26 }
    }
  ])
}

function sendCompletion(response: ServerResponse, content: string): void {
  sendSse(response, [
    {
      id: 'skill-response',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'writer-model',
      choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }]
    },
    {
      id: 'skill-response',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'writer-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 20, completion_tokens: 6, total_tokens: 26 }
    }
  ])
}

function sendSse(response: ServerResponse, chunks: unknown[]): void {
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache'
  })
  for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`)
  response.end('data: [DONE]\n\n')
}

async function configureAgentProvider(page: import('@playwright/test').Page, baseUrl: string) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await settings.getByRole('option', { name: /^Agent API/ }).click()
  await settings.getByRole('button', { name: 'Add provider' }).click()
  const addProvider = page.getByRole('dialog', { name: 'Add provider' })
  await addProvider.getByLabel('Provider name').fill('E2E Agent')
  await addProvider.getByRole('button', { name: 'Continue' }).click()
  await settings.getByLabel('Base URL').fill(baseUrl)
  await settings.getByLabel('API key').fill('e2e-secret')
  await settings.getByRole('button', { name: 'Save provider' }).click()
  await settings.getByRole('button', { name: 'Fetch E2E Agent models' }).click()
  await expect(settings.getByText(/1 models · current/)).toBeVisible()
  await page.keyboard.press('Escape')
}

async function createProject(page: import('@playwright/test').Page, name: string) {
  await page.getByRole('button', { name: 'Create project', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create project' })
  await dialog.getByLabel('Project name').fill(name)
  await dialog.getByRole('button', { name: 'Choose location' }).click()
  await expectActiveProject(page, name)
}

async function closeProject(page: import('@playwright/test').Page) {
  await page.getByRole('menuitem', { name: 'Project', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Close project', exact: true }).click()
}
