import { readFile, stat, writeFile } from 'node:fs/promises';
import { SourceJobExecutionError } from './scheduler.js';

const API = 'https://mineru.net/api/v4';
const MAX_PDF_BYTES = 200 * 1024 * 1024;
const MAX_PAGES = 200;

export type MinerUObservation =
  | { state: 'pending' | 'running'; progress: number }
  | { state: 'done'; resultUrl: string }
  | { state: 'failed'; code: string; retryable: boolean };

export class MinerUAdapter {
  constructor(
    private credential: () => Promise<string>,
    private request: typeof fetch = fetch,
  ) {}

  async submitLocalPdf(input: {
    jobId: string;
    dataId: string;
    absolutePath: string;
    modelVersion: 'vlm';
    ocr: true;
    tables: true;
    formulas: true;
    signal: AbortSignal;
  }): Promise<{ remoteBatchId: string }> {
    const info = await stat(input.absolutePath);
    if (!info.isFile() || info.size > MAX_PDF_BYTES)
      throw new SourceJobExecutionError('SOURCE_MINERU_REJECTED', false);
    const bytes = await readFile(input.absolutePath);
    if (countPdfPages(bytes) > MAX_PAGES)
      throw new SourceJobExecutionError('SOURCE_MINERU_REJECTED', false);
    const response = await this.call(`${API}/file-urls/batch`, {
      method: 'POST',
      headers: await this.headers(true),
      body: JSON.stringify({
        files: [{ name: 'source.pdf', data_id: input.dataId }],
        model_version: 'vlm',
        is_ocr: true,
        enable_table: true,
        enable_formula: true,
      }),
      signal: input.signal,
    });
    const payload = await safeJson(response);
    const batchId = nestedString(payload, ['data', 'batch_id']);
    const uploadUrl = nestedString(payload, ['data', 'file_urls', '0']);
    if (!batchId || !uploadUrl) throw new SourceJobExecutionError('SOURCE_MINERU_MALFORMED', false);
    const uploaded = await this.call(
      uploadUrl,
      {
        method: 'PUT',
        body: bytes,
        headers: { 'Content-Type': 'application/pdf' },
        signal: input.signal,
      },
      false,
    );
    if (!uploaded.ok) throw classify(uploaded);
    return { remoteBatchId: batchId };
  }

  async poll(input: { remoteBatchId: string; signal: AbortSignal }): Promise<MinerUObservation> {
    const response = await this.call(
      `${API}/extract-results/batch/${encodeURIComponent(input.remoteBatchId)}`,
      {
        method: 'GET',
        headers: await this.headers(false),
        signal: input.signal,
      },
    );
    const payload = await safeJson(response);
    const state =
      nestedString(payload, ['data', 'state']) ??
      nestedString(payload, ['data', 'extract_result', 'state']);
    if (state === 'waiting' || state === 'pending') return { state: 'pending', progress: 0 };
    if (state === 'running' || state === 'processing')
      return {
        state: 'running',
        progress: boundedProgress(nestedNumber(payload, ['data', 'progress'])),
      };
    if (state === 'done' || state === 'success') {
      const resultUrl =
        nestedString(payload, ['data', 'full_zip_url']) ??
        nestedString(payload, ['data', 'result_url']);
      if (!resultUrl) throw new SourceJobExecutionError('SOURCE_MINERU_MALFORMED', false);
      return { state: 'done', resultUrl };
    }
    if (state === 'failed')
      return { state: 'failed', code: 'SOURCE_MINERU_REJECTED', retryable: false };
    throw new SourceJobExecutionError('SOURCE_MINERU_MALFORMED', false);
  }

  async download(input: {
    resultUrl: string;
    destination: string;
    signal: AbortSignal;
  }): Promise<void> {
    if (!input.resultUrl.startsWith('https://'))
      throw new SourceJobExecutionError('SOURCE_MINERU_MALFORMED', false);
    const response = await this.call(
      input.resultUrl,
      { method: 'GET', signal: input.signal },
      false,
    );
    if (!response.ok) throw classify(response);
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > 1024 * 1024 * 1024)
      throw new SourceJobExecutionError('SOURCE_MINERU_MALFORMED', false);
    await writeFile(input.destination, new Uint8Array(await response.arrayBuffer()), {
      flag: 'wx',
    });
  }

  private async headers(json: boolean): Promise<Record<string, string>> {
    return {
      Authorization: `Bearer ${await this.credential()}`,
      ...(json ? { 'Content-Type': 'application/json' } : {}),
    };
  }
  private async call(url: string, init: RequestInit, requireOk = true): Promise<Response> {
    let response: Response;
    try {
      response = await this.request(url, init);
    } catch {
      if (init.signal?.aborted) throw new SourceJobExecutionError('SOURCE_MINERU_TEMPORARY', true);
      throw new SourceJobExecutionError('SOURCE_MINERU_TEMPORARY', true, undefined);
    }
    if (requireOk && !response.ok) throw classify(response);
    return response;
  }
}

function classify(response: Response): SourceJobExecutionError {
  if (response.status === 401 || response.status === 403)
    return new SourceJobExecutionError('SOURCE_MINERU_AUTH', false);
  if (response.status === 429)
    return new SourceJobExecutionError(
      'SOURCE_MINERU_RATE_LIMITED',
      true,
      response.headers.get('retry-after') ?? undefined,
    );
  if (response.status >= 500) return new SourceJobExecutionError('SOURCE_MINERU_TEMPORARY', true);
  return new SourceJobExecutionError('SOURCE_MINERU_REJECTED', false);
}
async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new SourceJobExecutionError('SOURCE_MINERU_MALFORMED', false);
  }
}
function nestedString(value: unknown, parts: string[]): string | undefined {
  let current: unknown = value;
  for (const part of parts) {
    if (Array.isArray(current)) current = current[Number(part)];
    else if (typeof current === 'object' && current !== null)
      current = (current as Record<string, unknown>)[part];
    else return undefined;
  }
  return typeof current === 'string' && current.length > 0 ? current : undefined;
}
function nestedNumber(value: unknown, parts: string[]): number | undefined {
  const found = nestedString(value, parts);
  if (found) return Number(found);
  let current: unknown = value;
  for (const part of parts) {
    if (typeof current === 'object' && current !== null)
      current = (current as Record<string, unknown>)[part];
    else return undefined;
  }
  return typeof current === 'number' ? current : undefined;
}
function boundedProgress(value?: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : 0;
}
function countPdfPages(bytes: Uint8Array): number {
  return (
    Buffer.from(bytes)
      .toString('latin1')
      .match(/\/Type\s*\/Page\b/g) ?? []
  ).length;
}
