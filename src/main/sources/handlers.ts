import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron';
import type {
  RemoveSourceRequest,
  RemoveSourceResult,
  RetrySourceResult,
} from '../../shared/sources.js';
import {
  parseGetSourceRequest,
  parseImportSourcesRequest,
  parseListSourcesRequest,
  parseRetrySourceRequest,
  parseSourceRemovalRequest,
  parseSourceSubscriptionRequest,
  type SourceError,
  sourceChannels,
} from '../../shared/sources.js';
import type { ProjectSession } from '../project/project-transaction.js';
import type { SourceImportService } from './import-service.js';
import type { SourceEvents } from './source-events.js';
import type { SourceRepository } from './source-repository.js';

export function registerSourceHandlers(options: {
  ipcMain: Pick<IpcMain, 'handle'>;
  getActiveSession(): ProjectSession | null;
  repository: SourceRepository;
  imports: SourceImportService;
  events: SourceEvents;
  isExpectedSender(event: IpcMainInvokeEvent): boolean;
  retrySource(
    session: ProjectSession,
    input: { sourceId: string; expectedSourceRevision: number },
  ): Promise<RetrySourceResult>;
  removeSource(session: ProjectSession, input: RemoveSourceRequest): Promise<RemoveSourceResult>;
}): void {
  const unauthorized = () => failure('SOURCE_UNAUTHORIZED_SENDER');
  const session = () => options.getActiveSession();
  options.ipcMain.handle(sourceChannels.list, async (event, value: unknown) => {
    if (!options.isExpectedSender(event)) return unauthorized();
    const parsed = parseListSourcesRequest(value);
    if ('code' in parsed) return { status: 'error', error: parsed };
    const active = session();
    if (!active) return failure('NO_ACTIVE_PROJECT');
    try {
      return { status: 'ok', ...(await options.repository.list(active, parsed)) };
    } catch {
      return failure('SOURCE_RECOVERY_REQUIRED');
    }
  });
  options.ipcMain.handle(sourceChannels.importDialog, async (event, value: unknown) => {
    if (!options.isExpectedSender(event)) return unauthorized();
    const parsed = parseImportSourcesRequest(value);
    if ('code' in parsed) return { status: 'error', error: parsed };
    return options.imports.importFromDialog(parsed.expectedCatalogRevision);
  });
  options.ipcMain.handle(sourceChannels.get, async (event, value: unknown) => {
    if (!options.isExpectedSender(event)) return unauthorized();
    const parsed = parseGetSourceRequest(value);
    if ('code' in parsed) return { status: 'error', error: parsed };
    const active = session();
    if (!active) return failure('NO_ACTIVE_PROJECT');
    const source = await options.repository.get(active, parsed.sourceId);
    if (!source) return failure('SOURCE_NOT_FOUND');
    const page = await options.repository.getBlocks(
      active,
      parsed.sourceId,
      parsed.cursor,
      parsed.limit,
    );
    return {
      status: 'ok',
      source,
      blocks: page.blocks.map(({ chunkId, ordinal, blockType, markdown, media, searchable }) => ({
        chunkId,
        ordinal,
        blockType,
        markdown,
        media,
        searchable,
      })),
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    };
  });
  options.ipcMain.handle(sourceChannels.retry, async (event, value: unknown) => {
    if (!options.isExpectedSender(event)) return unauthorized();
    const parsed = parseRetrySourceRequest(value);
    if ('code' in parsed) return { status: 'error', error: parsed };
    const active = session();
    if (!active) return failure('NO_ACTIVE_PROJECT');
    return options.retrySource(active, parsed);
  });
  options.ipcMain.handle(sourceChannels.remove, async (event, value: unknown) => {
    if (!options.isExpectedSender(event)) return unauthorized();
    const parsed = parseSourceRemovalRequest(value);
    if ('code' in parsed) return { status: 'error', error: parsed };
    const active = session();
    if (!active) return failure('NO_ACTIVE_PROJECT');
    if (parsed.target === 'candidate') {
      const canceled = await options.imports.cancelCandidate(active, parsed.candidateId);
      if (!canceled) return failure('SOURCE_NOT_FOUND');
      const catalogRevision = (await options.repository.list(active, { limit: 1 })).catalogRevision;
      return { status: 'candidate-canceled', candidateId: parsed.candidateId, catalogRevision };
    }
    return options.removeSource(active, parsed);
  });
  const subscriptions = new WeakMap<WebContents, () => void>();
  options.ipcMain.handle(sourceChannels.events, async (event, value: unknown) => {
    if (!options.isExpectedSender(event)) return unauthorized();
    const parsed = parseSourceSubscriptionRequest(value);
    if ('code' in parsed) return { status: 'error', error: parsed };
    subscriptions.get(event.sender)?.();
    subscriptions.set(
      event.sender,
      options.events.subscribe(parsed.afterSequence, (sourceEvent) => {
        if (!event.sender.isDestroyed()) event.sender.send(sourceChannels.events, sourceEvent);
      }),
    );
    return { status: 'subscribed' };
  });
}

function failure(code: SourceError['code']) {
  return {
    status: 'error' as const,
    error: { code, messageKey: `sources.error.${code.toLowerCase()}`, retryable: false },
  };
}
