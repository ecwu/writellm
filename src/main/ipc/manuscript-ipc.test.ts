import type { IpcMainInvokeEvent } from 'electron'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import type { ManuscriptWorkspace } from '../../shared/contracts/manuscript'
import { registerManuscriptIpc, type ManuscriptIpcMain } from './manuscript-ipc'

const projectSessionId = '11111111-1111-4111-8111-111111111111'
const createdAt = '2026-07-16T00:00:00.000Z'
const workspace: ManuscriptWorkspace = {
  manuscriptId: 'manuscript-1',
  outlineVersion: 1,
  brief: {
    manuscriptBriefId: 'brief-1',
    manuscriptId: 'manuscript-1',
    version: 1,
    schemaVersion: 1,
    title: 'Title',
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
    createdAt
  },
  sections: [
    {
      section: {
        sectionId: 'section-1',
        manuscriptId: 'manuscript-1',
        parentSectionId: null,
        position: 0,
        level: 1,
        title: 'Section',
        objective: null,
        status: 'planned',
        currentRevisionId: 'revision-1',
        createdAt,
        updatedAt: createdAt
      },
      revision: {
        sectionRevisionId: 'revision-1',
        sectionId: 'section-1',
        revisionNumber: 1,
        source: 'bootstrap',
        contentSchemaVersion: 5,
        contentHash: 'a'.repeat(64),
        priorRevisionId: null,
        wordCount: 0,
        characterCount: 0,
        countAlgorithmVersion: 2,
        agentRunId: null,
        agentToolCallId: null,
        agentProposalId: null,
        createdAt
      }
    }
  ],
  wordCount: 0,
  characterCount: 0
}

function harness() {
  const handlers = new Map<string, (...args: never[]) => unknown>()
  const ipc: ManuscriptIpcMain = {
    handle: vi.fn((channel, handler) => handlers.set(channel, handler as never)),
    removeHandler: vi.fn()
  }
  const manuscript = {
    getWorkspace: vi.fn(() => workspace),
    getReferenceIndex: vi.fn(() => ({
      outlineVersion: 1,
      entries: [
        {
          number: 1,
          title: 'Source',
          count: 1,
          occurrences: [
            {
              sectionId: 'section-1',
              sectionRevisionId: 'revision-1',
              blockId: 'block-1',
              ordinal: 0,
              raw: '[Source: Source]',
              syntax: 'english',
              title: 'Source'
            }
          ]
        }
      ]
    })),
    assemble: vi.fn(() => ({
      ...workspace,
      sections: workspace.sections.map((item) => ({
        section: item.section,
        revision: { ...item.revision, content: [] }
      }))
    })),
    updateBrief: vi.fn(),
    createSection: vi.fn(() => workspace.sections[0]?.section),
    updateSection: vi.fn(),
    moveSection: vi.fn(),
    deleteSection: vi.fn()
  }
  const editorPersistence = {
    loadSection: vi.fn(() => ({
      section: workspace.sections[0]?.section,
      revision: { ...workspace.sections[0]?.revision, content: [] }
    })),
    materialize: vi.fn(async () => undefined),
    removeMaterialization: vi.fn(async () => undefined)
  }
  const context = { manuscript, editorPersistence }
  const manager = {
    assertActiveSession: vi.fn((value: string) => {
      if (value !== projectSessionId) throw new Error('stale')
      return context
    }),
    assertMutationSession: vi.fn((value: string) => {
      if (value !== projectSessionId) throw new Error('stale')
      return context
    })
  }
  registerManuscriptIpc({
    manager: manager as never,
    logger: pino({ level: 'silent' }),
    developmentUrl: 'http://localhost:5173',
    ipc
  })
  const event = {
    senderFrame: { url: 'http://localhost:5173/' }
  } as unknown as IpcMainInvokeEvent
  const invoke = (channel: string, input: unknown) =>
    handlers.get(channel)?.(event as never, input as never)
  return { handlers, invoke, manager, manuscript, editorPersistence }
}

