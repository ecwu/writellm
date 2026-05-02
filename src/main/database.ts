import Database from 'better-sqlite3';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { createId, nowIso } from './ids.js';
import type {
  ArtifactRecord,
  AuthorTextRecord,
  ContainerRecord,
  ContainerTreeNode,
  EdgeKind,
  FocusedWorkspaceState,
  ProcessEdgeRecord,
  ReviewCommentRecord,
  ReviewCommentStatus,
  WorkspaceSummary
} from '../shared/types.js';

type SqlContainerRow = {
  id: string;
  title: string;
  intent: string | null;
  parent_id: string | null;
  active_author_text_id: string | null;
  created_at: string;
  updated_at: string;
};

type SqlArtifactRow = {
  id: string;
  kind: ArtifactRecord['kind'];
  container_id: string | null;
  title: string | null;
  content: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
};

type SqlAuthorTextRow = {
  artifact_id: string;
  container_id: string;
  content: string;
  lifecycle_status: AuthorTextRecord['lifecycleStatus'];
  review_status: AuthorTextRecord['reviewStatus'];
  created_from_artifact_id: string | null;
  created_at: string;
  updated_at: string;
};

type SqlReviewCommentRow = {
  id: string;
  artifact_id: string;
  target_author_text_id: string;
  start_offset: number | null;
  end_offset: number | null;
  quoted_text: string | null;
  prefix_text: string | null;
  suffix_text: string | null;
  source: ReviewCommentRecord['source'];
  reviewer_label: string | null;
  content: string;
  status: ReviewCommentRecord['status'];
  severity: ReviewCommentRecord['severity'];
  created_at: string;
  updated_at: string;
};

type SqlEdgeRow = {
  id: string;
  from_artifact_id: string;
  to_artifact_id: string;
  relation_type: EdgeKind;
  created_by: ProcessEdgeRecord['createdBy'];
  created_at: string;
};

