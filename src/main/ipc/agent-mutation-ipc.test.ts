import type { IpcMainInvokeEvent, WebContents } from 'electron'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import type {
  ApproveMutationProposalResult,
  MutationProposalActionResult
} from '../../shared/contracts/agent-mutations'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import { registerAgentMutationIpc, type AgentMutationIpcMain } from './agent-mutation-ipc'

const projectSessionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc900'
const agentSessionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc901'
const proposalId = '019c6a5c-8d34-7a8e-a602-3d37a52dc902'
const sectionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc903'
const revisionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc904'

describe('Agent mutation IPC', () => {
  it('authorizes the active project capability without publishing the removed legacy channel', async () => {
    const value = harness()
    await value.invoke(IPC_CHANNELS.agentSubscribeMutations, {
      projectSessionId,
      subscriptionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc905'
    })
    const result = await value.invoke(IPC_CHANNELS.agentProposalApprove, {
      projectSessionId,
      agentSessionId,
      proposalId
    })
    expect(result).toEqual(approvalResult)
    expect(value.service.approve).toHaveBeenCalledOnce()
    expect(value.sender.send).not.toHaveBeenCalled()
  })

  it('returns a refreshed proposal without publishing sectionChanged', async () => {
    const value = harness(refreshResult)
    await value.invoke(IPC_CHANNELS.agentSubscribeMutations, {
      projectSessionId,
      subscriptionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc909'
    })

    const result = await value.invoke(IPC_CHANNELS.agentProposalApprove, {
      projectSessionId,
      agentSessionId,
      proposalId
    })

    expect(result).toEqual(refreshResult)
    expect(value.sender.send).not.toHaveBeenCalled()
  })

  it('records whether rejection should continue into a revision run', async () => {
    const value = harness()
    await value.invoke(IPC_CHANNELS.agentProposalReject, {
      projectSessionId,
      agentSessionId,
      proposalId,
      reason: 'Preserve the original structure.',
      continueRequested: true
    })

    expect(value.agentSessions.recordApprovalDecision).toHaveBeenCalledWith({
      agentSessionId,
      agentRunId: actionResult.proposal.agentRunId,
      proposalId,
      decision: 'rejected',
      continueRequested: true
    })
  })

  it('rejects stale project sessions and unauthorized renderer origins before mutation', async () => {
    const value = harness()
    await expect(
      value.invoke(IPC_CHANNELS.agentProposalApprove, {
        projectSessionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc999',
        agentSessionId,
        proposalId
      })
    ).rejects.toThrow('stale')
    expect(value.service.approve).not.toHaveBeenCalled()

    const unauthorized = {
      senderFrame: { url: 'https://attacker.invalid/' },
      sender: value.sender
    } as unknown as IpcMainInvokeEvent
    expect(() =>
      value.handlers.get(IPC_CHANNELS.agentProposalReject)?.(
        unauthorized as never,
        { projectSessionId, agentSessionId, proposalId, reason: 'No' } as never
      )
    ).toThrow('Unauthorized IPC sender')
  })

  it('rejects every proposal write after its conversation is archived', async () => {
    const value = harness(approvalResult, true)
    await expect(
      value.invoke(IPC_CHANNELS.agentProposalUndo, {
        projectSessionId,
        agentSessionId,
        proposalId
      })
    ).rejects.toThrow('archived')
    expect(value.service.undo).not.toHaveBeenCalled()
  })
})

function harness(approveResult: ApproveMutationProposalResult = approvalResult, archived = false) {
  const handlers = new Map<string, (...args: never[]) => unknown>()
  const ipc: AgentMutationIpcMain = {
    handle: vi.fn((channel, handler) => handlers.set(channel, handler as never)),
    removeHandler: vi.fn()
  }
  const service = {
    approve: vi.fn(async () => approveResult),
    reject: vi.fn(() => actionResult),
    undo: vi.fn(async () => actionResult)
  }
  const agentSessions = {
    listSessions: vi.fn((status: 'active' | 'archived') =>
      status === (archived ? 'archived' : 'active') ? [{ agentSessionId }] : []
    ),
    recordApprovalDecision: vi.fn()
  }
  const manager = {
    assertMutationSession: vi.fn((sessionId: string) => {
      if (sessionId !== projectSessionId) throw new Error('stale')
      return { agentMutations: service }
    }),
    assertActiveSession: vi.fn((sessionId: string) => {
      if (sessionId !== projectSessionId) throw new Error('stale')
      return { agentMutations: service, agentSessions }
    })
  }
  registerAgentMutationIpc({
    manager: manager as never,
    logger: pino({ level: 'silent' }),
    developmentUrl: 'http://localhost:5173',
    ipc
  })
  const sender = {
    id: 1,
    send: vi.fn(),
    isDestroyed: vi.fn(() => false)
  } as unknown as WebContents
  const event = {
    senderFrame: { url: 'http://localhost:5173/' },
    sender
  } as unknown as IpcMainInvokeEvent
  const invoke = (channel: string, input: unknown) =>
    Promise.resolve(handlers.get(channel)?.(event as never, input as never))
  return { handlers, invoke, sender, service, agentSessions }
}

const now = '2026-07-21T00:00:00.000Z'
const actionResult: MutationProposalActionResult = {
  proposal: {
    proposalId,
    agentSessionId,
    agentRunId: '019c6a5c-8d34-7a8e-a602-3d37a52dc906',
    agentToolCallId: 'tool-call',
    kind: 'section_patch',
    payload: {
      schemaVersion: 1,
      kind: 'section_patch',
      mutation: {
        schemaVersion: 1,
        sectionId,
        baseRevisionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc907',
        operations: [
          {
            type: 'insertBlocks',
            anchorBlockId: null,
            placement: 'end',
            blocks: [
              {
                id: 'new',
                type: 'paragraph',
                props: {
                  backgroundColor: 'default',
                  textColor: 'default',
                  textAlignment: 'left'
                },
                content: [],
                children: []
              }
            ]
          }
        ],
        citationIds: []
      },
      preview: {
        summary: 'Insert',
        affectedSectionIds: [sectionId],
        beforeText: '',
        afterText: 'new',
        beforeTextTruncated: false,
        afterTextTruncated: false,
        citedSources: []
      },
      provenance: {
        modelRequestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc908',
        citedSources: []
      }
    },
    status: 'applied',
    decisionAt: now,
    appliedRevisionId: revisionId,
    appliedBriefVersion: null,
    appliedOutlineVersion: null,
    undoRevisionId: null,
    replacesProposalId: null,
    rejectedReason: null,
    createdAt: now,
    updatedAt: now
  },
  sectionChanged: {
    projectSessionId,
    proposalId,
    sectionId,
    sectionRevisionId: revisionId,
    reason: 'applied'
  }
}

const approvalResult: ApproveMutationProposalResult = {
  outcome: 'applied',
  ...actionResult
}

const replacementProposalId = '019c6a5c-8d34-7a8e-a602-3d37a52dc910'
const refreshResult: ApproveMutationProposalResult = {
  outcome: 'refresh_required',
  previousProposal: {
    ...actionResult.proposal,
    status: 'superseded',
    decisionAt: now,
    appliedRevisionId: null,
    replacesProposalId: null,
    rejectedReason: 'A refreshed proposal replaces this outdated proposal'
  },
  proposal: {
    ...actionResult.proposal,
    proposalId: replacementProposalId,
    status: 'pending',
    decisionAt: null,
    appliedRevisionId: null,
    replacesProposalId: proposalId,
    rejectedReason: null
  },
  sectionChanged: null
}
