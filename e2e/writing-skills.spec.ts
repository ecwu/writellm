import { mkdir } from 'node:fs/promises'
import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { expect, expectActiveProject, launchApp, scenario, sectionEditor, test } from './fixtures'

const SKILL_FIXTURE_ENV = 'WRITELLM_E2E_SKILL_FIXTURE_PATH'

test(
  'injects textual Skills, discovers a complement, and preserves visible provenance',
  scenario('agent.global-writing-skill'),
  async ({ testRoot }) => {
    const requests: unknown[] = []
    let autoSkillUris: string[] = []
    let autoReferenceUris: string[] = []
    let autoToolBatch = 0
    let mixedReadOnlyBatchObserved = false
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
          if (lastMessage?.role === 'user' && requests.length === 1) {
            const initialReferences = autoReferenceUris.slice(0, 2).map((uri) => skillRead(uri))
            if (initialReferences.length === 0) throw new Error('Skill reference URIs are missing')
            sendToolCalls(response, initialReferences, autoToolBatch++)
            return
          }
          if (lastMessage?.role === 'tool') {
            const requestText = JSON.stringify(body)
            if (!requestText.includes("Preserve the source's paragraph order")) {
              const discoveredRoot = autoSkillUris[2]
              if (discoveredRoot === undefined) throw new Error('Discovered Skill URI is missing')
              mixedReadOnlyBatchObserved = true
              sendToolCalls(
                response,
                [
                  ...autoReferenceUris.slice(2).map((uri) => skillRead(uri)),
                  { name: 'get_writing_context', args: {} },
                  skillRead(discoveredRoot)
                ],
                autoToolBatch++
              )
              return
            }
            sendCompletion(response, 'A textual skill fixture draft.')
            return
          }
          const content = 'A global skill fixture draft.'
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
        [SKILL_FIXTURE_ENV]: JSON.stringify([
          join(process.cwd(), 'e2e/fixtures/writing-skill'),
          join(process.cwd(), 'e2e/fixtures/writing-skill-companion'),
          join(process.cwd(), 'e2e/fixtures/writing-skill-discovered')
        ])
      }
    })
    try {
      await configureAgentProvider(launched.page, `http://127.0.0.1:${port}/v1`)

      await launched.page.getByRole('button', { name: 'Settings', exact: true }).click()
      const settings = launched.page.getByRole('dialog', { name: 'Settings' })
      await settings.getByRole('option', { name: 'Writing Skills' }).click()
      await expect(settings.getByRole('switch', { name: 'Enable e2e-writing' })).toBeVisible()
      await expect(settings.getByRole('switch', { name: 'Enable e2e-humanize' })).toBeVisible()
      await expect(settings.getByText(/^CCF Visual Composer/)).toBeVisible()
      await expect(settings.getByText(/^CCF Paper Reviewer/)).toBeVisible()
      await expect(settings.getByText(/^CCF Integrity Auditor/)).toBeVisible()
      await expect(settings.getByText(/^Nature Statistics/)).toBeVisible()
      await launched.page.keyboard.press('Escape')

      await createProject(launched.page, 'Skill project one')
      await closeProject(launched.page)
      await createProject(launched.page, 'Skill project two')
      await expect
        .poll(() =>
          launched.page.evaluate(async () => {
            const installed = (await window.desktop.skills.snapshot()).installed.filter(
              (candidate) => candidate.name === 'e2e-writing' || candidate.name === 'e2e-humanize'
            )
            return installed
              .map((skill) => [skill.name, skill.displayStatus])
              .sort(([left], [right]) => (left ?? '').localeCompare(right ?? ''))
          })
        )
        .toEqual([
          ['e2e-humanize', 'ready'],
          ['e2e-writing', 'ready']
        ])

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
      await details.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(details).toBeHidden()
      await expect(panel.getByRole('button', { name: 'Choose writing skill' })).toHaveCount(0)

      const installedSkills = (
        await launched.page.evaluate(() => window.desktop.skills.snapshot())
      ).installed.filter(
        (candidate) => candidate.name === 'e2e-writing' || candidate.name === 'e2e-humanize'
      )
      const writingSkill = installedSkills.find((skill) => skill.name === 'e2e-writing')
      const humanizeSkill = installedSkills.find((skill) => skill.name === 'e2e-humanize')
      const discoveredSkill = (
        await launched.page.evaluate(() => window.desktop.skills.snapshot())
      ).installed.find((skill) => skill.name === 'e2e-discovered')
      if (
        writingSkill === undefined ||
        humanizeSkill === undefined ||
        discoveredSkill === undefined
      ) {
        throw new Error('Installed E2E writing Skills are missing')
      }
      autoSkillUris = [skillUri(writingSkill), skillUri(humanizeSkill), skillUri(discoveredSkill)]
      autoReferenceUris = [
        skillUri(writingSkill, 'references/voice.md'),
        skillUri(writingSkill, 'references/structure.md'),
        skillUri(writingSkill, 'references/revision.md'),
        skillUri(humanizeSkill, 'references/rhythm.md'),
        skillUri(humanizeSkill, 'references/clarity.md')
      ]

      const composer = panel.getByLabel('Agent message')
      await composer.fill('$e2e-w')
      await expect(launched.page.getByTestId('agent-skill-mention-menu')).toBeVisible()
      await expect(launched.page.getByText('$e2e-writing', { exact: true })).toBeVisible()
      await composer.press('Enter')
      await expect(composer).toHaveValue('$e2e-writing ')
      await composer.pressSequentially('$e2e-h')
      await expect(launched.page.getByText('$e2e-humanize', { exact: true })).toBeVisible()
      await composer.press('Tab')
      await composer.pressSequentially('Read their relevant references, then draft.')
      const textualPrompt = '$e2e-writing $e2e-humanize Read their relevant references, then draft.'
      await expect(composer).toHaveValue(textualPrompt)
      await panel.getByRole('button', { name: 'Send', exact: true }).click()
      await expect(panel.getByText(textualPrompt, { exact: true })).toBeVisible()
      await expect
        .poll(async () => {
          const project = (await launched.page.evaluate(() => window.desktop.projects.lifecycle()))
            .activeProject
          if (project === undefined) return null
          const session = (
            await launched.page.evaluate(
              ({ projectSessionId }) => window.desktop.agent.listSessions({ projectSessionId }),
              { projectSessionId: project.projectSessionId }
            )
          )[0]
          if (session === undefined) return null
          const run = (
            await launched.page.evaluate(
              ({ projectSessionId, agentSessionId }) =>
                window.desktop.agent.listRuns({ projectSessionId, agentSessionId }),
              {
                projectSessionId: project.projectSessionId,
                agentSessionId: session.agentSessionId
              }
            )
          )[0]
          if (run === undefined) return null
          return {
            status: run.status,
            errorCode: run.errorCode,
            routingStatus: run.skillSnapshot.routingStatus,
            safeError: run.skillSnapshot.safeError,
            requested: run.skillSnapshot.requestedSkills.map((skill) => skill.name),
            loaded: run.skillSnapshot.skills.map((skill) => skill.name)
          }
        })
        .toEqual({
          status: 'completed',
          errorCode: null,
          routingStatus: 'selected',
          safeError: null,
          requested: ['e2e-writing', 'e2e-humanize'],
          loaded: ['e2e-writing', 'e2e-humanize', 'e2e-discovered']
        })
      await expect(panel.getByText(/Loaded e2e-discovered/)).toBeVisible()
      await expect(panel.getByText('A textual skill fixture draft.', { exact: true })).toBeVisible()
      await expect(panel.getByLabel('Writing Skills used for this message')).toHaveCount(0)
      await panel.getByRole('log').evaluate((element) => element.scrollTo({ top: 0 }))
      const screenshotDirectory = process.env.WRITELLM_CP61_SCREENSHOT_DIR
      if (screenshotDirectory !== undefined) {
        await mkdir(screenshotDirectory, { recursive: true })
        await launched.page.screenshot({
          path: join(screenshotDirectory, 'cp61-writing-skills-desktop.png'),
          animations: 'disabled'
        })
      }
      await expect(panel.getByRole('button', { name: 'Choose writing skill' })).toHaveCount(0)

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
        schemaVersion: 4,
        mode: 'explicit',
        routingStatus: 'selected',
        requestedSkills: [
          { name: 'e2e-writing', commit: 'e'.repeat(40) },
          { name: 'e2e-humanize', commit: 'f'.repeat(40) }
        ],
        skills: [
          { name: 'e2e-writing', commit: 'e'.repeat(40), invocationSource: 'user' },
          { name: 'e2e-humanize', commit: 'f'.repeat(40), invocationSource: 'user' },
          { name: 'e2e-discovered', commit: 'd'.repeat(40), invocationSource: 'agent' }
        ],
        resources: expect.arrayContaining([
          expect.objectContaining({
            skillId: writingSkill.skillId,
            relativePath: 'references/voice.md'
          }),
          expect.objectContaining({
            skillId: writingSkill.skillId,
            relativePath: 'references/structure.md'
          }),
          expect.objectContaining({
            skillId: writingSkill.skillId,
            relativePath: 'references/revision.md'
          }),
          expect.objectContaining({
            skillId: humanizeSkill.skillId,
            relativePath: 'references/rhythm.md'
          }),
          expect.objectContaining({
            skillId: humanizeSkill.skillId,
            relativePath: 'references/clarity.md'
          })
        ])
      })
      expect(mixedReadOnlyBatchObserved).toBe(true)
      const requestTexts = requests.map((request) => JSON.stringify(request))
      expect(requestTexts[0]).toContain('$e2e-writing $e2e-humanize')
      expect(requestTexts[0]).toContain('global skill fixture')
      expect(requestTexts[0]).toContain('Keep sentence rhythm varied')
      expect(requestTexts[0]).not.toContain('Use concrete nouns and active verbs')
      expect(
        requestTexts.some((request) => request.includes('Use concrete nouns and active verbs'))
      ).toBe(true)
      expect(requestTexts.some((request) => request.includes('WRITELLM_SKILL_GUIDANCE'))).toBe(true)
      expect(
        requestTexts.some((request) => request.includes("Preserve the source's paragraph order"))
      ).toBe(true)
      await panel.getByTestId('agent-conversation-menu').click()
      await launched.page.getByRole('menuitem', { name: 'Details', exact: true }).click()
      details = launched.page.getByRole('dialog', { name: 'Agent details' })
      await expect(details.getByText('2 requested · 3 loaded', { exact: true })).toBeVisible()
      await expect(details.getByText('Requested', { exact: true })).toHaveCount(2)
      await expect(details.getByText('Discovered', { exact: true })).toHaveCount(1)
      await expect(details.getByRole('button', { name: 'Choose writing skill' })).toHaveCount(0)
      await expect(details.getByText('Retained references', { exact: true })).toBeVisible()
      await expect(details.getByText('references/clarity.md', { exact: false })).toBeVisible()
      if (screenshotDirectory !== undefined) {
        await launched.page.screenshot({
          path: join(screenshotDirectory, 'cp61-writing-skills-details.png'),
          animations: 'disabled'
        })
      }
    } finally {
      await launched.app.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
)

type ReadOnlyToolCall =
  | { name: 'read_writing_skill'; args: { uri: string } }
  | { name: 'get_writing_context'; args: Record<string, never> }

function skillRead(uri: string): ReadOnlyToolCall {
  return { name: 'read_writing_skill', args: { uri } }
}

function sendToolCalls(
  response: ServerResponse,
  calls: readonly ReadOnlyToolCall[],
  batch: number
): void {
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
            tool_calls: calls.map((call, index) => ({
              index,
              id: `read-auto-writing-skill-${batch}-${index}`,
              type: 'function',
              function: { name: call.name, arguments: JSON.stringify(call.args) }
            }))
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

function skillUri(skill: { skillId: string; commit: string }, relativePath = 'SKILL.md'): string {
  return `writellm://skills/${encodeURIComponent(skill.skillId)}/${skill.commit}/${relativePath
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`
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
  await page
    .getByRole('menuitem', { name: 'Close project and return to chooser', exact: true })
    .click()
}