describe('manuscript IPC', () => {
  it('returns a bounded content-free workspace and an on-demand full preview', async () => {
    const { invoke, manuscript } = harness()
    const result = invoke(IPC_CHANNELS.manuscriptGetWorkspace, { projectSessionId })
    expect(result).toEqual(workspace)
    expect(result).not.toHaveProperty('sections.0.revision.content')

    const preview = await invoke(IPC_CHANNELS.manuscriptGetPreview, { projectSessionId })
    expect(preview).toHaveProperty('sections.0.revision.content', [])
    expect(manuscript.assemble).toHaveBeenCalledOnce()
  })

  it('returns the bounded whole-manuscript reference index', () => {
    const { invoke, manuscript } = harness()
    const result = invoke(IPC_CHANNELS.manuscriptGetReferences, { projectSessionId })
    expect(result).toEqual({
      outlineVersion: 1,
      entries: [expect.objectContaining({ number: 1, title: 'Source', count: 1 })]
    })
    expect(manuscript.getReferenceIndex).toHaveBeenCalledOnce()
  })

  it('searches and revalidates through the session-bound Main boundary', async () => {
    const { invoke, manager } = harness()
    const result = await invoke(IPC_CHANNELS.manuscriptSearch, {
      projectSessionId,
      query: 'section',
      caseSensitive: false,
      scope: { type: 'manuscript' },
      statuses: [],
      limit: 25
    })
    expect(result).toMatchObject({ complete: true, resultCount: 1 })
    const hit = (result as { hits: Array<Record<string, unknown>> }).hits[0]
    expect(hit).toMatchObject({ target: { kind: 'section_title', sectionId: 'section-1' } })
    if (hit === undefined) throw new Error('Expected one search hit')
    const revalidated = await invoke(IPC_CHANNELS.manuscriptSearchRevalidate, {
      projectSessionId,
      query: 'section',
      caseSensitive: false,
      matchId: hit.matchId,
      sourceSliceHash: hit.sourceSliceHash,
      target: hit.target
    })
    expect(revalidated).toMatchObject({ status: 'valid', sectionId: 'section-1' })
    expect(manager.assertActiveSession).toHaveBeenCalled()
  })

  it('authorizes the sender and rejects stale project capabilities', () => {
    const { handlers, invoke } = harness()
    expect(() =>
      invoke(IPC_CHANNELS.manuscriptGetWorkspace, { projectSessionId: 'stale-session' })
    ).toThrow('stale')

    const unauthorized = {
      senderFrame: { url: 'https://attacker.invalid/' }
    } as unknown as IpcMainInvokeEvent
    expect(() =>
      handlers.get(IPC_CHANNELS.manuscriptGetWorkspace)?.(
        unauthorized as never,
        { projectSessionId } as never
      )
    ).toThrow('Unauthorized IPC sender')
  })

  it('materializes new sections and removes deleted mirrors after authoritative mutations', async () => {
    const { invoke, manuscript, editorPersistence } = harness()
    await invoke(IPC_CHANNELS.manuscriptCreateSection, {
      projectSessionId,
      create: {
        baseOutlineVersion: 1,
        parentSectionId: null,
        position: 1,
        title: 'New section',
        objective: null,
        status: 'planned'
      }
    })
    expect(manuscript.createSection).toHaveBeenCalledOnce()
    expect(editorPersistence.materialize).toHaveBeenCalledOnce()

    await invoke(IPC_CHANNELS.manuscriptDeleteSection, {
      projectSessionId,
      delete: { baseOutlineVersion: 1, sectionId: 'section-1' }
    })
    expect(manuscript.deleteSection).toHaveBeenCalledOnce()
    expect(editorPersistence.removeMaterialization).toHaveBeenCalledWith('section-1')
  })
})
