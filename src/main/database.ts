import Database from 'better-sqlite3';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as sqliteVec from 'sqlite-vec';
import {
  canvasNodeLayouts,
  generationCitations,
  knowledgeChunks,
  knowledgeItems,
  nodeEdges,
  nodes,
  plainjobJobs,
  schema,
  type CanvasNodeLayoutRow,
  type KnowledgeChunkRow,
  type KnowledgeCitationRow,
  type KnowledgeItemRow,
  type NodeEdgeRow,
  type NodeRow,
  type PlainjobJobRow
} from './db/schema.js';
import { createId, createShortRef, nowIso } from './ids.js';
import { citationRefsFromText } from '../shared/citations.js';
import {
  defaultSectionMarkdown,
  ensureSectionsDirectory,
  hashMarkdown,
  readSectionMarkdownFile,
  sectionMarkdownForStorage,
  sectionMarkdownPath,
  writeSectionMarkdownFile
} from './sectionMarkdown.js';
import type {
  CanvasNodeLayout,
  CompositionTreeNode,
  ContentNodeRecord,
  CreateNodePayload,
  EdgeKind,
  FocusedWorkspaceState,
  KnowledgeChunkRecord,
  KnowledgeCitationRecord,
  KnowledgeChunkDebugRecord,
  KnowledgeIngestJobRecord,
  KnowledgeIngestStatus,
  KnowledgeIndexStatus,
  KnowledgeItemDebugRecord,
  KnowledgeItemRecord,
  KnowledgeSourceTarget,
  LlmOperationRecord,
  LlmOperationStatus,
  NodeEdgeRecord,
  NodeRecord,
  NodeStats,
  RetrievedKnowledgeSource,
  SectionNodeRecord,
  UpdateNodeLayoutPayload,
  UpdateNodePayload,
  WorkspaceSummary
} from '../shared/types.js';

const SCHEMA_VERSION = 11;
const VECTOR_TABLE_PREFIX = 'knowledge_chunk_vectors_d';
const KNOWLEDGE_INGEST_TASK_TYPE = 'knowledge-ingest';
const SECTION_METADATA_DIR = 'metadata/sections';
const LLM_OPERATION_COVERAGE_THRESHOLD = 0.4;
const PLAINJOB_STATUS_PENDING = 0;
const PLAINJOB_STATUS_PROCESSING = 1;
const PLAINJOB_STATUS_DONE = 2;
const PLAINJOB_STATUS_FAILED = 3;

type KnowledgeChunkJoinedRow = KnowledgeChunkRow & {
  itemPublicRef: string;
  itemTitle: string;
  itemMetadataJson: string | null;
};

