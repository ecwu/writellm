import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptPath), '..');

if (!process.versions.electron) {
  const electronBin = path.join(projectRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
  const result = spawnSync(electronBin, [scriptPath], {
    cwd: projectRoot,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit'
  });
  if (result.error) {
    throw result.error;
  }
  process.exit(result.status ?? 1);
}

const { WriteLLMDatabase } = await import('../dist-electron/main/database.js');
const workspacePath = mkdtempSync(path.join(os.tmpdir(), 'writellm-clean-slate-'));
const now = '2026-07-11T12:00:00.000Z';

function expectCount(db, tableName, expected) {
  const row = db.db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get();
  if (row.count !== expected) {
    throw new Error(`${tableName} expected ${expected} rows, received ${row.count}.`);
  }
}

try {
  const original = new WriteLLMDatabase(workspacePath);
  original.db.prepare(`
    INSERT INTO knowledge_items (id, public_ref, title, content, source_type, index_status, metadata_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('item-1', 'src1', 'Retained source', 'Indexed source body', 'text', 'indexed', '{}', now, now);
  original.db.prepare(`
    INSERT INTO knowledge_chunks (id, public_ref, item_id, chunk_index, content, embedding_json, embedding_dimensions, embedding_model, vector_rowid, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('chunk-1', 'src1.c1', 'item-1', 0, 'Indexed source body', '[0.1,0.2]', 2, 'embedding-model', 1, now, now);
  original.db.prepare('INSERT INTO knowledge_chunks_fts (chunk_id, content) VALUES (?, ?)').run('chunk-1', 'Indexed source body');
  original.db.exec('CREATE TABLE IF NOT EXISTS knowledge_chunk_vectors_d2 (embedding BLOB, chunk_id TEXT);');
  original.db.prepare('INSERT INTO knowledge_chunk_vectors_d2 (embedding, chunk_id) VALUES (?, ?)').run(Buffer.from([1, 2]), 'chunk-1');
  original.db.prepare(`
    INSERT INTO nodes (id, kind, title, content, markdown_path, metadata_json, sort_order, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'section-1',
    'section',
    'Author section',
    'Stored fallback',
    'sections/section-1.md',
    JSON.stringify({ llmOperations: [{ operationId: 'old-run' }], keep: 'author metadata' }),
    1,
    now,
    now
  );
  original.db.prepare('INSERT INTO llm_generation_sessions (id, section_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run('session-1', 'section-1', 'Legacy run', now, now);
  original.db.prepare(`
    INSERT INTO llm_generation_rounds (id, session_id, status, mode, output_mode, prompt, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('round-1', 'session-1', 'done', 'continue', 'patchProposal', 'legacy prompt', now, now);
  original.db.prepare(`
    INSERT INTO writing_patches (id, status, kind, section_id, generation_round_id, patch_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('patch-1', 'needs_review', 'insert_at_cursor', 'section-1', 'round-1', '{}', now, now);
  original.db.prepare(`
    INSERT INTO generation_citations (id, generation_node_id, knowledge_item_id, knowledge_chunk_id, label, snippet, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run('citation-1', 'section-1', 'item-1', 'chunk-1', 'Legacy citation', 'Indexed source body', now);
  mkdirSync(path.join(workspacePath, 'sections'), { recursive: true });
  writeFileSync(path.join(workspacePath, 'sections', 'section-1.md'), 'Author Markdown\n', 'utf8');
  mkdirSync(path.join(workspacePath, 'metadata', 'sections'), { recursive: true });
  writeFileSync(path.join(workspacePath, 'metadata', 'sections', 'section-1.llm.json'), '{"llmOperations":["legacy"]}\n', 'utf8');
  original.db.prepare('DELETE FROM document_blocks').run();
  original.db.prepare('DELETE FROM document_metadata').run();
  original.db.pragma('user_version = 17');
  original.close();

  const migrated = new WriteLLMDatabase(workspacePath);
  expectCount(migrated, 'knowledge_items', 1);
  expectCount(migrated, 'knowledge_chunks', 1);
  expectCount(migrated, 'knowledge_chunks_fts', 1);
  expectCount(migrated, 'knowledge_chunk_vectors_d2', 1);
  expectCount(migrated, 'llm_generation_sessions', 0);
  expectCount(migrated, 'llm_generation_rounds', 0);
  expectCount(migrated, 'writing_patches', 0);
  expectCount(migrated, 'generation_citations', 0);
  const metadataRow = migrated.db.prepare('SELECT metadata_json AS metadataJson FROM nodes WHERE id = ?').get('section-1');
  if (metadataRow.metadataJson !== JSON.stringify({ keep: 'author metadata' })) {
    throw new Error('Legacy LLM operations were not removed from section metadata.');
  }
  if (!existsSync(path.join(workspacePath, 'sections', 'section-1.md'))) {
    throw new Error('Author Markdown was removed during clean-slate migration.');
  }
  const migratedSection = migrated.getSection('section-1');
  if (
    migratedSection?.markdownContent !== 'Author Markdown\n' ||
    migrated.listDocumentBlocks('section-1').length !== 1
  ) {
    throw new Error('Legacy section Markdown was not migrated into the block document.');
  }
  if (existsSync(path.join(workspacePath, 'metadata', 'sections', 'section-1.llm.json'))) {
    throw new Error('Legacy LLM sidecar survived clean-slate migration.');
  }
  migrated.close();
} finally {
  rmSync(workspacePath, { recursive: true, force: true });
}
