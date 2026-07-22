import { createHash } from 'node:crypto'
import { createServer, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, expectActiveProject, launchApp, test } from './fixtures'

async function configureAgentProvider(page: Page, baseUrl: string): Promise<void> {
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('option', { name: /Agent model provider/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Agent model' })
  await dialog.getByLabel('Base URL').fill(baseUrl)
  await dialog.getByLabel('Model ID').fill('refresh-e2e-model')
  await dialog.getByLabel('Model revision').fill('refresh-e2e-r1')
  await dialog.getByLabel('API key or token').fill('refresh-e2e-secret')
  await dialog.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(dialog.getByText('Credential stored', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Close', exact: true }).first().click()
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

test('refreshes a non-conflicting outdated section proposal before final approval', async ({
  testRoot
}) => {
  let sectionId = ''
  let agentCall = 0
  const server = createServer((request, response) => {
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
    await expect(launched.page.locator('.bn-editor').first()).toContainText('First original')

    await launched.page.getByTestId('agent-menubar-trigger').click()
    const panel = launched.page.getByTestId('agent-panel')
    await panel.getByRole('button', { name: 'New', exact: true }).click()
    await panel.getByRole('button', { name: 'Section', exact: true }).click()
    await panel.getByLabel('Agent message').fill('Prepare the first update.')
    await panel.getByRole('button', { name: 'Send', exact: true }).click()
    await expect(panel.getByText('Review required', { exact: true })).toBeVisible()
    await expect(panel.getByText('Idle', { exact: true })).toBeVisible()
    await panel.getByLabel('Agent message').fill('Prepare the second update.')
    await panel.getByRole('button', { name: 'Send', exact: true }).click()
    await expect
      .poll(async () => {
        return launched.page.evaluate(async () => {
          const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
            ?.projectSessionId
          if (projectSessionId === undefined) return 0
          const session = (await window.desktop.agent.listSessions({ projectSessionId }))[0]
          if (session === undefined) return 0
          return (
            await window.desktop.agent.listProposals({
              projectSessionId,
              agentSessionId: session.agentSessionId
            })
          ).length
        })
      })
      .toBe(2)

    const originalProposals = await launched.page.evaluate(async () => {
      const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
        ?.projectSessionId
      if (projectSessionId === undefined) throw new Error('Project session missing')
      const session = (await window.desktop.agent.listSessions({ projectSessionId }))[0]
      if (session === undefined) throw new Error('Agent session missing')
      return window.desktop.agent.listProposals({
        projectSessionId,
        agentSessionId: session.agentSessionId
      })
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
    const firstCard = panel.getByTestId(`agent-proposal-${firstProposal.proposalId}`)
    const secondCard = panel.getByTestId(`agent-proposal-${secondProposal.proposalId}`)
    await firstCard.getByRole('button', { name: 'Approve', exact: true }).click()
    await expect(firstCard.getByText('applied', { exact: true })).toBeVisible()
    await expect(launched.page.locator('.bn-editor').first()).toContainText('First update applied')

    await expect(secondCard.getByText('outdated', { exact: true })).toBeVisible()
    await secondCard.getByRole('button', { name: 'Review update', exact: true }).click()
    await expect
      .poll(async () => {
        const proposals = await launched.page.evaluate(async () => {
          const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
            ?.projectSessionId
          if (projectSessionId === undefined) return []
          const session = (await window.desktop.agent.listSessions({ projectSessionId }))[0]
          if (session === undefined) return []
          return window.desktop.agent.listProposals({
            projectSessionId,
            agentSessionId: session.agentSessionId
          })
        })
        return proposals.find(
          (proposal) =>
            proposal.status === 'pending' &&
            proposal.replacesProposalId === secondProposal.proposalId
        )
      })
      .not.toBeUndefined()
    const refreshedProposals = await launched.page.evaluate(async () => {
      const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
        ?.projectSessionId
      if (projectSessionId === undefined) throw new Error('Project session missing')
      const session = (await window.desktop.agent.listSessions({ projectSessionId }))[0]
      if (session === undefined) throw new Error('Agent session missing')
      return window.desktop.agent.listProposals({
        projectSessionId,
        agentSessionId: session.agentSessionId
      })
    })
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
          .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-testid')))
        return testIds.filter((testId) => /^agent-proposal-[0-9a-f-]{36}$/.test(testId ?? ''))
          .length
      })
      .toBe(2)
    await expect(launched.page.getByText('Agent action failed', { exact: true })).toHaveCount(0)
    await expect(launched.page.locator('.bn-editor').first()).toContainText('Second original')

    await replacementCard.getByRole('button', { name: 'Approve', exact: true }).click()
    await expect(replacementCard.getByText('applied', { exact: true })).toBeVisible()
    await expect(launched.page.locator('.bn-editor').first()).toContainText('First update applied')
    await expect(launched.page.locator('.bn-editor').first()).toContainText('Second update applied')

    const finalTruth = await launched.page.evaluate(async (expectedSectionId) => {
      const projectSessionId = (await window.desktop.projects.lifecycle()).activeProject
        ?.projectSessionId
      if (projectSessionId === undefined) throw new Error('Project session missing')
      const session = (await window.desktop.agent.listSessions({ projectSessionId }))[0]
      if (session === undefined) throw new Error('Agent session missing')
      const proposals = await window.desktop.agent.listProposals({
        projectSessionId,
        agentSessionId: session.agentSessionId
      })
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
})
