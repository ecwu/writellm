import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach } from 'vitest'
import type { BlockNoteDocument } from '../../shared/contracts/manuscript'
import { ManuscriptAssetService } from '../manuscript/asset-service'
import { EditorPersistenceService } from '../manuscript/editor-persistence-service'
import { ManuscriptService } from '../manuscript/manuscript-service'
import { initializeProjectDatabase, type ProjectDatabase } from '../project/project-database'
import type { ProjectManifest } from '../project/project-manifest'
import { MutationProposalService } from './mutation-service'
import { AgentContextBuilder } from './context'
import { WritingTaskService } from './writing-task-service'
import type { MainAgentTools } from './tools'

export const roots: string[] = []

export const log = pino({ level: 'silent' })

export const projectSessionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc700'

export const agentSessionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc701'

export const agentRunId = '019c6a5c-8d34-7a8e-a602-3d37a52dc702'

export const modelRequestId = '019c6a5c-8d34-7a8e-a602-3d37a52dc703'

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })))
})

export async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'writellm-mutations-'))
  roots.push(root)
  const projectRoot = join(root, 'project')
  await mkdir(projectRoot)
  const manifest: ProjectManifest = {
    format: 'writellm-project',
    formatVersion: 1,
    projectId: '019c6a5c-8d34-7a8e-a602-3d37a52dc704',
    createdAt: '2026-07-21T00:00:00.000Z'
  }
  const database = await initializeProjectDatabase({
    projectRoot,
    manifest,
    applicationVersion: 'test',
    log
  })
  const manuscript = new ManuscriptService({ database, projectId: manifest.projectId, log })
  const persistence = new EditorPersistenceService({
    projectRoot,
    projectId: manifest.projectId,
    database,
    manuscript,
    log
  })
  seedAgent(database)
  const writingTasks = new WritingTaskService({ database, log })
  const service = new MutationProposalService({
    projectId: manifest.projectId,
    projectSessionId,
    database,
    manuscript,
    editorPersistence: persistence,
    writingTasks,
    log
  })
  let sequence = 0
  return {
    projectRoot,
    database,
    manuscript,
    persistence,
    manifest,
    service,
    writingTasks,
    toolCall(
      toolName:
        | 'submit_brief_change'
        | 'submit_writing_rules_change'
        | 'submit_outline_change'
        | 'submit_section_change'
        | 'generate_image'
    ) {
      sequence += 1
      const eventId = `019c6a5c-8d34-7a8e-a602-3d37a52dc7${String(sequence + 9).padStart(2, '0')}`
      const toolCallId = `tool-call-${sequence}`
      database.immediate((native) =>
        native
          .prepare(
            `INSERT INTO agent_events (
               agent_event_id, agent_session_id, agent_run_id, sequence, type,
               payload_json, model_request_id, created_at
             ) VALUES (?, ?, ?, ?, 'tool_call', ?, ?, ?)`
          )
          .run(
            eventId,
            agentSessionId,
            agentRunId,
            sequence,
            JSON.stringify({ toolCallId, toolName, args: {}, timestamp: sequence }),
            modelRequestId,
            '2026-07-21T00:00:00.000Z'
          )
      )
      return {
        agentSessionId,
        agentRunId,
        toolCallId,
        toolCallEventId: eventId,
        modelRequestId,
        signal: new AbortController().signal
      }
    }
  }
}

