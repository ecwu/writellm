import { createHash } from 'node:crypto'
import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, expectActiveProject, launchApp, scenario, sectionEditor, test } from './fixtures'

async function configureAgentProvider(page: Page, baseUrl: string): Promise<void> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await settings.getByRole('option', { name: /^Agent API/ }).click()
  await settings.getByRole('button', { name: 'Add provider' }).click()
  const addProvider = page.getByRole('dialog', { name: 'Add provider' })
  await addProvider.getByLabel('Provider name').fill('Refresh Agent')
  await addProvider.getByRole('button', { name: 'Continue' }).click()
  await settings.getByLabel('Base URL').fill(baseUrl)
  await settings.getByLabel('API key').fill('refresh-e2e-secret')
  await settings.getByRole('button', { name: 'Save provider' }).click()
  await settings.getByRole('button', { name: 'Fetch Refresh Agent models' }).click()
  await expect(settings.getByText(/1 models · current/)).toBeVisible()
  await page.keyboard.press('Escape')
}

async function createProject(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Create project', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Create project' })
  await dialog.getByLabel('Project name').fill(name)
  await dialog.getByRole('button', { name: 'Choose location' }).click()
  await expectActiveProject(page, name)
}

function sendToolCall(
  response: ServerResponse,
  input: {
    responseId: string
    toolCallId: string
    sectionId: string
    index: 1 | 2
  }
): void {
  const blockId = input.index === 1 ? 'refresh-first' : 'refresh-second'
  const originalText = input.index === 1 ? 'First original' : 'Second original'
  const text = input.index === 1 ? 'First update applied' : 'Second update applied'
  const expectedBlockHash = createHash('sha256')
    .update(
      JSON.stringify({
        id: blockId,
        type: 'paragraph',
        props: {
          backgroundColor: 'default',
          textColor: 'default',
          textAlignment: 'left'
        },
        content: [{ type: 'text', text: originalText, styles: {} }],
        children: []
      })
    )
    .digest('hex')
  sendSse(response, [
    {
      id: input.responseId,
      object: 'chat.completion.chunk',
      created: 1,
      model: 'refresh-e2e-model',
      choices: [
        {
          index: 0,
          delta: {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: input.toolCallId,
                type: 'function',
                function: {
                  name: 'submit_section_change',
                  arguments: JSON.stringify({
                    sectionId: input.sectionId,
                    operations: [
                      {
                        type: 'replaceBlockText',
                        target: { blockId, expectedBlockHash },
                        text
                      }
                    ],
                    citationIds: []
                  })
                }
              }
            ]
          },
          finish_reason: null
        }
      ]
    },
    {
      id: input.responseId,
      object: 'chat.completion.chunk',
      created: 1,
      model: 'refresh-e2e-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
    }
  ])
}

function sendCompletion(response: ServerResponse, text: string): void {
  sendSse(response, [
    {
      id: 'refresh-e2e-completion',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'refresh-e2e-model',
      choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }]
    },
    {
      id: 'refresh-e2e-completion',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'refresh-e2e-model',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 }
    }
  ])
}

