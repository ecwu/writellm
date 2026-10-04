import { createHash, randomUUID } from 'node:crypto'
import { readBoundedAgentImage } from './attachment-file'
import type { Logger } from 'pino'
import {
  agentAttachmentIdsSchema,
  agentImageContentSchema,
  type AgentImageContent
} from '../../shared/contracts/agent-attachments'
import type { ProjectDatabase } from '../project/project-database'
import { ProjectFilesystem } from '../project/project-filesystem'
import { validateImageBytes } from '../manuscript/asset-service'
import { writeAtomicFile } from '../storage/atomic-file'
import type { JobStore } from '../jobs/job-store'

const DIRECTORY = '.writellm/agent-attachments'
const GRACE_MS = 24 * 60 * 60 * 1000

interface AttachmentRow {
  attachment_id: string
  agent_session_id: string
  name: string
  original_sha256: string
  original_path: string
  original_bytes: number
  original_mime: string
  image_sha256: string
  image_path: string
  image_bytes: number
  image_mime: 'image/png' | 'image/jpeg' | 'image/webp'
  image_width: number
  image_height: number
  released_at: string
  deletion_state: 'active' | 'deleting'
}

export class AgentAttachmentService {
  readonly #temporary = new Map<string, Set<string>>()
  readonly #filesystem: ProjectFilesystem
  constructor(
    private readonly options: {
      projectRoot: string
      database: ProjectDatabase
      log: Pick<Logger, 'info' | 'warn' | 'error'>
      jobs?: Pick<JobStore, 'enqueue'>
      now?: () => Date
    }
  ) {
    this.#filesystem = new ProjectFilesystem(options.projectRoot, options.log)
  }

