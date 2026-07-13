import type { SourceDetail, SourceErrorCode, SourceSummary } from '../../shared/sources.js';
import type { SourceJob } from './job-repository.js';

type ProjectableSource = SourceSummary & {
  failure?: SourceDetail['failure'];
  currentVersionId: string;
};

export function projectSourceStatus<T extends ProjectableSource>(
  source: T,
  jobs: SourceJob[],
  indexedChunkIds: ReadonlySet<string>,
): T {
  const current = jobs.filter(
    (job) =>
      job.sourceId === source.sourceId &&
      job.sourceVersionId === source.currentVersionId &&
      job.state !== 'superseded',
  );
  const parse = latest(current.filter((job) => job.type === 'parse'));
  const hasPublishedParse = ['indexing', 'available', 'partial'].includes(source.state);
  if (parse && parse.state !== 'completed' && !hasPublishedParse) {
    if (parse.state === 'failed')
      return {
        ...source,
        state: 'failed',
        progress: parse.progress ?? { completed: 0, total: 100, stage: 'parsing' },
        retrying: false,
        retryable: true,
        failure: {
          code: sourceErrorCode(parse.errorCode),
          messageKey: `sources.error.${sourceErrorCode(parse.errorCode).toLowerCase()}`,
          stage: 'parse',
        },
      } as T;
    return {
      ...source,
      state: parse.state === 'queued' ? 'queued' : 'parsing',
      progress:
        parse.progress ??
        (parse.state === 'queued'
          ? { completed: 0, total: 1, stage: 'queued' }
          : { completed: 0, total: 100, stage: 'parsing' }),
      retrying: parse.state === 'retrying' || parse.attempt > 1,
      retryable: false,
      failure: undefined,
    } as T;
  }

  if (source.eligibility.eligible === 0) return source;
  const embeddings = current.filter((job) => job.type === 'embed' && job.chunkId);
  const latestByChunk = new Map<string, SourceJob>();
  for (const job of embeddings) {
    const found = latestByChunk.get(job.chunkId!);
    if (!found || job.updatedAt > found.updatedAt) latestByChunk.set(job.chunkId!, job);
  }
  const failedJobs = [...latestByChunk.values()].filter(
    (job) => job.state === 'failed' && !indexedChunkIds.has(job.chunkId!),
  );
  const indexed = Math.min(source.eligibility.eligible, indexedChunkIds.size);
  const failed = Math.min(source.eligibility.eligible - indexed, failedJobs.length);
  const complete = indexed === source.eligibility.eligible;
  const terminal = indexed + failed >= source.eligibility.eligible;
  const failureJob = latest(failedJobs);
  return {
    ...source,
    state: complete
      ? 'available'
      : terminal && indexed === 0
        ? 'failed'
        : terminal
          ? 'partial'
          : 'indexing',
    progress: {
      completed: indexed + failed,
      total: source.eligibility.eligible,
      stage: 'indexing',
    },
    eligibility: { ...source.eligibility, indexed, failed },
    retrying: !complete && !terminal && embeddings.some((job) => job.state === 'retrying'),
    retryable: !complete && failed > 0,
    failure:
      failed > 0
        ? {
            code: sourceErrorCode(failureJob?.errorCode, 'SOURCE_INDEX_FAILED'),
            messageKey: `sources.error.${sourceErrorCode(failureJob?.errorCode, 'SOURCE_INDEX_FAILED').toLowerCase()}`,
            stage: 'index',
          }
        : undefined,
  } as T;
}

function latest(jobs: SourceJob[]): SourceJob | undefined {
  return jobs.reduce<SourceJob | undefined>(
    (found, job) => (!found || job.updatedAt > found.updatedAt ? job : found),
    undefined,
  );
}

function sourceErrorCode(
  value: string | undefined,
  fallback: SourceErrorCode = 'SOURCE_INTERNAL',
): SourceErrorCode {
  return value?.startsWith('SOURCE_') ? (value as SourceErrorCode) : fallback;
}
