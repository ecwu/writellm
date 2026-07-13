import { expect, test } from 'bun:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MinerUAdapter } from '../../../src/main/sources/mineru-adapter';
import { SourceJobExecutionError } from '../../../src/main/sources/scheduler';
import { fiveHundredBlockPdfFixture, validPdfFixture } from '../../fixtures/sources/pdf-fixtures';

test('performs signed submit, PUT, poll and immediate download without leaking credential', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mineru-'));
  const pdf = path.join(root, 'source.pdf');
  await writeFile(pdf, validPdfFixture());
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fake = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith('/file-urls/batch'))
      return Response.json({
        data: { batch_id: 'remote-id', file_urls: ['https://upload.test/signed'] },
      });
    if (url.includes('upload.test')) return new Response('', { status: 200 });
    if (url.includes('extract-results'))
      return Response.json({
        data: {
          batch_id: 'remote-id',
          extract_result: [{ state: 'done', full_zip_url: 'https://download.test/result.zip' }],
        },
      });
    return new Response('zip', { status: 200 });
  };
  const adapter = new MinerUAdapter(async () => 'credential-sentinel', fake as typeof fetch);
  const submitted = await adapter.submitLocalPdf({
    jobId: 'j',
    dataId: 'd',
    absolutePath: pdf,
    modelVersion: 'vlm',
    ocr: true,
    tables: true,
    formulas: true,
    signal: new AbortController().signal,
  });
  expect(submitted.remoteBatchId).toBe('remote-id');
  expect(calls[1].init?.method).toBe('PUT');
  expect(calls[1].init?.headers).toBeUndefined();
  const observation = await adapter.poll({
    remoteBatchId: submitted.remoteBatchId,
    signal: new AbortController().signal,
  });
  expect(observation).toMatchObject({ state: 'done' });
  const destination = path.join(root, 'result.zip');
  if (observation.state === 'done')
    await adapter.download({
      resultUrl: observation.resultUrl,
      destination,
      signal: new AbortController().signal,
    });
  expect(await readFile(destination, 'utf8')).toBe('zip');
  expect(JSON.stringify(calls.map((call) => call.url))).not.toContain('credential-sentinel');
});

test('reads progress from the documented batch result array', async () => {
  const adapter = new MinerUAdapter(
    async () => 'secret',
    async () =>
      Response.json({
        code: 0,
        data: {
          batch_id: 'remote-id',
          extract_result: [
            {
              state: 'running',
              extract_progress: { extracted_pages: 3, total_pages: 12 },
            },
          ],
        },
      }),
  );
  await expect(
    adapter.poll({ remoteBatchId: 'remote-id', signal: new AbortController().signal }),
  ).resolves.toEqual({ state: 'running', progress: 25 });
});

test('enforces page limits and maps auth, throttling and malformed responses to stable errors', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mineru-'));
  const pdf = path.join(root, 'large.pdf');
  await writeFile(pdf, fiveHundredBlockPdfFixture());
  const adapter = new MinerUAdapter(
    async () => 'secret',
    async () => new Response('', { status: 401 }),
  );
  await expect(
    adapter.submitLocalPdf({
      jobId: 'j',
      dataId: 'd',
      absolutePath: pdf,
      modelVersion: 'vlm',
      ocr: true,
      tables: true,
      formulas: true,
      signal: new AbortController().signal,
    }),
  ).rejects.toMatchObject({ code: 'SOURCE_MINERU_REJECTED', retryable: false });
  const small = path.join(root, 'small.pdf');
  await writeFile(small, validPdfFixture());
  await expect(
    adapter.submitLocalPdf({
      jobId: 'j',
      dataId: 'd',
      absolutePath: small,
      modelVersion: 'vlm',
      ocr: true,
      tables: true,
      formulas: true,
      signal: new AbortController().signal,
    }),
  ).rejects.toMatchObject({ code: 'SOURCE_MINERU_AUTH', retryable: false });
  const throttled = new MinerUAdapter(
    async () => 'secret',
    async () => new Response('', { status: 429, headers: { 'retry-after': '2' } }),
  );
  await expect(
    throttled.poll({ remoteBatchId: 'id', signal: new AbortController().signal }),
  ).rejects.toEqual(new SourceJobExecutionError('SOURCE_MINERU_RATE_LIMITED', true, '2'));
});
