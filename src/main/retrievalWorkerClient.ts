import { Worker } from 'node:worker_threads';
import type {
  KnowledgeRetrievalTraceEvent,
  RetrievedKnowledgeSource
} from '../shared/types.js';
import type {
  RetrievalWorkerInboundMessage,
  RetrievalWorkerOutboundMessage,
  RetrievalWorkerRequest
} from './retrievalWorkerProtocol.js';

export const DEFAULT_RETRIEVAL_TIMEOUT_MS = 45_000;

type WorkerFactory = (workspacePath: string) => Worker;

type RetrievalTask = {
  taskId: string;
  request: RetrievalWorkerRequest;
  onTrace?: (event: KnowledgeRetrievalTraceEvent) => void;
  abortSignal?: AbortSignal;
  abortListener?: () => void;
  timeoutMs: number;
  timeoutHandle?: ReturnType<typeof setTimeout>;
  canceled: boolean;
  settled: boolean;
  resolve: (sources: RetrievedKnowledgeSource[]) => void;
  reject: (error: Error) => void;
};

let activeClient: RetrievalWorkerClient | null = null;
let nextTaskId = 0;

export function retrieveKnowledgeInWorker(
  workspacePath: string,
  request: RetrievalWorkerRequest,
  options: {
    abortSignal?: AbortSignal;
    onTrace?: (event: KnowledgeRetrievalTraceEvent) => void;
    timeoutMs?: number;
  } = {}
): Promise<RetrievedKnowledgeSource[]> {
  const client = getRetrievalWorkerClient(workspacePath);
  return client.retrieve(request, options);
}

export function closeRetrievalWorker(): void {
  activeClient?.close();
  activeClient = null;
}

function createRetrievalWorker(workspacePath: string): Worker {
  return new Worker(new URL('./retrievalWorker.js', import.meta.url), {
    workerData: { workspacePath }
  });
}

function resolveTimeoutMs(timeoutMs: number | undefined): number {
  if (!Number.isFinite(timeoutMs) || !timeoutMs || timeoutMs <= 0) {
    return DEFAULT_RETRIEVAL_TIMEOUT_MS;
  }
  return Math.trunc(timeoutMs);
}

function getRetrievalWorkerClient(workspacePath: string): RetrievalWorkerClient {
  if (activeClient?.workspacePath !== workspacePath) {
    closeRetrievalWorker();
    activeClient = new RetrievalWorkerClient(workspacePath);
  }
  return activeClient;
}

export class RetrievalWorkerClient {
  readonly workspacePath: string;
  private worker: Worker | null = null;
  private current: RetrievalTask | null = null;
  private readonly queue: RetrievalTask[] = [];

  constructor(
    workspacePath: string,
    private readonly workerFactory: WorkerFactory = createRetrievalWorker
  ) {
    this.workspacePath = workspacePath;
  }

  retrieve(
    request: RetrievalWorkerRequest,
    options: {
      abortSignal?: AbortSignal;
      onTrace?: (event: KnowledgeRetrievalTraceEvent) => void;
      timeoutMs?: number;
    }
  ): Promise<RetrievedKnowledgeSource[]> {
    if (options.abortSignal?.aborted) {
      return Promise.reject(new Error('Retrieval canceled.'));
    }

    return new Promise((resolve, reject) => {
      const task: RetrievalTask = {
        taskId: `retrieval-${Date.now()}-${nextTaskId++}`,
        request,
        onTrace: options.onTrace,
        abortSignal: options.abortSignal,
        timeoutMs: resolveTimeoutMs(options.timeoutMs),
        canceled: false,
        settled: false,
        resolve,
        reject
      };
      if (options.abortSignal) {
        task.abortListener = () => this.cancelTask(task);
        options.abortSignal.addEventListener('abort', task.abortListener, { once: true });
      }
      this.queue.push(task);
      this.pump();
    });
  }

  close(): void {
    const error = new Error('Retrieval worker closed.');
    this.rejectTask(this.current, error);
    this.current = null;
    while (this.queue.length > 0) {
      this.rejectTask(this.queue.shift() ?? null, error);
    }
    this.stopWorker(true);
  }