  async store(
    agentSessionId: string,
    name: string,
    bytes: Buffer,
    mimeType: string,
    image: AgentImageContent,
    signal?: AbortSignal
  ): Promise<AttachmentRow> {
    this.assertConversation(agentSessionId)
    if ((this.#temporary.get(`draft:${agentSessionId}`)?.size ?? 0) >= 4)
      throw new Error('Each message accepts up to four images')
    const original = validateImageBytes(bytes, mimeType)
    const sending = agentImageContentSchema.parse(image)
    const copy = Buffer.from(sending.data, 'base64')
    const copyDimensions = validateImageBytes(copy, sending.mimeType)
    if (
      hash(copy) !== sending.sha256 ||
      copyDimensions.width !== sending.width ||
      copyDimensions.height !== sending.height
    ) {
      throw new Error('Image worker output does not match its metadata')
    }
    const attachmentId = randomUUID()
    const originalPath = `${DIRECTORY}/${attachmentId}/original${original.extension}`
    const imagePath = `${DIRECTORY}/${attachmentId}/sending${copyDimensions.extension}`
    signal?.throwIfAborted()
    const now = this.#now().toISOString()
    this.options.database.immediate((db) => {
      db.prepare(`INSERT INTO agent_attachments (
        attachment_id, agent_session_id, name, original_sha256, original_path, original_bytes,
        original_mime, original_width, original_height, image_sha256, image_path, image_bytes,
        image_mime, image_width, image_height, created_at, released_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        attachmentId,
        agentSessionId,
        name.slice(0, 500),
        hash(bytes),
        originalPath,
        bytes.length,
        original.mimeType,
        original.width,
        original.height,
        sending.sha256,
        imagePath,
        copy.length,
        sending.mimeType,
        sending.width,
        sending.height,
        now,
        now
      )
    })
    this.retain(`draft:${agentSessionId}`, agentSessionId, [attachmentId])
    this.#enqueueCleanup(now)
    try {
      await this.#filesystem.ensureDirectory(`${DIRECTORY}/${attachmentId}`)
      await writeAtomicFile(await this.#filesystem.resolveForCreation(originalPath), bytes, {
        publishWithoutReplacement: true
      })
      signal?.throwIfAborted()
      await writeAtomicFile(await this.#filesystem.resolveForCreation(imagePath), copy, {
        publishWithoutReplacement: true
      })
      signal?.throwIfAborted()
    } catch (err) {
      this.options.log.error(
        { event: 'agent.attachment.publication_failed', err, attachmentId, agentSessionId },
        'Agent image publication failed'
      )
      this.release(`draft:${agentSessionId}`, [attachmentId])
      throw err
    }

    this.options.log.info(
      {
        event: 'agent.attachment.imported',
        agentSessionId,
        attachmentId,
        byteSize: bytes.length,
        sendingBytes: copy.length,
        width: sending.width,
        height: sending.height
      },
      'Agent image imported'
    )
    return this.get(agentSessionId, attachmentId)
  }

  assertConversation(agentSessionId: string): void {
    const exists = this.options.database.immediate((db) =>
      db
        .prepare("SELECT 1 FROM agent_sessions WHERE agent_session_id = ? AND status = 'active'")
        .get(agentSessionId)
    )
    if (!exists) throw new Error('Image import requires an active conversation')
  }

  get(agentSessionId: string, attachmentId: string): AttachmentRow {
    const row = this.#row(attachmentId)
    if (row.deletion_state !== 'active') throw new Error('Image attachment is unavailable')
    if (row.agent_session_id !== agentSessionId) {
      const inherited = this.options.database.immediate((db) =>
        db
          .prepare(`
        SELECT 1 FROM agent_conversation_history e, json_each(e.payload_json, '$.attachmentIds') a
        WHERE e.agent_session_id = ? AND e.type = 'user_message' AND a.value = ? LIMIT 1
      `)
          .get(agentSessionId, attachmentId)
      )
      if (!inherited) throw new Error('Image attachment belongs to another conversation')
    }
    return row
  }

  retain(owner: string, agentSessionId: string, ids: readonly string[]): void {
    for (const id of agentAttachmentIdsSchema.parse(ids)) this.get(agentSessionId, id)
    const references = this.#temporary.get(owner) ?? new Set<string>()
    for (const id of ids) references.add(id)
    this.#temporary.set(owner, references)
  }

  release(owner: string, ids?: readonly string[]): void {
    const references = this.#temporary.get(owner)
    if (!references) return
    const released = ids === undefined ? [...references] : ids.filter((id) => references.has(id))
    for (const id of released) references.delete(id)
    if (references.size === 0) this.#temporary.delete(owner)
    const now = this.#now().toISOString()
    this.options.database.immediate((db) => {
      const update = db.prepare(
        'UPDATE agent_attachments SET released_at = ? WHERE attachment_id = ?'
      )
      for (const id of released) update.run(now, id)
    })
    if (released.length > 0) this.#enqueueCleanup(now)
  }

  releaseAll(): void {
    for (const owner of [...this.#temporary.keys()]) this.release(owner)
  }

  async load(agentSessionId: string, ids: readonly string[]): Promise<AgentImageContent[]> {
    const parsed = agentAttachmentIdsSchema.parse(ids)
    const images: AgentImageContent[] = []
    for (const id of parsed) {
      const row = this.get(agentSessionId, id)
      const bytes = await this.#read(row.image_path, row.image_bytes, row.image_sha256)
      images.push(
        agentImageContentSchema.parse({
          type: 'image',
          data: bytes.toString('base64'),
          mimeType: row.image_mime,
          sha256: row.image_sha256,
          width: row.image_width,
          height: row.image_height
        })
      )
    }
    return images
  }

  async readVerified(
    attachmentId: string
  ): Promise<{ row: { byte_size: number; mime_type: string }; bytes: Buffer }> {
    const row = this.#row(attachmentId)
    if (row.deletion_state !== 'active') throw new Error('Image attachment is unavailable')
    const bytes = await this.#read(row.image_path, row.image_bytes, row.image_sha256)
    return { row: { byte_size: bytes.length, mime_type: row.image_mime }, bytes }
  }

  async cleanupOrphans(): Promise<number> {
    const cutoff = new Date(this.#now().getTime() - GRACE_MS).toISOString()
    const rows = this.options.database.immediate(
      (db) =>
        db
          .prepare(`SELECT a.* FROM agent_attachments a
      WHERE (released_at < ? OR deletion_state = 'deleting') AND NOT EXISTS (
        SELECT 1 FROM agent_events e, json_each(e.payload_json, '$.attachmentIds') r
        WHERE e.type = 'user_message' AND r.value = a.attachment_id
      )`)
          .all(cutoff) as AttachmentRow[]
    )
    let removed = 0
    for (const row of rows) {
      if ([...this.#temporary.values()].some((ids) => ids.has(row.attachment_id))) continue
      this.options.database.immediate((db) =>
        db
          .prepare(
            "UPDATE agent_attachments SET deletion_state = 'deleting' WHERE attachment_id = ?"
          )
          .run(row.attachment_id)
      )
      this.#assertPaths(row)
      await this.#filesystem.removeTree(`${DIRECTORY}/${row.attachment_id}`)
      this.options.database.immediate((db) =>
        db.prepare('DELETE FROM agent_attachments WHERE attachment_id = ?').run(row.attachment_id)
      )
      removed += 1
    }
    this.options.log.info(
      { event: 'agent.attachment.cleanup_completed', candidates: rows.length, removed },
      'Agent attachment cleanup completed'
    )
    return removed
  }

  #row(attachmentId: string): AttachmentRow {
    const row = this.options.database.immediate(
      (db) =>
        db.prepare('SELECT * FROM agent_attachments WHERE attachment_id = ?').get(attachmentId) as
          | AttachmentRow
          | undefined
    )
    if (!row) throw new Error('Image attachment does not exist')
    this.#assertPaths(row)
    return row
  }
  #assertPaths(row: AttachmentRow): void {
    const prefix = `${DIRECTORY}/${row.attachment_id}/`
    if (
      !/^([a-f0-9]{8}-[a-f0-9-]{27})$/.test(row.attachment_id) ||
      !['original.png', 'original.jpg', 'original.webp'].some(
        (name) => row.original_path === `${prefix}${name}`
      ) ||
      !['sending.png', 'sending.jpg', 'sending.webp'].some(
        (name) => row.image_path === `${prefix}${name}`
      )
    )
      throw new Error('Image attachment paths are invalid')
  }
  async #read(path: string, size: number, sha256: string): Promise<Buffer> {
    const bytes = await readBoundedAgentImage(
      await this.#filesystem.assertExistingRegularFile(path),
      size
    )
    if (bytes.length !== size || hash(bytes) !== sha256)
      throw new Error('Stored image attachment integrity failed')
    return bytes
  }
  #now(): Date {
    return (this.options.now ?? (() => new Date()))()
  }
  #enqueueCleanup(releasedAt: string): void {
    this.options.jobs?.enqueue({
      type: 'artifact_cleanup',
      payload: { cleanupId: 'agent-attachments' },
      deduplicationKey: `agent-attachments:${releasedAt}`,
      runAfter: new Date(new Date(releasedAt).getTime() + GRACE_MS),
      maxAttempts: 5
    })
  }
}

function hash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}