export async function imageRelocationFixture() {
  const value = await fixture()
  const opened = value.persistence.openEditor().activeSection
  if (opened === null) throw new Error('Missing source section')
  const assets = new ManuscriptAssetService({
    projectRoot: value.projectRoot,
    projectId: value.manifest.projectId,
    database: value.database,
    log
  })
  const asset = await assets.store({
    bytes: png(96, 54),
    mimeType: 'image/png',
    sourceType: 'upload',
    originalName: 'space-taxonomy.png'
  })
  const imageBlock: BlockNoteDocument[number] = {
    id: 'space-taxonomy-image',
    type: 'image',
    props: {
      backgroundColor: 'default',
      textAlignment: 'center',
      name: 'SPACE taxonomy',
      url: asset.logicalUrl,
      caption: 'The SPACE taxonomy and reference loop.',
      figureId: 'figure:space-taxonomy',
      altText: 'SPACE taxonomy diagram',
      showPreview: true,
      previewWidth: 960
    },
    children: []
  }
  const sourceSaved = await value.persistence.save({
    projectSessionId,
    sectionId: opened.section.sectionId,
    baseRevisionId: opened.revision.sectionRevisionId,
    baseContentHash: opened.revision.contentHash,
    document: [imageBlock, paragraph('background-body', 'Background text.')]
  })
  const targetSection = value.manuscript.createSection({
    baseOutlineVersion: value.manuscript.getWorkspace().outlineVersion,
    title: 'Scope, Reference Loop, and the SPACE Taxonomy',
    parentSectionId: null,
    position: 1
  })
  const targetBase = value.manuscript.getRevision(targetSection.currentRevisionId)
  const targetAnchor = paragraph('scope-third-paragraph', 'Third paragraph.')
  await value.persistence.save({
    projectSessionId,
    sectionId: targetSection.sectionId,
    baseRevisionId: targetBase.sectionRevisionId,
    baseContentHash: targetBase.contentHash,
    document: [targetAnchor]
  })
  const sourceSection = value.manuscript.getSection(opened.section.sectionId)
  const currentTargetSection = value.manuscript.getSection(targetSection.sectionId)
  const imageHash = createHash('sha256').update(JSON.stringify(imageBlock)).digest('hex')
  seedReadSectionResult(value.database, {
    section: sourceSection,
    revision: sourceSaved.revision,
    block: imageBlock,
    blockHash: imageHash
  })
  const contextBuilder = new AgentContextBuilder(value.manuscript)
  const snapshot = contextBuilder.capture('space-relocation-snapshot', {
    activeSectionId: targetSection.sectionId,
    activeBlockId: targetAnchor.id,
    selectedBlockIds: [targetAnchor.id]
  })
  return {
    ...value,
    assetId: asset.assetId,
    sourceSection,
    targetSection: currentTargetSection,
    imageBlock,
    imageHash,
    targetAnchor,
    targetAnchorHash: createHash('sha256').update(JSON.stringify(targetAnchor)).digest('hex'),
    contextBuilder,
    snapshot
  }
}

export function submitExistingImage(
  tools: MainAgentTools,
  value: Awaited<ReturnType<typeof imageRelocationFixture>>
) {
  return tools.execute({
    toolName: 'submit_section_change',
    args: {
      sectionId: value.targetSection.sectionId,
      operations: [
        {
          type: 'insertExistingImage',
          source: {
            sectionId: value.sourceSection.sectionId,
            blockId: value.imageBlock.id,
            expectedBlockHash: value.imageHash
          },
          anchor: null,
          placement: 'end'
        }
      ]
    },
    editorContext: value.snapshot.editorContext,
    snapshot: value.snapshot,
    ...value.toolCall('submit_section_change')
  })
}

export function seedReadSectionResult(
  database: ProjectDatabase,
  input: {
    section: ReturnType<ManuscriptService['getSection']>
    revision: ReturnType<ManuscriptService['getRevision']>
    block: BlockNoteDocument[number]
    blockHash: string
  }
): void {
  const payload = {
    toolCallId: 'read-source-image',
    toolName: 'read_section',
    contractVersion: 8,
    isError: false,
    result: {
      section: {
        sectionId: input.section.sectionId,
        parentSectionId: input.section.parentSectionId,
        position: input.section.position,
        level: input.section.level,
        title: input.section.title,
        objective: input.section.objective,
        status: input.section.status,
        currentRevisionId: input.section.currentRevisionId,
        wordCount: input.revision.wordCount,
        characterCount: input.revision.characterCount
      },
      revisionId: input.revision.sectionRevisionId,
      blocks: [
        {
          blockId: input.block.id,
          blockType: input.block.type,
          parentBlockId: null,
          depth: 0,
          ordinal: 0,
          text: '',
          textTruncated: false,
          blockHash: input.blockHash,
          childBlockIds: input.block.children.map((child) => child.id),
          hasRichContent: true
        }
      ],
      canonicalBlock: null,
      canonicalFragment: null,
      fragmentOffset: null,
      nextFragmentOffset: null,
      missingBlockIds: [],
      nextCursor: null,
      totalBlocks: 2
    },
    error: null,
    citationIds: [],
    knowledgeItemIds: [],
    parseRevisionIds: [],
    timestamp: 1
  }
  database.immediate((native) =>
    native
      .prepare(
        `INSERT INTO agent_events (
           agent_event_id, agent_session_id, agent_run_id, sequence, type,
           payload_json, model_request_id, created_at
         ) VALUES (?, ?, ?, 900, 'tool_result', ?, ?, ?)`
      )
      .run(
        '019d0000-0000-4000-8000-000000000900',
        agentSessionId,
        agentRunId,
        JSON.stringify(payload),
        modelRequestId,
        '2026-07-21T00:00:00.000Z'
      )
  )
}

