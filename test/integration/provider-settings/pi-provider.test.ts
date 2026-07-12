import { expect, test } from 'bun:test';
import { createProviderRuntime } from '../../../src/main/provider-settings/pi-provider';

test('Pi runtime uses the frozen model identity without retaining the secret in model metadata', () => {
  const secret = 'pi-secret-sentinel';
  const { model } = createProviderRuntime(
    {
      providerKind: 'openai-compatible',
      baseUrl: 'https://provider.example/v1/',
      modelId: 'writer',
      contextWindow: 8192,
      maxOutputTokens: 1024,
      reasoning: true,
    },
    secret,
  );
  expect(model).toMatchObject({
    provider: 'writellm-custom',
    api: 'openai-completions',
    id: 'writer',
    input: ['text'],
    contextWindow: 8192,
    maxTokens: 1024,
  });
  expect(JSON.stringify(model)).not.toContain(secret);
});
