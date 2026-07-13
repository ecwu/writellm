import { expect, test } from 'bun:test';
import { EmbeddingAdapter } from '../../../src/main/sources/embedding-adapter';
import { SILICONFLOW_MODEL, SILICONFLOW_VECTOR_DIMENSIONS } from '../../../src/shared/sources';

test('uses the fixed endpoint/profile and validates exact indexed 1024-finite vectors', async () => {
  let requestUrl = '',
    requestBody = '';
  const adapter = new EmbeddingAdapter(
    async () => 'secret-sentinel',
    async (input, init) => {
      requestUrl = String(input);
      requestBody = String(init?.body);
      return Response.json({
        data: [{ index: 0, embedding: Array(SILICONFLOW_VECTOR_DIMENSIONS).fill(0.5) }],
      });
    },
  );
  const output = await adapter.embed({
    jobId: 'job',
    model: SILICONFLOW_MODEL,
    texts: [{ chunkId: 'chunk', contentHash: 'hash', text: 'bounded text' }],
    signal: new AbortController().signal,
  });
  expect(requestUrl).toBe('https://api.siliconflow.cn/v1/embeddings');
  expect(requestBody).toContain('"model":"BAAI/bge-m3"');
  expect(requestBody).toContain('"encoding_format":"float"');
  expect(output[0].vector).toBeInstanceOf(Float32Array);
  expect(JSON.stringify({ requestUrl, requestBody })).not.toContain('secret-sentinel');
});

test('rejects bounds, wrong response indices/dimensions and non-finite or zero vectors', async () => {
  const make = (embedding: number[], index = 0) =>
    new EmbeddingAdapter(
      async () => 'secret',
      async () => Response.json({ data: [{ index, embedding }] }),
    );
  await expect(
    make([1]).embed({
      jobId: 'j',
      model: SILICONFLOW_MODEL,
      texts: [{ chunkId: 'c', contentHash: 'h', text: 'x' }],
      signal: new AbortController().signal,
    }),
  ).rejects.toMatchObject({ code: 'SOURCE_INDEX_MALFORMED' });
  await expect(
    make(Array(1024).fill(Number.NaN)).embed({
      jobId: 'j',
      model: SILICONFLOW_MODEL,
      texts: [{ chunkId: 'c', contentHash: 'h', text: 'x' }],
      signal: new AbortController().signal,
    }),
  ).rejects.toMatchObject({ code: 'SOURCE_INDEX_MALFORMED' });
  await expect(
    make(Array(1024).fill(0), 2).embed({
      jobId: 'j',
      model: SILICONFLOW_MODEL,
      texts: [{ chunkId: 'c', contentHash: 'h', text: 'x' }],
      signal: new AbortController().signal,
    }),
  ).rejects.toMatchObject({ code: 'SOURCE_INDEX_MALFORMED' });
  await expect(
    make(Array(1024).fill(1)).embed({
      jobId: 'j',
      model: SILICONFLOW_MODEL,
      texts: Array(17).fill({ chunkId: 'c', contentHash: 'h', text: 'x' }),
      signal: new AbortController().signal,
    }),
  ).rejects.toMatchObject({ code: 'SOURCE_INDEX_FAILED' });
});
