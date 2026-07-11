import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { KnowledgeIngestJobRecord, KnowledgeSettings, MineruSettings } from '../shared/types.js';
import { nowIso } from './ids.js';
import type { WriteLLMDatabase } from './database.js';
import { assertOutboundDataAllowed } from './llmSettings.js';
import { unzipBuffer, type ZipEntry } from './zip.js';

type MineruExtractOptions = {
  db: WriteLLMDatabase;
  job: KnowledgeIngestJobRecord;
  itemId: string;
  settings: KnowledgeSettings;
  onUpdate: () => void;
};

type MineruExtraction = {
  content: string;
  metadata: Record<string, unknown>;
};

type MineruJobMetadata = Record<string, unknown> & {
  extractionEngine?: 'pdfjs' | 'mineru';
  mineru?: Record<string, unknown>;
};

type MineruContentBlock = z.infer<typeof mineruContentBlockSchema>;
type MineruExtractProgress = {
  extractedPages: number | null;
  totalPages: number | null;
  startTime: string | null;
};

const MINERU_API_BASE = 'https://mineru.net/api/v4';
const DEFAULT_POLL_INTERVAL_MS = 2000;
const MAX_POLL_COUNT = 180;
const mineruApiResponseSchema = z.object({
  code: z.number().optional(),
  msg: z.string().optional(),
  message: z.string().optional(),
  data: z.unknown().optional()
}).passthrough();
const mineruContentBlockSchema = z.record(z.string(), z.unknown());
const mineruContentBlocksSchema = z.array(mineruContentBlockSchema);

export async function extractPdfWithMineru(options: MineruExtractOptions): Promise<MineruExtraction> {
  assertOutboundDataAllowed(MINERU_API_BASE, 'pdf');
  const { db, itemId, settings } = options;
  const knowledgeItem = db.getKnowledgeItem(itemId);
  if (!knowledgeItem) {
    throw new Error(`Knowledge item not found: ${itemId}`);
  }
  const mineruSettings = settings.mineru;
  if (!mineruSettings.apiKey.trim()) {
    throw new Error('MinerU API key is required for MinerU PDF extraction.');
  }

  let job = options.job;
  let metadata = readMineruJobMetadata(job);
  if (!metadata.mineru?.batchId) {
    job = await updateJob(options, {
      status: 'uploading',
      metadata: {
        ...metadata,
        extractionEngine: 'mineru',
        mineru: {
          ...(metadata.mineru ?? {}),
          dataId: job.id,
          modelVersion: mineruSettings.modelVersion,
          language: mineruSettings.language,
          requestedAt: nowIso()
        }
      }
    });
    metadata = readMineruJobMetadata(job);
    const upload = await createMineruBatch(job, mineruSettings);
    job = await updateJob(options, {
      metadata: mergeMineruMetadata(metadata, {
        batchId: upload.batchId,
        dataId: job.id,
        uploadUrl: upload.uploadUrl,
        traceIds: upload.traceIds
      })
    });
    metadata = readMineruJobMetadata(job);
  }

  if (!metadata.mineru?.uploadedAt) {
    const uploadUrl = readString(metadata.mineru?.uploadUrl);
    if (!uploadUrl) {
      throw new Error('MinerU upload URL is missing; retry the import task.');
    }
    await uploadToMineru(uploadUrl, await readFile(job.filePath));
    job = await updateJob(options, {
      metadata: mergeMineruMetadata(readMineruJobMetadata(job), {
        uploadedAt: nowIso()
      })
    });
    metadata = readMineruJobMetadata(job);
  }

  const result = await waitForMineruResult(options, job, metadata);
  job = result.job;
  metadata = result.metadata;

  job = await updateJob(options, { status: 'downloading' });
  const zipUrl = readString(metadata.mineru?.fullZipUrl);
  if (!zipUrl) {
    throw new Error('MinerU completed without a full_zip_url.');
  }
  const zipBuffer = await downloadMineruZip(zipUrl);
  const outputDirectory = path.join(db.workspacePath, 'assets', 'knowledge', itemId, 'mineru', job.id);
  const entries = await unzipBuffer(zipBuffer);
  await writeZipEntries(entries, outputDirectory);

  const parsed = parseMineruEntries(entries, db.workspacePath, outputDirectory, itemId, knowledgeItem.publicRef);
  if (!parsed.content.trim()) {
    throw new Error('MinerU did not return extractable text for this PDF.');
  }

  return {
    content: parsed.content,
    metadata: {
      mineru: {
        jobId: job.id,
        dataId: readString(metadata.mineru?.dataId) || job.id,
        batchId: readString(metadata.mineru?.batchId),
        modelVersion: mineruSettings.modelVersion,
        language: mineruSettings.language,
        outputDirectory: toWorkspaceRelativePath(db.workspacePath, outputDirectory),
        markdownPath: parsed.markdownPath,
        contentListPath: parsed.contentListPath,
        fullZipUrl: zipUrl,
        parsedAt: nowIso(),
        images: parsed.images
      }
    }
  };
}