function sendSse(response: ServerResponse, chunks: unknown[]): void {
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    'x-request-id': 'refresh-e2e-request'
  })
  for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`)
  response.end('data: [DONE]\n\n')
}

test(
  'refreshes a non-conflicting outdated section proposal before final approval',
  scenario('agent.refreshes-outdated-proposal', ['@packaged']),
  async ({ testRoot }) => {
    let sectionId = ''
    let agentCall = 0
    const server = createServer((request, response) => {
      if (request.method === 'GET' && request.url === '/v1/models') {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end('{"data":[{"id":"refresh-e2e-model","displayName":"Refresh E2E model"}]}')
        return
      }
      if (request.method !== 'POST' || !request.url?.endsWith('/chat/completions')) {
        response.writeHead(404)
        response.end()
        return
      }
      const chunks: Buffer[] = []
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      request.on('end', () => {
        JSON.parse(Buffer.concat(chunks).toString())
        agentCall += 1
        if (agentCall === 1 || agentCall === 2) {
          const index = agentCall
          sendToolCall(response, {
            responseId: `refresh-e2e-proposal-${index}`,
            toolCallId: `refresh-e2e-tool-${index}`,
            sectionId,
            index
          })
          return
        }
        sendCompletion(response, 'No additional provider turn expected.')
      })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const port = (server.address() as AddressInfo).port
    const projectName = 'Proposal refresh E2E'
    const launched = await launchApp({
      userData: join(testRoot, 'user-data'),
      dialogPaths: [testRoot]
    })
    try {
      await configureAgentProvider(launched.page, `http://127.0.0.1:${port}/v1`)
      await createProject(launched.page, projectName)
      sectionId = await launched.page.evaluate(async () => {
        const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
          ?.projectSessionId
        if (projectSessionId === undefined) throw new Error('Project session missing')
        const workspace = await window.desktop.manuscript.workspace({ projectSessionId })
        const section = workspace.sections[0]
        if (section === undefined) throw new Error('Section missing')
        const saved = await window.desktop.editor.saveSectionDocument({
          projectSessionId,
          sectionId: section.section.sectionId,
          baseRevisionId: section.revision.sectionRevisionId,
          baseContentHash: section.revision.contentHash,
          document: [
            {
              id: 'refresh-first',
              type: 'paragraph',
              props: {
                backgroundColor: 'default',
                textColor: 'default',
                textAlignment: 'left'
              },
              content: [{ type: 'text', text: 'First original', styles: {} }],
              children: []
            },
            {
              id: 'refresh-second',
              type: 'paragraph',
              props: {
                backgroundColor: 'default',
                textColor: 'default',
                textAlignment: 'left'
              },
              content: [{ type: 'text', text: 'Second original', styles: {} }],
              children: []
            }
          ]
        })
        if (!saved.ok) throw new Error('Initial section save conflicted')
        return section.section.sectionId
      })
      await launched.page.reload()
      await expectActiveProject(launched.page, projectName)
      await expect(sectionEditor(launched.page)).toContainText('First original')

      await launched.page.getByTestId('agent-menubar-trigger').click()
      const panel = launched.page.getByTestId('agent-panel')
      await panel.getByRole('button', { name: 'New', exact: true }).click()
      await panel.getByLabel('Agent model').click()
      const modelPicker = launched.page.getByTestId('agent-model-picker')
      await modelPicker.getByRole('option', { name: /Refresh Agent/ }).click()
      await modelPicker.getByRole('option', { name: /Refresh E2E model/ }).click()
      await panel.getByRole('radio', { name: 'Section', exact: true }).click()
      await panel.getByLabel('Agent message').fill('Prepare the first update.')
      await panel.getByRole('button', { name: 'Send', exact: true }).click()
      await expect(panel.getByText('Review required', { exact: true })).toBeVisible()
      await expect(panel.getByText('Waiting for review', { exact: true }).first()).toBeVisible()
      await expect(panel.getByLabel('Agent message')).toBeDisabled()
      await panel.getByRole('button', { name: 'Back to conversations' }).click()
      await panel.getByRole('button', { name: 'New', exact: true }).click()
      await panel.getByRole('radio', { name: 'Section', exact: true }).click()
      await panel.getByLabel('Agent message').fill('Prepare the second update.')
      await panel.getByRole('button', { name: 'Send', exact: true }).click()
      await expect
        .poll(async () => {
          return launched.page.evaluate(async () => {
            const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
              ?.projectSessionId
            if (projectSessionId === undefined) return 0
            const sessions = await window.desktop.agent.listSessions({ projectSessionId })
            const proposals = await Promise.all(
              sessions.map((session) =>
                window.desktop.agent.listProposals({
                  projectSessionId,
                  agentSessionId: session.agentSessionId
                })
              )
            )
            return proposals.flat().length
          })
        })
        .toBe(2)

      const originalProposals = await launched.page.evaluate(async () => {
        const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
          ?.projectSessionId
        if (projectSessionId === undefined) throw new Error('Project session missing')
        const sessions = await window.desktop.agent.listSessions({ projectSessionId })
        return (
          await Promise.all(
            sessions.map((session) =>
              window.desktop.agent.listProposals({
                projectSessionId,
                agentSessionId: session.agentSessionId
              })
            )
          )
        ).flat()
      })
      expect(originalProposals).toHaveLength(2)
      const firstProposal = originalProposals.find(
        (proposal) => proposal.agentToolCallId === 'refresh-e2e-tool-1'
      )
      const secondProposal = originalProposals.find(
        (proposal) => proposal.agentToolCallId === 'refresh-e2e-tool-2'
      )
      if (firstProposal === undefined || secondProposal === undefined) {
        throw new Error('Expected two proposals')
      }
      await panel.getByRole('button', { name: 'Back to conversations' }).click()
      await panel.getByRole('button', { name: /Conversation 1/ }).click()
      const firstCard = panel.getByTestId(`agent-proposal-${firstProposal.proposalId}`)
      await firstCard.getByRole('button', { name: 'Approve', exact: true }).click()
      await expect(firstCard.getByText('applied', { exact: true })).toBeVisible()
      await expect(sectionEditor(launched.page)).toContainText('First update applied')

      await panel.getByRole('button', { name: 'Back to conversations' }).click()
      await panel.getByRole('button', { name: /Conversation 2/ }).click()
      const secondCard = panel.getByTestId(`agent-proposal-${secondProposal.proposalId}`)
      await expect(secondCard.getByText('outdated', { exact: true })).toBeVisible()
      await secondCard.getByRole('button', { name: 'Review update', exact: true }).click()
      await expect
        .poll(async () => {
          const proposals = await launched.page.evaluate(async (agentSessionId) => {
            const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
              ?.projectSessionId
            if (projectSessionId === undefined) return []
            return window.desktop.agent.listProposals({
              projectSessionId,
              agentSessionId
            })
          }, secondProposal.agentSessionId)
          return proposals.find(
            (proposal) =>
              proposal.status === 'pending' &&
              proposal.replacesProposalId === secondProposal.proposalId
          )
        })
        .not.toBeUndefined()
      const refreshedProposals = await launched.page.evaluate(async (agentSessionId) => {
        const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
          ?.projectSessionId
        if (projectSessionId === undefined) throw new Error('Project session missing')
        return window.desktop.agent.listProposals({
          projectSessionId,
          agentSessionId
        })
      }, secondProposal.agentSessionId)
      const replacement = refreshedProposals.find(
        (proposal) => proposal.replacesProposalId === secondProposal.proposalId
      )
      if (replacement === undefined) throw new Error('Refreshed proposal missing')
      const replacementCard = panel.getByTestId(`agent-proposal-${replacement.proposalId}`)
      await expect(
        replacementCard.getByText('Refreshed from an outdated proposal.', { exact: true })
      ).toBeVisible()
      await expect
        .poll(async () => {
          const testIds = await panel
            .locator('[data-testid^="agent-proposal-"]')
            .evaluateAll((elements) =>
              elements.map((element) => element.getAttribute('data-testid'))
            )
          return testIds.filter((testId) => /^agent-proposal-[0-9a-f-]{36}$/.test(testId ?? ''))
            .length
        })
        .toBe(1)
      await expect(launched.page.getByText('Agent action failed', { exact: true })).toHaveCount(0)
      await expect(sectionEditor(launched.page)).toContainText('Second original')

      await replacementCard.getByRole('button', { name: 'Approve', exact: true }).click()
      await expect(replacementCard.getByText('applied', { exact: true })).toBeVisible()
      await expect(sectionEditor(launched.page)).toContainText('First update applied')
      await expect(sectionEditor(launched.page)).toContainText('Second update applied')

      const finalTruth = await launched.page.evaluate(async (expectedSectionId) => {
        const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
          ?.projectSessionId
        if (projectSessionId === undefined) throw new Error('Project session missing')
        const sessions = await window.desktop.agent.listSessions({ projectSessionId })
        const proposals = (
          await Promise.all(
            sessions.map((session) =>
              window.desktop.agent.listProposals({
                projectSessionId,
                agentSessionId: session.agentSessionId
              })
            )
          )
        ).flat()
        const loaded = await window.desktop.editor.loadSection({
          projectSessionId,
          sectionId: expectedSectionId
        })
        return { proposals, content: loaded.revision.content }
      }, sectionId)
      expect(finalTruth.proposals).toHaveLength(3)
      expect(
        finalTruth.proposals.find((proposal) => proposal.proposalId === firstProposal.proposalId)
          ?.status
      ).toBe('applied')
      expect(
        finalTruth.proposals.find((proposal) => proposal.proposalId === secondProposal.proposalId)
          ?.status
      ).toBe('superseded')
      expect(
        finalTruth.proposals.find(
          (proposal) => proposal.replacesProposalId === secondProposal.proposalId
        )?.status
      ).toBe('applied')
      expect(JSON.stringify(finalTruth.content)).toContain('First update applied')
      expect(JSON.stringify(finalTruth.content)).toContain('Second update applied')
      expect(agentCall).toBe(2)
    } finally {
      await launched.app.close()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    }
  }
)