export class PaperLabDatabase {
  readonly db: Database.Database;
  readonly workspacePath: string;
  rootContainerId: string;

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
    this.rootContainerId = this.ensureRootContainer();
  }

  close(): void {
    this.db.close();
  }

  summary(): WorkspaceSummary {
    return {
      path: this.workspacePath,
      rootContainerId: this.rootContainerId
    };
  }

  createContainer(parentId: string | null, title: string, intent?: string): void {
    const id = createId('ctr');
    const timestamp = nowIso();
    const insert = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO containers
           (id, title, intent, parent_id, active_author_text_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, NULL, ?, ?)`
        )
        .run(id, title, intent ?? null, parentId, timestamp, timestamp);

      if (parentId) {
        const nextOrder = this.nextChildOrder(parentId);
        this.db
          .prepare(
            `INSERT INTO container_children (parent_id, child_id, sort_order)
             VALUES (?, ?, ?)`
          )
          .run(parentId, id, nextOrder);
      }
    });
    insert();
  }

  updateContainer(containerId: string, payload: { title?: string; intent?: string }): void {
    const current = this.getContainer(containerId);
    if (!current) {
      throw new Error(`Container not found: ${containerId}`);
    }
    const title = payload.title?.trim() || current.title;
    const intent = payload.intent ?? current.intent;
    this.db
      .prepare('UPDATE containers SET title = ?, intent = ?, updated_at = ? WHERE id = ?')
      .run(title, intent, nowIso(), containerId);
  }

  deleteContainer(containerId: string): void {
    if (containerId === this.rootContainerId) {
      throw new Error('The document root container cannot be deleted.');
    }
    const containerIds = this.collectContainerIds(containerId);
    if (containerIds.length === 0) {
      throw new Error(`Container not found: ${containerId}`);
    }
    const timestamp = nowIso();
    const placeholders = containerIds.map(() => '?').join(', ');
    const artifactIds = this.db
      .prepare(
        `SELECT id FROM artifacts
         WHERE container_id IN (${placeholders}) AND deleted_at IS NULL`
      )
      .all(...containerIds)
      .map((row) => (row as { id: string }).id);

    const remove = this.db.transaction(() => {
      this.db
        .prepare(`UPDATE containers SET deleted_at = ?, updated_at = ? WHERE id IN (${placeholders})`)
        .run(timestamp, timestamp, ...containerIds);
      this.db
        .prepare(
          `UPDATE author_text_versions
           SET deleted_at = ?, updated_at = ?
           WHERE container_id IN (${placeholders}) AND deleted_at IS NULL`
        )
        .run(timestamp, timestamp, ...containerIds);
      this.db
        .prepare(`UPDATE artifacts SET deleted_at = ?, updated_at = ? WHERE container_id IN (${placeholders})`)
        .run(timestamp, timestamp, ...containerIds);
      this.db
        .prepare(
          `DELETE FROM container_children
           WHERE parent_id IN (${placeholders}) OR child_id IN (${placeholders})`
        )
        .run(...containerIds, ...containerIds);

      if (artifactIds.length > 0) {
        this.softDeleteReviewCommentsForArtifacts(artifactIds, timestamp);
        this.softDeleteEdgesForArtifacts(artifactIds, timestamp);
      }
    });
    remove();
  }

  moveContainer(containerId: string, newParentId: string | null, index: number): void {
    const timestamp = nowIso();
    const move = this.db.transaction(() => {
      this.db
        .prepare('DELETE FROM container_children WHERE child_id = ?')
        .run(containerId);
      this.db
        .prepare('UPDATE containers SET parent_id = ?, updated_at = ? WHERE id = ?')
        .run(newParentId, timestamp, containerId);
      if (newParentId) {
        const siblings = this.getOrderedChildIds(newParentId).filter((id) => id !== containerId);
        const insertAt = Math.max(0, Math.min(index, siblings.length));
        siblings.splice(insertAt, 0, containerId);
        this.rewriteChildren(newParentId, siblings);
      }
    });
    move();
  }

  createSourceNote(containerId: string, title: string | undefined, content: string): void {
    this.insertArtifact('source_note', containerId, title ?? 'Source note', content, {});
  }

  createGenerationCandidate(
    containerId: string,
    title: string,
    content: string,
    metadata: Record<string, unknown>
  ): string {
    return this.insertArtifact('generation_candidate', containerId, title, content, metadata);
  }

  createAuthorText(
    containerId: string,
    content: string,
    createdFromArtifactId?: string
  ): void {
    const artifactId = this.insertArtifact('author_text', containerId, 'Author text', content, {});
    const timestamp = nowIso();
    this.db
      .prepare(
        `INSERT INTO author_text_versions
         (artifact_id, container_id, content, lifecycle_status, review_status,
          created_from_artifact_id, created_at, updated_at)
         VALUES (?, ?, ?, 'draft', 'not_reviewed', ?, ?, ?)`
      )
      .run(artifactId, containerId, content, createdFromArtifactId ?? null, timestamp, timestamp);
  }

  deleteArtifact(artifactId: string): void {
    const artifact = this.getArtifact(artifactId);
    if (!artifact) {
      throw new Error(`Artifact not found: ${artifactId}`);
    }
    const timestamp = nowIso();
    const reviewArtifactIds = this.db
      .prepare(
        `SELECT artifact_id FROM review_comments
         WHERE (artifact_id = ? OR target_author_text_id = ?) AND deleted_at IS NULL`
      )
      .all(artifactId, artifactId)
      .map((row) => (row as { artifact_id: string }).artifact_id);
    const affectedArtifactIds = Array.from(new Set([artifactId, ...reviewArtifactIds]));

    const remove = this.db.transaction(() => {
      this.db
        .prepare('UPDATE artifacts SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
        .run(timestamp, timestamp, artifactId);
      this.db
        .prepare(
          `UPDATE author_text_versions
           SET deleted_at = ?, updated_at = ?
           WHERE artifact_id = ? AND deleted_at IS NULL`
        )
        .run(timestamp, timestamp, artifactId);
      this.db
        .prepare(
          `UPDATE review_comments
           SET deleted_at = ?, updated_at = ?
           WHERE (artifact_id = ? OR target_author_text_id = ?) AND deleted_at IS NULL`
        )
        .run(timestamp, timestamp, artifactId, artifactId);
      this.db
        .prepare(
          `UPDATE containers
           SET active_author_text_id = NULL, updated_at = ?
           WHERE active_author_text_id = ?`
        )
        .run(timestamp, artifactId);
      this.softDeleteEdgesForArtifacts(affectedArtifactIds, timestamp);
    });
    remove();
  }

  updateArtifactContent(artifactId: string, content: string): void {
    this.db
      .prepare('UPDATE artifacts SET content = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
      .run(content, nowIso(), artifactId);
  }

  updateAuthorTextContent(authorTextId: string, content: string): void {
    const timestamp = nowIso();
    const update = this.db.transaction(() => {
      this.db
        .prepare(
          'UPDATE artifacts SET content = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
        )
        .run(content, timestamp, authorTextId);
      this.db
        .prepare(
          `UPDATE author_text_versions
           SET content = ?, review_status = 'review_stale', updated_at = ?
           WHERE artifact_id = ? AND deleted_at IS NULL`
        )
        .run(content, timestamp, authorTextId);
    });
    update();
  }

  setActiveAuthorText(containerId: string, authorTextId: string): void {
    const timestamp = nowIso();
    const promote = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE author_text_versions
           SET lifecycle_status = CASE WHEN artifact_id = ? THEN 'active' ELSE 'archived' END,
               updated_at = ?
           WHERE container_id = ? AND deleted_at IS NULL`
        )
        .run(authorTextId, timestamp, containerId);
      this.db
        .prepare('UPDATE containers SET active_author_text_id = ?, updated_at = ? WHERE id = ?')
        .run(authorTextId, timestamp, containerId);
    });
    promote();
  }

  createReviewComment(
    authorTextId: string,
    range: { startOffset?: number; endOffset?: number },
    payload: {
      source: ReviewCommentRecord['source'];
      reviewerLabel?: string;
      content: string;
      severity?: ReviewCommentRecord['severity'];
    }
  ): void {
    const authorText = this.getAuthorText(authorTextId);
    if (!authorText) {
      throw new Error(`AuthorText not found: ${authorTextId}`);
    }

    const startOffset = range.startOffset ?? null;
    const endOffset = range.endOffset ?? null;
    const quotedText =
      startOffset !== null && endOffset !== null
        ? authorText.content.slice(startOffset, endOffset)
        : null;
    const prefixText =
      startOffset !== null
        ? authorText.content.slice(Math.max(0, startOffset - 40), startOffset)
        : null;
    const suffixText =
      endOffset !== null ? authorText.content.slice(endOffset, endOffset + 40) : null;

    const artifactId = this.insertArtifact(
      'review_comment',
      authorText.containerId,
      payload.reviewerLabel ?? 'Review comment',
      payload.content,
      { targetAuthorTextId: authorTextId }
    );
    const timestamp = nowIso();
    this.db
      .prepare(
        `INSERT INTO review_comments
         (id, artifact_id, target_author_text_id, start_offset, end_offset,
          quoted_text, prefix_text, suffix_text, source, reviewer_label,
          content, status, severity, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`
      )
      .run(
        createId('rev'),
        artifactId,
        authorTextId,
        startOffset,
        endOffset,
        quotedText,
        prefixText,
        suffixText,
        payload.source,
        payload.reviewerLabel ?? null,
        payload.content,
        payload.severity ?? null,
        timestamp,
        timestamp
      );
  }

  updateReviewCommentStatus(commentId: string, status: ReviewCommentStatus): void {
    this.db
      .prepare('UPDATE review_comments SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, nowIso(), commentId);
  }

  createProcessEdge(
    fromArtifactId: string,
    toArtifactId: string,
    relationType: EdgeKind
  ): ProcessEdgeRecord {
    const edge: ProcessEdgeRecord = {
      id: createId('edge'),
      fromArtifactId,
      toArtifactId,
      relationType,
      createdBy: 'user',
      createdAt: nowIso()
    };
    this.db
      .prepare(
        `INSERT INTO edges
         (id, from_artifact_id, to_artifact_id, relation_type, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        edge.id,
        edge.fromArtifactId,
        edge.toArtifactId,
        edge.relationType,
        edge.createdBy,
        edge.createdAt
      );
    return edge;
  }

  updateProcessEdge(edgeId: string, relationType: EdgeKind): void {
    const result = this.db
      .prepare('UPDATE edges SET relation_type = ? WHERE id = ? AND deleted_at IS NULL')
      .run(relationType, edgeId);
    if (result.changes === 0) {
      throw new Error(`Process edge not found: ${edgeId}`);
    }
  }

  getContainerParentId(containerId: string): string | null {
    return this.getContainer(containerId)?.parentId ?? null;
  }

  getState(focusContainerId?: string | null): FocusedWorkspaceState {
    const focusId = focusContainerId ?? this.rootContainerId;
    const containers = this.listContainers();
    const visibleContainerIds = new Set([
      focusId,
      ...containers.filter((container) => container.parentId === focusId).map((container) => container.id)
    ]);
    const artifacts = this.listArtifacts().filter((artifact) => artifact.containerId === focusId);
    const artifactIds = new Set(artifacts.map((artifact) => artifact.id));
    const authorTexts = this.listAuthorTexts().filter((text) => artifactIds.has(text.artifactId));
    const reviewComments = this.listReviewComments().filter(
      (comment) =>
        artifactIds.has(comment.artifactId) || artifactIds.has(comment.targetAuthorTextId)
    );
    const commentArtifactIds = new Set(reviewComments.map((comment) => comment.artifactId));
    const edgeNodeIds = new Set([...artifactIds, ...commentArtifactIds]);
    const edges = this.listEdges().filter(
      (edge) => edgeNodeIds.has(edge.fromArtifactId) && edgeNodeIds.has(edge.toArtifactId)
    );

    return {
      workspace: this.summary(),
      compositionTree: this.buildCompositionTree(),
      focusContainerId: focusId,
      containers: containers.filter((container) => visibleContainerIds.has(container.id)),
      artifacts,
      authorTexts,
      reviewComments,
      edges
    };
  }

  listContainers(): ContainerRecord[] {
    return this.db
      .prepare(
        `SELECT id, title, intent, parent_id, active_author_text_id, created_at, updated_at
         FROM containers
         WHERE deleted_at IS NULL`
      )
      .all()
      .map((row) => mapContainer(row as SqlContainerRow));
  }

  listArtifacts(): ArtifactRecord[] {
    return this.db
      .prepare(
        `SELECT id, kind, container_id, title, content, metadata_json, created_at, updated_at
         FROM artifacts
         WHERE deleted_at IS NULL`
      )
      .all()
      .map((row) => mapArtifact(row as SqlArtifactRow));
  }

  listAuthorTexts(): AuthorTextRecord[] {
    return this.db
      .prepare(
        `SELECT artifact_id, container_id, content, lifecycle_status, review_status,
                created_from_artifact_id, created_at, updated_at
         FROM author_text_versions
         WHERE deleted_at IS NULL`
      )
      .all()
      .map((row) => mapAuthorText(row as SqlAuthorTextRow));
  }

  listReviewComments(): ReviewCommentRecord[] {
    return this.db
      .prepare(
        `SELECT id, artifact_id, target_author_text_id, start_offset, end_offset,
                quoted_text, prefix_text, suffix_text, source, reviewer_label,
                content, status, severity, created_at, updated_at
         FROM review_comments
         WHERE deleted_at IS NULL`
      )
      .all()
      .map((row) => mapReviewComment(row as SqlReviewCommentRow));
  }

  listEdges(): ProcessEdgeRecord[] {
    return this.db
      .prepare(
        `SELECT id, from_artifact_id, to_artifact_id, relation_type, created_by, created_at
         FROM edges
         WHERE deleted_at IS NULL`
      )
      .all()
      .map((row) => mapEdge(row as SqlEdgeRow));
  }

  getExportRows(rootContainerId: string): { container: ContainerRecord; text: AuthorTextRecord | null }[] {
    const containers = new Map(this.listContainers().map((container) => [container.id, container]));
    const authorTexts = new Map(this.listAuthorTexts().map((text) => [text.artifactId, text]));
    const rows: { container: ContainerRecord; text: AuthorTextRecord | null }[] = [];

    const visit = (containerId: string): void => {
      const container = containers.get(containerId);
      if (!container) {
        return;
      }
      rows.push({
        container,
        text: container.activeAuthorTextId
          ? authorTexts.get(container.activeAuthorTextId) ?? null
          : null
      });
      for (const childId of this.getOrderedChildIds(containerId)) {
        visit(childId);
      }
    };

    visit(rootContainerId);
    return rows;
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS containers (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        intent TEXT,
        parent_id TEXT,
        active_author_text_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE TABLE IF NOT EXISTS container_children (
        parent_id TEXT NOT NULL,
        child_id TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        PRIMARY KEY (parent_id, child_id)
      );

      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        container_id TEXT,
        title TEXT,
        content TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE TABLE IF NOT EXISTS author_text_versions (
        artifact_id TEXT PRIMARY KEY,
        container_id TEXT NOT NULL,
        content TEXT NOT NULL,
        lifecycle_status TEXT NOT NULL,
        review_status TEXT NOT NULL,
        created_from_artifact_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE TABLE IF NOT EXISTS review_comments (
        id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL,
        target_author_text_id TEXT NOT NULL,
        start_offset INTEGER,
        end_offset INTEGER,
        quoted_text TEXT,
        prefix_text TEXT,
        suffix_text TEXT,
        source TEXT NOT NULL,
        reviewer_label TEXT,
        content TEXT NOT NULL,
        status TEXT NOT NULL,
        severity TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE TABLE IF NOT EXISTS edges (
        id TEXT PRIMARY KEY,
        from_artifact_id TEXT NOT NULL,
        to_artifact_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE TABLE IF NOT EXISTS llm_runs (
        id TEXT PRIMARY KEY,
        target_container_id TEXT,
        task TEXT NOT NULL,
        system_prompt TEXT,
        user_prompt TEXT NOT NULL,
        context_snapshot_json TEXT NOT NULL,
        model TEXT NOT NULL,
        base_url TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        output_artifact_id TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );
    `);
  }

  private ensureRootContainer(): string {
    const existing = this.db
      .prepare(
        `SELECT id FROM containers
         WHERE parent_id IS NULL AND deleted_at IS NULL
         ORDER BY created_at ASC
         LIMIT 1`
      )
      .get() as { id: string } | undefined;
    if (existing) {
      return existing.id;
    }

    const id = createId('ctr');
    const timestamp = nowIso();
    this.db
      .prepare(
        `INSERT INTO containers
         (id, title, intent, parent_id, active_author_text_id, created_at, updated_at)
         VALUES (?, 'Paper', 'Document root', NULL, NULL, ?, ?)`
      )
      .run(id, timestamp, timestamp);
    return id;
  }

  private insertArtifact(
    kind: ArtifactRecord['kind'],
    containerId: string,
    title: string,
    content: string,
    metadata: Record<string, unknown>
  ): string {
    const id = createId('art');
    const timestamp = nowIso();
    this.db
      .prepare(
        `INSERT INTO artifacts
         (id, kind, container_id, title, content, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, kind, containerId, title, content, JSON.stringify(metadata), timestamp, timestamp);
    return id;
  }

  private getContainer(containerId: string): ContainerRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, title, intent, parent_id, active_author_text_id, created_at, updated_at
         FROM containers
         WHERE id = ? AND deleted_at IS NULL`
      )
      .get(containerId) as SqlContainerRow | undefined;
    return row ? mapContainer(row) : null;
  }

  private getArtifact(artifactId: string): ArtifactRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, kind, container_id, title, content, metadata_json, created_at, updated_at
         FROM artifacts
         WHERE id = ? AND deleted_at IS NULL`
      )
      .get(artifactId) as SqlArtifactRow | undefined;
    return row ? mapArtifact(row) : null;
  }

  private getAuthorText(authorTextId: string): AuthorTextRecord | null {
    const row = this.db
      .prepare(
        `SELECT artifact_id, container_id, content, lifecycle_status, review_status,
                created_from_artifact_id, created_at, updated_at
         FROM author_text_versions
         WHERE artifact_id = ? AND deleted_at IS NULL`
      )
      .get(authorTextId) as SqlAuthorTextRow | undefined;
    return row ? mapAuthorText(row) : null;
  }

  private collectContainerIds(containerId: string): string[] {
    if (!this.getContainer(containerId)) {
      return [];
    }
    const ids = [containerId];
    for (const childId of this.getOrderedChildIds(containerId)) {
      ids.push(...this.collectContainerIds(childId));
    }
    return ids;
  }

  private softDeleteReviewCommentsForArtifacts(artifactIds: string[], timestamp: string): void {
    if (artifactIds.length === 0) {
      return;
    }
    const placeholders = artifactIds.map(() => '?').join(', ');
    this.db
      .prepare(
        `UPDATE review_comments
         SET deleted_at = ?, updated_at = ?
         WHERE (artifact_id IN (${placeholders}) OR target_author_text_id IN (${placeholders}))
           AND deleted_at IS NULL`
      )
      .run(timestamp, timestamp, ...artifactIds, ...artifactIds);
  }

  private softDeleteEdgesForArtifacts(artifactIds: string[], timestamp: string): void {
    if (artifactIds.length === 0) {
      return;
    }
    const placeholders = artifactIds.map(() => '?').join(', ');
    this.db
      .prepare(
        `UPDATE edges
         SET deleted_at = ?
         WHERE (from_artifact_id IN (${placeholders}) OR to_artifact_id IN (${placeholders}))
           AND deleted_at IS NULL`
      )
      .run(timestamp, ...artifactIds, ...artifactIds);
  }

  private buildCompositionTree(): ContainerTreeNode[] {
    const containers = new Map(this.listContainers().map((container) => [container.id, container]));
    const roots = [...containers.values()].filter((container) => container.parentId === null);

    const build = (container: ContainerRecord): ContainerTreeNode => ({
      ...container,
      children: this.getOrderedChildIds(container.id)
        .map((childId) => containers.get(childId))
        .filter((child): child is ContainerRecord => Boolean(child))
        .map(build)
    });

    return roots.map(build);
  }

  private nextChildOrder(parentId: string): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order
         FROM container_children
         WHERE parent_id = ?`
      )
      .get(parentId) as { next_order: number };
    return row.next_order;
  }

  private getOrderedChildIds(parentId: string): string[] {
    return this.db
      .prepare(
        `SELECT child_id
         FROM container_children
         WHERE parent_id = ?
         ORDER BY sort_order ASC`
      )
      .all(parentId)
      .map((row) => (row as { child_id: string }).child_id);
  }

  private rewriteChildren(parentId: string, childIds: string[]): void {
    this.db.prepare('DELETE FROM container_children WHERE parent_id = ?').run(parentId);
    const stmt = this.db.prepare(
      `INSERT INTO container_children (parent_id, child_id, sort_order)
       VALUES (?, ?, ?)`
    );
    childIds.forEach((childId, index) => stmt.run(parentId, childId, index));
  }
}