async function updateJob(
  options: MineruExtractOptions,
  payload: Parameters<WriteLLMDatabase['updateKnowledgeIngestJob']>[1]
): Promise<KnowledgeIngestJobRecord> {
  const updated = options.db.updateKnowledgeIngestJob(options.job.id, payload);
  options.onUpdate();
  return updated;
}

async function createMineruBatch(
  job: KnowledgeIngestJobRecord,
  settings: MineruSettings
): Promise<{ batchId: string; uploadUrl: string; traceIds: string[] }> {
  const response = await fetch(`${MINERU_API_BASE}/file-urls/batch`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      enable_formula: settings.enableFormula,
      enable_table: settings.enableTable,
      language: settings.language,
      model_version: settings.modelVersion,
      files: [
        {
          name: job.fileName,
          data_id: job.id,
          is_ocr: settings.isOcr
        }
      ]
    })
  });
  const parsed = await parseJsonResponse(response, 'create MinerU batch');
  const data = asRecord(parsed.data);
  const batchId = readString(data.batch_id) || readString(data.batchId);
  const uploadUrl = readUploadUrl(data);
  if (!batchId || !uploadUrl) {
    throw new Error('MinerU did not return a batch ID and upload URL.');
  }
  return {
    batchId,
    uploadUrl,
    traceIds: readTraceIds(parsed, data)
  };
}

async function uploadToMineru(uploadUrl: string, fileBuffer: Buffer): Promise<void> {
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    body: new Uint8Array(fileBuffer)
  });
  if (!response.ok) {
    throw new Error(`MinerU upload failed: ${response.status} ${response.statusText}`);
  }
}

async function waitForMineruResult(
  options: MineruExtractOptions,
  currentJob: KnowledgeIngestJobRecord,
  currentMetadata: MineruJobMetadata
): Promise<{ job: KnowledgeIngestJobRecord; metadata: MineruJobMetadata }> {
  let job = currentJob;
  let metadata = currentMetadata;
  const batchId = readString(metadata.mineru?.batchId);
  if (!batchId) {
    throw new Error('MinerU batch ID is missing; retry the import task.');
  }

  while (true) {
    const pollCount = Number(metadata.mineru?.pollCount ?? 0) + 1;
    if (pollCount > MAX_POLL_COUNT) {
      throw new Error('MinerU polling timed out before the extraction completed.');
    }

    job = await updateJob(options, {
      status: 'extracting',
      metadata: mergeMineruMetadata(metadata, {
        lastPollAt: nowIso(),
        pollCount
      })
    });
    metadata = readMineruJobMetadata(job);

    const result = await getMineruBatchResult(batchId, job.id, options.settings.mineru.apiKey);
    const progressMetadata = result.extractProgress
      ? {
          extractProgress: result.extractProgress,
          extractedPages: result.extractProgress.extractedPages,
          totalPages: result.extractProgress.totalPages
        }
      : {};
    job = await updateJob(options, {
      metadata: mergeMineruMetadata(metadata, {
        remoteState: result.state,
        progress: result.progress,
        ...progressMetadata,
        fullZipUrl: result.fullZipUrl,
        traceIds: mergeTraceIds(metadata.mineru?.traceIds, result.traceIds)
      })
    });
    metadata = readMineruJobMetadata(job);

    if (result.state === 'failed') {
      throw new Error(result.errorMessage || 'MinerU extraction failed.');
    }
    if (result.state === 'done') {
      if (!result.fullZipUrl) {
        throw new Error('MinerU completed without a full_zip_url.');
      }
      return { job, metadata };
    }

    await sleep(readPollIntervalMs());
  }
}

