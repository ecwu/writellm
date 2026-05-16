import Database from 'better-sqlite3';
import { better, defineQueue, defineWorker, type Queue, type Worker } from 'plainjob';
import path from 'node:path';
import { LLM_GENERATION_TASK_TYPE, type WriteLLMDatabase } from './database.js';
import { processLlmGenerationJob } from './generationWorker.js';
import { processKnowledgeIngestJob } from './knowledgeIngest.js';

const KNOWLEDGE_INGEST_TASK_TYPE = 'knowledge-ingest';
const KEEP_ARCHIVED_TASKS_MS = Number.MAX_SAFE_INTEGER;

type BackgroundTaskRuntime = {
  workspacePath: string;
  connection: Database.Database;
  queue: Queue;
  worker: Worker;
  generationWorker: Worker;
  workerRun: Promise<void>;
  generationWorkerRun: Promise<void>;
};

let activeRuntime: BackgroundTaskRuntime | null = null;

const quietLogger = {
  error: console.error.bind(console),
  warn: console.warn.bind(console),
  info: () => {},
  debug: () => {}
};

export async function startBackgroundTaskWorker(db: WriteLLMDatabase): Promise<void> {
  if (activeRuntime?.workspacePath === db.workspacePath) {
    return;
  }
  await stopBackgroundTaskWorker();

  const connection = new Database(path.join(db.workspacePath, 'project.sqlite'));
  const queue = defineQueue({
    connection: better(connection),
    logger: quietLogger,
    removeDoneJobsOlderThan: KEEP_ARCHIVED_TASKS_MS,
    removeFailedJobsOlderThan: KEEP_ARCHIVED_TASKS_MS
  });
  const worker = defineWorker(
    KNOWLEDGE_INGEST_TASK_TYPE,
    async (job) => {
      const result = await processKnowledgeIngestJob(db, String(job.id));
      if (result.status === 'error') {
        throw new Error(result.errorMessage ?? 'Knowledge ingest failed.');
      }
    },
    {
      queue,
      pollIntervall: 1000,
      logger: quietLogger
    }
  );
  const generationWorker = defineWorker(
    LLM_GENERATION_TASK_TYPE,
    async (job) => {
      await processLlmGenerationJob(db, String(job.id), job.data);
    },
    {
      queue,
      pollIntervall: 500,
      logger: quietLogger
    }
  );
  const workerRun = worker.start().catch((caught) => {
    console.error(caught);
  });
  const generationWorkerRun = generationWorker.start().catch((caught) => {
    console.error(caught);
  });
  activeRuntime = {
    workspacePath: db.workspacePath,
    connection,
    queue,
    worker,
    generationWorker,
    workerRun,
    generationWorkerRun
  };
}

export async function stopBackgroundTaskWorker(): Promise<void> {
  const runtime = activeRuntime;
  if (!runtime) {
    return;
  }
  activeRuntime = null;
  await runtime.worker.stop();
  await runtime.generationWorker.stop();
  await runtime.workerRun;
  await runtime.generationWorkerRun;
  runtime.queue.close();
}
