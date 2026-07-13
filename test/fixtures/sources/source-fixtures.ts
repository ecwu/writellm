export const FIXTURE_PROJECT_ID = '00000000-0000-4000-8000-000000000601';
export const FIXTURE_SOURCE_ID = '00000000-0000-4000-8000-000000000602';
export const FIXTURE_VERSION_ID = '00000000-0000-4000-8000-000000000603';
export const FIXTURE_CHUNK_ID = 'chunk-0001';
export const FIXTURE_MEDIA_ID = 'media-0001';

export const sourceFixture = (overrides: Record<string, unknown> = {}) => ({
  sourceId: FIXTURE_SOURCE_ID,
  revision: 1,
  displayName: 'Research paper.pdf',
  sizeBytes: 1024,
  importedAt: '2026-07-13T10:00:00.000Z',
  state: 'queued' as const,
  progress: { completed: 0, total: 1, stage: 'queued' as const },
  eligibility: { indexed: 0, eligible: 0, failed: 0 },
  retrying: false,
  retryable: false,
  ...overrides,
});

export const catalogFixture = (overrides: Record<string, unknown> = {}) => ({
  kind: 'writellm.source-catalog' as const,
  schemaVersion: 1 as const,
  projectId: FIXTURE_PROJECT_ID,
  revision: 1,
  sources: [sourceFixture()],
  ...overrides,
});

export const versionFixture = (overrides: Record<string, unknown> = {}) => ({
  kind: 'writellm.source-version' as const,
  schemaVersion: 1 as const,
  projectId: FIXTURE_PROJECT_ID,
  sourceId: FIXTURE_SOURCE_ID,
  sourceVersionId: FIXTURE_VERSION_ID,
  ordinalVersion: 1,
  originalSha256: 'a'.repeat(64),
  parseState: 'complete' as const,
  indexProfileId: 'siliconflow-bge-m3-v1',
  ...overrides,
});

export const blockFixture = (overrides: Record<string, unknown> = {}) => ({
  kind: 'writellm.source-block' as const,
  schemaVersion: 1 as const,
  sourceId: FIXTURE_SOURCE_ID,
  sourceVersionId: FIXTURE_VERSION_ID,
  chunkId: FIXTURE_CHUNK_ID,
  ordinal: 0,
  blockType: 'paragraph' as const,
  markdown: 'A deterministic paragraph.',
  plainText: 'A deterministic paragraph.',
  contentHash: 'b'.repeat(64),
  mediaIds: [] as string[],
  mineruMetadata: { page: 1 },
  structurallyValid: true,
  eligible: true,
  ...overrides,
});

export const mediaFixture = (overrides: Record<string, unknown> = {}) => ({
  kind: 'writellm.source-media' as const,
  schemaVersion: 1 as const,
  mediaId: FIXTURE_MEDIA_ID,
  mimeType: 'image/png' as const,
  extension: 'png' as const,
  sha256: 'c'.repeat(64),
  sizeBytes: 68,
  alt: 'A chart',
  ...overrides,
});

export const jobFixture = (overrides: Record<string, unknown> = {}) => ({
  kind: 'writellm.source-job' as const,
  schemaVersion: 1 as const,
  jobId: '00000000-0000-4000-8000-000000000604',
  projectId: FIXTURE_PROJECT_ID,
  sourceId: FIXTURE_SOURCE_ID,
  sourceVersionId: FIXTURE_VERSION_ID,
  type: 'parse' as const,
  state: 'queued' as const,
  attempt: 0,
  idempotencyKey: `${FIXTURE_SOURCE_ID}:${FIXTURE_VERSION_ID}:parse`,
  createdAt: '2026-07-13T10:00:00.000Z',
  updatedAt: '2026-07-13T10:00:00.000Z',
  ...overrides,
});

export const serviceStatusFixture = (provider: 'mineru' | 'siliconflow', overrides = {}) => ({
  provider,
  revision: 'service-revision-1',
  configured: true,
  available: true,
  validation: { status: 'succeeded' as const, completedAt: '2026-07-13T10:00:00.000Z' },
  ...overrides,
});

export const sourceEventFixture = (overrides: Record<string, unknown> = {}) => ({
  sequence: 1,
  catalogRevision: 1,
  type: 'source-upserted' as const,
  source: sourceFixture(),
  ...overrides,
});
