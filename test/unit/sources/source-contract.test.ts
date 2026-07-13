import { describe, expect, test } from 'bun:test';
import {
  parseCancelImportRequest,
  parseListSourcesRequest,
  parseRemoveSourceRequest,
  parseSaveServiceCredentialInput,
  parseSourceEvent,
  redactSourceError,
  sourceChannels,
  sourceServiceChannels,
} from '../../../src/shared/sources';
import { sourceEventFixture } from '../../fixtures/sources/source-fixtures';

describe('source contracts', () => {
  test('freezes the exact source and service channel inventories', () => {
    expect(Object.keys(sourceChannels)).toHaveLength(6);
    expect(Object.keys(sourceServiceChannels)).toHaveLength(7);
    expect(new Set(Object.values(sourceChannels)).size).toBe(6);
    expect(new Set(Object.values(sourceServiceChannels)).size).toBe(7);
  });

  test('rejects unknown fields and enforces DTO bounds', () => {
    expect(parseListSourcesRequest({ limit: 100 })).toEqual({ limit: 100 });
    expect(parseListSourcesRequest({ limit: 101 })).toMatchObject({ code: 'SOURCE_INVALID_INPUT' });
    expect(parseListSourcesRequest({ limit: 10, path: '/secret' })).toMatchObject({
      code: 'SOURCE_INVALID_INPUT',
    });
    expect(
      parseSaveServiceCredentialInput({ expectedRevision: null, credential: ' key ' }),
    ).toEqual({ expectedRevision: null, credential: 'key' });
    expect(
      parseSaveServiceCredentialInput({ expectedRevision: null, credential: '   ' }),
    ).toMatchObject({ code: 'SOURCE_INVALID_INPUT' });
  });

  test('keeps cancellation and durable removal discriminated', () => {
    expect(
      parseCancelImportRequest({
        target: 'candidate',
        candidateId: 'candidate-1',
        expectedCatalogRevision: 1,
      }),
    ).toEqual({ target: 'candidate', candidateId: 'candidate-1', expectedCatalogRevision: 1 });
    expect(
      parseRemoveSourceRequest({
        target: 'source',
        sourceId: 'source-1',
        expectedSourceRevision: 1,
      }),
    ).toEqual({ target: 'source', sourceId: 'source-1', expectedSourceRevision: 1 });
    const confirmationToken = `${'a'.repeat(180)}.${'b'.repeat(43)}`;
    expect(
      parseRemoveSourceRequest({
        target: 'source',
        sourceId: 'source-1',
        expectedSourceRevision: 1,
        confirmationToken,
      }),
    ).toEqual({
      target: 'source',
      sourceId: 'source-1',
      expectedSourceRevision: 1,
      confirmationToken,
    });
    expect(
      parseRemoveSourceRequest({
        target: 'source',
        sourceId: 'source-1',
        expectedSourceRevision: 1,
        confirmationToken: 'a'.repeat(1025),
      }),
    ).toMatchObject({ code: 'SOURCE_INVALID_INPUT' });
    expect(
      parseRemoveSourceRequest({
        target: 'candidate',
        sourceId: 'source-1',
        expectedSourceRevision: 1,
      }),
    ).toMatchObject({ code: 'SOURCE_INVALID_INPUT' });
  });

  test('validates event envelopes and redacts arbitrary provider detail', () => {
    expect(parseSourceEvent(sourceEventFixture())).toMatchObject({
      sequence: 1,
      type: 'source-upserted',
    });
    expect(parseSourceEvent({ ...sourceEventFixture(), sequence: -1 })).toBeNull();
    expect(
      parseSourceEvent({
        ...sourceEventFixture(),
        source: { ...sourceEventFixture().source, remoteBatchId: 'remote-secret' },
      }),
    ).toBeNull();
    expect(
      parseSourceEvent({
        ...sourceEventFixture(),
        source: {
          ...sourceEventFixture().source,
          progress: { completed: 2, total: 1, stage: 'parsing' },
        },
      }),
    ).toBeNull();
    expect(
      parseSourceEvent({ sequence: 1, catalogRevision: 1, type: 'resync-required', source: {} }),
    ).toBeNull();
    const error = redactSourceError(
      new Error('token-sentinel /Users/private remote-42'),
      'SOURCE_INTERNAL',
    );
    expect(error).toEqual({
      code: 'SOURCE_INTERNAL',
      messageKey: 'sources.error.internal',
      retryable: false,
    });
    expect(JSON.stringify(error)).not.toContain('sentinel');
  });
});
