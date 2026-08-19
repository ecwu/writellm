import { describe, expect, it } from 'vitest'
import type {
  AgentEventRecord,
  AgentRendererEvent,
  AgentSessionRecord
} from '../../../../shared/contracts/agent-ipc'
import type { InstalledSkill } from '../../../../shared/contracts/skills'
import type { WritingTaskView } from '../../../../shared/contracts/writing-task'
import {
  agentComposerKeyAction,
  agentComposerRunningAction,
  buildComposerCommands,
  buildSkillMentionCandidates,
  effectiveScope,
  filterComposerCommands,
  hasManualCompactionHead,
  sectionFollowTargetForAgentEvent,
  selectAttentionSession,
  slashCommandQuery,
  writingTaskDockSummary
} from './agent-panel'

const activeSessionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc521'
const backgroundSessionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc522'
const targetSectionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc523'

describe('Agent panel flow selection', () => {
  it('labels the writing-task dock from the current step ordinal and keeps terminal history', () => {
    const task = writingTaskView()
    expect(writingTaskDockSummary(task)).toEqual({
      label: 'Step 2 / 3',
      ariaLabel: 'Writing task, Step 2 of 3, open details',
      complete: false
    })
    expect(
      writingTaskDockSummary({
        ...task,
        progress: {
          ...task.progress,
          currentStepId: null,
          completedCount: 3,
          remainingCount: 0
        }
      })
    ).toEqual({
      label: 'Plan complete',
      ariaLabel: 'Writing task, plan complete, open details',
      complete: true
    })
    expect(
      writingTaskDockSummary({
        ...task,
        progress: { ...task.progress, currentStepId: null, remainingCount: 1 }
      })
    ).toEqual({
      label: 'Plan needs attention',
      ariaLabel: 'Writing task, plan needs attention, open details',
      complete: false
    })
  })

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

  it('keeps a compacting background conversation visible as active work', () => {
    const ready = session('019c6a5c-8d34-7a8e-a602-3d37a52dc505', 'idle')
    const compacting = session('019c6a5c-8d34-7a8e-a602-3d37a52dc506', 'compacting')
    expect(selectAttentionSession([ready, compacting])).toBe(compacting)
  })

  it('enables manual compaction only for two completed tail runs after the latest checkpoint', () => {
    const terminal = (sequence: number): AgentEventRecord => ({
      agentEventId: `019c6a5c-8d34-7a8e-a602-${String(sequence).padStart(12, '0')}`,
      agentSessionId: activeSessionId,
      agentRunId: `019c6a5c-8d34-7a8e-a602-${String(sequence + 100).padStart(12, '0')}`,
      sequence,
      type: 'run_completed',
      payload: { outcome: 'finished' },
      modelRequestId: null,
      createdAt: '2026-08-12T00:00:00.000Z'
    })
    const before = [terminal(1), terminal(2)]
    expect(hasManualCompactionHead(before)).toBe(true)
    const checkpoint: AgentEventRecord = {
      agentEventId: '019c6a5c-8d34-7a8e-a602-3d37a52dc530',
      agentSessionId: activeSessionId,
      agentRunId: null,
      sequence: 3,
      type: 'compaction_summary',
      payload: {
        summary: 'Legacy checkpoint',
        coveredThroughSequence: 2,
        estimatedInputTokens: 10,
        timestamp: 3
      },
      modelRequestId: null,
      createdAt: '2026-08-12T00:00:00.000Z'
    }
    expect(hasManualCompactionHead([...before, checkpoint, terminal(4)])).toBe(false)
    expect(hasManualCompactionHead([...before, checkpoint, terminal(4), terminal(5)])).toBe(true)
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

  it('uses one running action position for Stop or queued Follow-up', () => {
    expect(agentComposerRunningAction('')).toBe('stop')
    expect(agentComposerRunningAction('   ')).toBe('stop')
    expect(agentComposerRunningAction('Queue this next.')).toBe('follow_up')
  })

  it('keeps the Add and slash catalog limited to context controls', () => {
    const commands = buildComposerCommands({
      selectionAvailable: false,
      sectionAvailable: true,
      scopePreference: 'auto'
    })

    expect(commands.find((command) => command.id === 'scope-selection')?.disabled).toBe(true)
    expect(commands.find((command) => command.id === 'scope-section')?.disabled).toBe(false)
    expect(commands.find((command) => command.id === 'scope-auto')?.selected).toBe(true)
    expect(commands.some((command) => command.id.startsWith('skill-'))).toBe(false)
    expect(filterComposerCommands(commands, 'section').map((command) => command.id)).toEqual([
      'scope-section',
      'scope-auto'
    ])
  })

  it('opens slash actions only for a leading command token', () => {
    expect(slashCommandQuery('/')).toBe('')
    expect(slashCommandQuery('/section')).toBe('section')
    expect(slashCommandQuery('Use /section here')).toBeNull()
    expect(slashCommandQuery('/section please')).toBeNull()
  })

  it('offers ready explicit-only Skills for a leading dollar query in stable match order', () => {
    const candidates = buildSkillMentionCandidates({
      installed: [
        installedSkill('method-notes', 'Method Notes', 'Review the method.'),
        installedSkill('nature-writing', 'Nature Writing', 'Write vivid landscape prose.', {
          disableModelInvocation: true
        }),
        installedSkill('disabled-nature', 'Disabled Nature', 'Nature notes.', {
          enabled: false
        })
      ],
      prompt: '$nat',
      query: 'nat',
      queryStart: 0
    })

    expect(candidates.map((candidate) => candidate.name)).toEqual(['nature-writing'])
    expect(candidates[0]).toMatchObject({
      displayName: 'Nature Writing',
      disabled: false
    })
  })

  it('omits prior mentions, caps four prefixes, and exposes available-name collisions', () => {
    const installed = [
      installedSkill('nature-one', 'Nature One', 'First source.', { name: 'shared-name' }),
      installedSkill('nature-two', 'Nature Two', 'Second source.', { name: 'shared-name' }),
      installedSkill('fifth-method', 'Fifth Method', 'Fifth source.')
    ]
    expect(
      buildSkillMentionCandidates({
        installed,
        prompt: '$shared',
        query: 'shared',
        queryStart: 0
      })
    ).toEqual([
      expect.objectContaining({
        name: 'shared-name',
        disabled: true,
        skillId: 'ambiguous:shared-name'
      })
    ])
    expect(
      buildSkillMentionCandidates({
        installed,
        prompt: '$one $two $three $four $',
        query: '',
        queryStart: 22
      })
    ).toEqual([])
    expect(
      buildSkillMentionCandidates({
        installed: [installedSkill('nature-writing', 'Nature Writing', 'Nature source.')],
        prompt: '$nature-writing $nat',
        query: 'nat',
        queryStart: 16
      })
    ).toEqual([])
  })

  it('follows valid live section-editing tools from the visible conversation', () => {
    expect(
      sectionFollowTargetForAgentEvent(
        toolEvent('submit_section_change', {
          sectionId: targetSectionId,
          operations: [
            {
              type: 'insertTextBlocks',
              anchor: null,
              placement: 'end',
              blocks: [{ blockType: 'paragraph', text: 'Agent draft' }]
            }
          ],
          citationIds: []
        }),
        activeSessionId
      )
    ).toBe(targetSectionId)
    expect(
      sectionFollowTargetForAgentEvent(
        toolEvent('generate_image', {
          sectionId: targetSectionId,
          anchor: null,
          placement: 'end',
          prompt: 'A concise scholarly diagram',
          altText: 'A scholarly diagram',
          caption: '',
          aspectRatio: 'auto',
          imageSize: '1K'
        }),
        activeSessionId
      )
    ).toBe(targetSectionId)
  })

  it('ignores background conversations, unrelated tools, and malformed section edits', () => {
    const sectionEdit = toolEvent('submit_section_change', {
      sectionId: targetSectionId,
      operations: [],
      citationIds: []
    })
    expect(sectionFollowTargetForAgentEvent(sectionEdit, activeSessionId)).toBeNull()
    expect(
      sectionFollowTargetForAgentEvent(
        toolEvent('read_section', { sectionId: targetSectionId }, activeSessionId),
        activeSessionId
      )
    ).toBeNull()
    expect(
      sectionFollowTargetForAgentEvent(
        toolEvent(
          'submit_section_change',
          {
            sectionId: targetSectionId,
            operations: [
              {
                type: 'insertTextBlocks',
                anchor: null,
                placement: 'end',
                blocks: [{ text: 'Background draft' }]
              }
            ],
            citationIds: []
          },
          backgroundSessionId
        ),
        activeSessionId
      )
    ).toBeNull()
    expect(sectionFollowTargetForAgentEvent(sectionEdit, null)).toBeNull()
    expect(
      sectionFollowTargetForAgentEvent(
        {
          kind: 'durable',
          projectSessionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc524',
          event: {
            agentEventId: '019c6a5c-8d34-7a8e-a602-3d37a52dc528',
            agentSessionId: activeSessionId,
            agentRunId: null,
            sequence: 2,
            type: 'compaction_started',
            payload: {
              schemaVersion: 2,
              compactionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc529',
              trigger: 'manual',
              phase: 'planning',
              timestamp: 2
            },
            modelRequestId: null,
            createdAt: '2026-08-12T00:00:00.000Z'
          }
        },
        activeSessionId
      )
    ).toBeNull()
  })
})

function toolEvent(
  toolName: string,
  args: Record<string, unknown>,
  agentSessionId = activeSessionId
): AgentRendererEvent {
  return {
    kind: 'durable',
    projectSessionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc524',
    event: {
      agentEventId: '019c6a5c-8d34-7a8e-a602-3d37a52dc525',
      agentSessionId,
      agentRunId: '019c6a5c-8d34-7a8e-a602-3d37a52dc526',
      sequence: 1,
      type: 'tool_call',
      payload: {
        toolCallId: 'tool-follow-section',
        toolName,
        contractVersion: 4,
        args,
        timestamp: 1
      },
      modelRequestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc527',
      createdAt: '2026-08-12T00:00:00.000Z'
    }
  }
}

function writingTaskView(): WritingTaskView {
  const stepIds = [
    '019c6a5c-8d34-7a8e-a602-3d37a52dc531',
    '019c6a5c-8d34-7a8e-a602-3d37a52dc532',
    '019c6a5c-8d34-7a8e-a602-3d37a52dc533'
  ]
  const statuses = ['pending', 'active', 'pending'] as const
  return {
    taskId: '019c6a5c-8d34-7a8e-a602-3d37a52dc530',
    agentSessionId: activeSessionId,
    objective: 'Revise the manuscript coherently.',
    planVersion: 1,
    plan: {
      schemaVersion: 1,
      steps: stepIds.map((stepId, index) => ({
        stepId,
        title: `Step ${index + 1}`,
        status: statuses[index] ?? 'pending',
        statusReason: null
      }))
    },
    progress: {
      currentStepId: stepIds[1] ?? null,
      completedCount: 0,
      remainingCount: 3,
      hasDisagreement: false,
      steps: stepIds.map((stepId, index) => ({
        stepId,
        state: index === 1 ? 'in_progress' : 'pending',
        runCount: index === 1 ? 1 : 0,
        proposalCount: 0,
        successfulEffectCount: 0,
        pendingEffectCount: 0,
        adverseEffectCount: 0,
        latestRunId: null,
        note: index === 1 ? 'The step is active.' : 'The step is pending.'
      }))
    },
    createdByAgentRunId: null,
    createdAt: '2026-08-18T00:00:00.000Z',
    updatedAt: '2026-08-18T00:00:00.000Z'
  }
}

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
    createdAt: '2026-08-12T00:00:00.000Z',
    updatedAt: '2026-08-12T00:00:00.000Z',
    archivedAt: null
  }
}

function installedSkill(
  skillId: string,
  displayName: string,
  description: string,
  overrides: Partial<InstalledSkill> = {}
): InstalledSkill {
  return {
    skillId,
    displayName,
    name: skillId,
    description,
    source: 'curated',
    repository: 'writellm/skills',
    directory: skillId,
    commit: 'a'.repeat(40),
    license: 'MIT',
    enabled: true,
    disableModelInvocation: false,
    integrityStatus: 'ready',
    displayStatus: 'ready',
    dependencies: [],
    fileCount: 1,
    totalBytes: 100,
    installedAt: '2026-08-19T00:00:00.000Z',
    checkedAt: '2026-08-19T00:00:00.000Z',
    updateAvailable: false,
    updateKind: null,
    ...overrides
  }
}
