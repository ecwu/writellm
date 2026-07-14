export const EMBEDDING_MAX_BATCH_SIZE = 16;
export const EMBEDDING_MAX_BATCH_BYTES = 256 * 1024;
export const EMBEDDING_MAX_INPUT_TOKENS = 8192;
export const EMBEDDING_MAX_INPUT_BYTES = EMBEDDING_MAX_INPUT_TOKENS * 2;

export function estimateEmbeddingTokens(value: string): number {
  return Math.ceil(Buffer.byteLength(value) / 2);
}

export function isValidEmbeddingText(value: string): boolean {
  return Boolean(value.trim()) && estimateEmbeddingTokens(value) <= EMBEDDING_MAX_INPUT_TOKENS;
}
