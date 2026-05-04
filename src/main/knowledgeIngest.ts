import { readFile, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { TextItem, TextMarkedContent } from 'pdfjs-dist/types/src/display/api.js';
import type { KnowledgeIngestJobRecord, KnowledgeSettings, ModelEndpointSettings } from '../shared/types.js';
import { nowIso } from './ids.js';
import { extractAndStoreKnowledgeDisplayMetadata, indexKnowledgeItem } from './knowledgeIndex.js';
import { extractPdfWithMineru } from './mineru.js';
import type { PaperLabDatabase } from './database.js';

const SUPPORTED_FILE_EXTENSIONS = new Set(['.txt', '.md', '.pdf']);
const KNOWLEDGE_METADATA_SAMPLE_CHARS = 1000;
const require = createRequire(import.meta.url);
const PDFJS_ROOT = path.dirname(require.resolve('pdfjs-dist/package.json'));
const STANDARD_FONT_DATA_URL = `${path.join(PDFJS_ROOT, 'standard_fonts')}${path.sep}`;

let notifyUpdate: () => void = () => {};

export function setKnowledgeIngestUpdateNotifier(notifier: () => void): void {
  notifyUpdate = notifier;
}

export async function enqueueKnowledgeFiles(
  db: PaperLabDatabase,
  filePaths: string[],
  knowledgeSettings?: KnowledgeSettings
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
      fileSize: fileStat.size,
      metadata: createIngestJobMetadata(fileExt, knowledgeSettings)
    });
  }
}

