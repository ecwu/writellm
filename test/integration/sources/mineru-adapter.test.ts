import { expect, test } from 'bun:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MinerUAdapter } from '../../../src/main/sources/mineru-adapter';
import { fiveHundredBlockPdfFixture, validPdfFixture } from '../../fixtures/sources/pdf-fixtures';

test('performs signed submit, PUT, poll and immediate download without leaking credential', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mineru-'));
  const pdf = path.join(root, 'source.pdf');
  await writeFile(pdf, validPdfFixture());
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fake = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes('/file-urls/batch'))
      return Response.json({
        code: 0,
        data: { batch_id: 'remote-id', file_urls: ['https://upload.test/signed'] },
      });
    if (url.includes('upload.test')) return new Response('', { status: 200 });
    if (url.includes('extract-results'))
      return Response.json({
        code: 0,
        data: {
          batch_id: 'remote-id',
          extract_result: [{ state: 'done', full_zip_url: 'https://download.test/result.zip' }],
        },
      });
    return new Response('zip', { status: 200 });
  };
  const adapter = new MinerUAdapter(async () => 'credential-sentinel', fake as typeof fetch);
  let allocated = '';
  const uploadProgress: Array<[number, number]> = [];
  const submitted = await adapter.submitLocalPdf({
    jobId: 'j',
    dataId: 'd',
    absolutePath: pdf,
    modelVersion: 'vlm',
    ocr: true,
    tables: true,
    formulas: true,
    signal: new AbortController().signal,
    onBatchAllocated: async (remoteBatchId) => {
      allocated = remoteBatchId;
      expect(calls).toHaveLength(1);
    },
    onUploadProgress: (completed, total) => void uploadProgress.push([completed, total]),
  });
  expect(submitted.remoteBatchId).toBe('remote-id');
  expect(allocated).toBe('remote-id');
  expect(uploadProgress).toEqual([
    [0, validPdfFixture().byteLength],
    [validPdfFixture().byteLength, validPdfFixture().byteLength],
  ]);
  expect(calls[0]?.url).toContain('enable_table=true');
  expect(calls[0]?.url).toContain('enable_formula=true');
  expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
    files: [{ name: 'source.pdf', data_id: 'd', is_ocr: true }],
    model_version: 'vlm',
  });
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

test('submits and polls the documented URL task API', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const adapter = new MinerUAdapter(
    async () => ' token = "Bearer credential- sentinel"; ',
    async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (init?.method === 'POST')
        return Response.json({ code: 0, data: { task_id: 'task-id' }, msg: 'ok' });
      return Response.json({
        code: 0,
        data: {
          task_id: 'task-id',
          state: 'running',
          extract_progress: { extracted_pages: 1, total_pages: 2 },
        },
        msg: 'ok',
      });
    },
  );
  const submitted = await adapter.submitRemoteFile({
    url: 'https://cdn-mineru.openxlab.org.cn/demo/example.pdf',
    dataId: 'source:version',
    modelVersion: 'vlm',
    ocr: true,
    tables: true,
    formulas: true,
    signal: new AbortController().signal,
  });
  expect(submitted).toEqual({ remoteTaskId: 'task-id' });
  expect(calls[0]?.url).toBe('https://mineru.net/api/v4/extract/task');
  expect(new Headers(calls[0]?.init?.headers).get('authorization')).toBe(
    'Bearer credential-sentinel',
  );
  expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
    url: 'https://cdn-mineru.openxlab.org.cn/demo/example.pdf',
    model_version: 'vlm',
    is_ocr: true,
    enable_table: true,
    enable_formula: true,
    data_id: 'source_version',
  });
  await expect(
    adapter.pollTask({
      remoteTaskId: submitted.remoteTaskId,
      signal: new AbortController().signal,
    }),
  ).resolves.toEqual({ state: 'running', progress: 50 });
  expect(calls[1]?.url).toBe('https://mineru.net/api/v4/extract/task/task-id');
  expect(JSON.stringify(calls.map((call) => call.url))).not.toContain('credential-sentinel');
});

test('recognizes every documented non-terminal batch state', async () => {
  const states = ['waiting-file', 'pending', 'converting'] as const;
  for (const state of states) {
    const adapter = new MinerUAdapter(
      async () => 'secret',
      async () =>
        Response.json({
          code: 0,
          data: { batch_id: 'remote-id', extract_result: [{ state }] },
        }),
    );
    await expect(
      adapter.poll({ remoteBatchId: 'remote-id', signal: new AbortController().signal }),
    ).resolves.toEqual({ state: 'pending', providerState: state, progress: 0 });
  }
});

test('checks MinerU business success and separates signed transport failures from auth', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mineru-stages-'));
  const pdf = path.join(root, 'source.pdf');
  await writeFile(pdf, validPdfFixture());
  const rejected = new MinerUAdapter(
    async () => 'secret',
    async () => Response.json({ code: 1001, msg: 'provider detail' }),
  );
  await expect(
    rejected.submitLocalPdf({
      jobId: 'j',
      dataId: 'd',
      absolutePath: pdf,
      modelVersion: 'vlm',
      ocr: true,
      tables: true,
      formulas: true,
      signal: new AbortController().signal,
    }),
  ).rejects.toMatchObject({
    code: 'SOURCE_MINERU_REJECTED',
    phase: 'submit',
    referenceCode: '1001',
  });

  const uploadRejected = new MinerUAdapter(
    async () => 'secret',
    async (url) =>
      String(url).includes('upload.test')
        ? Response.json({ code: 1002, msg: 'signed upload expired' }, { status: 403 })
        : Response.json({
            code: 0,
            data: { batch_id: 'remote-id', file_urls: ['https://upload.test/signed'] },
          }),
  );
  await expect(
    uploadRejected.submitLocalPdf({
      jobId: 'j',
      dataId: 'd',
      absolutePath: pdf,
      modelVersion: 'vlm',
      ocr: true,
      tables: true,
      formulas: true,
      signal: new AbortController().signal,
    }),
  ).rejects.toMatchObject({
    code: 'SOURCE_MINERU_TEMPORARY',
    retryable: true,
    phase: 'upload',
    referenceCode: '1002',
  });

  const xmlUploadRejected = new MinerUAdapter(
    async () => 'secret',
    async (url) =>
      String(url).includes('upload.test')
        ? new Response(
            '<?xml version="1.0"?><Error><Code>SignatureDoesNotMatch</Code></Error>',
            { status: 403 },
          )
        : Response.json({
            code: 0,
            data: { batch_id: 'remote-id', file_urls: ['https://upload.test/signed'] },
          }),
  );
  await expect(
    xmlUploadRejected.submitLocalPdf({
      jobId: 'j',
      dataId: 'd',
      absolutePath: pdf,
      modelVersion: 'vlm',
      ocr: true,
      tables: true,
      formulas: true,
      signal: new AbortController().signal,
    }),
  ).rejects.toMatchObject({
    code: 'SOURCE_MINERU_TEMPORARY',
    retryable: true,
    phase: 'upload',
    referenceCode: 'SignatureDoesNotMatch',
  });
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
  ).rejects.toMatchObject({
    code: 'SOURCE_MINERU_RATE_LIMITED',
    retryable: true,
    retryAfter: '2',
    phase: 'poll',
  });
});
