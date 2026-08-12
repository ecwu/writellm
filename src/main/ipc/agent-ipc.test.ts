import type { IpcMainInvokeEvent, WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import type { MutationProposalRecord } from '../../shared/contracts/agent-mutations'
import { registerAgentIpc, type AgentIpcMain } from './agent-ipc'

const projectSessionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc900'
const agentSessionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc901'
const agentRunId = '019c6a5c-8d34-7a8e-a602-3d37a52dc902'
type ListedProposal = Pick<
  MutationProposalRecord,
  'proposalId' | 'agentSessionId' | 'agentRunId' | 'kind' | 'status' | 'rejectedReason'
>

describe('Agent session IPC', () => {
  it('installs the session lease before querying replay and completes it explicitly', async () => {
    const value = harness()
    const page = await value.invoke(IPC_CHANNELS.agentSubscribeEvents, {
      projectSessionId,
      agentSessionId,
      subscriptionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc903',
      afterSequence: 0
    })
    expect(page).toMatchObject({ events: [], hasMore: false })
    expect(value.order).toEqual(['subscribe', 'replay'])
    await value.invoke(IPC_CHANNELS.agentCompleteReplay, {
      projectSessionId,
      agentSessionId,
      subscriptionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc903',
      afterSequence: 0
    })
    expect(value.broker.completeReplay).toHaveBeenCalledWith(11, expect.any(String))
  })

  it('validates editor scope and starts a new immutable run through Main authority', async () => {
    const value = harness()
    const result = await value.invoke(IPC_CHANNELS.agentStartRun, {
      projectSessionId,
      agentSessionId,
      prompt: 'Draft from this section.',
      scope: 'section',
      editorContext: {
        activeSectionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc904',
        activeBlockId: null,
        selectedBlockIds: []
      }
    })
    expect(result).toMatchObject({ run: { agentRunId, status: 'running' } })
    expect(value.sessions.startRun).toHaveBeenCalledWith(
      expect.objectContaining({ agentSessionId, prompt: 'Draft from this section.' })
    )
    await expect(
      value.invoke(IPC_CHANNELS.agentStartRun, {
        projectSessionId,
        agentSessionId,
        prompt: 'Invalid project context.',
        scope: 'project',
        editorContext: {
          activeSectionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc904',
          activeBlockId: null,
          selectedBlockIds: []
        }
      })
    ).rejects.toThrow('Project scope')
  })

  it('continues an approved proposal with human-facing authoritative copy', async () => {
    const value = harness()
    const proposalId = '019c6a5c-8d34-7a8e-a602-3d37a52dc905'
    value.mutations.list.mockReturnValue([
      {
        proposalId,
        agentSessionId,
        agentRunId,
        kind: 'brief_update',
        status: 'applied',
        rejectedReason: null
      }
    ])

    await value.invoke(IPC_CHANNELS.agentStartRun, {
      projectSessionId,
      agentSessionId,
      prompt:
        'Continue the requested writing task. Verify the updated manuscript and run check_draft when appropriate.',
      approvedProposalId: proposalId,
      scope: 'project',
      editorContext: {
        activeSectionId: null,
        activeBlockId: null,
        selectedBlockIds: []
      }
    })

    expect(value.sessions.recordApprovalDecision).toHaveBeenCalledWith({
      agentSessionId,
      agentRunId,
      proposalId,
      decision: 'approved',
      continueRequested: true
    })
    const continuedPrompt = value.sessions.startRun.mock.calls.at(-1)?.[0]?.prompt
    expect(continuedPrompt).toContain('<AUTHORITATIVE_REVIEW_STATE instructionSemantics="true">')
    expect(continuedPrompt).toContain(
      'The user approved the proposed Brief update, and it is now applied. Treat the resulting manuscript state as authoritative.'
    )
    expect(continuedPrompt).toContain('<CURRENT_USER_REQUEST instructionSemantics="true">')
    expect(continuedPrompt).toContain(
      'Continue the requested writing task. Verify the updated manuscript and run check_draft when appropriate.'
    )
    expect(continuedPrompt).not.toContain(proposalId)
    expect(continuedPrompt).not.toContain('{')
    expect(value.sessions.startRun).toHaveBeenLastCalledWith(
      expect.objectContaining({ presentation: { kind: 'approval_continuation' } })
    )
  })

  it('builds rejected proposal revisions from persisted feedback and reuses the Skill snapshot', async () => {
    const value = harness()
    const proposalId = '019c6a5c-8d34-7a8e-a602-3d37a52dc906'
    value.mutations.list.mockReturnValue([
      {
        proposalId,
        agentSessionId,
        agentRunId,
        kind: 'section_patch',
        status: 'rejected',
        rejectedReason: 'Keep the opening restrained and preserve the quoted evidence.'
      }
    ])

    await value.invoke(IPC_CHANNELS.agentStartRun, {
      projectSessionId,
      agentSessionId,
      prompt: 'Renderer text must not replace the review feedback.',
      rejectedProposalId: proposalId,
      scope: 'project',
      editorContext: {
        activeSectionId: null,
        activeBlockId: null,
        selectedBlockIds: []
      }
    })

    expect(value.sessions.requireRun).toHaveBeenCalledWith(agentRunId)
    expect(value.sessions.startRun).toHaveBeenLastCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining(
          'Keep the opening restrained and preserve the quoted evidence.'
        ),
        presentation: {
          kind: 'review_feedback',
          displayContent: 'Keep the opening restrained and preserve the quoted evidence.'
        }
      })
    )
    expect(value.sessions.startRun.mock.calls.at(-1)?.[0]?.prompt).not.toContain(
      'Renderer text must not replace'
    )
    expect(value.sessions.recordApprovalDecision).not.toHaveBeenCalled()
  })

  it('rejects revision continuations with the wrong proposal state or an active blocker', async () => {
    const value = harness()
    const proposalId = '019c6a5c-8d34-7a8e-a602-3d37a52dc906'
    value.mutations.list.mockReturnValue([
      {
        proposalId,
        agentSessionId,
        agentRunId,
        kind: 'section_patch',
        status: 'pending',
        rejectedReason: null
      }
    ])
    const input = {
      projectSessionId,
      agentSessionId,
      prompt: 'Retry revision.',
      rejectedProposalId: proposalId,
      scope: 'project',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    }
    await expect(value.invoke(IPC_CHANNELS.agentStartRun, input)).rejects.toThrow('not authorized')

    value.mutations.list.mockReturnValue([
      {
        proposalId,
        agentSessionId,
        agentRunId,
        kind: 'section_patch',
        status: 'rejected',
        rejectedReason: 'Try again.'
      },
      {
        proposalId: '019c6a5c-8d34-7a8e-a602-3d37a52dc907',
        agentSessionId,
        agentRunId,
        kind: 'section_patch',
        status: 'generating',
        rejectedReason: null
      }
    ])
    await expect(value.invoke(IPC_CHANNELS.agentStartRun, input)).rejects.toThrow(
      'waiting for image generation'
    )
  })

  it('rejects stale project capabilities and unauthorized senders', async () => {
    const value = harness()
    await expect(
      value.invoke(IPC_CHANNELS.agentListSessions, {
        projectSessionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc999'
      })
    ).rejects.toThrow('stale')
    const unauthorized = {
      senderFrame: { url: 'https://attacker.invalid/' },
      sender: value.sender
    } as unknown as IpcMainInvokeEvent
    expect(() =>
      value.handlers.get(IPC_CHANNELS.agentListSessions)?.(
        unauthorized as never,
        { projectSessionId } as never
      )
    ).toThrow('Unauthorized IPC sender')
  })

  it('filters session lifecycle queries and projects title, archive, and restore commands', async () => {
    const value = harness()

    await expect(
      value.invoke(IPC_CHANNELS.agentListSessions, { projectSessionId, status: 'archived' })
    ).resolves.toHaveLength(1)
    expect(value.sessions.listSessions).toHaveBeenCalledWith('archived')
    await expect(
      value.invoke(IPC_CHANNELS.agentListSessions, { projectSessionId, status: 'deleted' })
    ).rejects.toThrow()

    await expect(
      value.invoke(IPC_CHANNELS.agentGenerateSessionTitle, {
        projectSessionId,
        agentSessionId
      })
    ).resolves.toMatchObject({ title: 'Generated title' })
    expect(value.sessions.generateSessionTitle).toHaveBeenCalledWith(agentSessionId)

    await expect(
      value.invoke(IPC_CHANNELS.agentArchiveSession, { projectSessionId, agentSessionId })
    ).resolves.toMatchObject({ status: 'archived', archivedAt: expect.any(String) })
    expect(value.sessions.archiveSession).toHaveBeenCalledWith(agentSessionId)

    await expect(
      value.invoke(IPC_CHANNELS.agentRestoreSession, { projectSessionId, agentSessionId })
    ).resolves.toMatchObject({ status: 'active', archivedAt: null })
    expect(value.sessions.restoreSession).toHaveBeenCalledWith(agentSessionId)
  })

  it('accepts only an exactly supported Thinking level and remembers explicit changes', async () => {
    const value = harness()

    await expect(
      value.invoke(IPC_CHANNELS.agentSetThinkingLevel, {
        projectSessionId,
        agentSessionId,
        level: 'high'
      })
    ).resolves.toMatchObject({ agentSessionId, thinkingLevel: 'high' })
    expect(value.sessions.setThinkingLevel).toHaveBeenCalledWith(agentSessionId, 'high')
    expect(value.catalog.setLastThinkingLevel).toHaveBeenCalledWith('high')

    await expect(
      value.invoke(IPC_CHANNELS.agentSetThinkingLevel, {
        projectSessionId,
        agentSessionId,
        level: 'xhigh'
      })
    ).rejects.toThrow('unavailable')
    expect(value.sessions.setThinkingLevel).toHaveBeenCalledTimes(1)
    expect(value.catalog.setLastThinkingLevel).toHaveBeenCalledTimes(1)
  })

  it('persists Writing Skill selection through the idle-only session command', async () => {
    const value = harness()
    await expect(
      value.invoke(IPC_CHANNELS.agentSetSkillSelection, {
        projectSessionId,
        agentSessionId,
        selection: { mode: 'explicit', skillId: 'nature-writing' }
      })
    ).resolves.toMatchObject({
      agentSessionId,
      skillSelection: { mode: 'explicit', skillId: 'nature-writing' }
    })
    expect(value.sessions.setSkillSelection).toHaveBeenCalledWith(agentSessionId, {
      mode: 'explicit',
      skillId: 'nature-writing'
    })
  })
})

