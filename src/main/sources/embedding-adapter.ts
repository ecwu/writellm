import {
  SILICONFLOW_INDEX_PROFILE_ID,
  SILICONFLOW_MODEL,
  SILICONFLOW_VECTOR_DIMENSIONS,
} from '../../shared/sources.js';
import { SourceJobExecutionError } from './scheduler.js';

const ENDPOINT = 'https://api.siliconflow.com/v1/embeddings';
export type EmbeddingInput = { chunkId: string; contentHash: string; text: string };
export type EmbeddingOutput = Omit<EmbeddingInput, 'text'> & { vector: Float32Array };

export class EmbeddingAdapter {
  constructor(
    private credential: () => Promise<string>,
    private request: typeof fetch = fetch,
  ) {}
  async describeProfile() {
    return {
      indexProfileId: SILICONFLOW_INDEX_PROFILE_ID,
      provider: 'siliconflow' as const,
      model: SILICONFLOW_MODEL,
      dimensions: SILICONFLOW_VECTOR_DIMENSIONS,
      encoding: 'float32' as const,
    };
  }
  async embed(input: {
    jobId: string;
    model: typeof SILICONFLOW_MODEL;
    texts: EmbeddingInput[];
    signal: AbortSignal;
  }): Promise<EmbeddingOutput[]> {
    if (input.model !== SILICONFLOW_MODEL || input.texts.length < 1 || input.texts.length > 16)
      throw new SourceJobExecutionError('SOURCE_INDEX_FAILED', false);
    const bytes = input.texts.reduce((total, value) => total + Buffer.byteLength(value.text), 0);
    if (
      bytes > 256 * 1024 ||
      input.texts.some((value) => !value.text.trim() || estimateTokens(value.text) > 8192)
    )
      throw new SourceJobExecutionError('SOURCE_INDEX_FAILED', false);
    let response: Response;
    try {
      response = await this.request(ENDPOINT, {
        method: 'POST',
        signal: input.signal,
        headers: {
          Authorization: `Bearer ${await this.credential()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: SILICONFLOW_MODEL,
          encoding_format: 'float',
          input: input.texts.map((value) => value.text),
        }),
      });
    } catch {
      throw new SourceJobExecutionError('SOURCE_SILICONFLOW_TEMPORARY', true);
    }
    if (!response.ok) throw classify(response);
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw malformed();
    }
    if (
      !isRecord(payload) ||
      !Array.isArray(payload.data) ||
      payload.data.length !== input.texts.length
    )
      throw malformed();
    const outputs: EmbeddingOutput[] = [];
    const seen = new Set<number>();
    for (const item of payload.data) {
      if (
        !isRecord(item) ||
        !Number.isSafeInteger(item.index) ||
        seen.has(item.index as number) ||
        (item.index as number) < 0 ||
        (item.index as number) >= input.texts.length ||
        !Array.isArray(item.embedding) ||
        item.embedding.length !== SILICONFLOW_VECTOR_DIMENSIONS ||
        !item.embedding.every((value) => typeof value === 'number' && Number.isFinite(value))
      )
        throw malformed();
      const index = item.index as number;
      seen.add(index);
      const vector = Float32Array.from(item.embedding as number[]);
      const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
      if (!Number.isFinite(norm) || norm <= 0) throw malformed();
      outputs.push({
        chunkId: input.texts[index].chunkId,
        contentHash: input.texts[index].contentHash,
        vector,
      });
    }
    outputs.sort(
      (left, right) =>
        input.texts.findIndex((value) => value.chunkId === left.chunkId) -
        input.texts.findIndex((value) => value.chunkId === right.chunkId),
    );
    return outputs;
  }
}

function classify(response: Response): SourceJobExecutionError {
  if (response.status === 401 || response.status === 403)
    return new SourceJobExecutionError('SOURCE_SILICONFLOW_AUTH', false);
  if (response.status === 429)
    return new SourceJobExecutionError(
      'SOURCE_SILICONFLOW_RATE_LIMITED',
      true,
      response.headers.get('retry-after') ?? undefined,
    );
  if (response.status >= 500)
    return new SourceJobExecutionError('SOURCE_SILICONFLOW_TEMPORARY', true);
  return new SourceJobExecutionError('SOURCE_INDEX_FAILED', false);
}
function malformed() {
  return new SourceJobExecutionError('SOURCE_INDEX_MALFORMED', false);
}
function estimateTokens(value: string): number {
  return Math.ceil(new TextEncoder().encode(value).byteLength / 2);
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
