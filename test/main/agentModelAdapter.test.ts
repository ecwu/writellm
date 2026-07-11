import { describe, expect, test } from 'bun:test';
import { Agent } from '@earendil-works/pi-agent-core';
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  Type,
  type StreamFunction
} from '@earendil-works/pi-ai';
import type { ModelEndpointSettings } from '../../src/shared/types.js';
import {
  createPiModelAdapter,
  PiModelPreflightError
} from '../../src/main/agent/modelAdapter.js';

const remoteSettings: ModelEndpointSettings = {
  provider: 'openai-compatible',
  baseURL: 'https://agent.example.test/v1',
  model: 'writing-model',
  apiKey: 'secret-test-key'
};

describe('Pi model adapter', () => {
  test('uses Pi native OpenAI-compatible transport in a deterministic tool-call round', async () => {
    const faux = fauxProvider();
    const fauxModel = faux.getModel();
    if (!fauxModel) {
      throw new Error('Expected faux provider model.');
    }
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('echo', { text: 'evidence query' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage([fauxText('Evidence was considered.')])
    ]);
    const models = createModels();
    models.setProvider(faux.provider);
    const streamFn: StreamFunction = (_model, context, options) =>
      models.streamSimple(fauxModel, context, options);
    const adapter = createPiModelAdapter(
      remoteSettings,
      { externalProcessingEnabled: true },
      { streamFn, maxOutputTokens: 7000 }
    );
    const agent = new Agent({
      initialState: {
        systemPrompt: 'Use the echo tool before responding.',
        model: adapter.model,
        tools: [{
          name: 'echo',
          label: 'Echo evidence',
          description: 'Returns a bounded evidence string.',
          parameters: Type.Object({ text: Type.String() }),
          executionMode: 'sequential',
          execute: async (_toolCallId, params) => ({
            content: [{ type: 'text', text: params.text }],
            details: { sourceCount: 1 }
          })
        }]
      },
      streamFn: adapter.streamFn,
      getApiKey: adapter.getApiKey,
      toolExecution: 'sequential'
    });
    const eventTypes: string[] = [];
    agent.subscribe((event) => {
      eventTypes.push(event.type);
    });

    await agent.prompt('Improve this paragraph with evidence.');

    expect(adapter.model.api).toBe('openai-completions');
    expect(adapter.model.baseUrl).toBe('https://agent.example.test/v1');
    expect(adapter.maxOutputTokens).toBe(4096);
    expect(adapter.getApiKey(adapter.model.provider)).toBe('secret-test-key');
    expect(eventTypes).toContain('tool_execution_start');
    expect(eventTypes).toContain('tool_execution_end');
    expect(eventTypes.at(-1)).toBe('agent_end');
  });

  test('rejects unsupported providers before an agent run begins', () => {
    expect(() => createPiModelAdapter(
      { ...remoteSettings, provider: 'anthropic-compatible' },
      { externalProcessingEnabled: true }
    )).toThrow(PiModelPreflightError);
    expect(() => createPiModelAdapter(
      { ...remoteSettings, provider: 'anthropic-compatible' },
      { externalProcessingEnabled: true }
    )).toThrow('requires an OpenAI-compatible chat endpoint');
  });

  test('rejects remote calls without outbound-data consent', () => {
    expect(() => createPiModelAdapter(
      remoteSettings,
      { externalProcessingEnabled: false }
    )).toThrow('External chat processing is disabled');
  });

  test('forwards Pi Agent cancellation to the configured native stream', async () => {
    const faux = fauxProvider({ tokensPerSecond: 1_000 });
    const fauxModel = faux.getModel();
    const models = createModels();
    models.setProvider(faux.provider);
    faux.setResponses([fauxAssistantMessage(fauxText('This response is deliberately long enough to stream before cancellation. '.repeat(12)))]);
    const adapter = createPiModelAdapter(
      remoteSettings,
      { externalProcessingEnabled: true },
      { streamFn: (_model, context, options) => models.streamSimple(fauxModel, context, options) }
    );
    const agent = new Agent({
      initialState: { systemPrompt: 'Respond briefly.', model: adapter.model },
      streamFn: adapter.streamFn,
      getApiKey: adapter.getApiKey
    });
    let canceled = false;
    agent.subscribe((event) => {
      if (event.type === 'message_update' && !canceled) {
        canceled = true;
        agent.abort();
      }
    });

    await agent.prompt('Start streaming.');

    expect(canceled).toBeTrue();
    expect(agent.state.messages.at(-1)).toMatchObject({ role: 'assistant', stopReason: 'aborted' });
  });
});
