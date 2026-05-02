import Database from 'better-sqlite3';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { createId, nowIso } from './ids.js';
import type {
  CanvasNodeLayout,
  CompositionTreeNode,
  ContentNodeRecord,
  CreateNodePayload,
  EdgeKind,
  FocusedWorkspaceState,
  NodeEdgeRecord,
  NodeRecord,
  NodeStats,
  SectionNodeRecord,
  UpdateNodeLayoutPayload,
  UpdateNodePayload,
  WorkspaceSummary
} from '../shared/types.js';

const SCHEMA_VERSION = 2;

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
  is_artifact: number;
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
    const isArtifact = 'isArtifact' in payload ? Boolean(payload.isArtifact) : node.isArtifact;
    const metadata = 'metadata' in payload ? payload.metadata ?? node.metadata : node.metadata;
    this.db
      .prepare(
        `UPDATE nodes
         SET title = ?, content = ?, is_main = ?, is_llm = ?, is_artifact = ?,
             metadata_json = ?, updated_at = ?
         WHERE id = ? AND kind = 'content' AND deleted_at IS NULL`
      )
      .run(
        title,
        content,
        isMain ? 1 : 0,
        isLlm ? 1 : 0,
        isArtifact ? 1 : 0,
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
      nodeStats: this.buildNodeStats(nodes),
      edges,
      nodeLayouts: this.listCanvasNodeLayouts(focusId)
    };
  }

  listNodes(): NodeRecord[] {
    return this.db
      .prepare(
        `SELECT id, kind, parent_id, title, intent, active_main_node_id, content,
                is_main, is_llm, is_artifact, metadata_json, sort_order, created_at, updated_at
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
                is_main, is_llm, is_artifact, metadata_json, sort_order, created_at, updated_at
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
    const version = this.db.pragma('user_version', { simple: true }) as number;
    if (version !== SCHEMA_VERSION) {
      this.db.exec(`
        DROP TABLE IF EXISTS containers;
        DROP TABLE IF EXISTS container_children;
        DROP TABLE IF EXISTS artifacts;
        DROP TABLE IF EXISTS author_text_versions;
        DROP TABLE IF EXISTS review_comments;
        DROP TABLE IF EXISTS edges;
        DROP TABLE IF EXISTS canvas_node_layouts;
        DROP TABLE IF EXISTS nodes;
        DROP TABLE IF EXISTS node_edges;
        DROP TABLE IF EXISTS llm_runs;
      `);
    }

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
        is_artifact INTEGER NOT NULL DEFAULT 0,
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
    this.db.pragma(`user_version = ${SCHEMA_VERSION}`);
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
         (id, kind, parent_id, title, content, is_main, is_llm, is_artifact,
          metadata_json, sort_order, created_at, updated_at)
         VALUES (?, 'content', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        payload.parentId,
        payload.title.trim() || 'Content',
        payload.content,
        payload.isMain ? 1 : 0,
        payload.isLlm ? 1 : 0,
        payload.isArtifact ? 1 : 0,
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
            artifactCount: 0,
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
      if (node.isArtifact) {
        stats[node.parentId].artifactCount += 1;
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
    isArtifact: Boolean(row.is_artifact),
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

function compareNodeOrder(left: NodeRecord, right: NodeRecord): number {
  return left.sortOrder - right.sortOrder || left.createdAt.localeCompare(right.createdAt);
}