export async function processKnowledgeIngestJob(
  db: PaperLabDatabase,
  jobId: string,
  embeddingSettings?: ModelEndpointSettings,
  indexItem: typeof indexKnowledgeItem = indexKnowledgeItem,
  knowledgeSettings?: KnowledgeSettings,
  metadataSettings?: ModelEndpointSettings
): Promise<KnowledgeIngestJobRecord> {
  let job = db.getKnowledgeIngestJob(jobId);
  if (!job) {
    throw new Error(`Knowledge ingest job not found: ${jobId}`);
  }
  const currentSettings = (embeddingSettings && metadataSettings && (knowledgeSettings || jobDoesNotNeedMineru(job)))
    ? null
    : (await import('./llmSettings.js')).readLlmSettings();
  const resolvedEmbeddingSettings = embeddingSettings ?? currentSettings!.embedding;
  const resolvedMetadataSettings = metadataSettings ?? currentSettings?.chat;
  const resolvedKnowledgeSettings = knowledgeSettings ?? currentSettings?.knowledge;

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
      throw new Error(`Knowledge ingest job was deleted: ${job.id}`);
    }

    const baseMetadata: Record<string, unknown> = {
      sourcePath: job.filePath,
      fileName: job.fileName,
      fileExt: job.fileExt,
      fileSize: job.fileSize,
      ingestJobId: job.id,
      extractionEngine: readExtractionEngine(job)
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
    job = db.updateKnowledgeIngestJob(job.id, { knowledgeItemId: item.id });
    notifyKnowledgeIngestUpdated();
    if (!db.getKnowledgeIngestJob(job.id)) {
      throw new Error(`Knowledge ingest job was deleted: ${job.id}`);
    }

    void startKnowledgeMetadataPreview(
      db,
      job,
      item.id,
      resolvedMetadataSettings
    );

    const extraction = await extractKnowledgeFileContent(
      db,
      job,
      item.id,
      resolvedKnowledgeSettings
    );
    const content = extraction.content;
    if (!content.trim()) {
      throw new Error('No extractable text was found in this file.');
    }
    if (!db.getKnowledgeIngestJob(job.id)) {
      throw new Error(`Knowledge ingest job was deleted: ${job.id}`);
    }
    const latestItem = db.getKnowledgeItem(item.id);
    db.updateKnowledgeItem(item.id, {
      title: latestItem?.title ?? job.fileName,
      content,
      sourceType: 'file',
      metadata: {
        ...baseMetadata,
        ...(latestItem?.metadata ?? {}),
        ...extraction.metadata
      }
    });

    phase = 'indexing';
    job = db.updateKnowledgeIngestJob(job.id, { status: 'indexing' });
    notifyKnowledgeIngestUpdated();
    if (!db.getKnowledgeIngestJob(job.id)) {
      throw new Error(`Knowledge ingest job was deleted: ${job.id}`);
    }

    await indexItem(db, item.id, resolvedEmbeddingSettings, resolvedMetadataSettings);
    if (!db.getKnowledgeIngestJob(job.id)) {
      throw new Error(`Knowledge ingest job was deleted: ${job.id}`);
    }
    job = db.updateKnowledgeIngestJob(job.id, {
      status: 'indexed',
      errorMessage: null,
      finishedAt: nowIso()
    });
    notifyKnowledgeIngestUpdated();
    return job;
  } catch (caught) {
    if (!db.getKnowledgeIngestJob(job.id)) {
      throw caught;
    }
    const message = caught instanceof Error ? caught.message : String(caught);
    if (itemId) {
      db.markKnowledgeItemError(itemId, phase === 'extraction' ? 'extractionError' : 'indexError', message);
    }
    job = db.updateKnowledgeIngestJob(job.id, {
      status: 'error',
      errorMessage: message,
      finishedAt: nowIso()
    });
    notifyKnowledgeIngestUpdated();
    return job;
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

async function startKnowledgeMetadataPreview(
  db: PaperLabDatabase,
  job: NonNullable<ReturnType<PaperLabDatabase['getKnowledgeIngestJob']>>,
  itemId: string,
  metadataSettings?: ModelEndpointSettings
): Promise<void> {
  if (!metadataSettings?.apiKey.trim()) {
    return;
  }
  if (job.fileExt !== '.pdf' || readExtractionEngine(job) !== 'mineru') {
    return;
  }

  try {
    const sample = await extractKnowledgeFileTextSample(
      job.filePath,
      job.fileExt,
      KNOWLEDGE_METADATA_SAMPLE_CHARS
    );
    await extractAndStoreKnowledgeDisplayMetadata(db, itemId, metadataSettings, sample, {
      replaceExisting: false,
      source: 'pdfjs-preview'
    });
    notifyKnowledgeIngestUpdated();
  } catch {
    // Preview metadata should never block the primary extraction path.
  }
}

async function extractKnowledgeFileTextSample(
  filePath: string,
  fileExt: string,
  maxChars: number
): Promise<string> {
  if (fileExt === '.txt' || fileExt === '.md') {
    return (await readFile(filePath, 'utf8')).slice(0, maxChars);
  }
  if (fileExt === '.pdf') {
    return extractPdfText(filePath, maxChars);
  }
  throw new Error(`Unsupported knowledge file type: ${fileExt || '(none)'}`);
}

async function extractKnowledgeFileContent(
  db: PaperLabDatabase,
  job: NonNullable<ReturnType<PaperLabDatabase['getKnowledgeIngestJob']>>,
  itemId: string,
  knowledgeSettings?: KnowledgeSettings
): Promise<{ content: string; metadata: Record<string, unknown> }> {
  if (job.fileExt === '.pdf' && readExtractionEngine(job) === 'mineru') {
    const settings = knowledgeSettings ?? (await import('./llmSettings.js')).readLlmSettings().knowledge;
    const result = await extractPdfWithMineru({
      db,
      job,
      itemId,
      settings: applyJobMineruSnapshot(settings, job),
      onUpdate: notifyKnowledgeIngestUpdated
    });
    return result;
  }
  return {
    content: await extractKnowledgeFileText(job.filePath, job.fileExt),
    metadata: {}
  };
}

function createIngestJobMetadata(
  fileExt: string,
  knowledgeSettings?: KnowledgeSettings
): Record<string, unknown> {
  const extractionEngine = fileExt === '.pdf' ? knowledgeSettings?.pdfExtractionEngine ?? 'pdfjs' : 'pdfjs';
  if (extractionEngine !== 'mineru' || !knowledgeSettings) {
    return { extractionEngine };
  }
  return {
    extractionEngine,
    mineru: {
      modelVersion: knowledgeSettings.mineru.modelVersion,
      language: knowledgeSettings.mineru.language,
      isOcr: knowledgeSettings.mineru.isOcr,
      enableTable: knowledgeSettings.mineru.enableTable,
      enableFormula: knowledgeSettings.mineru.enableFormula
    }
  };
}

function readExtractionEngine(job: { metadata: Record<string, unknown> }): 'pdfjs' | 'mineru' {
  return job.metadata.extractionEngine === 'mineru' ? 'mineru' : 'pdfjs';
}

function jobDoesNotNeedMineru(job: { metadata: Record<string, unknown> } | null): boolean {
  return readExtractionEngine(job ?? { metadata: {} }) !== 'mineru';
}

function applyJobMineruSnapshot(settings: KnowledgeSettings, job: { metadata: Record<string, unknown> }): KnowledgeSettings {
  const metadata = job.metadata.mineru;
  if (!metadata || typeof metadata !== 'object') {
    return settings;
  }
  const snapshot = metadata as Record<string, unknown>;
  return {
    ...settings,
    mineru: {
      ...settings.mineru,
      modelVersion: snapshot.modelVersion === 'pipeline' ? 'pipeline' : settings.mineru.modelVersion,
      language: typeof snapshot.language === 'string' && snapshot.language.trim()
        ? snapshot.language
        : settings.mineru.language,
      isOcr: typeof snapshot.isOcr === 'boolean' ? snapshot.isOcr : settings.mineru.isOcr,
      enableTable: typeof snapshot.enableTable === 'boolean' ? snapshot.enableTable : settings.mineru.enableTable,
      enableFormula: typeof snapshot.enableFormula === 'boolean'
        ? snapshot.enableFormula
        : settings.mineru.enableFormula
    }
  };
}

async function extractPdfText(filePath: string, maxChars = Number.POSITIVE_INFINITY): Promise<string> {
  const fileBuffer = await readFile(filePath);
  const document = await getDocument({
    data: new Uint8Array(fileBuffer),
    useWorkerFetch: false,
    useWasm: false,
    standardFontDataUrl: STANDARD_FONT_DATA_URL,
    stopAtErrors: false
  }).promise;
  const pages: string[] = [];
  let collectedChars = 0;

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
        collectedChars += pageText.length + 2;
      }
      if (collectedChars >= maxChars) {
        break;
      }
    }
  } finally {
    await document.destroy();
  }

  return pages.join('\n\n').slice(0, maxChars);
}

function notifyKnowledgeIngestUpdated(): void {
  notifyUpdate();
}
