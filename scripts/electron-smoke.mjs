import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { PaperLabDatabase } from '../dist-electron/main/database.js';
import { exportLatex } from '../dist-electron/main/exportLatex.js';
import {
  enqueueKnowledgeFiles,
  extractKnowledgeFileText,
  processKnowledgeIngestJob
} from '../dist-electron/main/knowledgeIngest.js';

const workspacePath = mkdtempSync(path.join(os.tmpdir(), 'paperlab-smoke-'));

try {
  const db = new PaperLabDatabase(workspacePath);
  const rootId = db.rootNodeId;
  const intro = db.createNode({
    kind: 'section',
    parentId: rootId,
    title: 'Intro',
    intent: ''
  });
  if (intro.kind !== 'section') {
    throw new Error('Child section was not created.');
  }

  const main = db.createNode({
    kind: 'content',
    parentId: intro.id,
    title: 'Main draft',
    content: '\\section{Intro}\nHello world.',
    isMain: true
  });
  const source = db.createNode({
    kind: 'content',
    parentId: intro.id,
    title: 'Source note',
    content: 'Background source.'
  });
  if (main.kind !== 'content' || source.kind !== 'content') {
    throw new Error('Content nodes were not created.');
  }

  db.setActiveMainNode(intro.id, main.id);
  const exportPath = exportLatex(db, rootId);
  const output = readFileSync(exportPath, 'utf8');
  if (!output.includes('\\section{Intro}') || !output.includes('Hello world.')) {
    throw new Error('Exported LaTeX did not include active main content.');
  }

  db.createNodeEdge(source.id, main.id, 'informs');
  if (db.listEdges().length !== 1) {
    throw new Error('Content edge was not created.');
  }

  const knowledge = db.createKnowledgeItem('Background source', 'Background source.');
  db.replaceKnowledgeChunks(knowledge.id, [
    {
      content: 'Background source.',
      embedding: [1, 0, 0],
      embeddingModel: 'test-embedding'
    }
  ]);
  const chunks = db.searchKnowledgeChunks({ embedding: [1, 0, 0], maxChunks: 1 });
  if (chunks.length !== 1 || chunks[0].itemId !== knowledge.id) {
    throw new Error('Knowledge chunk search did not return the indexed source.');
  }
  db.saveGenerationCitations(main.id, [
    {
      knowledgeItemId: knowledge.id,
      knowledgeChunkId: chunks[0].id,
      label: '[S1]',
      snippet: chunks[0].content,
      score: chunks[0].score ?? null
    }
  ]);
  if (db.listGenerationCitations(main.id).length !== 1) {
    throw new Error('Generation citation was not saved.');
  }

  const txtPath = path.join(workspacePath, 'source.txt');
  const mdPath = path.join(workspacePath, 'notes.md');
  const pdfPath = path.join(workspacePath, 'sample.pdf');
  writeFileSync(txtPath, 'Exact text source.');
  writeFileSync(mdPath, '# Notes\n\nMarkdown source.');
  writeFileSync(pdfPath, createSamplePdf('PDF source text'));

  await enqueueKnowledgeFiles(db, [txtPath, mdPath]);
  const queuedJobs = db.listKnowledgeIngestJobs();
  if (queuedJobs.length !== 2 || queuedJobs.some((job) => job.status !== 'queued')) {
    throw new Error('Batch enqueue did not create queued ingest jobs.');
  }

  const fakeEmbeddingSettings = {
    provider: 'openai-compatible',
    baseURL: 'http://localhost',
    model: 'test-embedding',
    apiKey: 'test'
  };
  const fakeIndexKnowledgeItem = async (database, itemId) => {
    const item = database.getKnowledgeItem(itemId);
    if (!item) {
      throw new Error('Ingest test item was not created.');
    }
    return database.replaceKnowledgeChunks(itemId, [
      {
        content: item.content,
        embedding: [1, 0, 0],
        embeddingModel: 'test-embedding'
      }
    ]);
  };
  const txtJob = queuedJobs.find((job) => job.fileName === 'source.txt');
  if (!txtJob) {
    throw new Error('Text ingest job was not queued.');
  }
  await processKnowledgeIngestJob(db, txtJob.id, fakeEmbeddingSettings, fakeIndexKnowledgeItem);
  const txtItemId = db.getKnowledgeIngestJob(txtJob.id)?.knowledgeItemId;
  const txtItem = txtItemId ? db.getKnowledgeItem(txtItemId) : null;
  if (txtItem?.content !== 'Exact text source.' || txtItem.sourceType !== 'file') {
    throw new Error('Text ingest did not store exact extracted source content.');
  }

  const pdfText = await extractKnowledgeFileText(pdfPath, '.pdf');
  if (!pdfText.includes('PDF source text')) {
    throw new Error('PDF extraction did not return expected text.');
  }

  const mineruSettings = {
    pdfExtractionEngine: 'mineru',
    mineru: {
      apiKey: 'mineru-test-key',
      modelVersion: 'vlm',
      language: 'ch',
      isOcr: false,
      enableTable: true,
      enableFormula: true
    }
  };
  process.env.PAPERLAB_MINERU_POLL_INTERVAL_MS = '0';
  const originalFetch = globalThis.fetch;
  try {
    const mineruPdfPath = path.join(workspacePath, 'mineru.pdf');
    writeFileSync(mineruPdfPath, createSamplePdf('MinerU PDF source'));
    await enqueueKnowledgeFiles(db, [mineruPdfPath], mineruSettings);
    const mineruJob = db.listKnowledgeIngestJobs().find((job) => job.fileName === 'mineru.pdf');
    if (!mineruJob || mineruJob.metadata.extractionEngine !== 'mineru') {
      throw new Error('MinerU import did not snapshot the extraction engine.');
    }

    let uploadSeen = false;
    let pollCount = 0;
    const mineruZip = createStoredZip({
      'full.md': '# MinerU Markdown\n\nMarkdown should be primary.\n\n![Figure caption text.](images/fig1.png)',
      'sample_content_list.json': JSON.stringify([
        { type: 'text', text: 'MinerU primary text block.', page_idx: 0 },
        {
          type: 'image',
          img_path: 'images/fig1.png',
          image_caption: ['Figure caption text.'],
          image_footnote: ['Figure footnote text.'],
          page_idx: 0,
          bbox: [1, 2, 3, 4]
        }
      ]),
      'images/fig1.png': Buffer.from([137, 80, 78, 71])
    });
    globalThis.fetch = async (url, init = {}) => {
      const href = String(url);
      if (href.endsWith('/api/v4/file-urls/batch')) {
        const body = JSON.parse(String(init.body));
        if (body.files?.[0]?.data_id !== mineruJob.id || body.model_version !== 'vlm') {
          throw new Error('MinerU batch request did not include expected task data.');
        }
        return jsonResponse({
          code: 0,
          data: {
            batch_id: 'batch-smoke',
            file_urls: ['https://upload.mineru.test/file.pdf']
          }
        });
      }
      if (href === 'https://upload.mineru.test/file.pdf') {
        if (init.method !== 'PUT') {
          throw new Error('MinerU upload did not use PUT.');
        }
        uploadSeen = true;
        return new Response(null, { status: 200 });
      }
      if (href.endsWith('/api/v4/extract-results/batch/batch-smoke')) {
        pollCount += 1;
        return jsonResponse({
          code: 0,
          data: {
            extract_result: [
              pollCount === 1
                ? { data_id: mineruJob.id, state: 'running', progress: 50 }
                : { data_id: mineruJob.id, state: 'done', progress: 100, full_zip_url: 'https://download.mineru.test/result.zip' }
            ]
          }
        });
      }
      if (href === 'https://download.mineru.test/result.zip') {
        return new Response(mineruZip, { status: 200 });
      }
      throw new Error(`Unexpected MinerU fetch URL: ${href}`);
    };
    await processKnowledgeIngestJob(db, mineruJob.id, fakeEmbeddingSettings, fakeIndexKnowledgeItem, mineruSettings);
    const mineruItemId = db.getKnowledgeIngestJob(mineruJob.id)?.knowledgeItemId;
    const mineruItem = mineruItemId ? db.getKnowledgeItem(mineruItemId) : null;
    if (!uploadSeen || pollCount !== 2) {
      throw new Error('MinerU import did not upload and poll as expected.');
    }
    if (!mineruItem?.content.includes('# MinerU Markdown') || mineruItem.content.includes('MinerU primary text block.')) {
      throw new Error('MinerU full markdown was not used as primary indexed text.');
    }
    const mineruMetadata = mineruItem.metadata.mineru;
    if (!mineruMetadata || !Array.isArray(mineruMetadata.images) || !mineruMetadata.images[0]?.relativePath) {
      throw new Error('MinerU image asset metadata was not stored.');
    }

    const fallbackJob = db.enqueueKnowledgeIngestJob({
      filePath: mineruPdfPath,
      fileName: 'mineru-fallback.pdf',
      fileExt: '.pdf',
      fileSize: 1,
      metadata: {
        extractionEngine: 'mineru',
        mineru: {
          modelVersion: 'vlm',
          language: 'ch',
          isOcr: false,
          enableTable: true,
          enableFormula: true
        }
      }
    });
    globalThis.fetch = async (url, init = {}) => {
      const href = String(url);
      if (href.endsWith('/api/v4/file-urls/batch')) {
        return jsonResponse({ code: 0, data: { batch_id: 'batch-fallback', file_urls: ['https://upload.mineru.test/fallback.pdf'] } });
      }
      if (href === 'https://upload.mineru.test/fallback.pdf') {
        return new Response(null, { status: 200 });
      }
      if (href.endsWith('/api/v4/extract-results/batch/batch-fallback')) {
        return jsonResponse({
          code: 0,
          data: { extract_result: [{ data_id: fallbackJob.id, state: 'done', full_zip_url: 'https://download.mineru.test/fallback.zip' }] }
        });
      }
      if (href === 'https://download.mineru.test/fallback.zip') {
        return new Response(createStoredZip({ 'full.md': 'Fallback markdown text.' }), { status: 200 });
      }
      throw new Error(`Unexpected MinerU fallback fetch URL: ${href}`);
    };
    await processKnowledgeIngestJob(db, fallbackJob.id, fakeEmbeddingSettings, fakeIndexKnowledgeItem, mineruSettings);
    const fallbackItemId = db.getKnowledgeIngestJob(fallbackJob.id)?.knowledgeItemId;
    const fallbackItem = fallbackItemId ? db.getKnowledgeItem(fallbackItemId) : null;
    if (fallbackItem?.content !== 'Fallback markdown text.') {
      throw new Error('MinerU fallback markdown was not used when content list was missing.');
    }

    const mineruFailedJob = db.enqueueKnowledgeIngestJob({
      filePath: mineruPdfPath,
      fileName: 'mineru-failed.pdf',
      fileExt: '.pdf',
      fileSize: 1,
      metadata: {
        extractionEngine: 'mineru',
        mineru: {
          modelVersion: 'vlm',
          language: 'ch',
          isOcr: false,
          enableTable: true,
          enableFormula: true
        }
      }
    });
    globalThis.fetch = async (url, init = {}) => {
      const href = String(url);
      if (href.endsWith('/api/v4/file-urls/batch')) {
        return jsonResponse({ code: 0, data: { batch_id: 'batch-failed', file_urls: ['https://upload.mineru.test/failed.pdf'] } });
      }
      if (href === 'https://upload.mineru.test/failed.pdf') {
        return new Response(null, { status: 200 });
      }
      if (href.endsWith('/api/v4/extract-results/batch/batch-failed')) {
        return jsonResponse({
          code: 0,
          data: { extract_result: [{ data_id: mineruFailedJob.id, state: 'failed', err_msg: 'remote parse failed' }] }
        });
      }
      throw new Error(`Unexpected MinerU failed fetch URL: ${href}`);
    };
    await processKnowledgeIngestJob(db, mineruFailedJob.id, fakeEmbeddingSettings, fakeIndexKnowledgeItem, mineruSettings);
    if (db.getKnowledgeIngestJob(mineruFailedJob.id)?.status !== 'error') {
      throw new Error('MinerU failed remote state did not mark the ingest job as error.');
    }

    const missingKeyJob = db.enqueueKnowledgeIngestJob({
      filePath: mineruPdfPath,
      fileName: 'mineru-missing-key.pdf',
      fileExt: '.pdf',
      fileSize: 1,
      metadata: { extractionEngine: 'mineru' }
    });
    await processKnowledgeIngestJob(
      db,
      missingKeyJob.id,
      fakeEmbeddingSettings,
      fakeIndexKnowledgeItem,
      { ...mineruSettings, mineru: { ...mineruSettings.mineru, apiKey: '' } }
    );
    if (!db.getKnowledgeIngestJob(missingKeyJob.id)?.errorMessage?.includes('API key')) {
      throw new Error('MinerU missing API key did not surface a clear error.');
    }

    const missingZipJob = db.enqueueKnowledgeIngestJob({
      filePath: mineruPdfPath,
      fileName: 'mineru-missing-zip.pdf',
      fileExt: '.pdf',
      fileSize: 1,
      metadata: { extractionEngine: 'mineru' }
    });
    globalThis.fetch = async (url, init = {}) => {
      const href = String(url);
      if (href.endsWith('/api/v4/file-urls/batch')) {
        return jsonResponse({ code: 0, data: { batch_id: 'batch-missing-zip', file_urls: ['https://upload.mineru.test/missing-zip.pdf'] } });
      }
      if (href === 'https://upload.mineru.test/missing-zip.pdf') {
        return new Response(null, { status: 200 });
      }
      if (href.endsWith('/api/v4/extract-results/batch/batch-missing-zip')) {
        return jsonResponse({ code: 0, data: { extract_result: [{ data_id: missingZipJob.id, state: 'done' }] } });
      }
      throw new Error(`Unexpected MinerU missing zip fetch URL: ${href}`);
    };
    await processKnowledgeIngestJob(db, missingZipJob.id, fakeEmbeddingSettings, fakeIndexKnowledgeItem, mineruSettings);
    if (!db.getKnowledgeIngestJob(missingZipJob.id)?.errorMessage?.includes('full_zip_url')) {
      throw new Error('MinerU done without full_zip_url did not surface a clear error.');
    }
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.PAPERLAB_MINERU_POLL_INTERVAL_MS;
  }

  const legacyWorkspacePath = path.join(workspacePath, 'legacy.paperlab');
  mkdirSync(legacyWorkspacePath, { recursive: true });
  const legacyRawDb = new Database(path.join(legacyWorkspacePath, 'project.sqlite'));
  legacyRawDb.exec(`
    CREATE TABLE knowledge_ingest_jobs (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_ext TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      knowledge_item_id TEXT,
      status TEXT NOT NULL,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT
    );
    INSERT INTO knowledge_ingest_jobs
      (id, file_path, file_name, file_ext, file_size, knowledge_item_id, status, error_message, created_at, updated_at, started_at, finished_at)
    VALUES
      ('legacy-ingest', '/tmp/legacy.pdf', 'legacy.pdf', '.pdf', 10, NULL, 'queued', NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL, NULL);
    PRAGMA user_version = 4;
  `);
  legacyRawDb.close();
  const legacyDb = new PaperLabDatabase(legacyWorkspacePath);
  const legacyJob = legacyDb.getKnowledgeIngestJob('legacy-ingest');
  if (legacyJob && (typeof legacyJob.metadata !== 'object' || Array.isArray(legacyJob.metadata))) {
    throw new Error('Legacy ingest job metadata migration did not produce readable metadata.');
  }
  legacyDb.close();

  const missingJob = db.enqueueKnowledgeIngestJob({
    filePath: path.join(workspacePath, 'missing.txt'),
    fileName: 'missing.txt',
    fileExt: '.txt',
    fileSize: 0
  });
  await processKnowledgeIngestJob(db, missingJob.id, fakeEmbeddingSettings, fakeIndexKnowledgeItem);
  const failedJob = db.getKnowledgeIngestJob(missingJob.id);
  if (failedJob?.status !== 'error' || !failedJob.errorMessage) {
    throw new Error('Failed extraction did not mark the ingest job as error.');
  }
  const failedItem = failedJob.knowledgeItemId ? db.getKnowledgeItem(failedJob.knowledgeItemId) : null;
  if (failedItem?.indexStatus !== 'error' || !failedItem.metadata.extractionError) {
    throw new Error('Failed extraction did not mark the knowledge item as error.');
  }
  db.retryKnowledgeIngestJob(missingJob.id);
  if (db.getKnowledgeIngestJob(missingJob.id)?.status !== 'queued') {
    throw new Error('Retry did not requeue the failed ingest job.');
  }
  db.updateKnowledgeIngestJob(missingJob.id, { status: 'extracting' });
  if (!db.listRunnableKnowledgeIngestJobs().some((job) => job.id === missingJob.id)) {
    throw new Error('Interrupted ingest jobs are not resumable.');
  }
  const failedItemId = db.getKnowledgeIngestJob(missingJob.id)?.knowledgeItemId;
  db.deleteKnowledgeIngestJob(missingJob.id);
  if (db.getKnowledgeIngestJob(missingJob.id)) {
    throw new Error('Deleting an ingest job did not remove the queue entry.');
  }
  if (failedItemId && db.getKnowledgeItem(failedItemId)) {
    throw new Error('Deleting an ingest job did not remove its knowledge item.');
  }

  db.updateNodeLayout({
    canvasSectionId: intro.id,
    nodeId: main.id,
    x: 10,
    y: 20,
    width: 240,
    height: 160
  });
  if (db.listCanvasNodeLayouts(intro.id).length !== 1) {
    throw new Error('Canvas layout was not saved.');
  }

  db.updateNode(intro.id, { title: 'Renamed intro', intent: 'State the problem.' });
  const renamed = db.getSection(intro.id);
  if (renamed?.title !== 'Renamed intro' || renamed.intent !== 'State the problem.') {
    throw new Error('Section update did not persist.');
  }

  db.deleteNode(source.id);
  if (db.listEdges().length !== 0) {
    throw new Error('Deleting content did not clean up edges.');
  }

  db.deleteNode(main.id);
  const afterMainDelete = db.getSection(intro.id);
  if (afterMainDelete?.activeMainNodeId !== null) {
    throw new Error('Deleting active main content did not clear active pointer.');
  }
  if (db.listCanvasNodeLayouts(intro.id).length !== 0) {
    throw new Error('Deleting content did not clean up layouts.');
  }

  db.deleteNode(intro.id);
  if (db.getNode(intro.id)) {
    throw new Error('Deleted section is still listed.');
  }

  const first = db.createNode({ kind: 'section', parentId: rootId, title: 'First', intent: '' });
  const second = db.createNode({ kind: 'section', parentId: rootId, title: 'Second', intent: '' });
  if (first.kind !== 'section' || second.kind !== 'section') {
    throw new Error('Ordering smoke sections were not created.');
  }
  const firstText = db.createNode({
    kind: 'content',
    parentId: first.id,
    title: 'First main',
    content: 'FIRST',
    isMain: true
  });
  const secondText = db.createNode({
    kind: 'content',
    parentId: second.id,
    title: 'Second main',
    content: 'SECOND',
    isMain: true
  });
  if (firstText.kind !== 'content' || secondText.kind !== 'content') {
    throw new Error('Ordering smoke content records were not created.');
  }
  db.setActiveMainNode(first.id, firstText.id);
  db.setActiveMainNode(second.id, secondText.id);
  db.moveNode(second.id, rootId, 0);
  const reorderedPath = exportLatex(db, rootId);
  const reorderedOutput = readFileSync(reorderedPath, 'utf8');
  if (reorderedOutput.indexOf('SECOND') > reorderedOutput.indexOf('FIRST')) {
    throw new Error('moveNode did not update export order.');
  }

  db.close();
  console.log('electron-smoke ok');
} finally {
  rmSync(workspacePath, { recursive: true, force: true });
}

function createSamplePdf(text) {
  const escapedText = text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n'
  ];
  const stream = `BT /F1 24 Tf 72 720 Td (${escapedText}) Tj ET`;
  objects.push(`5 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`);

  let output = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(output.length);
    output += object;
  }
  const xrefOffset = output.length;
  output += `xref\n0 ${objects.length + 1}\n`;
  output += '0000000000 65535 f \n';
  for (const offset of offsets.slice(1)) {
    output += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return output;
}

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

function createStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const [name, value] of Object.entries(entries)) {
    const nameBuffer = Buffer.from(name);
    const data = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt32LE(0, 10);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuffer, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt32LE(0, 12);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuffer);

    offset += localHeader.length + nameBuffer.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const centralOffset = offset;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}
