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
  'proposalId' | 'agentSessionId' | 'agentRunId' | 'kind' | 'status'
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
        status: 'applied'
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
    expect(continuedPrompt).toBe(
      'The user approved the proposed Brief update, and it is now applied. Treat the resulting manuscript state as authoritative. Continue the requested writing task. Verify the updated manuscript and run check_draft when appropriate.'
    )
    expect(continuedPrompt).not.toContain(proposalId)
    expect(continuedPrompt).not.toContain('{')
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
  const sessions = {
    listSessions: vi.fn(() => []),
    createSession: vi.fn(),
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
  registerAgentIpc({
    manager: manager as never,
    broker: broker as never,
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
  return { handlers, invoke, sender, sessions, mutations, broker, order }
}
