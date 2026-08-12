import { describe, expect, it } from 'vitest'
import type { AgentSessionRecord } from '../../../../shared/contracts/agent-ipc'
import { agentComposerKeyAction, effectiveScope, selectAttentionSession } from './agent-panel'

describe('Agent panel flow selection', () => {
  it('restores running work before review attention and the latest ready conversation', () => {
    const ready = session('019c6a5c-8d34-7a8e-a602-3d37a52dc501', 'idle')
    const review = session('019c6a5c-8d34-7a8e-a602-3d37a52dc502', 'awaiting_review')
    const generating = session('019c6a5c-8d34-7a8e-a602-3d37a52dc503', 'generating')
    const running = session('019c6a5c-8d34-7a8e-a602-3d37a52dc504', 'running')

    expect(selectAttentionSession([ready, review, generating, running])).toBe(running)
    expect(selectAttentionSession([ready, generating, review])).toBe(generating)
    expect(selectAttentionSession([ready])).toBe(ready)
    expect(selectAttentionSession([])).toBeNull()
  })

  it('infers Auto scope and safely degrades unavailable manual context', () => {
    const sectionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc511'
    expect(effectiveScope('auto', true, sectionId)).toBe('selection')
    expect(effectiveScope('auto', false, sectionId)).toBe('section')
    expect(effectiveScope('auto', false, null)).toBe('project')
    expect(effectiveScope('selection', false, sectionId)).toBe('section')
    expect(effectiveScope('section', false, null)).toBe('project')
    expect(effectiveScope('project', true, sectionId)).toBe('project')
  })

  it('maps Enter shortcuts without sending during IME composition', () => {
    const key = {
      key: 'Enter',
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      isComposing: false,
      running: false
    }
    expect(agentComposerKeyAction(key)).toBe('send')
    expect(agentComposerKeyAction({ ...key, shiftKey: true })).toBe('newline')
    expect(agentComposerKeyAction({ ...key, running: true })).toBe('follow_up')
    expect(agentComposerKeyAction({ ...key, running: true, metaKey: true })).toBe('steer')
    expect(agentComposerKeyAction({ ...key, running: true, ctrlKey: true })).toBe('steer')
    expect(agentComposerKeyAction({ ...key, isComposing: true })).toBe('none')
  })
})

function session(
  agentSessionId: string,
  workflowState: AgentSessionRecord['workflowState']
): AgentSessionRecord {
  return {
    agentSessionId,
    title: workflowState,
    status: 'active',
    compatible: true,
    approvalMode: 'manual',
    workflowState,
    modelSelection: null,
    thinkingLevel: 'off',
    skillSelection: { mode: 'auto' },
    createdAt: '2026-08-12T00:00:00.000Z',
    updatedAt: '2026-08-12T00:00:00.000Z',
    archivedAt: null
  }
}
