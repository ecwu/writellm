import { describe, expect, test } from 'bun:test';
import type { Worker } from 'node:worker_threads';
import { RetrievalWorkerClient } from '../../src/main/retrievalWorkerClient.js';
import type {
  RetrievalWorkerInboundMessage,
  RetrievalWorkerOutboundMessage,
  RetrievalWorkerRequest
} from '../../src/main/retrievalWorkerProtocol.js';

type WorkerEvent = 'message' | 'error' | 'exit';

class FakeWorker {
  readonly messages: RetrievalWorkerInboundMessage[] = [];
  terminated = false;
  private readonly listeners = new Map<WorkerEvent, Array<(value: unknown) => void>>();

  on(event: WorkerEvent, listener: (value: unknown) => void): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }

  postMessage(message: RetrievalWorkerInboundMessage): void {
    this.messages.push(message);
  }

  terminate(): Promise<number> {
    this.terminated = true;
    return Promise.resolve(0);
  }

  emit(event: WorkerEvent, value: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(value);
    }
  }
}

const request: RetrievalWorkerRequest = {
  query: 'retrieval timeout fixture',
  embeddingSettings: {
    provider: 'openai-compatible',
    baseURL: 'https://example.test/v1',
    model: 'embedding-fixture',
    apiKey: 'test-key'
  },
  chatSettings: {
    provider: 'openai-compatible',
    baseURL: 'https://example.test/v1',
    model: 'chat-fixture',
    apiKey: 'test-key'
  },
  externalProcessingEnabled: true
};

function makeClient(workers: FakeWorker[]): RetrievalWorkerClient {
  return new RetrievalWorkerClient('/workspace', () => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker as unknown as Worker;
  });
}

describe('retrieval worker lifecycle', () => {
  test('terminates an unresponsive worker and starts a fresh worker for the next retrieval', async () => {
    const workers: FakeWorker[] = [];
    const client = makeClient(workers);

    await expect(client.retrieve(request, { timeoutMs: 10 })).rejects.toThrow('Retrieval timed out after 10ms.');
    expect(workers).toHaveLength(1);
    expect(workers[0]!.terminated).toBeTrue();

    const next = client.retrieve(request, { timeoutMs: 1_000 });
    expect(workers).toHaveLength(2);
    const task = workers[1]!.messages[0];
    expect(task).toMatchObject({ type: 'retrieve' });
    if (!task || task.type !== 'retrieve') {
      throw new Error('Expected the restarted worker to receive a retrieval task.');
    }
    expect(task.request.externalProcessingEnabled).toBeTrue();
    workers[1]!.emit('message', {
      type: 'result',
      taskId: task.taskId,
      sources: []
    } satisfies RetrievalWorkerOutboundMessage);

    await expect(next).resolves.toEqual([]);
    client.close();
  });

  test('terminates the active worker on cancellation so a later retrieval is not queued behind it', async () => {
    const workers: FakeWorker[] = [];
    const client = makeClient(workers);
    const controller = new AbortController();
    const canceled = client.retrieve(request, { abortSignal: controller.signal, timeoutMs: 1_000 });

    controller.abort();
    await expect(canceled).rejects.toThrow('Retrieval canceled.');
    expect(workers[0]!.terminated).toBeTrue();

    const next = client.retrieve(request, { timeoutMs: 1_000 });
    expect(workers).toHaveLength(2);
    const task = workers[1]!.messages[0];
    if (!task || task.type !== 'retrieve') {
      throw new Error('Expected a new worker after cancellation.');
    }
    workers[1]!.emit('message', {
      type: 'result',
      taskId: task.taskId,
      sources: []
    } satisfies RetrievalWorkerOutboundMessage);

    await expect(next).resolves.toEqual([]);
    client.close();
  });
});
