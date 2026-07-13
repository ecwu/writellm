import type { ServiceProvider, SourceError, SourceErrorCode } from '../../shared/sources.js';
import { normalizeBearerToken } from './credential-token.js';

const ENDPOINTS: Record<ServiceProvider, string> = {
  mineru: 'https://mineru.net/api/v4/extract/task',
  siliconflow: 'https://api.siliconflow.cn/v1/models',
};
const MINERU_SAMPLE_URL = 'https://cdn-mineru.openxlab.org.cn/demo/example.pdf';

export type SourceHttpRequest = (input: string, init?: RequestInit) => Promise<Response>;

export class SourceServiceValidationError extends Error {
  readonly name = 'SourceServiceValidationError';

  constructor(
    readonly code: SourceErrorCode,
    readonly retryable: boolean,
  ) {
    super(code);
  }

  toSourceError(): SourceError {
    return {
      code: this.code,
      messageKey: `sources.error.${this.code.toLowerCase()}`,
      retryable: this.retryable,
    };
  }
}

export async function validateSourceService(
  provider: ServiceProvider,
  credential: string,
  signal: AbortSignal,
  request: SourceHttpRequest = fetch,
): Promise<void> {
  let response: Response;
  try {
    response = await request(ENDPOINTS[provider], {
      method: provider === 'mineru' ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${normalizeBearerToken(credential)}`,
        ...(provider === 'mineru' ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(provider === 'mineru'
        ? { body: JSON.stringify({ url: MINERU_SAMPLE_URL, model_version: 'vlm' }) }
        : {}),
      signal,
    });
  } catch {
    throw temporary(provider);
  }
  if (!response.ok) throw classify(provider, response.status);
  if (provider === 'mineru') await validateMinerUResponse(response);
}

async function validateMinerUResponse(response: Response): Promise<void> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new SourceServiceValidationError('SOURCE_MINERU_REJECTED', false);
  }
  if (!isRecord(payload)) throw new SourceServiceValidationError('SOURCE_MINERU_REJECTED', false);
  if (payload.code === 'A0202' || payload.code === 'A0211')
    throw new SourceServiceValidationError('SOURCE_MINERU_AUTH', false);
  if (payload.code !== 0 || !isRecord(payload.data) || typeof payload.data.task_id !== 'string')
    throw new SourceServiceValidationError('SOURCE_MINERU_REJECTED', false);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function classify(provider: ServiceProvider, status: number): SourceServiceValidationError {
  if (status === 401 || status === 403)
    return new SourceServiceValidationError(
      provider === 'mineru' ? 'SOURCE_MINERU_AUTH' : 'SOURCE_SILICONFLOW_AUTH',
      false,
    );
  if (status === 429)
    return new SourceServiceValidationError(
      provider === 'mineru' ? 'SOURCE_MINERU_RATE_LIMITED' : 'SOURCE_SILICONFLOW_RATE_LIMITED',
      true,
    );
  if (status >= 500 || status === 408) return temporary(provider);
  return new SourceServiceValidationError(
    provider === 'mineru' ? 'SOURCE_MINERU_REJECTED' : 'SOURCE_INDEX_FAILED',
    false,
  );
}

function temporary(provider: ServiceProvider): SourceServiceValidationError {
  return new SourceServiceValidationError(
    provider === 'mineru' ? 'SOURCE_MINERU_TEMPORARY' : 'SOURCE_SILICONFLOW_TEMPORARY',
    true,
  );
}
