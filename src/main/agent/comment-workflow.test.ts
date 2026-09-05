import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { ManuscriptCommentService } from '../manuscript/comment-service'
import { MainAgentReadTools } from './read-tools'
import { MainAgentTools } from './tools'
import {
  fixture,
  paragraph,
  log,
  projectSessionId,
  agentSessionId,
  agentRunId,
  modelRequestId
} from './mutation-service.test-support'

const editorContext = { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
async function setup() {
  const f = await fixture()
  const opened = f.persistence.openEditor().activeSection
  if (opened === null) throw new Error('Missing section')
  const saved = await f.persistence.save({
    projectSessionId,
    sectionId: opened.section.sectionId,
    baseRevisionId: opened.revision.sectionRevisionId,
    baseContentHash: opened.revision.contentHash,
    document: [paragraph('body', 'alpha beta'), paragraph('other', 'Context')]
  })
  const comments = new ManuscriptCommentService({
    database: f.database,
    manuscript: f.manuscript,
    projectSessionId,
    log
  })
  const thread = comments.create({
    projectSessionId,
    sectionId: opened.section.sectionId,
    revisionId: saved.revision.sectionRevisionId,
    contentHash: saved.revision.contentHash,
    quote: 'alpha',
    segments: [{ blockId: 'body', from: 0, to: 5 }],
    body: 'Clarify alpha.'
  })
  f.database.immediate((db) =>
    db
      .prepare(
        "UPDATE agent_runs SET status = 'completed', completed_at = updated_at WHERE agent_run_id = ?"
      )
      .run(agentRunId)
  )
  comments.delegate({ projectSessionId, agentSessionId, threadIds: [thread.threadId] })
  f.database.immediate((db) =>
    db
      .prepare(
        "UPDATE agent_runs SET status = 'running', completed_at = NULL WHERE agent_run_id = ?"
      )
      .run(agentRunId)
  )
  const reads = new MainAgentReadTools({
    projectSessionId,
    manuscript: f.manuscript,
    references: { list: () => [] } as never,
    retrieval: null,
    log
  })
  const tools = new MainAgentTools(reads, f.service, undefined, comments)
  const requests = new Map<string, string>([['initial-read', modelRequestId]])
  const requestId = (request: string): string => {
    let id = requests.get(request)
    if (id === undefined) {
      id = randomUUID()
      requests.set(request, id)
    }
    return id
  }
  const context = (request: string) => ({
    ...f.toolCall('submit_section_change'),
    modelRequestId: requestId(request),
    editorContext,
    snapshot: reads.contextBuilder().capture(request, editorContext)
  })
  const currentContext = context('initial-read')
  await tools.execute({
    ...currentContext,
    toolName: 'read_comment',
    args: { threadId: thread.threadId }
  })
  const result = await tools.execute({
    ...currentContext,
    toolName: 'read_section',
    args: { sectionId: thread.sectionId, view: 'summary' }
  })
  return { ...f, comments, thread, tools, context, result }
}

describe('delegated comment workflow through Main tools and proposals', () => {
  for (const mode of ['manual', 'automatic'] as const)
    it(`${mode}: applies, rereads, verifies, resolves and reopens on undo`, async () => {
      const f = await setup()
      try {
        const submitted = await f.tools.execute({
          ...f.context('initial-read'),
          toolName: 'submit_section_change',
          args: {
            sectionId: f.thread.sectionId,
            operations: [
              {
                type: 'replaceBlockText',
                target: { blockId: 'body', expectedBlockHash: f.result.blocks[0].blockHash },
                text: 'gamma beta'
              }
            ],
            citationIds: []
          }
        })
        expect(f.comments.read(f.thread.threadId).activity?.proposalId).toBe(submitted.proposalId)
        const pendingThread = f.comments.read(f.thread.threadId)
        await expect(
          f.tools.execute({
            ...f.context('pending-verification'),
            toolName: 'resolve_comment',
            args: {
              threadId: f.thread.threadId,
              expectedVersion: pendingThread.version,
              verificationNote: 'Done',
              operationId: 'resolve'
            }
          })
        ).rejects.toThrow()
        if (mode === 'manual')
          await f.service.approve({
            projectSessionId,
            agentSessionId,
            proposalId: submitted.proposalId
          })
        else await f.service.approveAutomatically(agentSessionId, submitted.proposalId, false)
        const verifiedContext = f.context('after-application')
        const fresh = await f.tools.execute({
          ...verifiedContext,
          toolName: 'read_comment',
          args: { threadId: f.thread.threadId }
        })
        expect(fresh.anchor.status).toBe('attached')
        await f.tools.execute({
          ...verifiedContext,
          toolName: 'read_section',
          args: { sectionId: f.thread.sectionId, view: 'summary' }
        })
        const args = {
          threadId: f.thread.threadId,
          expectedVersion: fresh.version,
          verificationNote: 'The current section now says gamma beta.',
          operationId: 'resolve',
          proposalId: submitted.proposalId
        }
        await expect(
          f.tools.execute({ ...verifiedContext, toolName: 'resolve_comment', args })
        ).rejects.toThrow()
        const resolved = await f.tools.execute({
          ...f.context('verification-decision'),
          toolName: 'resolve_comment',
          args
        })
        expect(resolved.status).toBe('resolved')
        expect(
          resolved.events.some(
            (event) => event.proposalId === submitted.proposalId && event.type === 'resolved'
          )
        ).toBe(true)
        expect(
          (await f.tools.execute({ ...f.context('retry'), toolName: 'resolve_comment', args }))
            .version
        ).toBe(resolved.version)
        await f.service.undo({ projectSessionId, agentSessionId, proposalId: submitted.proposalId })
        const reopened = f.comments.read(f.thread.threadId)
        expect(reopened.status).toBe('open')
        expect(reopened.anchor.status).toBe('attached')
        expect(reopened.events.at(-1)?.note).toBe('linked_proposal_undone')
      } finally {
        f.database.close()
      }
    })

  it('rejects undelegated replies, missing pages, stale replies and cancelled runs', async () => {
    const f = await setup()
    try {
      const revision = f.manuscript.getRevision(f.thread.anchor.currentRevisionId)
      const other = f.comments.create({
        projectSessionId,
        sectionId: f.thread.sectionId,
        revisionId: revision.sectionRevisionId,
        contentHash: revision.contentHash,
        quote: 'Context',
        segments: [{ blockId: 'other', from: 0, to: 7 }],
        body: 'Another comment'
      })
      await expect(
        f.tools.execute({
          ...f.context('outside'),
          toolName: 'reply_comment',
          args: {
            threadId: other.threadId,
            expectedVersion: other.version,
            body: 'Unauthorized reply',
            operationId: 'reply'
          }
        })
      ).rejects.toThrow()
      const read = f.context('paged-read')
      const thread = await f.tools.execute({
        ...read,
        toolName: 'read_comment',
        args: { threadId: f.thread.threadId }
      })
      await f.tools.execute({
        ...read,
        toolName: 'read_section',
        args: { sectionId: f.thread.sectionId, blockIds: ['body'] }
      })
      const resolve = {
        threadId: thread.threadId,
        expectedVersion: thread.version,
        verificationNote: 'Verified',
        operationId: 'resolve'
      }
      await expect(
        f.tools.execute({ ...f.context('incomplete'), toolName: 'resolve_comment', args: resolve })
      ).rejects.toThrow()
      await f.tools.execute({
        ...f.context('remaining-page'),
        toolName: 'read_section',
        args: { sectionId: f.thread.sectionId, blockIds: ['other'] }
      })
      f.comments.reply({
        projectSessionId,
        threadId: thread.threadId,
        expectedVersion: thread.version,
        body: 'New information'
      })
      await expect(
        f.tools.execute({ ...f.context('stale'), toolName: 'resolve_comment', args: resolve })
      ).rejects.toThrow()
      f.database.immediate((db) =>
        db
          .prepare(
            "UPDATE agent_runs SET status = 'interrupted', completed_at = updated_at WHERE agent_run_id = ?"
          )
          .run(agentRunId)
      )
      await expect(
        f.tools.execute({
          ...f.context('cancelled'),
          toolName: 'reply_comment',
          args: {
            threadId: thread.threadId,
            expectedVersion: thread.version + 1,
            body: 'Late result',
            operationId: 'late'
          }
        })
      ).rejects.toThrow()
    } finally {
      f.database.close()
    }
  })
  it('preserves a later author resolution when an older linked proposal is undone', async () => {
    const f = await setup()
    try {
      const submitted = await f.tools.execute({
        ...f.context('initial-read'),
        toolName: 'submit_section_change',
        args: {
          sectionId: f.thread.sectionId,
          operations: [
            {
              type: 'replaceBlockText',
              target: { blockId: 'body', expectedBlockHash: f.result.blocks[0].blockHash },
              text: 'gamma beta'
            }
          ],
          citationIds: []
        }
      })
      await f.service.approve({
        projectSessionId,
        agentSessionId,
        proposalId: submitted.proposalId
      })
      const ctx = f.context('read-applied')
      const read = await f.tools.execute({
        ...ctx,
        toolName: 'read_comment',
        args: { threadId: f.thread.threadId }
      })
      await f.tools.execute({
        ...ctx,
        toolName: 'read_section',
        args: { sectionId: f.thread.sectionId }
      })
      const resolved = await f.tools.execute({
        ...f.context('verify'),
        toolName: 'resolve_comment',
        args: {
          threadId: read.threadId,
          expectedVersion: read.version,
          verificationNote: 'Applied',
          operationId: 'first'
        }
      })
      const reopened = f.comments.reopen({
        projectSessionId,
        threadId: read.threadId,
        expectedVersion: resolved.version
      })
      f.comments.resolve({
        projectSessionId,
        threadId: read.threadId,
        expectedVersion: reopened.version,
        resolutionNote: 'Author separately verified this'
      })
      await f.service.undo({ projectSessionId, agentSessionId, proposalId: submitted.proposalId })
      expect(f.comments.read(read.threadId).status).toBe('resolved')
    } finally {
      f.database.close()
    }
  })

  it('accepts an applied block deletion only after fresh contextual verification', async () => {
    const f = await setup()
    try {
      const submitted = await f.tools.execute({
        ...f.context('initial-read'),
        toolName: 'submit_section_change',
        args: {
          sectionId: f.thread.sectionId,
          operations: [
            {
              type: 'removeBlocks',
              targets: [{ blockId: 'body', expectedBlockHash: f.result.blocks[0].blockHash }]
            }
          ],
          citationIds: []
        }
      })
      await f.service.approve({
        projectSessionId,
        agentSessionId,
        proposalId: submitted.proposalId
      })
      const ctx = f.context('read-deleted')
      const read = await f.tools.execute({
        ...ctx,
        toolName: 'read_comment',
        args: { threadId: f.thread.threadId }
      })
      expect(read.anchor.status).toBe('orphaned')
      await f.tools.execute({
        ...ctx,
        toolName: 'read_section',
        args: { sectionId: f.thread.sectionId }
      })
      const resolved = await f.tools.execute({
        ...f.context('verify-deletion'),
        toolName: 'resolve_comment',
        args: {
          threadId: read.threadId,
          expectedVersion: read.version,
          verificationNote: 'The anchored block is removed and remaining context is intact.',
          operationId: 'deleted',
          proposalId: submitted.proposalId
        }
      })
      expect(resolved.status).toBe('resolved')
    } finally {
      f.database.close()
    }
  })
})