function mapContainer(row: SqlContainerRow): ContainerRecord {
  return {
    id: row.id,
    title: row.title,
    intent: row.intent,
    parentId: row.parent_id,
    activeAuthorTextId: row.active_author_text_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapArtifact(row: SqlArtifactRow): ArtifactRecord {
  return {
    id: row.id,
    kind: row.kind,
    containerId: row.container_id,
    title: row.title,
    content: row.content,
    metadata: row.metadata_json ? (JSON.parse(row.metadata_json) as Record<string, unknown>) : {},
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapAuthorText(row: SqlAuthorTextRow): AuthorTextRecord {
  return {
    artifactId: row.artifact_id,
    containerId: row.container_id,
    content: row.content,
    lifecycleStatus: row.lifecycle_status,
    reviewStatus: row.review_status,
    createdFromArtifactId: row.created_from_artifact_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapReviewComment(row: SqlReviewCommentRow): ReviewCommentRecord {
  return {
    id: row.id,
    artifactId: row.artifact_id,
    targetAuthorTextId: row.target_author_text_id,
    startOffset: row.start_offset,
    endOffset: row.end_offset,
    quotedText: row.quoted_text,
    prefixText: row.prefix_text,
    suffixText: row.suffix_text,
    source: row.source,
    reviewerLabel: row.reviewer_label,
    content: row.content,
    status: row.status,
    severity: row.severity,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapEdge(row: SqlEdgeRow): ProcessEdgeRecord {
  return {
    id: row.id,
    fromArtifactId: row.from_artifact_id,
    toArtifactId: row.to_artifact_id,
    relationType: row.relation_type,
    createdBy: row.created_by,
    createdAt: row.created_at
  };
}
