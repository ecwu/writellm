import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { readFile, rename, symlink, writeFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { openProjectDatabase } from '../project/project-database'
import { AgentAttachmentService } from './attachment-service'
import {
  createDatabase,
  createService,
  FakeAgentRuntime,
  log,
  assistant,
  metadata
} from './session-service.test-support'
import { imageFixture } from '../../workers/agent-image-fixtures.test-support'
import { processAgentImage } from '../../workers/agent-image-process'
import { buildNextCompactionMaterial, loadContinuousRuntimeHistory } from './context-checkpoint'

async function fixture() {
  const database = await createDatabase()
  const projectRoot = database.immediate((db) => dirname(dirname(db.name)))
  const runtime = new FakeAgentRuntime()
  let now = new Date('2026-10-03T00:00:00.000Z')
  const attachments = new AgentAttachmentService({ database, projectRoot, log, now: () => now })
  let vision = true
  const resolve = async () => ({
    presetId: 'custom:images',
    presetName: 'Images',
    providerId: 'image-fixture',
    timeoutMs: 30000,
    model: {
      id: 'vision',
      name: 'Vision',
      api: 'openai-completions',
      provider: 'image-fixture',
      baseUrl: 'https://images.example.test/v1',
      reasoning: false,
      input: vision ? ['text', 'image'] : ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 262144,
      maxTokens: 8192
    },
    auth: { auth: { apiKey: 'image-secret' }, source: 'Stored API key' }
  })
  const service = createService(database, runtime, undefined, {
    attachments,
    agentCatalog: { resolve } as never
  })
  const session = service.createSession('Images', undefined, {
    presetId: 'custom:images',
    modelId: 'vision'
  })
  const bytes = imageFixture()
  const importImage = (owner = session.agentSessionId) =>
    attachments.store(
      owner,
      'fixture.png',
      bytes,
      'image/png',
      processAgentImage(bytes, 'image/png')
    )
  const editorContext = { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
  const start = (ids: string[], prompt = '', owner = session.agentSessionId) =>
    service.startRun({ agentSessionId: owner, prompt, attachmentIds: ids, editorContext })
  return {
    database,
    projectRoot,
    runtime,
    attachments,
    service,
    session,
    bytes,
    importImage,
    start,
    setVision: (value: boolean) => {
      vision = value
    },
    advance: () => {
      now = new Date(now.getTime() + 25 * 3600000)
    }
  }
}

describe('Agent attachment ownership, history and recovery', () => {
  it('persists originals and copies with relative paths, detects corruption and blocks symlinks', async () => {
    const f = await fixture()
    const row = await f.importImage()
    expect(row.original_path).toMatch(/^\.writellm\/agent-attachments\//)
    expect(await readFile(join(f.projectRoot, row.original_path))).toEqual(f.bytes)
    expect(
      (await f.attachments.load(f.session.agentSessionId, [row.attachment_id]))[0]
    ).toMatchObject({ width: 3, height: 2 })
    await rename(
      join(f.projectRoot, row.image_path),
      join(f.projectRoot, `${row.image_path}.saved`)
    )
    await symlink(
      join(f.projectRoot, `${row.image_path}.saved`),
      join(f.projectRoot, row.image_path)
    )
    await expect(
      f.attachments.load(f.session.agentSessionId, [row.attachment_id])
    ).rejects.toThrow()
    f.database.close()
  })
  it('rehydrates images after reopening a moved project root and detects changed content', async () => {
    const f = await fixture()
    const row = await f.importImage()
    const run = await f.start([row.attachment_id])
    f.runtime.active().resolve()
    await run.completion
    f.database.close()
    const moved = `${f.projectRoot}.moved`
    await rename(f.projectRoot, moved)
    const database = await openProjectDatabase({
      projectRoot: moved,
      manifest: {
        format: 'writellm-project',
        formatVersion: 1,
        projectId: '019c6a5c-8d34-7a8e-a602-3d37a52dc421',
        createdAt: '2026-07-21T00:00:00.000Z'
      },
      applicationVersion: 'test',
      log
    })
    const reopened = new AgentAttachmentService({ projectRoot: moved, database, log })
    expect(await reopened.load(f.session.agentSessionId, [row.attachment_id])).toHaveLength(1)
    expect(loadContinuousRuntimeHistory(database, f.session.agentSessionId)).toContainEqual(
      expect.objectContaining({ attachmentIds: [row.attachment_id] })
    )
    const path = join(moved, row.image_path)
    const changed = await readFile(path)
    changed[changed.length - 1] ^= 1
    await writeFile(path, changed)
    await expect(reopened.load(f.session.agentSessionId, [row.attachment_id])).rejects.toThrow(
      'integrity'
    )
    database.close()
  })
  it('retains publication recovery metadata and restarts the grace period when a draft closes', async () => {
    const f = await fixture()
    const controller = new AbortController()
    const pending = f.attachments.store(
      f.session.agentSessionId,
      'canceled.png',
      f.bytes,
      'image/png',
      processAgentImage(f.bytes, 'image/png'),
      controller.signal
    )
    controller.abort(new Error('Canceled during publication'))
    await expect(pending).rejects.toThrow('Canceled')
    f.advance()
    expect(await f.attachments.cleanupOrphans()).toBe(1)
    await f.importImage()
    f.advance()
    expect(await f.attachments.cleanupOrphans()).toBe(0)
    await f.service.close()
    expect(await f.attachments.cleanupOrphans()).toBe(0)
    f.advance()
    expect(await f.attachments.cleanupOrphans()).toBe(1)
    f.database.close()
  })
  it('enforces four draft images in Main before publishing another attachment', async () => {
    const f = await fixture()
    for (let index = 0; index < 4; index += 1) await f.importImage()
    await expect(f.importImage()).rejects.toThrow('four images')
    expect(
      f.database.immediate((db) =>
        db.prepare('SELECT COUNT(*) FROM agent_attachments').pluck().get()
      )
    ).toBe(4)
    f.database.close()
  })
  it('sends image-only input, rehydrates history and preserves images through edit and fork', async () => {
    const f = await fixture()
    const row = await f.importImage()
    const ids = [row.attachment_id]
    const first = await f.start(ids)
    expect(f.runtime.active().input.images).toHaveLength(1)
    await f.runtime.active().emit({
      type: 'assistant_message',
      modelRequestId: f.runtime.active().input.modelRequestId,
      message: assistant('Image answer', 'image-answer')
    })
    await f.runtime.active().emit({
      type: 'model_call_finished',
      modelRequestId: f.runtime.active().input.modelRequestId,
      outcome: 'succeeded',
      metadata: metadata('image-answer')
    })
    f.runtime.active().resolve()
    await first.completion
    const user = f.service
      .listEvents(f.session.agentSessionId)
      .find((event) => event.type === 'user_message')
    if (!user) throw new Error('Missing image user event')
    const reply = f.service
      .listEvents(f.session.agentSessionId)
      .find((event) => event.type === 'assistant_message')
    if (!reply) throw new Error('Missing completed reply')
    expect(user.payload).toMatchObject({ content: '', attachmentIds: ids })
    expect(JSON.stringify(user.payload)).not.toContain('data')
    const fork = f.service.forkConversation({
      sourceSessionId: f.session.agentSessionId,
      targetEventId: reply.agentEventId,
      requestId: randomUUID()
    })
    expect(await f.attachments.load(fork.agentSessionId, ids)).toHaveLength(1)
    const second = await f.start([], 'Recall the image', fork.agentSessionId)
    expect(f.runtime.active().input.history).toContainEqual(
      expect.objectContaining({
        role: 'user',
        images: expect.arrayContaining([expect.objectContaining({ width: 3 })])
      })
    )
    f.runtime.active().resolve()
    await second.completion
    const edited = await f.service.editLastMessageAndRestart({
      agentSessionId: f.session.agentSessionId,
      targetEventId: user.agentEventId,
      expectedThroughSequence: f.service.listEvents(f.session.agentSessionId).at(-1)?.sequence ?? 0,
      content: 'Updated description',
      attachmentIds: ids,
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    expect(f.runtime.active().input.images).toHaveLength(1)
    f.runtime.active().resolve()
    await edited.completion
    expect(
      loadContinuousRuntimeHistory(f.database, f.session.agentSessionId).filter(
        (message) => message.role === 'user'
      )
    ).toHaveLength(1)
    f.advance()
    expect(await f.attachments.cleanupOrphans()).toBe(0)
    f.database.close()
  })
  it('rejects text-only models and cross-conversation attachments before recording a user event', async () => {
    const f = await fixture()
    const row = await f.importImage()
    f.setVision(false)
    await expect(f.start([row.attachment_id])).rejects.toThrow('does not support image')
    expect(f.service.listEvents(f.session.agentSessionId)).toEqual([])
    f.setVision(true)
    const other = f.service.createSession('Other', undefined, {
      presetId: 'custom:images',
      modelId: 'vision'
    })
    await expect(f.start([row.attachment_id], '', other.agentSessionId)).rejects.toThrow(
      'another conversation'
    )
    expect(f.service.listEvents(other.agentSessionId)).toEqual([])
    const first = await f.start([row.attachment_id])
    f.runtime.active().resolve()
    await first.completion
    f.setVision(false)
    await expect(f.start([], 'Next')).rejects.toThrow('does not support image')
    f.database.close()
  })
  it('retains queued images, releases canceled drafts and protects all raw references', async () => {
    const f = await fixture()
    const first = await f.start([], 'Hold')
    const queued = await f.importImage()
    await f.service.followUp(first.agentRunId, '', [queued.attachment_id])
    f.advance()
    expect(await f.attachments.cleanupOrphans()).toBe(0)
    const draft = await f.importImage()
    f.attachments.release(`draft:${f.session.agentSessionId}`, [draft.attachment_id])
    f.advance()
    expect(await f.attachments.cleanupOrphans()).toBe(1)
    expect(() => f.attachments.get(f.session.agentSessionId, draft.attachment_id)).toThrow(
      'does not exist'
    )
    const command = f.runtime.active().commands.find((command) => command.operation === 'follow_up')
    if (!command?.pendingMessageId) throw new Error('Missing queued image')
    await f.runtime.active().emit({
      type: 'follow_up_consumption_requested',
      consumptionId: randomUUID(),
      pendingMessageId: command.pendingMessageId,
      modelRequestId: command.modelRequestId
    })
    f.runtime.active().resolve()
    await first.completion
    f.advance()
    expect(await f.attachments.cleanupOrphans()).toBe(0)
    expect(
      f.service
        .listEvents(f.session.agentSessionId)
        .some((event) => JSON.stringify(event.payload).includes(queued.attachment_id))
    ).toBe(true)
    f.database.close()
  })
  it('sends selected old images to compaction material while preserving the recent raw turn', async () => {
    const f = await fixture()
    const row = await f.importImage()
    const first = await f.start([row.attachment_id])
    f.runtime.active().resolve()
    await first.completion
    const next = await f.start([], 'Recent request')
    f.runtime.active().resolve()
    await next.completion
    const material = buildNextCompactionMaterial({
      database: f.database,
      agentSessionId: f.session.agentSessionId,
      recentTailTokenBudget: 100,
      sourceTokenBudget: 20000
    })
    if (!material) throw new Error('Missing compaction source')
    expect(material.sourcePayloadJson).toContain(row.attachment_id)
    expect(material.estimatedPromptTokens).toBeGreaterThan(1200)
    expect(material.sourceImageBytes).toBeGreaterThan(0)
    expect(material.retainedTail).toContainEqual(
      expect.objectContaining({ role: 'user', content: 'Recent request' })
    )
    f.database.close()
  })
})
