import Database from 'better-sqlite3';
import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createId, createShortRef, nowIso } from './ids.js';
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
  NodeEdgeRecord,
  NodeRecord,
  NodeStats,
  SectionNodeRecord,
  UpdateNodeLayoutPayload,
  UpdateNodePayload,
  WorkspaceSummary
} from '../shared/types.js';

const SCHEMA_VERSION = 6;

type SqlNodeRow = {
  id: string;
  kind: NodeRecord['kind'];
  parent_id: string | null;
  title: string;
  intent: string | null;
  active_main_node_id: string | null;
  content: string | null;
  is_main: number;
  is_llm: number;
  metadata_json: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type SqlEdgeRow = {
  id: string;
  from_node_id: string;
  to_node_id: string;
  relation_type: EdgeKind;
  created_by: NodeEdgeRecord['createdBy'];
  created_at: string;
};

type SqlCanvasNodeLayoutRow = {
  canvas_section_id: string;
  node_id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  updated_at: string;
};

type SqlKnowledgeItemRow = {
  id: string;
  public_ref: string;
  title: string;
  content: string;
  source_type: KnowledgeItemRecord['sourceType'];
  index_status: KnowledgeIndexStatus;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
};

type SqlKnowledgeChunkRow = {
  id: string;
  public_ref: string;
  item_id: string;
  item_public_ref: string;
  item_title: string;
  chunk_index: number;
  content: string;
  embedding_json: string | null;
  embedding_model: string | null;
  created_at: string;
  updated_at: string;
};

type SqlKnowledgeDebugChunkRow = {
  id: string;
  public_ref: string;
  item_id: string;
  chunk_index: number;
  content: string;
  embedding_json: string | null;
  embedding_model: string | null;
  created_at: string;
  updated_at: string;
};

type SqlKnowledgeCitationRow = {
  id: string;
  generation_node_id: string;
  public_ref: string | null;
  knowledge_item_id: string;
  knowledge_chunk_id: string;
  label: string;
  snippet: string;
  score: number | null;
  created_at: string;
};

type SqlKnowledgeIngestJobRow = {
  id: string;
  file_path: string;
  file_name: string;
  file_ext: string;
  file_size: number;
  knowledge_item_id: string | null;
  status: KnowledgeIngestStatus;
  error_message: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export class PaperLabDatabase {
  readonly db: Database.Database;
  readonly workspacePath: string;
  rootNodeId: string;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
    mkdirSync(workspacePath, { recursive: true });
    mkdirSync(path.join(workspacePath, 'assets'), { recursive: true });
    mkdirSync(path.join(workspacePath, 'exports'), { recursive: true });
    mkdirSync(path.join(workspacePath, 'snapshots'), { recursive: true });
    mkdirSync(path.join(workspacePath, 'cache'), { recursive: true });
    mkdirSync(path.join(workspacePath, 'logs'), { recursive: true });
    this.db = new Database(path.join(workspacePath, 'project.sqlite'));
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
    this.backfillMineruMarkdownContent();
    this.rootNodeId = this.ensureRootSection();
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
      if (activeMainNodeId) {
        this.assertContentBelongsToSection(activeMainNodeId, node.id);
      }
      this.db
        .prepare(
          `UPDATE nodes
           SET title = ?, intent = ?, active_main_node_id = ?, updated_at = ?
           WHERE id = ? AND kind = 'section' AND deleted_at IS NULL`
        )
        .run(title, intent, activeMainNodeId, timestamp, nodeId);
      return;
    }

    const title = payload.title?.trim() || node.title;
    const content = 'content' in payload ? payload.content ?? node.content : node.content;
    const isMain = 'isMain' in payload ? Boolean(payload.isMain) : node.isMain;
    const isLlm = 'isLlm' in payload ? Boolean(payload.isLlm) : node.isLlm;
    const metadata = 'metadata' in payload ? payload.metadata ?? node.metadata : node.metadata;
    this.db
      .prepare(
        `UPDATE nodes
         SET title = ?, content = ?, is_main = ?, is_llm = ?,
             metadata_json = ?, updated_at = ?
         WHERE id = ? AND kind = 'content' AND deleted_at IS NULL`
      )
      .run(
        title,
        content,
        isMain ? 1 : 0,
        isLlm ? 1 : 0,
        JSON.stringify(metadata),
        timestamp,
        nodeId
      );
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
    const placeholders = nodeIds.map(() => '?').join(', ');
    const remove = this.db.transaction(() => {
      this.db
        .prepare(`UPDATE nodes SET deleted_at = ?, updated_at = ? WHERE id IN (${placeholders})`)
        .run(timestamp, timestamp, ...nodeIds);
      this.db
        .prepare(
          `UPDATE nodes
           SET active_main_node_id = NULL, updated_at = ?
           WHERE active_main_node_id IN (${placeholders}) AND deleted_at IS NULL`
        )
        .run(timestamp, ...nodeIds);
      this.db
        .prepare(
          `UPDATE node_edges
           SET deleted_at = ?
           WHERE (from_node_id IN (${placeholders}) OR to_node_id IN (${placeholders}))
             AND deleted_at IS NULL`
        )
        .run(timestamp, ...nodeIds, ...nodeIds);
      this.db
        .prepare(
          `DELETE FROM canvas_node_layouts
           WHERE canvas_section_id IN (${placeholders}) OR node_id IN (${placeholders})`
        )
        .run(...nodeIds, ...nodeIds);
    });
    remove();
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
    const move = this.db.transaction(() => {
      this.db
        .prepare('UPDATE nodes SET parent_id = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
        .run(newParentId, timestamp, nodeId);
      this.rewriteSiblingOrder(newParentId, node.kind, nodeId, index);
    });
    move();
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
    const update = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE nodes
           SET active_main_node_id = ?, updated_at = ?
           WHERE id = ? AND kind = 'section' AND deleted_at IS NULL`
        )
        .run(contentNodeId, timestamp, sectionId);
      if (contentNodeId) {
        this.db
          .prepare(
            `UPDATE nodes
             SET is_main = 1, updated_at = ?
             WHERE id = ? AND kind = 'content' AND deleted_at IS NULL`
          )
          .run(timestamp, contentNodeId);
      }
    });
    update();
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
    this.db
      .prepare(
        `INSERT INTO node_edges
         (id, from_node_id, to_node_id, relation_type, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(edge.id, edge.fromNodeId, edge.toNodeId, edge.relationType, edge.createdBy, edge.createdAt);
    return edge;
  }

  updateNodeEdge(edgeId: string, relationType: EdgeKind): void {
    const result = this.db
      .prepare('UPDATE node_edges SET relation_type = ? WHERE id = ? AND deleted_at IS NULL')
      .run(relationType, edgeId);
    if (result.changes === 0) {
      throw new Error(`Node edge not found: ${edgeId}`);
    }
  }

  deleteNodeEdge(edgeId: string): void {
    const result = this.db
      .prepare('UPDATE node_edges SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL')
      .run(nowIso(), edgeId);
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
    this.db
      .prepare(
        `INSERT INTO canvas_node_layouts
         (canvas_section_id, node_id, x, y, width, height, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(canvas_section_id, node_id)
         DO UPDATE SET
           x = excluded.x,
           y = excluded.y,
           width = excluded.width,
           height = excluded.height,
           updated_at = excluded.updated_at`
      )
      .run(
        payload.canvasSectionId,
        payload.nodeId,
        payload.x,
        payload.y,
        payload.width,
        payload.height,
        timestamp
      );
  }

  listKnowledgeItems(): KnowledgeItemRecord[] {
    return this.db
      .prepare(
        `SELECT id, public_ref, title, content, source_type, index_status, metadata_json, created_at, updated_at
         FROM knowledge_items
         WHERE deleted_at IS NULL
         ORDER BY updated_at DESC, created_at DESC`
      )
      .all()
      .map((row) => mapKnowledgeItem(row as SqlKnowledgeItemRow));
  }

  getKnowledgeItem(itemId: string): KnowledgeItemRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, public_ref, title, content, source_type, index_status, metadata_json, created_at, updated_at
         FROM knowledge_items
         WHERE id = ? AND deleted_at IS NULL`
      )
      .get(itemId) as SqlKnowledgeItemRow | undefined;
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
    this.db
      .prepare(
        `INSERT INTO knowledge_items
         (id, public_ref, title, content, source_type, index_status, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
      )
      .run(
        id,
        publicRef,
        title.trim() || 'Knowledge source',
        content,
        options.sourceType ?? 'text',
        JSON.stringify(options.metadata ?? {}),
        timestamp,
        timestamp
      );
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
    this.db
      .prepare(
        `UPDATE knowledge_items
         SET title = ?, content = ?, source_type = ?, index_status = 'pending', metadata_json = ?, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`
      )
      .run(nextTitle, nextContent, nextSourceType, JSON.stringify(nextMetadata), timestamp, itemId);
    return this.getKnowledgeItem(itemId)!;
  }

  deleteKnowledgeItem(itemId: string): void {
    if (!this.getKnowledgeItem(itemId)) {
      throw new Error(`Knowledge item not found: ${itemId}`);
    }
    const timestamp = nowIso();
    const remove = this.db.transaction(() => {
      this.db
        .prepare('UPDATE knowledge_items SET deleted_at = ?, updated_at = ? WHERE id = ?')
        .run(timestamp, timestamp, itemId);
      this.db.prepare('DELETE FROM knowledge_chunks WHERE item_id = ?').run(itemId);
    });
    remove();
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
    const replace = this.db.transaction(() => {
      this.db.prepare('DELETE FROM knowledge_chunks WHERE item_id = ?').run(itemId);
      const insert = this.db.prepare(
        `INSERT INTO knowledge_chunks
         (id, public_ref, item_id, chunk_index, content, embedding_json, embedding_model, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      chunks.forEach((chunk, index) => {
        insert.run(
          createId('chk'),
          createKnowledgeChunkPublicRef(item.publicRef, index),
          itemId,
          index,
          chunk.content,
          JSON.stringify(chunk.embedding),
          chunk.embeddingModel,
          timestamp,
          timestamp
        );
      });
      this.db
        .prepare("UPDATE knowledge_items SET index_status = 'indexed', updated_at = ? WHERE id = ?")
        .run(timestamp, itemId);
    });
    replace();
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
    this.db
      .prepare(
        `UPDATE knowledge_items
         SET index_status = 'error', metadata_json = ?, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`
      )
      .run(JSON.stringify(metadata), nowIso(), itemId);
  }

  listKnowledgeIngestJobs(): KnowledgeIngestJobRecord[] {
    return this.db
      .prepare(
        `SELECT id, file_path, file_name, file_ext, file_size, knowledge_item_id, status,
                error_message, metadata_json, created_at, updated_at, started_at, finished_at
         FROM knowledge_ingest_jobs
         ORDER BY created_at DESC`
      )
      .all()
      .map((row) => mapKnowledgeIngestJob(row as SqlKnowledgeIngestJobRow));
  }

  getKnowledgeIngestJob(jobId: string): KnowledgeIngestJobRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, file_path, file_name, file_ext, file_size, knowledge_item_id, status,
                error_message, metadata_json, created_at, updated_at, started_at, finished_at
         FROM knowledge_ingest_jobs
         WHERE id = ?`
      )
      .get(jobId) as SqlKnowledgeIngestJobRow | undefined;
    return row ? mapKnowledgeIngestJob(row) : null;
  }

  enqueueKnowledgeIngestJob(file: {
    filePath: string;
    fileName: string;
    fileExt: string;
    fileSize: number;
    metadata?: Record<string, unknown>;
  }): KnowledgeIngestJobRecord {
    const id = createId('ing');
    const timestamp = nowIso();
    this.db
      .prepare(
        `INSERT INTO knowledge_ingest_jobs
         (id, file_path, file_name, file_ext, file_size, knowledge_item_id, status,
          error_message, metadata_json, created_at, updated_at, started_at, finished_at)
         VALUES (?, ?, ?, ?, ?, NULL, 'queued', NULL, ?, ?, ?, NULL, NULL)`
      )
      .run(
        id,
        file.filePath,
        file.fileName,
        file.fileExt,
        file.fileSize,
        JSON.stringify(file.metadata ?? {}),
        timestamp,
        timestamp
      );
    return this.getKnowledgeIngestJob(id)!;
  }

  listRunnableKnowledgeIngestJobs(): KnowledgeIngestJobRecord[] {
    return this.db
      .prepare(
        `SELECT id, file_path, file_name, file_ext, file_size, knowledge_item_id, status,
                error_message, metadata_json, created_at, updated_at, started_at, finished_at
         FROM knowledge_ingest_jobs
         WHERE status IN ('queued', 'uploading', 'extracting', 'downloading', 'indexing')
         ORDER BY created_at ASC`
      )
      .all()
      .map((row) => mapKnowledgeIngestJob(row as SqlKnowledgeIngestJobRow));
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
    const timestamp = nowIso();
    this.db
      .prepare(
        `UPDATE knowledge_ingest_jobs
         SET status = ?, error_message = ?, metadata_json = ?, knowledge_item_id = ?, updated_at = ?,
             started_at = ?, finished_at = ?
         WHERE id = ?`
      )
      .run(
        payload.status ?? job.status,
        Object.prototype.hasOwnProperty.call(payload, 'errorMessage') ? payload.errorMessage : job.errorMessage,
        Object.prototype.hasOwnProperty.call(payload, 'metadata') ? JSON.stringify(payload.metadata) : JSON.stringify(job.metadata),
        Object.prototype.hasOwnProperty.call(payload, 'knowledgeItemId') ? payload.knowledgeItemId : job.knowledgeItemId,
        timestamp,
        Object.prototype.hasOwnProperty.call(payload, 'startedAt') ? payload.startedAt : job.startedAt,
        Object.prototype.hasOwnProperty.call(payload, 'finishedAt') ? payload.finishedAt : job.finishedAt,
        jobId
      );
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
    const remove = this.db.transaction(() => {
      if (job.knowledgeItemId && this.getKnowledgeItem(job.knowledgeItemId)) {
        this.deleteKnowledgeItem(job.knowledgeItemId);
      }
      this.db.prepare('DELETE FROM knowledge_ingest_jobs WHERE id = ?').run(jobId);
    });
    remove();
  }

  listKnowledgeChunks(itemId?: string): KnowledgeChunkRecord[] {
    const sql = `SELECT chunks.id, chunks.public_ref, chunks.item_id, items.public_ref AS item_public_ref,
                       items.title AS item_title, chunks.chunk_index,
                       chunks.content, chunks.embedding_json, chunks.embedding_model,
                       chunks.created_at, chunks.updated_at
                FROM knowledge_chunks chunks
                JOIN knowledge_items items ON items.id = chunks.item_id
                WHERE items.deleted_at IS NULL${itemId ? ' AND chunks.item_id = ?' : ''}
                ORDER BY items.updated_at DESC, chunks.chunk_index ASC`;
    return (itemId ? this.db.prepare(sql).all(itemId) : this.db.prepare(sql).all())
      .map((row) => mapKnowledgeChunk(row as SqlKnowledgeChunkRow));
  }

  listKnowledgeDebugItems(): KnowledgeItemDebugRecord[] {
    return this.listKnowledgeItems().map((item) => {
      const chunks = this.db
        .prepare(
          `SELECT id, public_ref, item_id, chunk_index, content, embedding_json, embedding_model,
                  created_at, updated_at
           FROM knowledge_chunks
           WHERE item_id = ?
           ORDER BY chunk_index ASC`
        )
        .all(item.id)
        .map((row) => mapKnowledgeChunkDebug(row as SqlKnowledgeDebugChunkRow));

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
    const excludedItemIds = new Set(options.excludedItemIds ?? []);
    const excludedChunkIds = new Set(options.excludedChunkIds ?? []);
    const maxChunks = Math.max(1, Math.min(options.maxChunks ?? 6, 12));

    return this.listKnowledgeChunks()
      .filter((chunk) => !excludedItemIds.has(chunk.itemId) && !excludedChunkIds.has(chunk.id))
      .map((chunk) => ({
        ...chunk,
        score: cosineSimilarity(options.embedding, readEmbedding(chunk.id, this.db))
      }))
      .filter((chunk) => Number.isFinite(chunk.score))
      .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
      .slice(0, maxChunks);
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
    if (!node || node.kind !== 'content') {
      throw new Error(`Generated content node not found: ${generationNodeId}`);
    }
    const timestamp = nowIso();
    const save = this.db.transaction(() => {
      this.db.prepare('DELETE FROM generation_citations WHERE generation_node_id = ?').run(generationNodeId);
      const insert = this.db.prepare(
        `INSERT INTO generation_citations
         (id, generation_node_id, public_ref, knowledge_item_id, knowledge_chunk_id, label, snippet, score, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      citations.forEach((citation) => {
        insert.run(
          createId('cite'),
          generationNodeId,
          citation.publicRef,
          citation.knowledgeItemId,
          citation.knowledgeChunkId,
          citation.label,
          citation.snippet,
          citation.score,
          timestamp
        );
      });
    });
    save();
    return this.listGenerationCitations(generationNodeId);
  }

  listGenerationCitations(generationNodeId: string): KnowledgeCitationRecord[] {
    return this.db
      .prepare(
        `SELECT id, generation_node_id, public_ref, knowledge_item_id, knowledge_chunk_id,
                label, snippet, score, created_at
         FROM generation_citations
         WHERE generation_node_id = ?
         ORDER BY label ASC, created_at ASC`
      )
      .all(generationNodeId)
      .map((row) => mapKnowledgeCitation(row as SqlKnowledgeCitationRow));
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
        (node): node is ContentNodeRecord => node.kind === 'content' && Boolean(node.content.trim())
      ),
      knowledgeItems: this.listKnowledgeItems(),
      knowledgeIngestJobs: this.listKnowledgeIngestJobs(),
      nodeStats: this.buildNodeStats(nodes),
      edges,
      nodeLayouts: this.listCanvasNodeLayouts(focusId)
    };
  }

  listNodes(): NodeRecord[] {
    return this.db
      .prepare(
        `SELECT id, kind, parent_id, title, intent, active_main_node_id, content,
                is_main, is_llm, metadata_json, sort_order, created_at, updated_at
         FROM nodes
         WHERE deleted_at IS NULL
         ORDER BY sort_order ASC, created_at ASC`
      )
      .all()
      .map((row) => mapNode(row as SqlNodeRow));
  }

  listEdges(): NodeEdgeRecord[] {
    return this.db
      .prepare(
        `SELECT id, from_node_id, to_node_id, relation_type, created_by, created_at
         FROM node_edges
         WHERE deleted_at IS NULL`
      )
      .all()
      .map((row) => mapEdge(row as SqlEdgeRow));
  }

  listCanvasNodeLayouts(canvasSectionId: string): CanvasNodeLayout[] {
    return this.db
      .prepare(
        `SELECT canvas_section_id, node_id, x, y, width, height, updated_at
         FROM canvas_node_layouts
         WHERE canvas_section_id = ?`
      )
      .all(canvasSectionId)
      .map((row) => mapCanvasNodeLayout(row as SqlCanvasNodeLayoutRow));
  }

  getExportRows(rootSectionId: string): { section: SectionNodeRecord; text: ContentNodeRecord | null }[] {
    const nodes = this.listNodes();
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const rows: { section: SectionNodeRecord; text: ContentNodeRecord | null }[] = [];

    const visit = (sectionId: string): void => {
      const section = byId.get(sectionId);
      if (!section || section.kind !== 'section') {
        return;
      }
      const activeMain = section.activeMainNodeId ? byId.get(section.activeMainNodeId) : null;
      rows.push({
        section,
        text: activeMain?.kind === 'content' ? activeMain : null
      });
      const childSections = nodes
        .filter((node): node is SectionNodeRecord => node.kind === 'section' && node.parentId === sectionId)
        .sort(compareNodeOrder);
      childSections.forEach((child) => visit(child.id));
    };

    visit(rootSectionId);
    return rows;
  }

  getNode(nodeId: string): NodeRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, kind, parent_id, title, intent, active_main_node_id, content,
                is_main, is_llm, metadata_json, sort_order, created_at, updated_at
         FROM nodes
         WHERE id = ? AND deleted_at IS NULL`
      )
      .get(nodeId) as SqlNodeRow | undefined;
    return row ? mapNode(row) : null;
  }

  getSection(sectionId: string): SectionNodeRecord | null {
    const node = this.getNode(sectionId);
    return node?.kind === 'section' ? node : null;
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
        embedding_model TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_item
      ON knowledge_chunks(item_id, chunk_index);

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

      CREATE TABLE IF NOT EXISTS knowledge_ingest_jobs (
        id TEXT PRIMARY KEY,
        file_path TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_ext TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        knowledge_item_id TEXT,
        status TEXT NOT NULL,
        error_message TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_knowledge_ingest_jobs_status
      ON knowledge_ingest_jobs(status, created_at);
    `);

    this.addColumnIfMissing('knowledge_ingest_jobs', 'metadata_json', 'TEXT');
    this.addColumnIfMissing('knowledge_items', 'public_ref', 'TEXT');
    this.addColumnIfMissing('knowledge_chunks', 'public_ref', 'TEXT');
    this.addColumnIfMissing('generation_citations', 'public_ref', 'TEXT');

    if (previousSchemaVersion < 6) {
      this.clearLegacyKnowledgeData();
    }

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
    const clear = this.db.transaction(() => {
      this.db.prepare('DELETE FROM generation_citations').run();
      this.db.prepare('DELETE FROM knowledge_chunks').run();
      this.db.prepare('DELETE FROM knowledge_ingest_jobs').run();
      this.db.prepare('DELETE FROM knowledge_items').run();
    });
    clear();
    rmSync(path.join(this.workspacePath, 'assets', 'knowledge'), { recursive: true, force: true });
  }

  private createUniqueKnowledgeItemPublicRef(): string {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const publicRef = createShortRef();
      const existing = this.db
        .prepare('SELECT 1 FROM knowledge_items WHERE public_ref = ? LIMIT 1')
        .get(publicRef);
      if (!existing) {
        return publicRef;
      }
    }
    throw new Error('Could not create a unique knowledge item reference.');
  }

  private ensureRootSection(): string {
    const existing = this.db
      .prepare(
        `SELECT id FROM nodes
         WHERE kind = 'section' AND parent_id IS NULL AND deleted_at IS NULL
         ORDER BY created_at ASC
         LIMIT 1`
      )
      .get() as { id: string } | undefined;
    if (existing) {
      return existing.id;
    }

    const id = createId('sec');
    const timestamp = nowIso();
    this.db
      .prepare(
        `INSERT INTO nodes
         (id, kind, parent_id, title, intent, active_main_node_id, sort_order, created_at, updated_at)
         VALUES (?, 'section', NULL, 'Paper', 'Document root', NULL, 0, ?, ?)`
      )
      .run(id, timestamp, timestamp);
    return id;
  }

  private createSection(parentId: string | null, title: string, intent?: string): SectionNodeRecord {
    if (parentId && !this.getSection(parentId)) {
      throw new Error(`Parent section not found: ${parentId}`);
    }
    const id = createId('sec');
    const timestamp = nowIso();
    const sortOrder = this.nextSiblingOrder(parentId, 'section');
    this.db
      .prepare(
        `INSERT INTO nodes
         (id, kind, parent_id, title, intent, active_main_node_id, sort_order, created_at, updated_at)
         VALUES (?, 'section', ?, ?, ?, NULL, ?, ?, ?)`
      )
      .run(id, parentId, title.trim() || 'New section', intent ?? null, sortOrder, timestamp, timestamp);
    return this.getSection(id)!;
  }

  private createContent(payload: Extract<CreateNodePayload, { kind: 'content' }>): ContentNodeRecord {
    if (!this.getSection(payload.parentId)) {
      throw new Error(`Parent section not found: ${payload.parentId}`);
    }
    const id = createId('cnt');
    const timestamp = nowIso();
    const sortOrder = this.nextSiblingOrder(payload.parentId, 'content');
    this.db
      .prepare(
        `INSERT INTO nodes
         (id, kind, parent_id, title, content, is_main, is_llm,
          metadata_json, sort_order, created_at, updated_at)
         VALUES (?, 'content', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        payload.parentId,
        payload.title.trim() || 'Content',
        payload.content,
        payload.isMain ? 1 : 0,
        payload.isLlm ? 1 : 0,
        JSON.stringify(payload.metadata ?? {}),
        sortOrder,
        timestamp,
        timestamp
      );
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
    const row = this.db
      .prepare(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order
         FROM nodes
         WHERE parent_id IS ? AND kind = ? AND deleted_at IS NULL`
      )
      .get(parentId, kind) as { next_order: number };
    return row.next_order;
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

    const stmt = this.db.prepare('UPDATE nodes SET sort_order = ?, updated_at = ? WHERE id = ?');
    const timestamp = nowIso();
    siblings.forEach((node, sortOrder) => stmt.run(sortOrder, timestamp, node.id));
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

function mapNode(row: SqlNodeRow): NodeRecord {
  const base = {
    id: row.id,
    kind: row.kind,
    parentId: row.parent_id,
    title: row.title,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };

  if (row.kind === 'section') {
    return {
      ...base,
      kind: 'section',
      intent: row.intent,
      activeMainNodeId: row.active_main_node_id
    };
  }

  return {
    ...base,
    kind: 'content',
    parentId: row.parent_id ?? '',
    content: row.content ?? '',
    isMain: Boolean(row.is_main),
    isLlm: Boolean(row.is_llm),
    metadata: row.metadata_json ? (JSON.parse(row.metadata_json) as Record<string, unknown>) : {}
  };
}

function mapEdge(row: SqlEdgeRow): NodeEdgeRecord {
  return {
    id: row.id,
    fromNodeId: row.from_node_id,
    toNodeId: row.to_node_id,
    relationType: row.relation_type,
    createdBy: row.created_by,
    createdAt: row.created_at
  };
}

function mapCanvasNodeLayout(row: SqlCanvasNodeLayoutRow): CanvasNodeLayout {
  return {
    canvasSectionId: row.canvas_section_id,
    nodeId: row.node_id,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    updatedAt: row.updated_at
  };
}

function mapKnowledgeItem(row: SqlKnowledgeItemRow): KnowledgeItemRecord {
  return {
    id: row.id,
    publicRef: row.public_ref,
    title: row.title,
    content: row.content,
    sourceType: row.source_type,
    indexStatus: row.index_status,
    metadata: row.metadata_json ? (JSON.parse(row.metadata_json) as Record<string, unknown>) : {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapKnowledgeChunk(row: SqlKnowledgeChunkRow): KnowledgeChunkRecord {
  return {
    id: row.id,
    publicRef: row.public_ref,
    itemId: row.item_id,
    itemPublicRef: row.item_public_ref,
    itemTitle: row.item_title,
    chunkIndex: row.chunk_index,
    content: row.content,
    embeddingModel: row.embedding_model,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapKnowledgeChunkDebug(row: SqlKnowledgeDebugChunkRow): KnowledgeChunkDebugRecord {
  const embedding = parseEmbedding(row.embedding_json);
  return {
    id: row.id,
    publicRef: row.public_ref,
    chunkIndex: row.chunk_index,
    content: row.content,
    contentLength: row.content.length,
    embeddingModel: row.embedding_model,
    embeddingDimensions: embedding.length,
    embeddingPreview: embedding.slice(0, 8).map((value) => Number(value.toFixed(6))),
    embeddingNorm: embedding.length > 0
      ? Number(Math.sqrt(embedding.reduce((sum, value) => sum + value * value, 0)).toFixed(6))
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapKnowledgeCitation(row: SqlKnowledgeCitationRow): KnowledgeCitationRecord {
  return {
    id: row.id,
    generationNodeId: row.generation_node_id,
    publicRef: row.public_ref ?? row.label,
    knowledgeItemId: row.knowledge_item_id,
    knowledgeChunkId: row.knowledge_chunk_id,
    label: row.label,
    snippet: row.snippet,
    score: row.score,
    createdAt: row.created_at
  };
}

function mapKnowledgeIngestJob(row: SqlKnowledgeIngestJobRow): KnowledgeIngestJobRecord {
  return {
    id: row.id,
    filePath: row.file_path,
    fileName: row.file_name,
    fileExt: row.file_ext,
    fileSize: row.file_size,
    knowledgeItemId: row.knowledge_item_id,
    status: row.status,
    errorMessage: row.error_message,
    metadata: row.metadata_json ? (JSON.parse(row.metadata_json) as Record<string, unknown>) : {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at
  };
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

function readEmbedding(chunkId: string, db: Database.Database): number[] {
  const row = db
    .prepare('SELECT embedding_json FROM knowledge_chunks WHERE id = ?')
    .get(chunkId) as { embedding_json: string | null } | undefined;
  return parseEmbedding(row?.embedding_json ?? null);
}

function parseEmbedding(raw: string | null): number[] {
  if (!raw) {
    return [];
  }
  const parsed = JSON.parse(raw) as unknown;
  return Array.isArray(parsed) ? parsed.filter((value): value is number => typeof value === 'number') : [];
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) {
    return Number.NEGATIVE_INFINITY;
  }
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return Number.NEGATIVE_INFINITY;
  }
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function compareNodeOrder(left: NodeRecord, right: NodeRecord): number {
  return left.sortOrder - right.sortOrder || left.createdAt.localeCompare(right.createdAt);
}
