import { describe, expect, test } from 'bun:test';
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  Type,
  type StreamFunction
} from '@earendil-works/pi-ai';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { ModelEndpointSettings } from '../../src/shared/types.js';
import {
  PiAgentManager,
  PiRunConflictError,
  type PiRunEvent
} from '../../src/main/agent/agentManager.js';
import { createPiModelAdapter } from '../../src/main/agent/modelAdapter.js';
import { SourceToolError } from '../../src/main/agent/sourceService.js';
import type { WriteLlmTools } from '../../src/main/agent/writeLlmTools.js';

const settings: ModelEndpointSettings = {
  provider: 'openai-compatible',
  baseURL: 'https://agent.example.test/v1',
  model: 'writing-model',
  apiKey: 'test-key'
};

function adapterFor(faux: ReturnType<typeof fauxProvider>) {
  const model = faux.getModel();
  if (!model) {
    throw new Error('Expected faux model.');
  }
  const models = createModels();
  models.setProvider(faux.provider);
  const streamFn: StreamFunction = (_requestedModel, context, options) => models.streamSimple(model, context, options);
  return createPiModelAdapter(settings, { externalProcessingEnabled: true }, { streamFn });
}

function tools(entries: AgentTool[] = []): WriteLlmTools {
  return {
    tools: entries,
    getEvidenceManifest: () => []
  };
}

function createManager() {
  const lifecycle = {
    completed: 0,
    cancel: null as ((reason: Error) => void) | null
  };
  let nextId = 0;
  const manager = new PiAgentManager({
    now: () => '2026-07-11T01:02:03.000Z',
    createRunId: () => `run-${++nextId}`,
    registerActiveWork: (_workspacePath, cancel) => {
      lifecycle.cancel = cancel;
      return { complete: () => { lifecycle.completed += 1; } };
    }
  });
  return { manager, lifecycle };
}

