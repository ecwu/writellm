import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { KnowledgeIngestJobRecord, KnowledgeSettings, ModelEndpointSettings } from '../shared/types.js';
import { nowIso } from './ids.js';
import { extractAndStoreKnowledgeItemDisplayMetadata, indexKnowledgeItem } from './knowledgeIndex.js';
import { extractKnowledgeFileText } from './knowledgeTextExtract.js';
import { extractPdfWithMineru } from './mineru.js';
import type { WriteLLMDatabase } from './database.js';

const SUPPORTED_FILE_EXTENSIONS = new Set(['.txt', '.md', '.pdf']);

let notifyUpdate: () => void = () => {};

export function setKnowledgeIngestUpdateNotifier(notifier: () => void): void {
  notifyUpdate = notifier;
}

export async function enqueueKnowledgeFiles(
  db: WriteLLMDatabase,
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
  db: WriteLLMDatabase,
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
    const existingItem = itemId ? db.getKnowledgeItem(itemId) : null;
    const item = existingItem
      ? db.updateKnowledgeItem(existingItem.id, {
          title: job.fileName,
          sourceType: 'file',
          metadata: mergeKnowledgeFileMetadata(baseMetadata, existingItem.metadata, {})
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
      metadata: mergeKnowledgeFileMetadata(baseMetadata, latestItem?.metadata ?? {}, extraction.metadata)
    });

    await extractAndStoreKnowledgeItemDisplayMetadata(db, item.id, resolvedMetadataSettings, {
      replaceExisting: false,
      source: job.fileExt === '.pdf' ? 'pdfjs-file-sample' : 'file-sample'
    });
    notifyKnowledgeIngestUpdated();

    phase = 'indexing';
    job = db.updateKnowledgeIngestJob(job.id, { status: 'indexing' });
    notifyKnowledgeIngestUpdated();
    if (!db.getKnowledgeIngestJob(job.id)) {
      throw new Error(`Knowledge ingest job was deleted: ${job.id}`);
    }

    await indexItem(
      db,
      item.id,
      resolvedEmbeddingSettings,
      resolvedMetadataSettings,
      resolvedKnowledgeSettings?.retrieval
    );
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

async function extractKnowledgeFileContent(
  db: WriteLLMDatabase,
  job: NonNullable<ReturnType<WriteLLMDatabase['getKnowledgeIngestJob']>>,
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

function mergeKnowledgeFileMetadata(
  baseMetadata: Record<string, unknown>,
  existingMetadata: Record<string, unknown>,
  extractionMetadata: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...baseMetadata,
    ...existingMetadata,
    ...removeKnowledgeDisplayMetadata(extractionMetadata)
  };
}

function removeKnowledgeDisplayMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const {
    knowledgeDisplayMetadata: _knowledgeDisplayMetadata,
    knowledgeDisplayMetadataError: _knowledgeDisplayMetadataError,
    ...rest
  } = metadata;
  return rest;
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

function notifyKnowledgeIngestUpdated(): void {
  notifyUpdate();
}
