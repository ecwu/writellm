import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import {
  parseSaveServiceCredentialInput,
  parseServiceRevisionInput,
  type ServiceProvider,
  type SourceError,
  sourceServiceChannels,
  type ValidateServiceResult,
} from '../../shared/sources.js';
import type { SourceServiceCredentials } from './service-credentials.js';
import { SourceServiceValidationError } from './service-validator.js';

export function registerSourceServiceHandlers(options: {
  ipcMain: Pick<IpcMain, 'handle'>;
  repository: SourceServiceCredentials;
  isExpectedSender(event: IpcMainInvokeEvent): boolean;
  validate(provider: ServiceProvider, credential: string, signal: AbortSignal): Promise<void>;
}): void {
  const { ipcMain, repository } = options;
  const unauthorized = (): SourceError => ({
    code: 'SOURCE_UNAUTHORIZED_SENDER',
    messageKey: 'sources.error.unauthorized',
    retryable: false,
  });
  ipcMain.handle(sourceServiceChannels.get, async (event) =>
    options.isExpectedSender(event)
      ? {
          status: 'ok',
          mineru: repository.summary('mineru'),
          siliconflow: repository.summary('siliconflow'),
        }
      : { status: 'error', error: unauthorized() },
  );
  for (const provider of ['mineru', 'siliconflow'] as const) {
    const channels =
      provider === 'mineru'
        ? {
            save: sourceServiceChannels.mineruSave,
            remove: sourceServiceChannels.mineruRemove,
            validate: sourceServiceChannels.mineruValidate,
          }
        : {
            save: sourceServiceChannels.siliconflowSave,
            remove: sourceServiceChannels.siliconflowRemove,
            validate: sourceServiceChannels.siliconflowValidate,
          };
    ipcMain.handle(channels.save, async (event, value: unknown) => {
      if (!options.isExpectedSender(event)) return { status: 'error', error: unauthorized() };
      const parsed = parseSaveServiceCredentialInput(value);
      if ('code' in parsed) return { status: 'error', error: parsed };
      return repository.save(provider, parsed.expectedRevision, parsed.credential);
    });
    ipcMain.handle(channels.remove, async (event, value: unknown) => {
      if (!options.isExpectedSender(event)) return { status: 'error', error: unauthorized() };
      const parsed = parseServiceRevisionInput(value);
      if ('code' in parsed) return { status: 'error', error: parsed };
      return repository.remove(provider, parsed.expectedRevision);
    });
    const inFlight = new Set<string>();
    ipcMain.handle(
      channels.validate,
      async (event, value: unknown): Promise<ValidateServiceResult> => {
        if (!options.isExpectedSender(event)) return { status: 'error', error: unauthorized() };
        const parsed = parseServiceRevisionInput(value);
        if ('code' in parsed) return { status: 'error', error: parsed };
        const current = repository.summary(provider);
        if (current.revision !== parsed.expectedRevision)
          return { status: 'error', error: conflict(), currentSummary: current };
        if (inFlight.has(parsed.expectedRevision))
          return {
            status: 'error',
            error: {
              code: 'SOURCE_CONFLICT',
              messageKey: 'sources.error.validationInProgress',
              retryable: true,
            },
            currentSummary: current,
          };
        inFlight.add(parsed.expectedRevision);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30_000);
        try {
          await repository.setValidation(provider, parsed.expectedRevision, { status: 'running' });
          const credential = await repository.readCredential(provider, parsed.expectedRevision);
          await options.validate(provider, credential, controller.signal);
          const stored = await repository.setValidation(provider, parsed.expectedRevision, {
            status: 'succeeded',
            completedAt: new Date().toISOString(),
          });
          return { status: stored ? 'completed' : 'stale', summary: repository.summary(provider) };
        } catch (cause) {
          const error =
            cause instanceof SourceServiceValidationError
              ? cause.toSourceError()
              : new SourceServiceValidationError(
                  provider === 'mineru'
                    ? 'SOURCE_MINERU_TEMPORARY'
                    : 'SOURCE_SILICONFLOW_TEMPORARY',
                  true,
                ).toSourceError();
          await repository.setValidation(provider, parsed.expectedRevision, {
            status: 'failed',
            completedAt: new Date().toISOString(),
            code: error.code,
          });
          return {
            status: 'error',
            error,
            currentSummary: repository.summary(provider),
          };
        } finally {
          clearTimeout(timer);
          inFlight.delete(parsed.expectedRevision);
        }
      },
    );
  }
}

function conflict(): SourceError {
  return { code: 'SOURCE_CONFLICT', messageKey: 'sources.error.conflict', retryable: true };
}
