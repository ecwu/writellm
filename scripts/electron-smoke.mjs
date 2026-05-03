import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
