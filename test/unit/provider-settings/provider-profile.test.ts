import { describe, expect, test } from 'bun:test';
import {
  deriveHarnessProfile,
  parseProviderConfig,
  parseSaveInput,
} from '../../../src/shared/provider-settings';

const config = {
  providerKind: 'openai-compatible' as const,
  baseUrl: 'https://example.com/v1',
  modelId: ' model ',
  contextWindow: 8192,
  maxOutputTokens: 1024,
  reasoning: false,
};
describe('provider profile', () => {
  test('canonicalizes and derives the frozen Pi descriptor', () => {
    const parsed = parseProviderConfig(config);
    expect('code' in parsed).toBe(false);
    if ('code' in parsed) return;
    expect(parsed.baseUrl).toBe('https://example.com/v1/');
    expect(deriveHarnessProfile(parsed)).toMatchObject({
      profileVersion: 1,
      providerId: 'writellm-custom',
      api: 'openai-completions',
      id: 'model',
      input: ['text'],
    });
  });
  test('permits loopback HTTP but rejects remote HTTP and unknown keys', () => {
    expect('code' in parseProviderConfig({ ...config, baseUrl: 'http://127.0.0.1:4444/v1' })).toBe(
      false,
    );
    expect(parseProviderConfig({ ...config, baseUrl: 'http://example.com/v1' })).toMatchObject({
      code: 'PROVIDER_INSECURE_ENDPOINT',
    });
    expect(parseProviderConfig({ ...config, headers: { x: 'y' } })).toMatchObject({
      code: 'PROVIDER_INVALID_INPUT',
    });
  });
  test('enforces capacity and strict secret branches', () => {
    expect(parseProviderConfig({ ...config, maxOutputTokens: 9000 })).toMatchObject({
      code: 'PROVIDER_INVALID_INPUT',
    });
    expect(
      parseSaveInput({ expectedRevision: null, config, secret: 'key', reuseSavedSecret: true }),
    ).toMatchObject({ code: 'PROVIDER_SECRET_REQUIRED' });
  });
});
