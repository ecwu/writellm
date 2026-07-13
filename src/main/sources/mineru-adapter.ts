import { readFile, stat, writeFile } from 'node:fs/promises';
import { normalizeBearerToken } from './credential-token.js';
import { SourceJobExecutionError } from './scheduler.js';
import type { SourceHttpRequest } from './service-validator.js';

const API = 'https://mineru.net/api/v4';
const MAX_PDF_BYTES = 200 * 1024 * 1024;
const MAX_PAGES = 200;

export type MinerUObservation =
  | {
      state: 'pending';
      progress: number;
      providerState: 'waiting-file' | 'pending' | 'converting';
    }
  | { state: 'running'; progress: number }
  | { state: 'done'; resultUrl: string }
  | { state: 'failed'; code: string; retryable: boolean };

export type MinerUTransportPhase = 'submit' | 'upload' | 'poll' | 'download';

export class MinerUTransportError extends SourceJobExecutionError {
  constructor(
    code: string,
    retryable: boolean,
    readonly phase: MinerUTransportPhase,
    retryAfter?: string,
    readonly httpStatus?: number,
  ) {
    super(code, retryable, retryAfter);
  }
}

export class MinerUAdapter {
  constructor(
    private credential: () => Promise<string>,
    private request: SourceHttpRequest = fetch,
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
    onBatchAllocated?(remoteBatchId: string): Promise<void>;
  }): Promise<{ remoteBatchId: string }> {
    const info = await stat(input.absolutePath);
    if (!info.isFile() || info.size > MAX_PDF_BYTES)
      throw new SourceJobExecutionError('SOURCE_MINERU_REJECTED', false);
    const bytes = await readFile(input.absolutePath);
    if (countPdfPages(bytes) > MAX_PAGES)
      throw new SourceJobExecutionError('SOURCE_MINERU_REJECTED', false);
    const endpoint = new URL(`${API}/file-urls/batch`);
    endpoint.searchParams.set('enable_table', String(input.tables));
    endpoint.searchParams.set('enable_formula', String(input.formulas));
    const response = await this.call(
      endpoint.toString(),
      {
        method: 'POST',
        headers: await this.headers(true),
        body: JSON.stringify({
          files: [{ name: 'source.pdf', data_id: providerDataId(input.dataId) }],
          model_version: input.modelVersion,
        }),
        signal: input.signal,
      },
      'submit',
    );
    const payload = await successfulPayload(response, 'submit');
    const batchId = nestedString(payload, ['data', 'batch_id']);
    const uploadUrl = nestedString(payload, ['data', 'file_urls', '0']);
    if (!batchId || !uploadUrl)
      throw new MinerUTransportError('SOURCE_MINERU_MALFORMED', false, 'submit');
    await input.onBatchAllocated?.(batchId);
    const uploaded = await this.call(
      uploadUrl,
      {
        method: 'PUT',
        body: bytes,
        signal: input.signal,
      },
      'upload',
      false,
    );
    if (!uploaded.ok) throw classify(uploaded, 'upload');
    return { remoteBatchId: batchId };
  }

  async submitRemoteFile(input: {
    url: string;
    dataId?: string;
    modelVersion: 'vlm';
    ocr: boolean;
    tables: boolean;
    formulas: boolean;
    signal: AbortSignal;
  }): Promise<{ remoteTaskId: string }> {
    if (!input.url.startsWith('https://'))
      throw new MinerUTransportError('SOURCE_MINERU_REJECTED', false, 'submit');
    const response = await this.call(
      `${API}/extract/task`,
      {
        method: 'POST',
        headers: await this.headers(true),
        body: JSON.stringify({
          url: input.url,
          model_version: input.modelVersion,
          is_ocr: input.ocr,
          enable_table: input.tables,
          enable_formula: input.formulas,
          ...(input.dataId ? { data_id: providerDataId(input.dataId) } : {}),
        }),
        signal: input.signal,
      },
      'submit',
    );
    const payload = await successfulPayload(response, 'submit');
    const taskId = nestedString(payload, ['data', 'task_id']);
    if (!taskId) throw new MinerUTransportError('SOURCE_MINERU_MALFORMED', false, 'submit');
    return { remoteTaskId: taskId };
  }

  async poll(input: { remoteBatchId: string; signal: AbortSignal }): Promise<MinerUObservation> {
    const response = await this.call(
      `${API}/extract-results/batch/${encodeURIComponent(input.remoteBatchId)}`,
      {
        method: 'GET',
        headers: await this.headers(false),
        signal: input.signal,
      },
      'poll',
    );
    const payload = await successfulPayload(response, 'poll');
    const result = nestedRecord(payload, ['data', 'extract_result', '0']);
    return observationFromPayload(payload, result);
  }

  async pollTask(input: { remoteTaskId: string; signal: AbortSignal }): Promise<MinerUObservation> {
    const response = await this.call(
      `${API}/extract/task/${encodeURIComponent(input.remoteTaskId)}`,
      {
        method: 'GET',
        headers: await this.headers(false),
        signal: input.signal,
      },
      'poll',
    );
    const payload = await successfulPayload(response, 'poll');
    return observationFromPayload(payload, nestedRecord(payload, ['data']));
  }

  async download(input: {
    resultUrl: string;
    destination: string;
    signal: AbortSignal;
  }): Promise<void> {
    if (!input.resultUrl.startsWith('https://'))
      throw new MinerUTransportError('SOURCE_MINERU_MALFORMED', false, 'download');
    const response = await this.call(
      input.resultUrl,
      { method: 'GET', signal: input.signal },
      'download',
      false,
    );
    if (!response.ok) throw classify(response, 'download');
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > 1024 * 1024 * 1024)
      throw new MinerUTransportError('SOURCE_MINERU_MALFORMED', false, 'download');
    await writeFile(input.destination, new Uint8Array(await response.arrayBuffer()), {
      flag: 'wx',
    });
  }

  private async headers(json: boolean): Promise<Record<string, string>> {
    return {
      Authorization: `Bearer ${normalizeBearerToken(await this.credential())}`,
      ...(json ? { 'Content-Type': 'application/json' } : {}),
    };
  }
  private async call(
    url: string,
    init: RequestInit,
    phase: MinerUTransportPhase,
    requireOk = true,
  ): Promise<Response> {
    let response: Response;
    try {
      response = await this.request(url, init);
    } catch {
      throw new MinerUTransportError('SOURCE_MINERU_TEMPORARY', true, phase);
    }
    if (requireOk && !response.ok) throw classify(response, phase);
    return response;
  }
}

