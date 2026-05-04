import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const nodes = sqliteTable('nodes', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  parentId: text('parent_id'),
  title: text('title').notNull(),
  intent: text('intent'),
  activeMainNodeId: text('active_main_node_id'),
  content: text('content'),
  markdownPath: text('markdown_path'),
  markdownHash: text('markdown_hash'),
  isMain: integer('is_main').notNull().default(0),
  isLlm: integer('is_llm').notNull().default(0),
  metadataJson: text('metadata_json'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at')
}, (table) => [
  index('idx_nodes_parent_kind_order').on(table.parentId, table.kind, table.sortOrder)
]);

export const nodeEdges = sqliteTable('node_edges', {
  id: text('id').primaryKey(),
  fromNodeId: text('from_node_id').notNull(),
  toNodeId: text('to_node_id').notNull(),
  relationType: text('relation_type').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: text('created_at').notNull(),
  deletedAt: text('deleted_at')
});

export const canvasNodeLayouts = sqliteTable('canvas_node_layouts', {
  canvasSectionId: text('canvas_section_id').notNull(),
  nodeId: text('node_id').notNull(),
  x: real('x').notNull(),
  y: real('y').notNull(),
  width: real('width').notNull(),
  height: real('height').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [
  primaryKey({ columns: [table.canvasSectionId, table.nodeId] })
]);

export const knowledgeItems = sqliteTable('knowledge_items', {
  id: text('id').primaryKey(),
  publicRef: text('public_ref').notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  sourceType: text('source_type').notNull().default('text'),
  indexStatus: text('index_status').notNull().default('pending'),
  metadataJson: text('metadata_json'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deletedAt: text('deleted_at')
}, (table) => [
  index('idx_knowledge_items_status').on(table.indexStatus, table.updatedAt),
  uniqueIndex('idx_knowledge_items_public_ref').on(table.publicRef)
]);

export const knowledgeChunks = sqliteTable('knowledge_chunks', {
  id: text('id').primaryKey(),
  publicRef: text('public_ref').notNull(),
  itemId: text('item_id').notNull(),
  chunkIndex: integer('chunk_index').notNull(),
  content: text('content').notNull(),
  embeddingJson: text('embedding_json'),
  embeddingDimensions: integer('embedding_dimensions').notNull().default(0),
  embeddingModel: text('embedding_model'),
  vectorRowid: integer('vector_rowid'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (table) => [
  index('idx_knowledge_chunks_item').on(table.itemId, table.chunkIndex),
  uniqueIndex('idx_knowledge_chunks_public_ref').on(table.publicRef)
]);

export const generationCitations = sqliteTable('generation_citations', {
  id: text('id').primaryKey(),
  generationNodeId: text('generation_node_id').notNull(),
  publicRef: text('public_ref'),
  knowledgeItemId: text('knowledge_item_id').notNull(),
  knowledgeChunkId: text('knowledge_chunk_id').notNull(),
  label: text('label').notNull(),
  snippet: text('snippet').notNull(),
  score: real('score'),
  createdAt: text('created_at').notNull()
}, (table) => [
  index('idx_generation_citations_node').on(table.generationNodeId)
]);

export const plainjobJobs = sqliteTable('plainjob_jobs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type').notNull(),
  data: text('data').notNull(),
  status: integer('status').notNull().default(0),
  failedAt: integer('failed_at'),
  error: text('error'),
  nextRunAt: integer('next_run_at'),
  createdAt: integer('created_at').notNull()
}, (table) => [
  index('idx_jobs_status_type_next_run_at').on(table.status, table.type, table.nextRunAt)
]);

export const plainjobScheduledJobs = sqliteTable('plainjob_scheduled_jobs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  type: text('type').notNull(),
  status: integer('status').notNull().default(0),
  cronExpression: text('cron_expression'),
  nextRunAt: integer('next_run_at'),
  createdAt: integer('created_at').notNull()
}, (table) => [
  uniqueIndex('idx_plainjob_scheduled_jobs_type').on(table.type),
  index('idx_scheduled_jobs_status_type_next_run_at').on(table.status, table.type, table.nextRunAt)
]);

export const schema = {
  nodes,
  nodeEdges,
  canvasNodeLayouts,
  knowledgeItems,
  knowledgeChunks,
  generationCitations,
  plainjobJobs,
  plainjobScheduledJobs
};

export type NodeRow = typeof nodes.$inferSelect;
export type NodeEdgeRow = typeof nodeEdges.$inferSelect;
export type CanvasNodeLayoutRow = typeof canvasNodeLayouts.$inferSelect;
export type KnowledgeItemRow = typeof knowledgeItems.$inferSelect;
export type KnowledgeChunkRow = typeof knowledgeChunks.$inferSelect;
export type KnowledgeCitationRow = typeof generationCitations.$inferSelect;
export type PlainjobJobRow = typeof plainjobJobs.$inferSelect;
export type PlainjobScheduledJobRow = typeof plainjobScheduledJobs.$inferSelect;