describe('PiAgentManager', () => {
  test('owns a single live section run, projects ordered redacted events, and discards terminal state', async () => {
    const faux = fauxProvider();
    faux.setResponses([fauxAssistantMessage(fauxText('A concise response.'))]);
    const { manager, lifecycle } = createManager();
    const events: PiRunEvent[] = [];
    manager.subscribe((event) => events.push(event));

    const started = manager.start({
      workspacePath: '/workspace.writellm',
      sectionId: 'section-1',
      prompt: 'Improve the introduction.',
      systemPrompt: 'Write helpfully.',
      adapter: adapterFor(faux),
      tools: tools()
    });
    expect(manager.listLiveRuns('/workspace.writellm')).toHaveLength(1);
    expect(() => manager.start({
      workspacePath: '/workspace.writellm',
      sectionId: 'section-1',
      prompt: 'Competing request.',
      systemPrompt: 'Write helpfully.',
      adapter: adapterFor(faux),
      tools: tools()
    })).toThrow(PiRunConflictError);

    const terminal = await started.completion;
    expect(terminal).toMatchObject({ runId: 'run-1', status: 'succeeded', turnCount: 1 });
    expect(manager.listLiveRuns()).toEqual([]);
    expect(lifecycle.completed).toBe(1);
    expect(events.map((event) => event.sequence)).toEqual(events.map((_event, index) => index + 1));
    expect(events.find((event) => event.type === 'message_delta')?.data).toMatchObject({ role: 'assistant' });
    expect(events.at(-1)).toMatchObject({ type: 'run_terminal', data: { status: 'succeeded' } });
  });

  test('coalesces token deltas before projection and flushes text before message completion', async () => {
    const faux = fauxProvider({ tokensPerSecond: 10_000 });
    const response = 'A long streamed answer that should cross IPC in bounded batches. '.repeat(80);
    faux.setResponses([fauxAssistantMessage(fauxText(response))]);
    const { manager } = createManager();
    const events: PiRunEvent[] = [];
    let eventLoopTimerFired = false;
    manager.subscribe((event) => events.push(event));
    setTimeout(() => { eventLoopTimerFired = true; }, 0);

    await manager.start({
      workspacePath: '/workspace.writellm',
      sectionId: 'section-1',
      prompt: 'Stream a long answer.',
      systemPrompt: 'Write helpfully.',
      adapter: adapterFor(faux),
      tools: tools()
    }).completion;

    const deltas = events.filter((event) => event.type === 'message_delta');
    expect(deltas.length).toBeLessThan(20);
    expect(deltas.map((event) => String(event.data?.text ?? '')).join('').length).toBeGreaterThan(4_000);
    expect(eventLoopTimerFired).toBe(true);
    expect(events.findIndex((event) => event.type === 'message_delta'))
      .toBeLessThan(events.findIndex((event) => event.type === 'message_end' && event.data?.role === 'assistant'));
  });

  test('projects a typed tool failure without exposing raw arguments and lets Pi continue', async () => {
    const faux = fauxProvider();
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall('source', { query: 'source query' })], { stopReason: 'toolUse' }),
      fauxAssistantMessage(fauxText('I could not retrieve evidence.'))
    ]);
    const source: AgentTool = {
      name: 'source',
      label: 'Source',
      description: 'Source',
      parameters: Type.Object({ query: Type.String() }),
      execute: async () => {
        throw new SourceToolError('embedding_timeout', true, 'Embedding timed out.');
      }
    };
    const { manager } = createManager();
    const events: PiRunEvent[] = [];
    manager.subscribe((event) => events.push(event));

    const terminal = await manager.start({
      workspacePath: '/workspace.writellm',
      sectionId: 'section-1',
      prompt: 'Find evidence.',
      systemPrompt: 'Use source when needed.',
      adapter: adapterFor(faux),
      tools: tools([source])
    }).completion;

    const toolEnd = events.find((event) => event.type === 'tool_execution_end');
    expect(toolEnd).toMatchObject({
      data: {
        toolName: 'source',
        status: 'error',
        failure: { category: 'embedding_timeout', retryable: true }
      }
    });
    expect(toolEnd?.data).not.toHaveProperty('args');
    expect(terminal.status).toBe('succeeded');
  });

  test('cancellation from the shared workspace lifecycle aborts Pi and releases the section lock', async () => {
    const faux = fauxProvider({ tokensPerSecond: 1_000 });
    faux.setResponses([fauxAssistantMessage(fauxText('Streaming response '.repeat(30)))]);
    const { manager, lifecycle } = createManager();
    const started = manager.start({
      workspacePath: '/workspace.writellm',
      sectionId: 'section-1',
      prompt: 'Start streaming.',
      systemPrompt: 'Write helpfully.',
      adapter: adapterFor(faux),
      tools: tools()
    });
    lifecycle.cancel?.(new Error('Workspace switched.'));

    const terminal = await started.completion;
    expect(terminal).toMatchObject({
      status: 'canceled',
      failure: { category: 'canceled', retryable: false }
    });
    expect(manager.listLiveRuns()).toEqual([]);
    expect(lifecycle.completed).toBe(1);
  });

  test('terminalizes a run when its wall-clock budget expires', async () => {
    const faux = fauxProvider({ tokensPerSecond: 1 });
    faux.setResponses([fauxAssistantMessage(fauxText('This response cannot finish before the test run deadline. '.repeat(8)))]);
    const manager = new PiAgentManager({
      runTimeoutMs: 1,
      registerActiveWork: () => ({ complete: () => undefined })
    });

    const terminal = await manager.start({
      workspacePath: '/workspace.writellm',
      sectionId: 'section-1',
      prompt: 'Start slowly.',
      systemPrompt: 'Write helpfully.',
      adapter: adapterFor(faux),
      tools: tools()
    }).completion;

    expect(terminal).toMatchObject({
      status: 'timed_out',
      failure: { category: 'run_timeout', retryable: true }
    });
  });
});
