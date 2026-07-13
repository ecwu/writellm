import { describe, expect, test } from 'bun:test';
import {
  createSourceServiceFormState,
  sourceServiceErrorMessage,
  sourceServiceFormReducer,
} from '../../../src/renderer/features/sources/source-service-settings-state';
import { serviceStatusFixture } from '../../fixtures/sources/source-fixtures';

describe('source service settings state', () => {
  test('keeps provider revisions independent and credentials write-only', () => {
    let mineru = sourceServiceFormReducer(createSourceServiceFormState('mineru'), {
      type: 'loaded',
      summary: serviceStatusFixture('mineru'),
    });
    let siliconflow = sourceServiceFormReducer(createSourceServiceFormState('siliconflow'), {
      type: 'loaded',
      summary: serviceStatusFixture('siliconflow', { revision: 'other' }),
    });
    mineru = sourceServiceFormReducer(mineru, { type: 'credential.change', value: 'secret' });
    mineru = sourceServiceFormReducer(mineru, {
      type: 'success',
      summary: serviceStatusFixture('mineru', { revision: 'next' }),
    });
    expect(mineru.credential).toBe('');
    expect(mineru.summary?.revision).toBe('next');
    expect(siliconflow.summary?.revision).toBe('other');
    siliconflow = sourceServiceFormReducer(siliconflow, { type: 'clear' });
    expect(siliconflow.credential).toBe('');
  });

  test('explains safe validation failure categories', () => {
    expect(
      sourceServiceErrorMessage({
        code: 'SOURCE_SILICONFLOW_AUTH',
        messageKey: 'redacted',
        retryable: false,
      }),
    ).toContain('Authentication failed');
    expect(
      sourceServiceErrorMessage({
        code: 'SOURCE_SILICONFLOW_RATE_LIMITED',
        messageKey: 'redacted',
        retryable: true,
      }),
    ).toContain('rate limiting');
    expect(
      sourceServiceErrorMessage({
        code: 'SOURCE_SILICONFLOW_TEMPORARY',
        messageKey: 'redacted',
        retryable: true,
      }),
    ).toContain('timed out');
  });
});
