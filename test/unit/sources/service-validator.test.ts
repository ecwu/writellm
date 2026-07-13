import { describe, expect, test } from 'bun:test';
import {
  SourceServiceValidationError,
  validateSourceService,
} from '../../../src/main/sources/service-validator';

const response = (status: number) => new Response(null, { status });

describe('source service validator', () => {
  test('accepts only successful responses and keeps the credential main-only', async () => {
    let authorization = '';
    let requestUrl = '';
    await validateSourceService(
      'siliconflow',
      'secret-sentinel',
      new AbortController().signal,
      (url, init) => {
        requestUrl = url;
        authorization = new Headers(init?.headers).get('authorization') ?? '';
        return Promise.resolve(response(200));
      },
    );
    expect(requestUrl).toBe('https://api.siliconflow.cn/v1/models');
    expect(authorization).toBe('Bearer secret-sentinel');
  });

  test.each([
    [401, 'SOURCE_SILICONFLOW_AUTH', false],
    [403, 'SOURCE_SILICONFLOW_AUTH', false],
    [429, 'SOURCE_SILICONFLOW_RATE_LIMITED', true],
    [500, 'SOURCE_SILICONFLOW_TEMPORARY', true],
    [503, 'SOURCE_SILICONFLOW_TEMPORARY', true],
    [400, 'SOURCE_INDEX_FAILED', false],
    [404, 'SOURCE_INDEX_FAILED', false],
  ] as const)('maps SiliconFlow HTTP %i safely', async (status, code, retryable) => {
    expect(
      validateSourceService('siliconflow', 'secret-sentinel', new AbortController().signal, () =>
        Promise.resolve(response(status)),
      ),
    ).rejects.toMatchObject({ code, retryable });
  });

  test('maps network and timeout failures to a retryable temporary error', async () => {
    const failure = validateSourceService(
      'siliconflow',
      'secret-sentinel',
      new AbortController().signal,
      () => Promise.reject(new Error('raw provider detail')),
    );
    expect(failure).rejects.toEqual(
      new SourceServiceValidationError('SOURCE_SILICONFLOW_TEMPORARY', true),
    );
    expect(JSON.stringify(await failure.catch((error) => error))).not.toContain(
      'raw provider detail',
    );
  });
});
