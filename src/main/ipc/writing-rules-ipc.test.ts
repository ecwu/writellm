import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import { registerWritingRulesIpc } from './writing-rules-ipc'

const projectSessionId = '019d0000-0000-7000-8000-000000000301'
const manuscriptId = '019d0000-0000-7000-8000-000000000302'

describe('Writing Rules IPC', () => {
  it('authorizes the renderer and rechecks the mutation capability', () => {
    const handlers = new Map<string, (...args: never[]) => unknown>()
    const ipc = {
      handle: vi.fn((channel: string, handler: (...args: never[]) => unknown) => {
        handlers.set(channel, handler)
      }),
      removeHandler: vi.fn()
    }
    const getBrief = vi.fn(() => ({
      version: 1,
      manuscriptBriefId: '019d0000-0000-7000-8000-000000000303',
      manuscriptId,
      schemaVersion: 1 as const,
      title: 'Writing rules fixture',
      description: '',
      topic: '',
      targetAudience: '',
      language: '',
      styleTone: '',
      scopeExclusions: '',
      targetLength: '',
      citationRequirements: '',
      additionalInstructions: '',
      extensible: {},
      createdAt: '2026-09-03T00:00:00.000Z'
    }))
    const getWorkspace = vi.fn(() => ({
      manuscriptId,
      outlineVersion: 1,
      brief: getBrief(),
      sections: [],
      wordCount: 0,
      characterCount: 0
    }))
    const updateBrief = vi.fn()
    const manager = {
      assertMutationSession: vi.fn((sessionId: string) => {
        if (sessionId !== projectSessionId) throw new Error('Stale project capability')
        return { manuscript: { getBrief, getWorkspace, updateBrief } }
      })
    }
    registerWritingRulesIpc({
      manager: manager as never,
      logger: { info: vi.fn(), error: vi.fn() },
      developmentUrl: 'http://localhost:5173',
      ipc
    })
    const handler = handlers.get(IPC_CHANNELS.writingRulesUpdate)
    if (handler === undefined) throw new Error('Missing Writing Rules handler')
    const trusted = {
      senderFrame: { url: 'http://localhost:5173/' }
    } as unknown as IpcMainInvokeEvent
    expect(
      handler(
        trusted as never,
        {
          projectSessionId,
          baseBriefVersion: 1,
          operations: [
            {
              type: 'add',
              clientRef: 'new-rule',
              rule: {
                category: 'other',
                instruction: 'Prefer concise examples.',
                preferredForm: null,
                discouragedForms: [],
                rationale: null,
                active: true
              }
            }
          ]
        } as never
      )
    ).toEqual(getWorkspace())
    expect(updateBrief).toHaveBeenCalledOnce()

    const untrusted = {
      senderFrame: { url: 'https://attacker.invalid/' }
    } as unknown as IpcMainInvokeEvent
    expect(() =>
      handler(
        untrusted as never,
        { projectSessionId, baseBriefVersion: 1, operations: [] } as never
      )
    ).toThrow('Unauthorized IPC sender')
    expect(() =>
      handler(
        trusted as never,
        {
          projectSessionId: crypto.randomUUID(),
          baseBriefVersion: 1,
          operations: [{ type: 'remove', ruleId: crypto.randomUUID() }]
        } as never
      )
    ).toThrow('Stale project capability')
  })
})