function observationFromPayload(
  payload: unknown,
  result?: Record<string, unknown>,
): MinerUObservation {
  const state = stringValue(result?.state) ?? nestedString(payload, ['data', 'state']);
  if (state === 'waiting-file' || state === 'waiting')
    return { state: 'pending', providerState: 'waiting-file', progress: 0 };
  if (state === 'pending') return { state: 'pending', providerState: 'pending', progress: 0 };
  if (state === 'converting') return { state: 'pending', providerState: 'converting', progress: 0 };
  if (state === 'running' || state === 'processing')
    return {
      state: 'running',
      progress: boundedProgress(
        progressPercent(
          nestedNumber(result, ['extract_progress', 'extracted_pages']),
          nestedNumber(result, ['extract_progress', 'total_pages']),
        ) ?? nestedNumber(payload, ['data', 'progress']),
      ),
    };
  if (state === 'done' || state === 'success') {
    const resultUrl =
      stringValue(result?.full_zip_url) ??
      nestedString(payload, ['data', 'full_zip_url']) ??
      nestedString(payload, ['data', 'result_url']);
    if (!resultUrl) throw new MinerUTransportError('SOURCE_MINERU_MALFORMED', false, 'poll');
    return { state: 'done', resultUrl };
  }
  if (state === 'failed')
    return { state: 'failed', code: 'SOURCE_MINERU_REJECTED', retryable: false };
  throw new MinerUTransportError('SOURCE_MINERU_MALFORMED', false, 'poll');
}

function classify(response: Response, phase: MinerUTransportPhase): MinerUTransportError {
  if (response.status === 401 || response.status === 403) {
    if (phase === 'submit' || phase === 'poll')
      return new MinerUTransportError(
        'SOURCE_MINERU_AUTH',
        false,
        phase,
        undefined,
        response.status,
      );
    return new MinerUTransportError(
      'SOURCE_MINERU_TEMPORARY',
      true,
      phase,
      undefined,
      response.status,
    );
  }
  if (response.status === 429)
    return new MinerUTransportError(
      'SOURCE_MINERU_RATE_LIMITED',
      true,
      phase,
      response.headers.get('retry-after') ?? undefined,
      response.status,
    );
  if (response.status >= 500 || response.status === 408)
    return new MinerUTransportError(
      'SOURCE_MINERU_TEMPORARY',
      true,
      phase,
      undefined,
      response.status,
    );
  return new MinerUTransportError(
    'SOURCE_MINERU_REJECTED',
    false,
    phase,
    undefined,
    response.status,
  );
}
async function successfulPayload(
  response: Response,
  phase: Extract<MinerUTransportPhase, 'submit' | 'poll'>,
): Promise<unknown> {
  const payload = await safeJson(response, phase);
  const code = nestedNumber(payload, ['code']);
  if (code === undefined) throw new MinerUTransportError('SOURCE_MINERU_MALFORMED', false, phase);
  if (code !== 0) throw new MinerUTransportError('SOURCE_MINERU_REJECTED', false, phase);
  return payload;
}
async function safeJson(response: Response, phase: MinerUTransportPhase): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new MinerUTransportError('SOURCE_MINERU_MALFORMED', false, phase);
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
function nestedRecord(value: unknown, parts: string[]): Record<string, unknown> | undefined {
  let current: unknown = value;
  for (const part of parts) {
    if (Array.isArray(current)) current = current[Number(part)];
    else if (typeof current === 'object' && current !== null)
      current = (current as Record<string, unknown>)[part];
    else return undefined;
  }
  return typeof current === 'object' && current !== null && !Array.isArray(current)
    ? (current as Record<string, unknown>)
    : undefined;
}
function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
function progressPercent(completed?: number, total?: number): number | undefined {
  if (completed === undefined || total === undefined || total <= 0) return undefined;
  return (completed / total) * 100;
}
function boundedProgress(value?: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(100, value))
    : 0;
}
function providerDataId(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 128);
}
function countPdfPages(bytes: Uint8Array): number {
  return (
    Buffer.from(bytes)
      .toString('latin1')
      .match(/\/Type\s*\/Page\b/g) ?? []
  ).length;
}
