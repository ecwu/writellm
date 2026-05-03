import { readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { TextItem, TextMarkedContent } from 'pdfjs-dist/types/src/display/api.js';
import type { ModelEndpointSettings } from '../shared/types.js';
import { nowIso } from './ids.js';
import { indexKnowledgeItem } from './knowledgeIndex.js';
import type { PaperLabDatabase } from './database.js';

const SUPPORTED_FILE_EXTENSIONS = new Set(['.txt', '.md', '.pdf']);
const require = createRequire(import.meta.url);
const PDFJS_ROOT = path.dirname(require.resolve('pdfjs-dist/package.json'));
const STANDARD_FONT_DATA_URL = `${path.join(PDFJS_ROOT, 'standard_fonts')}${path.sep}`;

let runningWorkspacePath: string | null = null;
let rerunRequested = false;
let notifyUpdate: () => void = () => {};

export function setKnowledgeIngestUpdateNotifier(notifier: () => void): void {
  notifyUpdate = notifier;
}

export async function enqueueKnowledgeFiles(
  db: PaperLabDatabase,
  filePaths: string[]
): Promise<void> {
  for (const filePath of filePaths) {
    const resolvedPath = path.resolve(filePath);
    const fileStat = await stat(resolvedPath);
    if (!fileStat.isFile()) {
      throw new Error(`Knowledge import path is not a file: ${resolvedPath}`);
    }
    const fileExt = path.extname(resolvedPath).toLowerCase();
    if (!SUPPORTED_FILE_EXTENSIONS.has(fileExt)) {
      throw new Error(`Unsupported knowledge file type: ${fileExt || '(none)'}`);
    }
    db.enqueueKnowledgeIngestJob({
      filePath: resolvedPath,
      fileName: path.basename(resolvedPath),
      fileExt,
      fileSize: fileStat.size
    });
  }
}

export function startKnowledgeIngestWorker(db: PaperLabDatabase): void {
  if (runningWorkspacePath === db.workspacePath) {
    rerunRequested = true;
    return;
  }
  runningWorkspacePath = db.workspacePath;
  rerunRequested = false;
  void runKnowledgeIngestWorkerAndMaybeRestart(db);
}

export function stopKnowledgeIngestWorker(): void {
  runningWorkspacePath = null;
  rerunRequested = false;
}

export async function processKnowledgeIngestJob(
  db: PaperLabDatabase,
  jobId: string,
  embeddingSettings?: ModelEndpointSettings,
  indexItem: typeof indexKnowledgeItem = indexKnowledgeItem
): Promise<void> {
  const resolvedEmbeddingSettings = embeddingSettings ?? (await import('./llmSettings.js')).readLlmSettings().embedding;
  let job = db.getKnowledgeIngestJob(jobId);
  if (!job) {
    throw new Error(`Knowledge ingest job not found: ${jobId}`);
  }

  let phase: 'extraction' | 'indexing' = 'extraction';
  let itemId = job.knowledgeItemId;
  try {
    job = db.updateKnowledgeIngestJob(job.id, {
      status: 'extracting',
      errorMessage: null,
      startedAt: job.startedAt ?? nowIso(),
      finishedAt: null
    });
    notifyKnowledgeIngestUpdated();
    if (!db.getKnowledgeIngestJob(job.id)) {
      return;
    }

    const baseMetadata = {
      sourcePath: job.filePath,
      fileName: job.fileName,
      fileExt: job.fileExt,
      fileSize: job.fileSize,
      ingestJobId: job.id
    };
    const item = itemId && db.getKnowledgeItem(itemId)
      ? db.updateKnowledgeItem(itemId, {
          title: job.fileName,
          sourceType: 'file',
          metadata: baseMetadata
        })
      : db.createKnowledgeItem(job.fileName, '', {
          sourceType: 'file',
          metadata: baseMetadata
        });
    itemId = item.id;
    db.updateKnowledgeIngestJob(job.id, { knowledgeItemId: item.id });
    notifyKnowledgeIngestUpdated();
    if (!db.getKnowledgeIngestJob(job.id)) {
      return;
    }

    const content = await extractKnowledgeFileText(job.filePath, job.fileExt);
    if (!content.trim()) {
      throw new Error('No extractable text was found in this file.');
    }
    if (!db.getKnowledgeIngestJob(job.id)) {
      return;
    }
    db.updateKnowledgeItem(item.id, {
      title: job.fileName,
      content,
      sourceType: 'file',
      metadata: baseMetadata
    });

    phase = 'indexing';
    db.updateKnowledgeIngestJob(job.id, { status: 'indexing' });
    notifyKnowledgeIngestUpdated();
    if (!db.getKnowledgeIngestJob(job.id)) {
      return;
    }

    await indexItem(db, item.id, resolvedEmbeddingSettings);
    if (!db.getKnowledgeIngestJob(job.id)) {
      return;
    }
    db.updateKnowledgeIngestJob(job.id, {
      status: 'indexed',
      errorMessage: null,
      finishedAt: nowIso()
    });
    notifyKnowledgeIngestUpdated();
  } catch (caught) {
    if (!db.getKnowledgeIngestJob(job.id)) {
      return;
    }
    const message = caught instanceof Error ? caught.message : String(caught);
    if (itemId) {
      db.markKnowledgeItemError(itemId, phase === 'extraction' ? 'extractionError' : 'indexError', message);
    }
    db.updateKnowledgeIngestJob(job.id, {
      status: 'error',
      errorMessage: message,
      finishedAt: nowIso()
    });
    notifyKnowledgeIngestUpdated();
  }
}

export async function extractKnowledgeFileText(filePath: string, fileExt = path.extname(filePath).toLowerCase()): Promise<string> {
  if (fileExt === '.txt' || fileExt === '.md') {
    return readFile(filePath, 'utf8');
  }
  if (fileExt === '.pdf') {
    return extractPdfText(filePath);
  }
  throw new Error(`Unsupported knowledge file type: ${fileExt || '(none)'}`);
}

async function runKnowledgeIngestWorker(db: PaperLabDatabase): Promise<void> {
  while (runningWorkspacePath === db.workspacePath) {
    const nextJob = db.listRunnableKnowledgeIngestJobs()[0];
    if (!nextJob) {
      return;
    }
    await processKnowledgeIngestJob(db, nextJob.id);
  }
}

async function runKnowledgeIngestWorkerAndMaybeRestart(db: PaperLabDatabase): Promise<void> {
  await runKnowledgeIngestWorker(db);
  if (runningWorkspacePath !== db.workspacePath) {
    return;
  }
  if (rerunRequested) {
    rerunRequested = false;
    await runKnowledgeIngestWorkerAndMaybeRestart(db);
    return;
  }
  runningWorkspacePath = null;
}

async function extractPdfText(filePath: string): Promise<string> {
  const fileBuffer = await readFile(filePath);
  const document = await getDocument({
    data: new Uint8Array(fileBuffer),
    useWorkerFetch: false,
    useWasm: false,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
    stopAtErrors: false
  }).promise;
  const pages: string[] = [];

  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: TextItem | TextMarkedContent) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/[ \t]+/g, ' ')
        .trim();
      if (pageText) {
        pages.push(pageText);
      }
    }
  } finally {
    await document.destroy();
  }

  return pages.join('\n\n');
}

function notifyKnowledgeIngestUpdated(): void {
  notifyUpdate();
}