async function getMineruBatchResult(
  batchId: string,
  dataId: string,
  apiKey: string
): Promise<{
  state: string;
  progress: number | null;
  fullZipUrl: string | null;
  errorMessage: string | null;
  extractProgress: MineruExtractProgress | null;
  traceIds: string[];
}> {
  const response = await fetch(`${MINERU_API_BASE}/extract-results/batch/${encodeURIComponent(batchId)}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`
    }
  });
  const parsed = await parseJsonResponse(response, 'read MinerU batch result');
  const data = asRecord(parsed.data);
  const candidate = findMineruResult(data, dataId);
  const state = readString(candidate.state) || readString(candidate.status) || 'unknown';
  return {
    state,
    progress: readNumber(candidate.progress),
    fullZipUrl: readString(candidate.full_zip_url) || readString(candidate.fullZipUrl),
    errorMessage: readString(candidate.err_msg) || readString(candidate.errorMessage) || readString(candidate.message),
    extractProgress: readExtractProgress(candidate),
    traceIds: readTraceIds(parsed, data)
  };
}

async function downloadMineruZip(zipUrl: string): Promise<Buffer> {
  const response = await fetch(zipUrl);
  if (!response.ok) {
    throw new Error(`MinerU result download failed: ${response.status} ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function writeZipEntries(entries: ZipEntry[], outputDirectory: string): Promise<void> {
  await mkdir(outputDirectory, { recursive: true });
  for (const entry of entries) {
    const targetPath = safeJoin(outputDirectory, entry.path);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, entry.data);
  }
}

function parseMineruEntries(
  entries: ZipEntry[],
  workspacePath: string,
  outputDirectory: string,
  itemId: string,
  itemPublicRef: string
): {
  content: string;
  markdownPath: string | null;
  contentListPath: string | null;
  images: Array<Record<string, unknown>>;
} {
  const contentList = findEntry(entries, /_content_list\.json$/i);
  const markdown = findEntry(entries, /(^|\/)full\.md$/i) ?? findEntry(entries, /\.md$/i);
  const markdownPath = markdown ? toWorkspaceRelativePath(workspacePath, safeJoin(outputDirectory, markdown.path)) : null;
  const contentListPath = contentList ? toWorkspaceRelativePath(workspacePath, safeJoin(outputDirectory, contentList.path)) : null;

  if (contentList) {
    const blocks = parseMineruContentBlocks(contentList.data.toString('utf8'));
    if (blocks) {
      return {
        content: markdown?.data.toString('utf8') ?? blocksToText(blocks),
        markdownPath,
        contentListPath,
        images: imageAssetsFromBlocks(blocks, workspacePath, outputDirectory, itemId, itemPublicRef)
      };
    }
  }

  return {
    content: markdown?.data.toString('utf8') ?? '',
    markdownPath,
    contentListPath,
    images: []
  };
}

function parseMineruContentBlocks(text: string): MineruContentBlock[] | null {
  try {
    const parsed = mineruContentBlocksSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function blocksToText(blocks: MineruContentBlock[]): string {
  return blocks
    .map((block) => blockToText(block))
    .filter((text) => text.trim())
    .join('\n\n')
    .trim();
}

function blockToText(block: MineruContentBlock): string {
  const parts = [
    readString(block.text),
    readString(block.content),
    readString(block.table_body),
    readString(block.tableBody),
    readString(block.latex),
    readString(block.equation),
    textArray(block.texts),
    textArray(block.image_caption),
    textArray(block.image_footnote),
    textArray(block.table_caption),
    textArray(block.table_footnote)
  ].filter(Boolean);
  return parts.join('\n').trim();
}

function imageAssetsFromBlocks(
  blocks: MineruContentBlock[],
  workspacePath: string,
  outputDirectory: string,
  itemId: string,
  itemPublicRef: string
): Array<Record<string, unknown>> {
  const images: Array<Record<string, unknown>> = [];
  blocks.forEach((block, blockIndex) => {
    const imagePath = readString(block.img_path) || readString(block.image_path) || readString(block.path);
    if (!imagePath) {
      return;
    }
    const imageIndex = images.length + 1;
    images.push({
      publicRef: `${itemPublicRef}.i${imageIndex}`,
      sourceItemId: itemId,
      itemPublicRef,
      relativePath: toWorkspaceRelativePath(workspacePath, safeJoin(outputDirectory, imagePath)),
      pageNumber: typeof block.page_idx === 'number' ? block.page_idx + 1 : null,
      blockIndex,
      type: readString(block.type) || 'image',
      bbox: Array.isArray(block.bbox) ? block.bbox : null,
      caption: textArray(block.image_caption),
      footnote: textArray(block.image_footnote)
    });
  });
  return images;
}

async function parseJsonResponse(response: Response, action: string): Promise<Record<string, unknown>> {
  const text = await response.text();
  const parsed = text ? parseMineruJson(text, action) : {};
  if (!response.ok) {
    throw new Error(`MinerU ${action} failed: ${response.status} ${response.statusText}`);
  }
  const code = parsed.code;
  if (typeof code === 'number' && code !== 0) {
    throw new Error(readString(parsed.msg) || readString(parsed.message) || `MinerU ${action} failed with code ${code}.`);
  }
  return parsed;
}

function parseMineruJson(text: string, action: string): Record<string, unknown> {
  try {
    return mineruApiResponseSchema.parse(JSON.parse(text));
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    throw new Error(`MinerU ${action} returned invalid JSON: ${message}`);
  }
}

function findMineruResult(data: Record<string, unknown>, dataId: string): Record<string, unknown> {
  const candidates = [
    data.extract_result,
    data.extractResult,
    data.results,
    data.files,
    data
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      const match = candidate.map(asRecord).find((item) => readString(item.data_id) === dataId || readString(item.dataId) === dataId);
      if (match) {
        return match;
      }
      if (candidate.length === 1) {
        return asRecord(candidate[0]);
      }
    }
  }
  return data;
}

function readUploadUrl(data: Record<string, unknown>): string | null {
  const urls = data.file_urls ?? data.fileUrls ?? data.urls;
  if (Array.isArray(urls)) {
    const first = urls[0];
    if (typeof first === 'string') {
      return first;
    }
    const record = asRecord(first);
    return readString(record.url) || readString(record.upload_url) || readString(record.uploadUrl);
  }
  return readString(data.upload_url) || readString(data.uploadUrl);
}

function readTraceIds(...records: Array<Record<string, unknown>>): string[] {
  return records.flatMap((record) => {
    const value = record.trace_id ?? record.traceId ?? record.trace_ids ?? record.traceIds;
    if (typeof value === 'string') {
      return [value];
    }
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === 'string');
    }
    return [];
  });
}

function mergeTraceIds(current: unknown, next: string[]): string[] {
  const existing = Array.isArray(current) ? current.filter((item): item is string => typeof item === 'string') : [];
  return Array.from(new Set([...existing, ...next]));
}

function readMineruJobMetadata(job: KnowledgeIngestJobRecord): MineruJobMetadata {
  return job.metadata as MineruJobMetadata;
}

function mergeMineruMetadata(metadata: MineruJobMetadata, mineru: Record<string, unknown>): MineruJobMetadata {
  return {
    ...metadata,
    extractionEngine: 'mineru',
    mineru: {
      ...(metadata.mineru ?? {}),
      ...mineru
    }
  };
}

function findEntry(entries: ZipEntry[], pattern: RegExp): ZipEntry | null {
  return entries.find((entry) => pattern.test(entry.path)) ?? null;
}

function safeJoin(root: string, rawPath: string): string {
  const normalized = path.normalize(rawPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const joined = path.resolve(root, normalized);
  if (!joined.startsWith(path.resolve(root) + path.sep) && joined !== path.resolve(root)) {
    throw new Error(`Unsafe zip entry path: ${rawPath}`);
  }
  return joined;
}

function toWorkspaceRelativePath(workspacePath: string, absolutePath: string): string {
  return path.relative(workspacePath, absolutePath).split(path.sep).join('/');
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readExtractProgress(candidate: Record<string, unknown>): MineruExtractProgress | null {
  const progress = asRecord(candidate.extract_progress ?? candidate.extractProgress);
  const extractedPages = readNumber(progress.extracted_pages) ?? readNumber(progress.extractedPages);
  const totalPages = readNumber(progress.total_pages) ?? readNumber(progress.totalPages);
  const startTime = readString(progress.start_time) ?? readString(progress.startTime);
  if (extractedPages === null && totalPages === null && startTime === null) {
    return null;
  }
  return { extractedPages, totalPages, startTime };
}

function textArray(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }
        if (item && typeof item === 'object') {
          const record = item as Record<string, unknown>;
          return readString(record.text) || readString(record.content) || '';
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return readString(value) ?? '';
}

function readPollIntervalMs(): number {
  const parsed = Number(process.env.WRITELLM_MINERU_POLL_INTERVAL_MS);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_POLL_INTERVAL_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