function harness() {
  const handlers = new Map<string, (...args: never[]) => unknown>()
  const ipc: AgentIpcMain = {
    handle: vi.fn((channel, handler) => handlers.set(channel, handler as never)),
    removeHandler: vi.fn()
  }
  const order: string[] = []
  const run = {
    agentRunId,
    agentSessionId,
    status: 'running' as const,
    providerId: 'openai-compatible' as const,
    modelId: 'writer',
    editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] },
    errorCode: null,
    startedAt: '2026-07-21T00:00:00.000Z',
    completedAt: null,
    updatedAt: '2026-07-21T00:00:00.000Z'
  }
  const session = {
    agentSessionId,
    title: 'Conversation',
    status: 'active' as const,
    compatible: true,
    approvalMode: 'manual' as const,
    workflowState: 'idle' as const,
    modelSelection: { presetId: 'builtin:anthropic', modelId: 'claude-writer' },
    thinkingLevel: 'off' as const,
    createdAt: '2026-07-21T00:00:00.000Z',
    updatedAt: '2026-07-21T00:00:00.000Z',
    archivedAt: null
  }
  const sessions = {
    listSessions: vi.fn(() => [session]),
    createSession: vi.fn(),
    generateSessionTitle: vi.fn(async () => ({ ...session, title: 'Generated title' })),
    archiveSession: vi.fn(() => ({
      ...session,
      status: 'archived' as const,
      archivedAt: '2026-07-22T00:00:00.000Z'
    })),
    restoreSession: vi.fn(() => ({ ...session, status: 'active' as const, archivedAt: null })),
    setModelSelection: vi.fn(),
    setThinkingLevel: vi.fn((_sessionId: string, level: string) => ({
      ...session,
      thinkingLevel: level
    })),
    setSkillSelection: vi.fn(async (_sessionId: string, selection: unknown) => ({
      ...session,
      skillSelection: selection
    })),
    listEventPage: vi.fn(() => {
      order.push('replay')
      return { events: [], nextAfterSequence: 0, hasMore: false, returnedBytes: 0 }
    }),
    listRuns: vi.fn(() => [run]),
    startRun: vi.fn(async (_input: { agentSessionId: string; prompt: string }) => ({
      agentRunId,
      completion: Promise.resolve()
    })),
    recordApprovalDecision: vi.fn(),
    requireRun: vi.fn(() => run),
    steer: vi.fn(),
    followUp: vi.fn(),
    abort: vi.fn()
  }
  const mutations = { list: vi.fn((): ListedProposal[] => []) }
  const manager = {
    assertActiveSession: vi.fn((value: string) => {
      if (value !== projectSessionId) throw new Error('stale')
      return { agentSessions: sessions, agentMutations: mutations }
    }),
    assertMutationSession: vi.fn((value: string) => {
      if (value !== projectSessionId) throw new Error('stale')
      return { agentSessions: sessions, agentMutations: mutations }
    })
  }
  const broker = {
    subscribe: vi.fn(() => order.push('subscribe')),
    completeReplay: vi.fn(),
    unsubscribe: vi.fn(),
    revokeSession: vi.fn(),
    clear: vi.fn()
  }
  const catalog = {
    snapshot: vi.fn(async () => ({ presets: [], defaultSelection: session.modelSelection })),
    resolve: vi.fn(async () => ({
      presetId: 'builtin:anthropic',
      presetName: 'Anthropic',
      providerId: 'anthropic',
      timeoutMs: 45_000,
      model: {
        id: 'claude-writer',
        name: 'Claude Writer',
        api: 'anthropic-messages',
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        reasoning: true,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200_000,
        maxTokens: 16_384
      },
      auth: { auth: { apiKey: 'secret' }, source: 'test' }
    })),
    setDefaultSelection: vi.fn(),
    getLastThinkingLevel: vi.fn(async () => 'medium' as const),
    setLastThinkingLevel: vi.fn(async (level: string) => level)
  }
  registerAgentIpc({
    manager: manager as never,
    broker: broker as never,
    catalog: catalog as never,
    logger: { info: vi.fn(), error: vi.fn() },
    developmentUrl: 'http://localhost:5173',
    ipc
  })
  const sender = {
    id: 11,
    send: vi.fn(),
    isDestroyed: vi.fn(() => false)
  } as unknown as WebContents
  const event = {
    senderFrame: { url: 'http://localhost:5173/' },
    sender
  } as unknown as IpcMainInvokeEvent
  const invoke = async (channel: string, input: unknown) =>
    handlers.get(channel)?.(event as never, input as never)
  return { handlers, invoke, sender, sessions, mutations, broker, catalog, order }
}