export function currentContent(
  value: Awaited<ReturnType<typeof fixture>>,
  sectionId: string
): BlockNoteDocument {
  const section = value.manuscript.getSection(sectionId)
  return value.manuscript.getRevision(section.currentRevisionId).content
}

export function isImage(block: BlockNoteDocument[number]): boolean {
  return block.type === 'image'
}

export const imageModelRequestId = '019c6a5c-8d34-4a8e-a602-3d37a52dc799'

export function seedImageModelRequest(
  database: ProjectDatabase,
  requestId: string = imageModelRequestId
): void {
  const now = '2026-07-21T00:00:00.000Z'
  database.immediate((native) =>
    native
      .prepare(
        `INSERT INTO model_requests (
           model_request_id, operation_kind, provider_id, model_id, provider_fingerprint,
           request_fingerprint, status, attempt_count, retry_count, input_tokens, output_tokens,
           cache_read_tokens, cache_write_tokens, input_items, output_items,
           estimated_cost_usd_micros, usage_json, response_ids_json, error_json,
           operation_id, job_id, agent_run_id, started_at, completed_at, duration_ms,
           created_at, updated_at
         ) VALUES (?, 'image', 'google-gemini', 'gemini-3.1-flash-image', ?, ?, 'succeeded',
                   1, 0, 10, 20, NULL, NULL, 1, 1, NULL, '{}', '["gemini-response"]', NULL,
                   'image-operation', NULL, ?, ?, ?, 1, ?, ?)`
      )
      .run(requestId, 'c'.repeat(64), 'd'.repeat(64), agentRunId, now, now, now, now)
  )
}

export function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(24)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes)
  bytes.write('IHDR', 12, 'ascii')
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}

export function seedAgent(database: ProjectDatabase): void {
  database.immediate((native) => {
    const now = '2026-07-21T00:00:00.000Z'
    native
      .prepare(
        `INSERT INTO agent_sessions (
           agent_session_id, title, pi_runtime_version, event_schema_version,
           status, created_at, updated_at, archived_at
         ) VALUES (?, 'Test session', 'test', 1, 'active', ?, ?, NULL)`
      )
      .run(agentSessionId, now, now)
    native
      .prepare(
        `INSERT INTO agent_runs (
           agent_run_id, agent_session_id, status, provider_id, model_id,
           provider_fingerprint, model_fingerprint, editor_context_json,
           error_json, started_at, completed_at, created_at, updated_at
         ) VALUES (?, ?, 'running', 'provider', 'model', ?, ?, '{}', NULL, ?, NULL, ?, ?)`
      )
      .run(agentRunId, agentSessionId, 'a'.repeat(64), 'b'.repeat(64), now, now, now)
    native
      .prepare(
        `INSERT INTO model_requests (
           model_request_id, operation_kind, provider_id, model_id,
           provider_fingerprint, request_fingerprint, status, attempt_count,
           retry_count, input_items, usage_json, response_ids_json, agent_run_id,
           started_at, created_at, updated_at
         ) VALUES (?, 'agent', 'provider', 'model', ?, ?, 'running', 1, 0, 1, '{}', '[]', ?, ?, ?, ?)`
      )
      .run(modelRequestId, 'a'.repeat(64), 'c'.repeat(64), agentRunId, now, now, now)
  })
}

export function inline(text: string) {
  return [{ type: 'text' as const, text, styles: {} }]
}

export function paragraph(id: string, text: string): BlockNoteDocument[number] {
  return {
    id,
    type: 'paragraph',
    props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' },
    content: inline(text),
    children: []
  }
}