  private pump(): void {
    if (this.current || this.queue.length === 0) {
      return;
    }
    const next = this.queue.shift()!;
    if (next.canceled) {
      this.rejectTask(next, new Error('Retrieval canceled.'));
      this.pump();
      return;
    }
    this.current = next;
    try {
      this.ensureWorker();
      this.startTaskTimeout(next);
      this.post({
        type: 'retrieve',
        taskId: next.taskId,
        request: next.request
      });
    } catch (caught) {
      this.handleWorkerFailure(toError(caught));
    }
  }

  private ensureWorker(): void {
    if (this.worker) {
      return;
    }
    const worker = this.workerFactory(this.workspacePath);
    worker.on('message', (message: RetrievalWorkerOutboundMessage) => this.handleMessage(message));
    worker.on('error', (error) => {
      if (this.worker === worker) {
        this.handleWorkerFailure(error);
      }
    });
    worker.on('exit', (code) => {
      if (code !== 0 && this.worker === worker) {
        this.handleWorkerFailure(new Error(`Retrieval worker exited with code ${code}.`));
      }
      if (this.worker === worker) {
        this.worker = null;
      }
    });
    this.worker = worker;
  }

  private handleMessage(message: RetrievalWorkerOutboundMessage): void {
    const task = this.current;
    if (!task || task.taskId !== message.taskId) {
      return;
    }
    if (message.type === 'trace') {
      if (!task.canceled) {
        task.onTrace?.(message.event);
      }
      return;
    }
    if (message.type === 'result') {
      this.current = null;
      if (!task.canceled) {
        this.resolveTask(task, message.sources);
      } else {
        this.cleanupTask(task);
      }
      this.pump();
      return;
    }
    if (message.type === 'canceled') {
      this.current = null;
      this.rejectTask(task, new Error('Retrieval canceled.'));
      this.pump();
      return;
    }
    if (message.type === 'error') {
      this.current = null;
      this.rejectTask(task, new Error(message.message));
      this.pump();
    }
  }

  private handleWorkerFailure(error: Error): void {
    this.worker = null;
    const current = this.current;
    this.current = null;
    this.rejectTask(current, error);
    while (this.queue.length > 0) {
      this.rejectTask(this.queue.shift() ?? null, error);
    }
  }

  private cancelTask(task: RetrievalTask): void {
    task.canceled = true;
    if (this.current?.taskId === task.taskId) {
      this.current = null;
      this.rejectTask(task, new Error('Retrieval canceled.'));
      this.stopWorker();
      this.pump();
      return;
    }
    const index = this.queue.findIndex((candidate) => candidate.taskId === task.taskId);
    if (index >= 0) {
      this.queue.splice(index, 1);
      this.rejectTask(task, new Error('Retrieval canceled.'));
    }
  }

  private resolveTask(task: RetrievalTask, sources: RetrievedKnowledgeSource[]): void {
    if (task.settled) {
      this.cleanupTask(task);
      return;
    }
    task.settled = true;
    this.cleanupTask(task);
    task.resolve(sources);
  }

  private rejectTask(task: RetrievalTask | null, error: Error): void {
    if (!task) {
      return;
    }
    if (task.settled) {
      this.cleanupTask(task);
      return;
    }
    task.settled = true;
    this.cleanupTask(task);
    task.reject(error);
  }

  private cleanupTask(task: RetrievalTask): void {
    if (task.timeoutHandle) {
      clearTimeout(task.timeoutHandle);
      task.timeoutHandle = undefined;
    }
    if (task.abortSignal && task.abortListener) {
      task.abortSignal.removeEventListener('abort', task.abortListener);
      task.abortListener = undefined;
    }
  }

  private post(message: RetrievalWorkerInboundMessage): void {
    this.worker?.postMessage(message);
  }

  private startTaskTimeout(task: RetrievalTask): void {
    task.timeoutHandle = setTimeout(() => {
      if (this.current?.taskId !== task.taskId || task.settled) {
        return;
      }
      this.current = null;
      this.rejectTask(task, new Error(`Retrieval timed out after ${task.timeoutMs}ms.`));
      this.stopWorker();
      this.pump();
    }, task.timeoutMs);
  }

  private stopWorker(sendShutdown = false): void {
    const worker = this.worker;
    this.worker = null;
    if (!worker) {
      return;
    }
    if (sendShutdown) {
      worker.postMessage({ type: 'shutdown' });
    }
    void worker.terminate();
  }
}

function toError(caught: unknown): Error {
  return caught instanceof Error ? caught : new Error(String(caught));
}
