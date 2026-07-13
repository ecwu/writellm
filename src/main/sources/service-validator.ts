import type { ServiceProvider, SourceError, SourceErrorCode } from '../../shared/sources.js';

const ENDPOINTS: Record<ServiceProvider, string> = {
  mineru: 'https://mineru.net/api/v4/file-urls/batch',
  siliconflow: 'https://api.siliconflow.cn/v1/models',
};

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
        Authorization: `Bearer ${credential}`,
        ...(provider === 'mineru' ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(provider === 'mineru' ? { body: JSON.stringify({ files: [] }) } : {}),
      signal,
    });
  } catch {
    throw temporary(provider);
  }
  if (!response.ok) throw classify(provider, response.status);
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