type KnowledgeIngestTaskData = {
  filePath: string;
  fileName: string;
  fileExt: string;
  fileSize: number;
  knowledgeItemId: string | null;
  status: KnowledgeIngestStatus;
  errorMessage: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export class WriteLLMDatabase {
  readonly db: Database.Database;
  readonly orm: BetterSQLite3Database<typeof schema>;
  readonly workspacePath: string;
  rootNodeId = '';

  constructor(
    workspacePath: string,
    options: { startupMode?: 'app' | 'retrievalWorker' } = {}
  ) {
    const startupMode = options.startupMode ?? 'app';
    this.workspacePath = workspacePath;
    if (startupMode === 'app') {
      mkdirSync(workspacePath, { recursive: true });
      mkdirSync(path.join(workspacePath, 'assets'), { recursive: true });
      mkdirSync(path.join(workspacePath, 'exports'), { recursive: true });
      mkdirSync(path.join(workspacePath, 'snapshots'), { recursive: true });
      mkdirSync(path.join(workspacePath, 'cache'), { recursive: true });
      mkdirSync(path.join(workspacePath, 'logs'), { recursive: true });
      ensureSectionsDirectory(workspacePath);
    }
    this.db = new Database(path.join(workspacePath, 'project.sqlite'));
    this.orm = drizzle(this.db, { schema });
    this.loadVectorExtension();
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    if (startupMode === 'retrievalWorker') {
      return;
    }
    this.migrate();
    this.backfillMineruMarkdownContent();
    this.rebuildKnowledgeChunksFts();
    this.rootNodeId = this.ensureRootSection();
    this.reconcileSectionMarkdownFiles();
    this.writeManifest();
  }

  close(): void {
    this.db.close();
  }

  summary(): WorkspaceSummary {
    return {
      path: this.workspacePath,
      rootNodeId: this.rootNodeId
    };
  }

  private loadVectorExtension(): void {
    try {
      sqliteVec.load(this.db);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      throw new Error(`Failed to load sqlite-vec extension. Rebuild native dependencies and restart writellm. ${message}`);
    }
  }

  createNode(payload: CreateNodePayload): NodeRecord {
    if (payload.kind === 'section') {
      return this.createSection(payload.parentId, payload.title, payload.intent);
    }

    return this.createContent(payload);
  }

  updateNode(nodeId: string, payload: UpdateNodePayload): void {
    const node = this.getNode(nodeId);
    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }

    const timestamp = nowIso();
    if (node.kind === 'section') {
      const title = payload.title?.trim() || node.title;
      const intent = 'intent' in payload ? payload.intent ?? null : node.intent;
      const activeMainNodeId =
        'activeMainNodeId' in payload ? payload.activeMainNodeId ?? null : node.activeMainNodeId;
      const markdownContent = 'markdownContent' in payload ? payload.markdownContent : undefined;
      if (activeMainNodeId) {
        this.assertContentBelongsToSection(activeMainNodeId, node.id);
      }
      this.orm
        .update(nodes)
        .set({ title, intent, activeMainNodeId, updatedAt: timestamp })
        .where(and(eq(nodes.id, nodeId), eq(nodes.kind, 'section'), isNull(nodes.deletedAt)))
        .run();
      if (typeof markdownContent === 'string') {
        this.updateSectionMarkdown(nodeId, markdownContent);
      } else {
        this.writeManifest();
      }
      return;
    }

    const title = payload.title?.trim() || node.title;
    const content = 'content' in payload ? payload.content ?? node.content : node.content;
    const isMain = 'isMain' in payload ? Boolean(payload.isMain) : node.isMain;
    const isLlm = 'isLlm' in payload ? Boolean(payload.isLlm) : node.isLlm;
    const metadata = 'metadata' in payload ? payload.metadata ?? node.metadata : node.metadata;
    this.orm
      .update(nodes)
      .set({
        title,
        content,
        isMain: isMain ? 1 : 0,
        isLlm: isLlm ? 1 : 0,
        metadataJson: JSON.stringify(metadata),
        updatedAt: timestamp
      })
      .where(and(eq(nodes.id, nodeId), eq(nodes.kind, 'content'), isNull(nodes.deletedAt)))
      .run();
  }

  updateSectionMarkdown(sectionId: string, markdown: string): SectionNodeRecord {
    const section = this.getSection(sectionId);
    if (!section) {
      throw new Error(`Section not found: ${sectionId}`);
    }
    const markdownPath = section.markdownPath || sectionMarkdownPath(sectionId);
    const normalizedMarkdown = sectionMarkdownForStorage(markdown);
    writeSectionMarkdownFile(this.workspacePath, markdownPath, normalizedMarkdown);
    const markdownHash = hashMarkdown(normalizedMarkdown);
    this.orm
      .update(nodes)
      .set({
        content: normalizedMarkdown,
        markdownPath,
        markdownHash,
        updatedAt: nowIso()
      })
      .where(and(eq(nodes.id, sectionId), eq(nodes.kind, 'section'), isNull(nodes.deletedAt)))
      .run();
    this.refreshSectionLlmOperationStatuses(sectionId, normalizedMarkdown, markdownHash);
    this.writeManifest();
    return this.getSection(sectionId)!;
  }

  upsertSectionLlmOperation(sectionId: string, operation: LlmOperationRecord): SectionNodeRecord {
    const section = this.getSection(sectionId);
    if (!section) {
      throw new Error(`Section not found: ${sectionId}`);
    }

    const existingOperations = readLlmOperations(section.metadata);
    const operationIndex = existingOperations.findIndex((item) => item.operationId === operation.operationId);
    const refreshedOperation = refreshLlmOperationStatus(operation, section.markdownContent, section.markdownHash);
    const nextOperations = operationIndex >= 0
      ? existingOperations.map((item, index) => index === operationIndex ? refreshedOperation : item)
      : [...existingOperations, refreshedOperation];

    this.writeSectionMetadata(sectionId, {
      ...section.metadata,
      llmOperations: nextOperations
    });
    return this.getSection(sectionId)!;
  }

  deleteNode(nodeId: string): void {
    if (nodeId === this.rootNodeId) {
      throw new Error('The document root section cannot be deleted.');
    }
    const nodeIds = this.collectNodeIds(nodeId);
    if (nodeIds.length === 0) {
      throw new Error(`Node not found: ${nodeId}`);
    }

    const timestamp = nowIso();
    this.orm.transaction((tx) => {
      tx.update(nodes)
        .set({ deletedAt: timestamp, updatedAt: timestamp })
        .where(inArray(nodes.id, nodeIds))
        .run();
      tx.update(nodes)
        .set({ activeMainNodeId: null, updatedAt: timestamp })
        .where(and(inArray(nodes.activeMainNodeId, nodeIds), isNull(nodes.deletedAt)))
        .run();
      tx.update(nodeEdges)
        .set({ deletedAt: timestamp })
        .where(
          and(
            or(inArray(nodeEdges.fromNodeId, nodeIds), inArray(nodeEdges.toNodeId, nodeIds)),
            isNull(nodeEdges.deletedAt)
          )
        )
        .run();
      tx.delete(canvasNodeLayouts)
        .where(or(inArray(canvasNodeLayouts.canvasSectionId, nodeIds), inArray(canvasNodeLayouts.nodeId, nodeIds)))
        .run();
    });
    this.writeManifest();
  }

  moveNode(nodeId: string, newParentId: string | null, index: number): void {
    const node = this.getNode(nodeId);
    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }
    if (node.id === this.rootNodeId) {
      throw new Error('The document root section cannot be moved.');
    }
    if (node.kind === 'content' && !newParentId) {
      throw new Error('Content nodes must belong to a section.');
    }
    if (newParentId) {
      const parent = this.getSection(newParentId);
      if (!parent) {
        throw new Error(`Parent section not found: ${newParentId}`);
      }
      if (node.kind === 'section' && this.collectNodeIds(node.id).includes(newParentId)) {
        throw new Error('A section cannot be moved into itself or its descendants.');
      }
    }

    const timestamp = nowIso();
    this.orm.transaction(() => {
      this.orm
        .update(nodes)
        .set({ parentId: newParentId, updatedAt: timestamp })
        .where(and(eq(nodes.id, nodeId), isNull(nodes.deletedAt)))
        .run();
      this.rewriteSiblingOrder(newParentId, node.kind, nodeId, index);
    });
    this.writeManifest();
  }

  setActiveMainNode(sectionId: string, contentNodeId: string | null): void {
    const section = this.getSection(sectionId);
    if (!section) {
      throw new Error(`Section not found: ${sectionId}`);
    }
    if (contentNodeId) {
      this.assertContentBelongsToSection(contentNodeId, sectionId);
    }
    const timestamp = nowIso();
    this.orm.transaction(() => {
      this.orm
        .update(nodes)
        .set({ activeMainNodeId: contentNodeId, updatedAt: timestamp })
        .where(and(eq(nodes.id, sectionId), eq(nodes.kind, 'section'), isNull(nodes.deletedAt)))
        .run();
      if (contentNodeId) {
        this.orm
          .update(nodes)
          .set({ isMain: 1, updatedAt: timestamp })
          .where(and(eq(nodes.id, contentNodeId), eq(nodes.kind, 'content'), isNull(nodes.deletedAt)))
          .run();
      }
    });
  }

  createNodeEdge(
    fromNodeId: string,
    toNodeId: string,
    relationType: EdgeKind,
    createdBy: NodeEdgeRecord['createdBy'] = 'user'
  ): NodeEdgeRecord {
    if (fromNodeId === toNodeId) {
      throw new Error('A node edge cannot connect a node to itself.');
    }
    if (!this.getNode(fromNodeId)) {
      throw new Error(`Source node not found: ${fromNodeId}`);
    }
    if (!this.getNode(toNodeId)) {
      throw new Error(`Target node not found: ${toNodeId}`);
    }

    const edge: NodeEdgeRecord = {
      id: createId('edge'),
      fromNodeId,
      toNodeId,
      relationType,
      createdBy,
      createdAt: nowIso()
    };
    this.orm.insert(nodeEdges).values({
      id: edge.id,
      fromNodeId: edge.fromNodeId,
      toNodeId: edge.toNodeId,
      relationType: edge.relationType,
      createdBy: edge.createdBy,
      createdAt: edge.createdAt
    }).run();
    return edge;
  }

  updateNodeEdge(edgeId: string, relationType: EdgeKind): void {
    const result = this.orm
      .update(nodeEdges)
      .set({ relationType })
      .where(and(eq(nodeEdges.id, edgeId), isNull(nodeEdges.deletedAt)))
      .run();
    if (result.changes === 0) {
      throw new Error(`Node edge not found: ${edgeId}`);
    }
  }

  deleteNodeEdge(edgeId: string): void {
    const result = this.orm
      .update(nodeEdges)
      .set({ deletedAt: nowIso() })
      .where(and(eq(nodeEdges.id, edgeId), isNull(nodeEdges.deletedAt)))
      .run();
    if (result.changes === 0) {
      throw new Error(`Node edge not found: ${edgeId}`);
    }
  }

  updateNodeLayout(payload: UpdateNodeLayoutPayload): void {
    const values = [payload.x, payload.y, payload.width, payload.height];
    if (!values.every(Number.isFinite) || payload.width <= 0 || payload.height <= 0) {
      throw new Error('Canvas node layout dimensions must be finite positive numbers.');
    }
    if (!this.getSection(payload.canvasSectionId)) {
      throw new Error(`Canvas section not found: ${payload.canvasSectionId}`);
    }
    if (!this.getNode(payload.nodeId)) {
      throw new Error(`Node not found: ${payload.nodeId}`);
    }

    const timestamp = nowIso();
    this.orm
      .insert(canvasNodeLayouts)
      .values({
        canvasSectionId: payload.canvasSectionId,
        nodeId: payload.nodeId,
        x: payload.x,
        y: payload.y,
        width: payload.width,
        height: payload.height,
        updatedAt: timestamp
      })
      .onConflictDoUpdate({
        target: [canvasNodeLayouts.canvasSectionId, canvasNodeLayouts.nodeId],
        set: {
          x: payload.x,
          y: payload.y,
          width: payload.width,
          height: payload.height,
          updatedAt: timestamp
        }
      })
      .run();
  }

  listKnowledgeItems(): KnowledgeItemRecord[] {
    return this.orm
      .select()
      .from(knowledgeItems)
      .where(isNull(knowledgeItems.deletedAt))
      .orderBy(desc(knowledgeItems.updatedAt), desc(knowledgeItems.createdAt))
      .all()
      .map(mapKnowledgeItem);
  }

  getKnowledgeItem(itemId: string): KnowledgeItemRecord | null {
    const row = this.orm
      .select()
      .from(knowledgeItems)
      .where(and(eq(knowledgeItems.id, itemId), isNull(knowledgeItems.deletedAt)))
      .get();
    return row ? mapKnowledgeItem(row) : null;
  }

  createKnowledgeItem(
    title: string,
    content: string,
    options: {
      sourceType?: KnowledgeItemRecord['sourceType'];
      metadata?: Record<string, unknown>;
    } = {}
  ): KnowledgeItemRecord {
    const id = createId('knw');
    const publicRef = this.createUniqueKnowledgeItemPublicRef();
    const timestamp = nowIso();
    this.orm.insert(knowledgeItems).values({
      id,
      publicRef,
      title: title.trim() || 'Knowledge source',
      content,
      sourceType: options.sourceType ?? 'text',
      indexStatus: 'pending',
      metadataJson: JSON.stringify(options.metadata ?? {}),
      createdAt: timestamp,
      updatedAt: timestamp
    }).run();
    return this.getKnowledgeItem(id)!;
  }

  updateKnowledgeItem(
    itemId: string,
    payload: {
      title?: string;
      content?: string;
      sourceType?: KnowledgeItemRecord['sourceType'];
      metadata?: Record<string, unknown>;
    }
  ): KnowledgeItemRecord {
    const item = this.getKnowledgeItem(itemId);
    if (!item) {
      throw new Error(`Knowledge item not found: ${itemId}`);
    }
    const nextTitle = payload.title?.trim() || item.title;
    const nextContent = payload.content ?? item.content;
    const nextSourceType = payload.sourceType ?? item.sourceType;
    const nextMetadata = payload.metadata ?? item.metadata;
    const timestamp = nowIso();
    this.orm
      .update(knowledgeItems)
      .set({
        title: nextTitle,
        content: nextContent,
        sourceType: nextSourceType,
        indexStatus: 'pending',
        metadataJson: JSON.stringify(nextMetadata),
        updatedAt: timestamp
      })
      .where(and(eq(knowledgeItems.id, itemId), isNull(knowledgeItems.deletedAt)))
      .run();
    return this.getKnowledgeItem(itemId)!;
  }

  updateKnowledgeItemMetadata(
    itemId: string,
    metadata: Record<string, unknown>
  ): KnowledgeItemRecord {
    const item = this.getKnowledgeItem(itemId);
    if (!item) {
      throw new Error(`Knowledge item not found: ${itemId}`);
    }
    this.orm
      .update(knowledgeItems)
      .set({ metadataJson: JSON.stringify(metadata), updatedAt: nowIso() })
      .where(and(eq(knowledgeItems.id, itemId), isNull(knowledgeItems.deletedAt)))
      .run();
    return this.getKnowledgeItem(itemId)!;
  }

  deleteKnowledgeItem(itemId: string): void {
    if (!this.getKnowledgeItem(itemId)) {
      throw new Error(`Knowledge item not found: ${itemId}`);
    }
    const timestamp = nowIso();
    this.orm.transaction(() => {
      this.deleteKnowledgeVectorsForItem(itemId);
      this.deleteKnowledgeFtsForItem(itemId);
      this.orm
        .update(knowledgeItems)
        .set({ deletedAt: timestamp, updatedAt: timestamp })
        .where(eq(knowledgeItems.id, itemId))
        .run();
      this.orm.delete(knowledgeChunks).where(eq(knowledgeChunks.itemId, itemId)).run();
    });
  }

  replaceKnowledgeChunks(
    itemId: string,
    chunks: Array<{ content: string; embedding: number[]; embeddingModel: string }>
  ): KnowledgeChunkRecord[] {
    const item = this.getKnowledgeItem(itemId);
    if (!item) {
      throw new Error(`Knowledge item not found: ${itemId}`);
    }
    const timestamp = nowIso();
    this.orm.transaction(() => {
      this.deleteKnowledgeVectorsForItem(itemId);
      this.deleteKnowledgeFtsForItem(itemId);
      this.orm.delete(knowledgeChunks).where(eq(knowledgeChunks.itemId, itemId)).run();
      chunks.forEach((chunk, index) => {
        const dimensions = chunk.embedding.length;
        const chunkId = createId('chk');
        this.orm.insert(knowledgeChunks).values({
          id: chunkId,
          publicRef: createKnowledgeChunkPublicRef(item.publicRef, index),
          itemId,
          chunkIndex: index,
          content: chunk.content,
          embeddingJson: JSON.stringify(chunk.embedding),
          embeddingDimensions: dimensions,
          embeddingModel: chunk.embeddingModel,
          vectorRowid: null,
          createdAt: timestamp,
          updatedAt: timestamp
        }).run();
        const vectorRowid = this.insertKnowledgeVector(chunkId, chunk.embedding);
        this.insertKnowledgeChunkFts(chunkId, chunk.content);
        this.orm
          .update(knowledgeChunks)
          .set({ vectorRowid })
          .where(eq(knowledgeChunks.id, chunkId))
          .run();
      });
      this.orm
        .update(knowledgeItems)
        .set({ indexStatus: 'indexed', updatedAt: timestamp })
        .where(eq(knowledgeItems.id, itemId))
        .run();
    });
    return this.listKnowledgeChunks(itemId);
  }

  markKnowledgeItemIndexError(itemId: string, message: string): void {
    this.markKnowledgeItemError(itemId, 'indexError', message);
  }

  markKnowledgeItemError(itemId: string, metadataKey: string, message: string): void {
    const item = this.getKnowledgeItem(itemId);
    if (!item) {
      return;
    }
    const metadata = { ...item.metadata, [metadataKey]: message };
    this.orm
      .update(knowledgeItems)
      .set({
        indexStatus: 'error',
        metadataJson: JSON.stringify(metadata),
        updatedAt: nowIso()
      })
      .where(and(eq(knowledgeItems.id, itemId), isNull(knowledgeItems.deletedAt)))
      .run();
  }

  listKnowledgeIngestJobs(): KnowledgeIngestJobRecord[] {
    return this.orm
      .select()
      .from(plainjobJobs)
      .where(eq(plainjobJobs.type, KNOWLEDGE_INGEST_TASK_TYPE))
      .orderBy(desc(plainjobJobs.createdAt))
      .all()
      .map(mapKnowledgeIngestJob);
  }

  getKnowledgeIngestJob(jobId: string): KnowledgeIngestJobRecord | null {
    const numericJobId = Number(jobId);
    if (!Number.isInteger(numericJobId)) {
      return null;
    }
    const row = this.orm
      .select()
      .from(plainjobJobs)
      .where(and(eq(plainjobJobs.id, numericJobId), eq(plainjobJobs.type, KNOWLEDGE_INGEST_TASK_TYPE)))
      .get();
    return row ? mapKnowledgeIngestJob(row) : null;
  }

  enqueueKnowledgeIngestJob(file: {
    filePath: string;
    fileName: string;
    fileExt: string;
    fileSize: number;
    metadata?: Record<string, unknown>;
  }): KnowledgeIngestJobRecord {
    const timestamp = nowIso();
    const now = Date.now();
    const result = this.orm.insert(plainjobJobs).values({
      type: KNOWLEDGE_INGEST_TASK_TYPE,
      data: JSON.stringify({
        filePath: file.filePath,
        fileName: file.fileName,
        fileExt: file.fileExt,
        fileSize: file.fileSize,
        knowledgeItemId: null,
        status: 'queued',
        errorMessage: null,
        metadata: file.metadata ?? {},
        createdAt: timestamp,
        updatedAt: timestamp,
        startedAt: null,
        finishedAt: null
      } satisfies KnowledgeIngestTaskData),
      status: PLAINJOB_STATUS_PENDING,
      failedAt: null,
      error: null,
      nextRunAt: now,
      createdAt: now
    }).run();
    return this.getKnowledgeIngestJob(String(result.lastInsertRowid))!;
  }

  listRunnableKnowledgeIngestJobs(): KnowledgeIngestJobRecord[] {
    return this.orm
      .select()
      .from(plainjobJobs)
      .where(
        and(
          eq(plainjobJobs.type, KNOWLEDGE_INGEST_TASK_TYPE),
          or(eq(plainjobJobs.status, PLAINJOB_STATUS_PENDING), eq(plainjobJobs.status, PLAINJOB_STATUS_PROCESSING))
        )
      )
      .orderBy(asc(plainjobJobs.createdAt))
      .all()
      .map(mapKnowledgeIngestJob);
  }

  updateKnowledgeIngestJob(
    jobId: string,
    payload: {
      status?: KnowledgeIngestStatus;
      errorMessage?: string | null;
      metadata?: Record<string, unknown>;
      knowledgeItemId?: string | null;
      startedAt?: string | null;
      finishedAt?: string | null;
    }
  ): KnowledgeIngestJobRecord {
    const job = this.getKnowledgeIngestJob(jobId);
    if (!job) {
      throw new Error(`Knowledge ingest job not found: ${jobId}`);
    }
    const numericJobId = Number(jobId);
    const timestamp = nowIso();
    const nextStatus = payload.status ?? job.status;
    const nextErrorMessage = Object.prototype.hasOwnProperty.call(payload, 'errorMessage')
      ? payload.errorMessage ?? null
      : job.errorMessage;
    const nextData: KnowledgeIngestTaskData = {
      filePath: job.filePath,
      fileName: job.fileName,
      fileExt: job.fileExt,
      fileSize: job.fileSize,
      knowledgeItemId: Object.prototype.hasOwnProperty.call(payload, 'knowledgeItemId')
        ? payload.knowledgeItemId ?? null
        : job.knowledgeItemId,
      status: nextStatus,
      errorMessage: nextErrorMessage,
      metadata: Object.prototype.hasOwnProperty.call(payload, 'metadata') ? payload.metadata ?? {} : job.metadata,
      createdAt: job.createdAt,
      updatedAt: timestamp,
      startedAt: Object.prototype.hasOwnProperty.call(payload, 'startedAt') ? payload.startedAt ?? null : job.startedAt,
      finishedAt: Object.prototype.hasOwnProperty.call(payload, 'finishedAt') ? payload.finishedAt ?? null : job.finishedAt
    };

    const plainjobPatch = plainjobPatchForKnowledgeStatus(nextStatus, nextErrorMessage);
    this.orm
      .update(plainjobJobs)
      .set({
        data: JSON.stringify(nextData),
        ...plainjobPatch
      })
      .where(and(eq(plainjobJobs.id, numericJobId), eq(plainjobJobs.type, KNOWLEDGE_INGEST_TASK_TYPE)))
      .run();
    return this.getKnowledgeIngestJob(jobId)!;
  }

  retryKnowledgeIngestJob(jobId: string): KnowledgeIngestJobRecord {
    const job = this.getKnowledgeIngestJob(jobId);
    if (!job) {
      throw new Error(`Knowledge ingest job not found: ${jobId}`);
    }
    if (job.status !== 'error') {
      return job;
    }
    const item = job.knowledgeItemId ? this.getKnowledgeItem(job.knowledgeItemId) : null;
    if (item) {
      this.updateKnowledgeItem(item.id, {
        metadata: {
          ...item.metadata,
          extractionError: null,
          indexError: null
        }
      });
    }
    const nextMetadata = resetRetryableIngestMetadata(job.metadata);
    return this.updateKnowledgeIngestJob(jobId, {
      status: 'queued',
      errorMessage: null,
      metadata: nextMetadata,
      startedAt: null,
      finishedAt: null
    });
  }

  deleteKnowledgeIngestJob(jobId: string): void {
    const job = this.getKnowledgeIngestJob(jobId);
    if (!job) {
      throw new Error(`Knowledge ingest job not found: ${jobId}`);
    }
    this.orm.transaction(() => {
      if (job.knowledgeItemId && this.getKnowledgeItem(job.knowledgeItemId)) {
        this.deleteKnowledgeItem(job.knowledgeItemId);
      }
      this.orm.delete(plainjobJobs).where(eq(plainjobJobs.id, Number(jobId))).run();
    });
  }

  listKnowledgeChunks(itemId?: string): KnowledgeChunkRecord[] {
    return this.orm
      .select({
        id: knowledgeChunks.id,
        publicRef: knowledgeChunks.publicRef,
        itemId: knowledgeChunks.itemId,
        itemPublicRef: knowledgeItems.publicRef,
        itemTitle: knowledgeItems.title,
        itemMetadataJson: knowledgeItems.metadataJson,
        chunkIndex: knowledgeChunks.chunkIndex,
        content: knowledgeChunks.content,
        embeddingJson: knowledgeChunks.embeddingJson,
        embeddingDimensions: knowledgeChunks.embeddingDimensions,
        embeddingModel: knowledgeChunks.embeddingModel,
        vectorRowid: knowledgeChunks.vectorRowid,
        createdAt: knowledgeChunks.createdAt,
        updatedAt: knowledgeChunks.updatedAt
      })
      .from(knowledgeChunks)
      .innerJoin(knowledgeItems, eq(knowledgeItems.id, knowledgeChunks.itemId))
      .where(
        itemId
          ? and(isNull(knowledgeItems.deletedAt), eq(knowledgeChunks.itemId, itemId))
          : isNull(knowledgeItems.deletedAt)
      )
      .orderBy(desc(knowledgeItems.updatedAt), asc(knowledgeChunks.chunkIndex))
      .all()
      .map(mapKnowledgeChunk);
  }

  resolveKnowledgeSourceTarget(options: {
    publicRef?: string;
    chunkId?: string;
  }): KnowledgeSourceTarget | null {
    const publicRef = options.publicRef?.replace(/^\[|\]$/g, '').trim();
    const chunkId = options.chunkId?.trim();
    if (!publicRef && !chunkId) {
      return null;
    }

    const row = this.orm
      .select({
        id: knowledgeChunks.id,
        publicRef: knowledgeChunks.publicRef,
        itemId: knowledgeChunks.itemId,
        itemPublicRef: knowledgeItems.publicRef,
        itemTitle: knowledgeItems.title,
        itemMetadataJson: knowledgeItems.metadataJson,
        chunkIndex: knowledgeChunks.chunkIndex,
        content: knowledgeChunks.content
      })
      .from(knowledgeChunks)
      .innerJoin(knowledgeItems, eq(knowledgeItems.id, knowledgeChunks.itemId))
      .where(
        and(
          isNull(knowledgeItems.deletedAt),
          chunkId ? eq(knowledgeChunks.id, chunkId) : eq(knowledgeChunks.publicRef, publicRef!)
        )
      )
      .get();

    return row
      ? {
          publicRef: row.publicRef,
          itemId: row.itemId,
          itemPublicRef: row.itemPublicRef,
          itemTitle: knowledgeDisplayTitle(row.itemTitle, row.itemMetadataJson),
          itemDescription: knowledgeDisplayDescription(row.itemMetadataJson),
          chunkId: row.id,
          chunkIndex: row.chunkIndex,
          snippet: row.content
        }
      : null;
  }

  listKnowledgeDebugItems(): KnowledgeItemDebugRecord[] {
    return this.listKnowledgeItems().map((item) => {
      const chunks = this.orm
        .select()
        .from(knowledgeChunks)
        .where(eq(knowledgeChunks.itemId, item.id))
        .orderBy(asc(knowledgeChunks.chunkIndex))
        .all()
        .map(mapKnowledgeChunkDebug);

      return {
        itemId: item.id,
        publicRef: item.publicRef,
        title: item.title,
        sourceType: item.sourceType,
        indexStatus: item.indexStatus,
        contentLength: item.content.length,
        chunkCount: chunks.length,
        chunks
      };
    });
  }

  searchKnowledgeChunks(options: {
    embedding: number[];
    excludedItemIds?: string[];
    excludedChunkIds?: string[];
    maxChunks?: number;
  }): KnowledgeChunkRecord[] {
    const maxChunks = Math.max(1, Math.min(options.maxChunks ?? 6, 100));
    const dimensions = options.embedding.length;
    if (dimensions === 0) {
      return [];
    }
    const vectorTableName = this.knowledgeVectorTableName(dimensions);
    if (!this.knowledgeVectorTableExists(vectorTableName)) {
      return [];
    }
    const excludedItemIds = options.excludedItemIds ?? [];
    const excludedChunkIds = options.excludedChunkIds ?? [];
    const excludedItemClauses = excludedItemIds.map(() => 'items.id != ?').join(' AND ');
    const excludedChunkClauses = excludedChunkIds.map(() => 'chunks.id != ?').join(' AND ');
    const filters = [excludedItemClauses, excludedChunkClauses].filter(Boolean).join(' AND ');
    const whereFilters = filters ? ` AND ${filters}` : '';
    const vectorLimit = Math.min(100, Math.max(maxChunks * 4, maxChunks + excludedChunkIds.length + excludedItemIds.length * 6));
    const rows = this.db
      .prepare(
        `WITH matches AS (
           SELECT rowid, distance
           FROM ${vectorTableName}
           WHERE embedding MATCH ? AND k = ?
         )
         SELECT chunks.id, chunks.public_ref AS publicRef, chunks.item_id AS itemId,
                items.public_ref AS itemPublicRef, items.title AS itemTitle,
                items.metadata_json AS itemMetadataJson,
                chunks.chunk_index AS chunkIndex, chunks.content,
                chunks.embedding_json AS embeddingJson,
                chunks.embedding_dimensions AS embeddingDimensions,
                chunks.embedding_model AS embeddingModel,
                chunks.vector_rowid AS vectorRowid,
                chunks.created_at AS createdAt, chunks.updated_at AS updatedAt,
                matches.distance
         FROM matches
         JOIN knowledge_chunks chunks ON chunks.vector_rowid = matches.rowid
          AND chunks.embedding_dimensions = ?
         JOIN knowledge_items items ON items.id = chunks.item_id
         WHERE items.deleted_at IS NULL${whereFilters}
         ORDER BY matches.distance ASC
         LIMIT ?`
      )
      .all(
        toVectorBuffer(options.embedding),
        vectorLimit,
        dimensions,
        ...excludedItemIds,
        ...excludedChunkIds,
        maxChunks
      ) as Array<KnowledgeChunkJoinedRow & { distance: number }>;

    return rows.map((row) => ({
      ...mapKnowledgeChunk(row),
      score: cosineDistanceToScore(row.distance),
      retrievalMethod: 'vector'
    }));
  }

  searchKnowledgeChunksByText(options: {
    query: string;
    excludedItemIds?: string[];
    excludedChunkIds?: string[];
    maxChunks?: number;
  }): KnowledgeChunkRecord[] {
    const maxChunks = Math.max(1, Math.min(options.maxChunks ?? 20, 100));
    const ftsQuery = toKnowledgeFtsQuery(options.query);
    if (!ftsQuery) {
      return [];
    }
    const excludedItemIds = options.excludedItemIds ?? [];
    const excludedChunkIds = options.excludedChunkIds ?? [];
    const excludedItemClauses = excludedItemIds.map(() => 'items.id != ?').join(' AND ');
    const excludedChunkClauses = excludedChunkIds.map(() => 'chunks.id != ?').join(' AND ');
    const filters = [excludedItemClauses, excludedChunkClauses].filter(Boolean).join(' AND ');
    const whereFilters = filters ? ` AND ${filters}` : '';
    const rows = this.db
      .prepare(
        `SELECT chunks.id, chunks.public_ref AS publicRef, chunks.item_id AS itemId,
                items.public_ref AS itemPublicRef, items.title AS itemTitle,
                items.metadata_json AS itemMetadataJson,
                chunks.chunk_index AS chunkIndex, chunks.content,
                chunks.embedding_json AS embeddingJson,
                chunks.embedding_dimensions AS embeddingDimensions,
                chunks.embedding_model AS embeddingModel,
                chunks.vector_rowid AS vectorRowid,
                chunks.created_at AS createdAt, chunks.updated_at AS updatedAt,
                bm25(knowledge_chunks_fts) AS rank
         FROM knowledge_chunks_fts
         JOIN knowledge_chunks chunks ON chunks.id = knowledge_chunks_fts.chunk_id
         JOIN knowledge_items items ON items.id = chunks.item_id
         WHERE knowledge_chunks_fts MATCH ?
           AND items.deleted_at IS NULL${whereFilters}
         ORDER BY rank ASC
         LIMIT ?`
      )
      .all(
        ftsQuery,
        ...excludedItemIds,
        ...excludedChunkIds,
        maxChunks
      ) as Array<KnowledgeChunkJoinedRow & { rank: number }>;

    return rows.map((row) => ({
      ...mapKnowledgeChunk(row),
      score: ftsRankToScore(row.rank),
      retrievalMethod: 'fts'
    }));
  }

  getAdjacentKnowledgeChunks(
    seeds: Array<{ itemId: string; chunkIndex: number }>,
    radius: number,
    options: {
      excludedItemIds?: string[];
      excludedChunkIds?: string[];
    } = {}
  ): KnowledgeChunkRecord[] {
    const normalizedRadius = Math.max(0, Math.min(radius, 3));
    if (normalizedRadius === 0 || seeds.length === 0) {
      return [];
    }
    const excludedItemIds = new Set(options.excludedItemIds ?? []);
    const excludedChunkIds = new Set(options.excludedChunkIds ?? []);
    const byKey = new Map<string, { itemId: string; min: number; max: number }>();
    for (const seed of seeds) {
      if (excludedItemIds.has(seed.itemId)) {
        continue;
      }
      const current = byKey.get(seed.itemId);
      const min = Math.max(0, seed.chunkIndex - normalizedRadius);
      const max = seed.chunkIndex + normalizedRadius;
      byKey.set(seed.itemId, {
        itemId: seed.itemId,
        min: current ? Math.min(current.min, min) : min,
        max: current ? Math.max(current.max, max) : max
      });
    }
    const chunks: KnowledgeChunkRecord[] = [];
    for (const range of byKey.values()) {
      const rows = this.db
        .prepare(
          `SELECT chunks.id, chunks.public_ref AS publicRef, chunks.item_id AS itemId,
                  items.public_ref AS itemPublicRef, items.title AS itemTitle,
                  items.metadata_json AS itemMetadataJson,
                  chunks.chunk_index AS chunkIndex, chunks.content,
                  chunks.embedding_json AS embeddingJson,
                  chunks.embedding_dimensions AS embeddingDimensions,
                  chunks.embedding_model AS embeddingModel,
                  chunks.vector_rowid AS vectorRowid,
                  chunks.created_at AS createdAt, chunks.updated_at AS updatedAt
           FROM knowledge_chunks chunks
           JOIN knowledge_items items ON items.id = chunks.item_id
           WHERE items.deleted_at IS NULL
             AND chunks.item_id = ?
             AND chunks.chunk_index BETWEEN ? AND ?
           ORDER BY chunks.chunk_index ASC`
        )
        .all(range.itemId, range.min, range.max) as KnowledgeChunkJoinedRow[];
      for (const row of rows) {
        if (!excludedChunkIds.has(row.id)) {
          chunks.push({
            ...mapKnowledgeChunk(row),
            score: 0,
            retrievalMethod: 'hybrid'
          });
        }
      }
    }
    return chunks;
  }

  saveGenerationCitations(
    generationNodeId: string,
    citations: Array<{
      publicRef: string;
      knowledgeItemId: string;
      knowledgeChunkId: string;
      label: string;
      snippet: string;
      score: number | null;
    }>
  ): KnowledgeCitationRecord[] {
    const node = this.getNode(generationNodeId);
    if (!node) {
      throw new Error(`Generated node not found: ${generationNodeId}`);
    }
    const timestamp = nowIso();
    this.orm.transaction(() => {
      this.orm
        .delete(generationCitations)
        .where(eq(generationCitations.generationNodeId, generationNodeId))
        .run();
      citations.forEach((citation) => {
        this.orm.insert(generationCitations).values({
          id: createId('cite'),
          generationNodeId,
          publicRef: citation.publicRef,
          knowledgeItemId: citation.knowledgeItemId,
          knowledgeChunkId: citation.knowledgeChunkId,
          label: citation.label,
          snippet: citation.snippet,
          score: citation.score,
          createdAt: timestamp
        }).run();
      });
    });
    return this.listGenerationCitations(generationNodeId);
  }

  listGenerationCitations(generationNodeId: string): KnowledgeCitationRecord[] {
    return this.orm
      .select()
      .from(generationCitations)
      .where(eq(generationCitations.generationNodeId, generationNodeId))
      .orderBy(asc(generationCitations.label), asc(generationCitations.createdAt))
      .all()
      .map(mapKnowledgeCitation);
  }

  private attachSectionCitationSources(node: NodeRecord): NodeRecord {
    if (node.kind !== 'section') {
      return node;
    }
    const citationSources: RetrievedKnowledgeSource[] = this.listGenerationCitations(node.id).map((citation) => {
      const target = this.resolveKnowledgeSourceTarget({
        publicRef: citation.publicRef,
        chunkId: citation.knowledgeChunkId
      });
      return {
        label: citation.label,
        publicRef: citation.publicRef,
        itemId: citation.knowledgeItemId,
        itemPublicRef: target?.itemPublicRef ?? '',
        itemTitle: target?.itemTitle ?? 'Source',
        itemDescription: target?.itemDescription ?? '',
        chunkId: citation.knowledgeChunkId,
        chunkIndex: target?.chunkIndex ?? 0,
        snippet: citation.snippet,
        score: citation.score ?? 0
      };
    });
    const existingRefs = new Set(citationSources.map((source) => source.publicRef.toLowerCase()));
    for (const publicRef of citationRefsFromText(node.markdownContent)) {
      if (existingRefs.has(publicRef.toLowerCase())) {
        continue;
      }
      const target = this.resolveKnowledgeSourceTarget({ publicRef });
      if (!target) {
        continue;
      }
      citationSources.push({
        label: publicRef,
        publicRef,
        itemId: target.itemId,
        itemPublicRef: target.itemPublicRef,
        itemTitle: target.itemTitle,
        itemDescription: target.itemDescription,
        chunkId: target.chunkId,
        chunkIndex: target.chunkIndex,
        snippet: target.snippet,
        score: 0
      });
      existingRefs.add(publicRef.toLowerCase());
    }
    return {
      ...node,
      citationSources
    };
  }

  getParentSectionId(nodeId: string): string | null {
    const node = this.getNode(nodeId);
    return node?.parentId ?? null;
  }

  getState(focusSectionId?: string | null): FocusedWorkspaceState {
    const focusId = this.resolveFocusSectionId(focusSectionId);
    const nodes = this.listNodes();
    const visibleNodes = nodes.filter((node) => node.id === focusId || node.parentId === focusId);
    const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
    const edges = this.listEdges().filter(
      (edge) => visibleNodeIds.has(edge.fromNodeId) && visibleNodeIds.has(edge.toNodeId)
    );

    return {
      workspace: this.summary(),
      compositionTree: this.buildCompositionTree(),
      focusSectionId: focusId,
      nodes,
      visibleNodes,
      contextNodes: nodes.filter(
        (node): node is ContentNodeRecord =>
          node.kind === 'content' &&
          node.metadata.nodeRole !== 'knowledge-source' &&
          Boolean(node.content.trim())
      ),
      knowledgeItems: this.listKnowledgeItems(),
      knowledgeIngestJobs: this.listKnowledgeIngestJobs(),
      nodeStats: this.buildNodeStats(nodes),
      edges,
      nodeLayouts: this.listCanvasNodeLayouts(focusId)
    };
  }

  listNodes(): NodeRecord[] {
    return this.orm
      .select()
      .from(nodes)
      .where(isNull(nodes.deletedAt))
      .orderBy(asc(nodes.sortOrder), asc(nodes.createdAt))
      .all()
      .map((row) => this.attachSectionCitationSources(mapNode(row)));
  }

  listSectionsForContext(): SectionNodeRecord[] {
    return this.orm
      .select()
      .from(nodes)
      .where(and(eq(nodes.kind, 'section'), isNull(nodes.deletedAt)))
      .orderBy(asc(nodes.sortOrder), asc(nodes.createdAt))
      .all()
      .map(mapNode)
      .filter((node): node is SectionNodeRecord => node.kind === 'section');
  }

  listEdges(): NodeEdgeRecord[] {
    return this.orm
      .select()
      .from(nodeEdges)
      .where(isNull(nodeEdges.deletedAt))
      .all()
      .map(mapEdge);
  }

  listCanvasNodeLayouts(canvasSectionId: string): CanvasNodeLayout[] {
    return this.orm
      .select()
      .from(canvasNodeLayouts)
      .where(eq(canvasNodeLayouts.canvasSectionId, canvasSectionId))
      .all()
      .map(mapCanvasNodeLayout);
  }

  getExportRows(rootSectionId: string): { section: SectionNodeRecord; markdown: string; depth: number }[] {
    const nodes = this.listNodes();
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const rows: { section: SectionNodeRecord; markdown: string; depth: number }[] = [];

    const visit = (sectionId: string, depth: number): void => {
      const section = byId.get(sectionId);
      if (!section || section.kind !== 'section') {
        return;
      }
      rows.push({
        section,
        markdown: section.markdownContent,
        depth
      });
      const childSections = nodes
        .filter((node): node is SectionNodeRecord => node.kind === 'section' && node.parentId === sectionId)
        .sort(compareNodeOrder);
      childSections.forEach((child) => visit(child.id, depth + 1));
    };

    visit(rootSectionId, 0);
    return rows;
  }

  getNode(nodeId: string): NodeRecord | null {
    const row = this.orm
      .select()
      .from(nodes)
      .where(and(eq(nodes.id, nodeId), isNull(nodes.deletedAt)))
      .get();
    return row ? mapNode(row) : null;
  }

  getSection(sectionId: string): SectionNodeRecord | null {
    const node = this.getNode(sectionId);
    if (node?.kind !== 'section') {
      return null;
    }
    return this.attachSectionCitationSources(node) as SectionNodeRecord;
  }

  private migrate(): void {
    const previousSchemaVersion = Number(this.db.pragma('user_version', { simple: true }) ?? 0);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        parent_id TEXT,
        title TEXT NOT NULL,
        intent TEXT,
        active_main_node_id TEXT,
        content TEXT,
        markdown_path TEXT,
        markdown_hash TEXT,
        is_main INTEGER NOT NULL DEFAULT 0,
        is_llm INTEGER NOT NULL DEFAULT 0,
        metadata_json TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_nodes_parent_kind_order
      ON nodes(parent_id, kind, sort_order);

      CREATE TABLE IF NOT EXISTS node_edges (
        id TEXT PRIMARY KEY,
        from_node_id TEXT NOT NULL,
        to_node_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE TABLE IF NOT EXISTS canvas_node_layouts (
        canvas_section_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        x REAL NOT NULL,
        y REAL NOT NULL,
        width REAL NOT NULL,
        height REAL NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (canvas_section_id, node_id)
      );
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_items (
        id TEXT PRIMARY KEY,
        public_ref TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        source_type TEXT NOT NULL DEFAULT 'text',
        index_status TEXT NOT NULL DEFAULT 'pending',
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_knowledge_items_status
      ON knowledge_items(index_status, updated_at);

      CREATE TABLE IF NOT EXISTS knowledge_chunks (
        id TEXT PRIMARY KEY,
        public_ref TEXT NOT NULL,
        item_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        embedding_json TEXT,
        embedding_dimensions INTEGER NOT NULL DEFAULT 0,
        embedding_model TEXT,
        vector_rowid INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_item
      ON knowledge_chunks(item_id, chunk_index);

      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts
      USING fts5(
        chunk_id UNINDEXED,
        content,
        tokenize = 'unicode61'
      );

      CREATE TABLE IF NOT EXISTS generation_citations (
        id TEXT PRIMARY KEY,
        generation_node_id TEXT NOT NULL,
        public_ref TEXT,
        knowledge_item_id TEXT NOT NULL,
        knowledge_chunk_id TEXT NOT NULL,
        label TEXT NOT NULL,
        snippet TEXT NOT NULL,
        score REAL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_generation_citations_node
      ON generation_citations(generation_node_id);

      CREATE TABLE IF NOT EXISTS plainjob_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        data TEXT NOT NULL,
        status INTEGER DEFAULT 0 NOT NULL,
        failed_at INTEGER,
        error TEXT,
        next_run_at INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_status_type_next_run_at
      ON plainjob_jobs(status, type, next_run_at);

      CREATE TABLE IF NOT EXISTS plainjob_scheduled_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL UNIQUE,
        status INTEGER DEFAULT 0 NOT NULL,
        cron_expression TEXT,
        next_run_at INTEGER,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_status_type_next_run_at
      ON plainjob_scheduled_jobs(status, type, next_run_at);
    `);

    this.addColumnIfMissing('knowledge_items', 'public_ref', 'TEXT');
    this.addColumnIfMissing('knowledge_chunks', 'public_ref', 'TEXT');
    this.addColumnIfMissing('knowledge_chunks', 'embedding_dimensions', 'INTEGER NOT NULL DEFAULT 0');
    this.addColumnIfMissing('knowledge_chunks', 'vector_rowid', 'INTEGER');
    this.addColumnIfMissing('generation_citations', 'public_ref', 'TEXT');
    this.addColumnIfMissing('nodes', 'markdown_path', 'TEXT');
    this.addColumnIfMissing('nodes', 'markdown_hash', 'TEXT');

    if (previousSchemaVersion < 7) {
      this.clearLegacyKnowledgeData();
      this.dropKnowledgeVectorTables();
    }

    this.db.exec('DROP TABLE IF EXISTS knowledge_ingest_jobs;');

    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_items_public_ref
      ON knowledge_items(public_ref);

      CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_chunks_public_ref
      ON knowledge_chunks(public_ref);
    `);

    this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
  }

  private addColumnIfMissing(tableName: string, columnName: string, columnDefinition: string): void {
    const columns = this.db.pragma(`table_info(${tableName})`) as Array<{ name: string }>;
    if (columns.some((column) => column.name === columnName)) {
      return;
    }
    this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
  }

  private insertKnowledgeVector(chunkId: string, embedding: number[]): number | null {
    if (embedding.length === 0) {
      return null;
    }
    const tableName = this.ensureKnowledgeVectorTable(embedding.length);
    const info = this.db
      .prepare(`INSERT INTO ${tableName} (embedding, chunk_id) VALUES (?, ?)`)
      .run(toVectorBuffer(embedding), chunkId);
    return Number(info.lastInsertRowid);
  }

  private rebuildKnowledgeChunksFts(): void {
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts
      USING fts5(
        chunk_id UNINDEXED,
        content,
        tokenize = 'unicode61'
      );
    `);
    this.db.exec('DELETE FROM knowledge_chunks_fts;');
    this.db.exec(`
      INSERT INTO knowledge_chunks_fts (chunk_id, content)
      SELECT chunks.id, chunks.content
      FROM knowledge_chunks chunks
      JOIN knowledge_items items ON items.id = chunks.item_id
      WHERE items.deleted_at IS NULL;
    `);
  }

  private insertKnowledgeChunkFts(chunkId: string, content: string): void {
    this.db.prepare('DELETE FROM knowledge_chunks_fts WHERE chunk_id = ?').run(chunkId);
    this.db
      .prepare('INSERT INTO knowledge_chunks_fts (chunk_id, content) VALUES (?, ?)')
      .run(chunkId, content);
  }

  private deleteKnowledgeFtsForItem(itemId: string): void {
    const rows = this.db
      .prepare('SELECT id FROM knowledge_chunks WHERE item_id = ?')
      .all(itemId) as Array<{ id: string }>;
    const deleteChunk = this.db.prepare('DELETE FROM knowledge_chunks_fts WHERE chunk_id = ?');
    for (const row of rows) {
      deleteChunk.run(row.id);
    }
  }

  private deleteKnowledgeVectorsForItem(itemId: string): void {
    const rows = this.db
      .prepare(
        `SELECT vector_rowid, embedding_dimensions
         FROM knowledge_chunks
         WHERE item_id = ? AND vector_rowid IS NOT NULL AND embedding_dimensions > 0`
      )
      .all(itemId) as Array<{ vector_rowid: number; embedding_dimensions: number }>;
    for (const row of rows) {
      const tableName = this.knowledgeVectorTableName(row.embedding_dimensions);
      if (this.knowledgeVectorTableExists(tableName)) {
        this.db.prepare(`DELETE FROM ${tableName} WHERE rowid = ?`).run(row.vector_rowid);
      }
    }
  }

  private ensureKnowledgeVectorTable(dimensions: number): string {
    const tableName = this.knowledgeVectorTableName(dimensions);
    this.db.exec(
      `CREATE VIRTUAL TABLE IF NOT EXISTS ${tableName}
       USING vec0(
         embedding float[${dimensions}] distance_metric=cosine,
         +chunk_id text
       )`
    );
    return tableName;
  }

  private knowledgeVectorTableName(dimensions: number): string {
    if (!Number.isInteger(dimensions) || dimensions <= 0) {
      throw new Error(`Invalid embedding dimensions: ${dimensions}`);
    }
    return `${VECTOR_TABLE_PREFIX}${dimensions}`;
  }

  private knowledgeVectorTableExists(tableName: string): boolean {
    const row = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName) as { name: string } | undefined;
    return Boolean(row);
  }

  private listKnowledgeVectorTables(): string[] {
    return (this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE ?")
      .all(`${VECTOR_TABLE_PREFIX}%`) as Array<{ name: string }>)
      .map((row) => row.name)
      .filter((tableName) => /^knowledge_chunk_vectors_d\d+$/.test(tableName));
  }

  private dropKnowledgeVectorTables(): void {
    for (const tableName of this.listKnowledgeVectorTables()) {
      this.db.exec(`DROP TABLE IF EXISTS ${tableName}`);
    }
  }

  private backfillMineruMarkdownContent(): void {
    const rows = this.db
      .prepare(
        `SELECT id, content, metadata_json
         FROM knowledge_items
         WHERE deleted_at IS NULL
           AND source_type = 'file'
           AND metadata_json LIKE '%"mineru"%'
           AND content NOT LIKE '%![](%'`
      )
      .all() as Array<{ id: string; content: string; metadata_json: string | null }>;
    if (rows.length === 0) {
      return;
    }

    const update = this.db.prepare(
      `UPDATE knowledge_items
       SET content = ?, metadata_json = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`
    );
    const timestamp = nowIso();
    const backfill = this.db.transaction(() => {
      for (const row of rows) {
        const metadata = parseMetadata(row.metadata_json);
        const mineru = metadata.mineru && typeof metadata.mineru === 'object'
          ? metadata.mineru as Record<string, unknown>
          : null;
        if (!mineru || mineru.markdownBackfilledAt) {
          continue;
        }
        const markdownPath = typeof mineru.markdownPath === 'string' ? mineru.markdownPath : null;
        if (!markdownPath) {
          continue;
        }
        const absoluteMarkdownPath = path.resolve(this.workspacePath, markdownPath);
        if (!existsSync(absoluteMarkdownPath)) {
          continue;
        }
        const markdown = readFileSync(absoluteMarkdownPath, 'utf8');
        if (!markdown.trim() || !markdown.includes('![](')) {
          continue;
        }
        update.run(
          markdown,
          JSON.stringify({
            ...metadata,
            mineru: {
              ...mineru,
              markdownBackfilledAt: timestamp
            }
          }),
          timestamp,
          row.id
        );
      }
    });
    backfill();
  }

  private clearLegacyKnowledgeData(): void {
    this.orm.transaction(() => {
      this.orm.delete(generationCitations).run();
      this.orm.delete(knowledgeChunks).run();
      this.orm.delete(plainjobJobs).where(eq(plainjobJobs.type, KNOWLEDGE_INGEST_TASK_TYPE)).run();
      this.orm.delete(knowledgeItems).run();
    });
    rmSync(path.join(this.workspacePath, 'assets', 'knowledge'), { recursive: true, force: true });
  }

  private createUniqueKnowledgeItemPublicRef(): string {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const publicRef = createShortRef();
      const existing = this.orm
        .select({ id: knowledgeItems.id })
        .from(knowledgeItems)
        .where(eq(knowledgeItems.publicRef, publicRef))
        .limit(1)
        .get();
      if (!existing) {
        return publicRef;
      }
    }
    throw new Error('Could not create a unique knowledge item reference.');
  }

  private ensureRootSection(): string {
    const existing = this.orm
      .select({ id: nodes.id })
      .from(nodes)
      .where(and(eq(nodes.kind, 'section'), isNull(nodes.parentId), isNull(nodes.deletedAt)))
      .orderBy(asc(nodes.createdAt))
      .limit(1)
      .get();
    if (existing) {
      return existing.id;
    }

    const id = createId('sec');
    const timestamp = nowIso();
    const markdownPath = sectionMarkdownPath(id);
    const markdownContent = defaultSectionMarkdown();
    this.orm.insert(nodes).values({
      id,
      kind: 'section',
      parentId: null,
      title: 'Paper',
      intent: 'Document root',
      activeMainNodeId: null,
      content: markdownContent,
      markdownPath,
      markdownHash: hashMarkdown(markdownContent),
      sortOrder: 0,
      createdAt: timestamp,
      updatedAt: timestamp
    }).run();
    writeSectionMarkdownFile(this.workspacePath, markdownPath, markdownContent);
    return id;
  }

  private createSection(parentId: string | null, title: string, intent?: string): SectionNodeRecord {
    if (parentId && !this.getSection(parentId)) {
      throw new Error(`Parent section not found: ${parentId}`);
    }
    const id = createId('sec');
    const timestamp = nowIso();
    const sortOrder = this.nextSiblingOrder(parentId, 'section');
    const resolvedTitle = title.trim() || 'New section';
    const markdownPath = sectionMarkdownPath(id);
    const markdownContent = defaultSectionMarkdown();
    this.orm.insert(nodes).values({
      id,
      kind: 'section',
      parentId,
      title: resolvedTitle,
      intent: intent ?? null,
      activeMainNodeId: null,
      content: markdownContent,
      markdownPath,
      markdownHash: hashMarkdown(markdownContent),
      sortOrder,
      createdAt: timestamp,
      updatedAt: timestamp
    }).run();
    writeSectionMarkdownFile(this.workspacePath, markdownPath, markdownContent);
    this.writeManifest();
    return this.getSection(id)!;
  }

  private createContent(payload: Extract<CreateNodePayload, { kind: 'content' }>): ContentNodeRecord {
    if (!this.getSection(payload.parentId)) {
      throw new Error(`Parent section not found: ${payload.parentId}`);
    }
    const id = createId('cnt');
    const timestamp = nowIso();
    const sortOrder = this.nextSiblingOrder(payload.parentId, 'content');
    this.orm.insert(nodes).values({
      id,
      kind: 'content',
      parentId: payload.parentId,
      title: payload.title.trim() || 'Content',
      content: payload.content,
      isMain: payload.isMain ? 1 : 0,
      isLlm: payload.isLlm ? 1 : 0,
      metadataJson: JSON.stringify(payload.metadata ?? {}),
      sortOrder,
      createdAt: timestamp,
      updatedAt: timestamp
    }).run();
    return this.getNode(id)! as ContentNodeRecord;
  }

  private resolveFocusSectionId(focusSectionId?: string | null): string {
    if (!focusSectionId) {
      return this.rootNodeId;
    }
    return this.getSection(focusSectionId)?.id ?? this.rootNodeId;
  }

  private collectNodeIds(nodeId: string): string[] {
    const node = this.getNode(nodeId);
    if (!node) {
      return [];
    }
    const ids = [nodeId];
    if (node.kind === 'section') {
      this.listNodes()
        .filter((child) => child.parentId === nodeId)
        .forEach((child) => {
          ids.push(...this.collectNodeIds(child.id));
        });
    }
    return ids;
  }

  private buildCompositionTree(): CompositionTreeNode[] {
    const sections = this.listNodes().filter((node): node is SectionNodeRecord => node.kind === 'section');
    const byParent = new Map<string | null, SectionNodeRecord[]>();
    sections.forEach((section) => {
      const siblings = byParent.get(section.parentId) ?? [];
      siblings.push(section);
      byParent.set(section.parentId, siblings);
    });
    byParent.forEach((siblings) => siblings.sort(compareNodeOrder));

    const build = (section: SectionNodeRecord): CompositionTreeNode => ({
      ...section,
      children: (byParent.get(section.id) ?? []).map(build)
    });

    return (byParent.get(null) ?? []).map(build);
  }

  private reconcileSectionMarkdownFiles(): void {
    const sections = this.listNodes().filter((node): node is SectionNodeRecord => node.kind === 'section');
    for (const section of sections) {
      const markdownPath = section.markdownPath || sectionMarkdownPath(section.id);
      const fileContent = readSectionMarkdownFile(this.workspacePath, markdownPath);
      const storedContent = section.markdownContent || defaultSectionMarkdown();
      const nextContent = sectionMarkdownForStorage(fileContent ?? storedContent);
      const nextHash = hashMarkdown(nextContent);
      if (fileContent === null || fileContent !== nextContent) {
        writeSectionMarkdownFile(this.workspacePath, markdownPath, nextContent);
      }
      if (
        section.markdownPath !== markdownPath ||
        section.markdownContent !== nextContent ||
        section.markdownHash !== nextHash
      ) {
        this.orm
          .update(nodes)
          .set({
            content: nextContent,
            markdownPath,
            markdownHash: nextHash,
            updatedAt: nowIso()
          })
          .where(and(eq(nodes.id, section.id), eq(nodes.kind, 'section'), isNull(nodes.deletedAt)))
          .run();
        this.refreshSectionLlmOperationStatuses(section.id, nextContent, nextHash);
      }
    }
  }

  private refreshSectionLlmOperationStatuses(
    sectionId: string,
    markdownContent: string,
    markdownHash: string
  ): void {
    const section = this.getSection(sectionId);
    if (!section) {
      return;
    }
    const operations = readLlmOperations(section.metadata);
    if (operations.length === 0) {
      return;
    }
    const refreshed = operations.map((operation) =>
      refreshLlmOperationStatus(operation, markdownContent, markdownHash)
    );
    if (JSON.stringify(refreshed) === JSON.stringify(operations)) {
      return;
    }
    this.writeSectionMetadata(sectionId, {
      ...section.metadata,
      llmOperations: refreshed
    });
  }

  private writeSectionMetadata(sectionId: string, metadata: Record<string, unknown>): void {
    const section = this.getSection(sectionId);
    if (!section) {
      throw new Error(`Section not found: ${sectionId}`);
    }
    const timestamp = nowIso();
    this.orm
      .update(nodes)
      .set({ metadataJson: JSON.stringify(metadata), updatedAt: timestamp })
      .where(and(eq(nodes.id, sectionId), eq(nodes.kind, 'section'), isNull(nodes.deletedAt)))
      .run();
    writeSectionLlmMetadataSidecar(this.workspacePath, sectionId, section.markdownPath, metadata);
    this.writeManifest();
  }

  private writeManifest(): void {
    const sections = this.listNodes()
      .filter((node): node is SectionNodeRecord => node.kind === 'section')
      .sort(compareNodeOrder)
      .map((section) => ({
        id: section.id,
        parentId: section.parentId,
        title: section.title,
        intent: section.intent,
        sortOrder: section.sortOrder,
        markdownPath: section.markdownPath,
        markdownHash: section.markdownHash,
        updatedAt: section.updatedAt
      }));
    const manifest = {
      version: 1,
      rootNodeId: this.rootNodeId,
      sections
    };
    writeFileSync(
      path.join(this.workspacePath, '.writellm-manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8'
    );
  }

  private buildNodeStats(nodes: NodeRecord[]): Record<string, NodeStats> {
    const stats = Object.fromEntries(
      nodes
        .filter((node): node is SectionNodeRecord => node.kind === 'section')
        .map((section) => [
          section.id,
          {
            sectionCount: 0,
            contentCount: 0,
            mainContentCount: 0,
            llmCount: 0
          }
        ])
    ) as Record<string, NodeStats>;

    nodes.forEach((node) => {
      if (!node.parentId || !stats[node.parentId]) {
        return;
      }
      if (node.kind === 'section') {
        stats[node.parentId].sectionCount += 1;
        return;
      }
      stats[node.parentId].contentCount += 1;
      if (node.isMain) {
        stats[node.parentId].mainContentCount += 1;
      }
      if (node.isLlm) {
        stats[node.parentId].llmCount += 1;
      }
    });

    return stats;
  }

  private nextSiblingOrder(parentId: string | null, kind: NodeRecord['kind']): number {
    const row = this.orm
      .select({ nextOrder: sql<number>`COALESCE(MAX(${nodes.sortOrder}), -1) + 1` })
      .from(nodes)
      .where(and(parentId === null ? isNull(nodes.parentId) : eq(nodes.parentId, parentId), eq(nodes.kind, kind), isNull(nodes.deletedAt)))
      .get();
    return row?.nextOrder ?? 0;
  }

  private rewriteSiblingOrder(
    parentId: string | null,
    kind: NodeRecord['kind'],
    movingNodeId: string,
    index: number
  ): void {
    const siblings = this.listNodes()
      .filter((node) => node.kind === kind && node.parentId === parentId && node.id !== movingNodeId)
      .sort(compareNodeOrder);
    const insertAt = Math.max(0, Math.min(index, siblings.length));
    siblings.splice(insertAt, 0, this.getNode(movingNodeId)!);

    const timestamp = nowIso();
    siblings.forEach((node, sortOrder) => {
      this.orm.update(nodes).set({ sortOrder, updatedAt: timestamp }).where(eq(nodes.id, node.id)).run();
    });
  }

  private assertContentBelongsToSection(contentNodeId: string, sectionId: string): void {
    const node = this.getNode(contentNodeId);
    if (!node || node.kind !== 'content') {
      throw new Error(`Content node not found: ${contentNodeId}`);
    }
    if (node.parentId !== sectionId) {
      throw new Error('Active main content must belong to the selected section.');
    }
  }
}

function mapNode(row: NodeRow): NodeRecord {
  const base = {
    id: row.id,
    kind: row.kind as NodeRecord['kind'],
    parentId: row.parentId,
    title: row.title,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };

  if (row.kind === 'section') {
    const markdownContent = row.content ?? '';
    const markdownHash = row.markdownHash ?? hashMarkdown(markdownContent);
    return {
      ...base,
      kind: 'section',
      intent: row.intent,
      activeMainNodeId: row.activeMainNodeId,
      markdownPath: row.markdownPath ?? sectionMarkdownPath(row.id),
      markdownContent,
      markdownHash,
      metadata: row.metadataJson ? (JSON.parse(row.metadataJson) as Record<string, unknown>) : {},
      citationSources: []
    };
  }

  return {
    ...base,
    kind: 'content',
    parentId: row.parentId ?? '',
    content: row.content ?? '',
    isMain: Boolean(row.isMain),
    isLlm: Boolean(row.isLlm),
    metadata: row.metadataJson ? (JSON.parse(row.metadataJson) as Record<string, unknown>) : {}
  };
}

function mapEdge(row: NodeEdgeRow): NodeEdgeRecord {
  return {
    id: row.id,
    fromNodeId: row.fromNodeId,
    toNodeId: row.toNodeId,
    relationType: row.relationType as EdgeKind,
    createdBy: row.createdBy as NodeEdgeRecord['createdBy'],
    createdAt: row.createdAt
  };
}

function mapCanvasNodeLayout(row: CanvasNodeLayoutRow): CanvasNodeLayout {
  return {
    canvasSectionId: row.canvasSectionId,
    nodeId: row.nodeId,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    updatedAt: row.updatedAt
  };
}

function readLlmOperations(metadata: Record<string, unknown>): LlmOperationRecord[] {
  const value = metadata.llmOperations;
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isLlmOperationRecord);
}

function isLlmOperationRecord(value: unknown): value is LlmOperationRecord {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<LlmOperationRecord>;
  return (
    typeof candidate.operationId === 'string' &&
    typeof candidate.type === 'string' &&
    typeof candidate.status === 'string' &&
    typeof candidate.createdAt === 'string' &&
    typeof candidate.appliedAt === 'string' &&
    typeof candidate.sectionId === 'string' &&
    typeof candidate.sectionPath === 'string' &&
    typeof candidate.beforeSectionHash === 'string' &&
    typeof candidate.afterSectionHash === 'string' &&
    typeof candidate.userPrompt === 'string' &&
    typeof candidate.resolvedPrompt === 'string' &&
    typeof candidate.systemPrompt === 'string' &&
    typeof candidate.beforeText === 'string' &&
    typeof candidate.afterText === 'string' &&
    typeof candidate.outputHash === 'string' &&
    typeof candidate.retainedCoverage === 'number' &&
    Array.isArray(candidate.contextNodeIds) &&
    Array.isArray(candidate.retrievedSources)
  );
}

function refreshLlmOperationStatus(
  operation: LlmOperationRecord,
  currentMarkdown: string,
  currentMarkdownHash: string
): LlmOperationRecord {
  if (operation.status === 'superseded') {
    return operation;
  }
  const retainedCoverage = currentMarkdownHash === operation.afterSectionHash
    ? 1
    : calculateRetainedCoverage(currentMarkdown, operation.afterText);
  const status: LlmOperationStatus = currentMarkdownHash === operation.afterSectionHash
    ? 'current'
    : retainedCoverage >= LLM_OPERATION_COVERAGE_THRESHOLD
      ? 'edited'
      : 'stale';
  return {
    ...operation,
    status,
    retainedCoverage
  };
}

function calculateRetainedCoverage(currentMarkdown: string, afterText: string): number {
  const normalizedCurrent = normalizeProvenanceText(currentMarkdown);
  const normalizedAfter = normalizeProvenanceText(afterText);
  if (!normalizedAfter) {
    return normalizedCurrent ? 0 : 1;
  }
  if (normalizedCurrent.includes(normalizedAfter)) {
    return 1;
  }

  const afterUnits = provenanceUnits(normalizedAfter);
  if (afterUnits.length === 0) {
    return 0;
  }
  const currentUnits = new Set(provenanceUnits(normalizedCurrent));
  const retained = afterUnits.filter((unit) => currentUnits.has(unit)).length;
  return retained / afterUnits.length;
}

function normalizeProvenanceText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function provenanceUnits(value: string): string[] {
  const words = value.match(/[\p{L}\p{N}_]+/gu) ?? [];
  if (words.length >= 5) {
    const units: string[] = [];
    for (let index = 0; index <= words.length - 3; index += 1) {
      units.push(words.slice(index, index + 3).join(' '));
    }
    return units.length > 0 ? units : words;
  }

  const compact = value.replace(/\s+/g, '');
  if (compact.length <= 3) {
    return compact ? [compact] : [];
  }
  const units: string[] = [];
  for (let index = 0; index <= compact.length - 3; index += 1) {
    units.push(compact.slice(index, index + 3));
  }
  return units;
}

function writeSectionLlmMetadataSidecar(
  workspacePath: string,
  sectionId: string,
  sectionPath: string,
  metadata: Record<string, unknown>
): void {
  if (!/^[A-Za-z0-9_-]+$/.test(sectionId)) {
    throw new Error('Section id is invalid.');
  }
  const relativePath = path.posix.join(SECTION_METADATA_DIR, `${sectionId}.llm.json`);
  const absolutePath = path.resolve(workspacePath, relativePath);
  const metadataRoot = path.resolve(workspacePath, 'metadata');
  if (!absolutePath.startsWith(`${metadataRoot}${path.sep}`)) {
    throw new Error('Section metadata path must be inside the workspace metadata directory.');
  }
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(
    absolutePath,
    `${JSON.stringify({
      version: 1,
      sectionId,
      sectionPath,
      llmOperations: readLlmOperations(metadata)
    }, null, 2)}\n`,
    'utf8'
  );
}

function mapKnowledgeItem(row: KnowledgeItemRow): KnowledgeItemRecord {
  return {
    id: row.id,
    publicRef: row.publicRef,
    title: row.title,
    content: row.content,
    sourceType: row.sourceType as KnowledgeItemRecord['sourceType'],
    indexStatus: row.indexStatus as KnowledgeIndexStatus,
    metadata: row.metadataJson ? (JSON.parse(row.metadataJson) as Record<string, unknown>) : {},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapKnowledgeChunk(row: KnowledgeChunkJoinedRow): KnowledgeChunkRecord {
  return {
    id: row.id,
    publicRef: row.publicRef,
    itemId: row.itemId,
    itemPublicRef: row.itemPublicRef,
    itemTitle: knowledgeDisplayTitle(row.itemTitle, row.itemMetadataJson),
    itemDescription: knowledgeDisplayDescription(row.itemMetadataJson),
    chunkIndex: row.chunkIndex,
    content: row.content,
    embeddingModel: row.embeddingModel,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function knowledgeDisplayTitle(fallbackTitle: string, metadataJson: string | null): string {
  return readKnowledgeDisplayMetadata(metadataJson).title || fallbackTitle;
}

function knowledgeDisplayDescription(metadataJson: string | null): string {
  return readKnowledgeDisplayMetadata(metadataJson).description;
}

function readKnowledgeDisplayMetadata(metadataJson: string | null): { title: string; description: string } {
  if (!metadataJson) {
    return { title: '', description: '' };
  }
  try {
    const metadata = JSON.parse(metadataJson) as Record<string, unknown>;
    const value = metadata.knowledgeDisplayMetadata ?? metadata.knowledgeMetadata;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { title: '', description: '' };
    }
    const record = value as Record<string, unknown>;
    return {
      title: typeof record.title === 'string' ? record.title.trim() : '',
      description: typeof record.description === 'string' ? record.description.trim() : ''
    };
  } catch {
    return { title: '', description: '' };
  }
}

function mapKnowledgeChunkDebug(row: KnowledgeChunkRow): KnowledgeChunkDebugRecord {
  const embedding = parseEmbedding(row.embeddingJson);
  return {
    id: row.id,
    publicRef: row.publicRef,
    chunkIndex: row.chunkIndex,
    content: row.content,
    contentLength: row.content.length,
    embeddingModel: row.embeddingModel,
    embeddingDimensions: embedding.length,
    embeddingPreview: embedding.slice(0, 8).map((value) => Number(value.toFixed(6))),
    embeddingNorm: embedding.length > 0
      ? Number(Math.sqrt(embedding.reduce((sum, value) => sum + value * value, 0)).toFixed(6))
      : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function mapKnowledgeCitation(row: KnowledgeCitationRow): KnowledgeCitationRecord {
  return {
    id: row.id,
    generationNodeId: row.generationNodeId,
    publicRef: row.publicRef ?? row.label,
    knowledgeItemId: row.knowledgeItemId,
    knowledgeChunkId: row.knowledgeChunkId,
    label: row.label,
    snippet: row.snippet,
    score: row.score,
    createdAt: row.createdAt
  };
}

function mapKnowledgeIngestJob(row: PlainjobJobRow): KnowledgeIngestJobRecord {
  const data = parseKnowledgeIngestTaskData(row);
  const status = mapPlainjobKnowledgeStatus(row, data.status);
  return {
    id: String(row.id),
    filePath: data.filePath,
    fileName: data.fileName,
    fileExt: data.fileExt,
    fileSize: data.fileSize,
    knowledgeItemId: data.knowledgeItemId,
    status,
    errorMessage: row.error ?? data.errorMessage,
    metadata: data.metadata,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    startedAt: data.startedAt,
    finishedAt: data.finishedAt
  };
}

function parseKnowledgeIngestTaskData(row: PlainjobJobRow): KnowledgeIngestTaskData {
  const parsed = parseMetadata(row.data);
  const timestamp = new Date(row.createdAt).toISOString();
  return {
    filePath: typeof parsed.filePath === 'string' ? parsed.filePath : '',
    fileName: typeof parsed.fileName === 'string' ? parsed.fileName : 'Unknown file',
    fileExt: typeof parsed.fileExt === 'string' ? parsed.fileExt : '',
    fileSize: typeof parsed.fileSize === 'number' ? parsed.fileSize : 0,
    knowledgeItemId: typeof parsed.knowledgeItemId === 'string' ? parsed.knowledgeItemId : null,
    status: isKnowledgeIngestStatus(parsed.status) ? parsed.status : mapPlainjobKnowledgeStatus(row, null),
    errorMessage: typeof parsed.errorMessage === 'string' ? parsed.errorMessage : null,
    metadata: parsed.metadata && typeof parsed.metadata === 'object' && !Array.isArray(parsed.metadata)
      ? parsed.metadata as Record<string, unknown>
      : {},
    createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : timestamp,
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : timestamp,
    startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : null,
    finishedAt: typeof parsed.finishedAt === 'string' ? parsed.finishedAt : null
  };
}

function mapPlainjobKnowledgeStatus(row: PlainjobJobRow, dataStatus: KnowledgeIngestStatus | null): KnowledgeIngestStatus {
  if (row.status === PLAINJOB_STATUS_FAILED) {
    return 'error';
  }
  if (row.status === PLAINJOB_STATUS_DONE) {
    return 'indexed';
  }
  return dataStatus ?? (row.status === PLAINJOB_STATUS_PENDING ? 'queued' : 'extracting');
}

function isKnowledgeIngestStatus(value: unknown): value is KnowledgeIngestStatus {
  return value === 'queued' ||
    value === 'uploading' ||
    value === 'extracting' ||
    value === 'downloading' ||
    value === 'indexing' ||
    value === 'indexed' ||
    value === 'error';
}

function plainjobPatchForKnowledgeStatus(
  status: KnowledgeIngestStatus,
  errorMessage: string | null
): Partial<Pick<PlainjobJobRow, 'status' | 'failedAt' | 'error' | 'nextRunAt'>> {
  if (status === 'queued') {
    return {
      status: PLAINJOB_STATUS_PENDING,
      failedAt: null,
      error: null,
      nextRunAt: Date.now()
    };
  }
  if (status === 'indexed') {
    return {
      status: PLAINJOB_STATUS_DONE,
      failedAt: null,
      error: null
    };
  }
  if (status === 'error') {
    return {
      status: PLAINJOB_STATUS_FAILED,
      failedAt: Date.now(),
      error: errorMessage
    };
  }
  return { status: PLAINJOB_STATUS_PROCESSING };
}

function parseMetadata(raw: string | null): Record<string, unknown> {
  if (!raw) {
    return {};
  }
  const parsed = JSON.parse(raw) as unknown;
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

function resetRetryableIngestMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  if (metadata.extractionEngine !== 'mineru') {
    return metadata;
  }
  const mineru = metadata.mineru && typeof metadata.mineru === 'object'
    ? metadata.mineru as Record<string, unknown>
    : {};
  return {
    ...metadata,
    mineru: {
      modelVersion: mineru.modelVersion,
      language: mineru.language,
      isOcr: mineru.isOcr,
      enableTable: mineru.enableTable,
      enableFormula: mineru.enableFormula
    }
  };
}

function createKnowledgeChunkPublicRef(itemPublicRef: string, chunkIndex: number): string {
  return `${itemPublicRef}.c${chunkIndex + 1}`;
}

function parseEmbedding(raw: string | null): number[] {
  if (!raw) {
    return [];
  }
  const parsed = JSON.parse(raw) as unknown;
  return Array.isArray(parsed) ? parsed.filter((value): value is number => typeof value === 'number') : [];
}

function toVectorBuffer(embedding: number[]): Buffer {
  return Buffer.from(new Float32Array(embedding).buffer);
}

function cosineDistanceToScore(distance: number): number {
  return Number.isFinite(distance) ? 1 - distance : Number.NEGATIVE_INFINITY;
}

function ftsRankToScore(rank: number): number {
  if (!Number.isFinite(rank)) {
    return 0;
  }
  return rank < 0 ? Math.abs(rank) : 1 / (1 + rank);
}

function toKnowledgeFtsQuery(query: string): string {
  const terms = query
    .normalize('NFKC')
    .match(/[\p{L}\p{N}_./+-]{2,}/gu)
    ?.map((term) => term.replace(/"/g, '').trim())
    .filter(Boolean) ?? [];
  const uniqueTerms = Array.from(new Set(terms))
    .sort((left, right) => right.length - left.length)
    .slice(0, 24);
  return uniqueTerms.map((term) => `"${term}"`).join(' OR ');
}

function compareNodeOrder(left: NodeRecord, right: NodeRecord): number {
  return left.sortOrder - right.sortOrder || left.createdAt.localeCompare(right.createdAt);
}
