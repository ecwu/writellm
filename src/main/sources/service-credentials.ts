import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  ServiceMutationResult,
  ServiceProvider,
  SourceErrorCode,
  SourceServiceSummary,
} from '../../shared/sources.js';

export interface SourceSecretProtector {
  available(): Promise<boolean>;
  protect(value: string): Promise<string>;
  unprotect(value: string): Promise<string>;
}
type StoredProvider = {
  revision: string;
  ciphertext: string;
  validation: SourceServiceSummary['validation'];
  updatedAt: string;
};
type StoredServices = {
  kind: 'writellm.source-services';
  schemaVersion: 1;
  mineru: StoredProvider | null;
  siliconflow: StoredProvider | null;
};
const empty = (): StoredServices => ({
  kind: 'writellm.source-services',
  schemaVersion: 1,
  mineru: null,
  siliconflow: null,
});

export class SourceServiceCredentials {
  private document = empty();
  private readable: Record<ServiceProvider, boolean> = { mineru: false, siliconflow: false };
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private directory: string,
    private protector: SourceSecretProtector,
    private id = () => randomUUID(),
    private now = () => new Date().toISOString(),
  ) {}

  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.file(), 'utf8')) as StoredServices;
      if (parsed.kind !== 'writellm.source-services' || parsed.schemaVersion !== 1)
        throw new Error();
      this.document = parsed;
    } catch {
      this.document = empty();
    }
    for (const provider of ['mineru', 'siliconflow'] as const) {
      const stored = this.document[provider];
      if (!stored) continue;
      try {
        if (!(await this.protector.available())) throw new Error();
        await this.protector.unprotect(stored.ciphertext);
        this.readable[provider] = true;
      } catch {
        this.readable[provider] = false;
      }
    }
  }

  summary(provider: ServiceProvider): SourceServiceSummary {
    const stored = this.document[provider];
    return {
      provider,
      revision: stored?.revision ?? null,
      configured: Boolean(stored),
      available: Boolean(
        stored && this.readable[provider] && stored.validation.status === 'succeeded',
      ),
      validation: stored?.validation ?? { status: 'never' },
    };
  }

  save(
    provider: ServiceProvider,
    expectedRevision: string | null,
    credential: string,
  ): Promise<ServiceMutationResult> {
    return this.serial(async () => {
      if (this.summary(provider).revision !== expectedRevision)
        return { status: 'conflict', currentSummary: this.summary(provider) };
      try {
        if (!(await this.protector.available())) throw new Error('protection unavailable');
        const revision = this.id();
        const ciphertext = await this.protector.protect(credential);
        const next: StoredServices = {
          ...this.document,
          [provider]: {
            revision,
            ciphertext,
            validation: { status: 'never' },
            updatedAt: this.now(),
          },
        };
        await this.publish(next);
        this.document = next;
        this.readable[provider] = true;
        return { status: 'saved', summary: this.summary(provider) };
      } catch {
        return { status: 'error', error: storageError(), currentSummary: this.summary(provider) };
      }
    });
  }

  remove(provider: ServiceProvider, expectedRevision: string): Promise<ServiceMutationResult> {
    return this.serial(async () => {
      if (this.summary(provider).revision !== expectedRevision)
        return { status: 'conflict', currentSummary: this.summary(provider) };
      try {
        const next = { ...this.document, [provider]: null };
        await this.publish(next);
        this.document = next;
        this.readable[provider] = false;
        return { status: 'removed', summary: this.summary(provider) };
      } catch {
        return { status: 'error', error: storageError(), currentSummary: this.summary(provider) };
      }
    });
  }

  async readCredential(provider: ServiceProvider, expectedRevision: string): Promise<string> {
    const stored = this.document[provider];
    if (!stored || stored.revision !== expectedRevision || !this.readable[provider])
      throw new Error('SOURCE_CREDENTIAL_UNAVAILABLE');
    if (!(await this.protector.available())) throw new Error('SOURCE_CREDENTIAL_UNAVAILABLE');
    return this.protector.unprotect(stored.ciphertext);
  }

  setValidation(
    provider: ServiceProvider,
    expectedRevision: string,
    validation: SourceServiceSummary['validation'],
  ): Promise<boolean> {
    return this.serial(async () => {
      const stored = this.document[provider];
      if (!stored || stored.revision !== expectedRevision) return false;
      const next = {
        ...this.document,
        [provider]: { ...stored, validation, updatedAt: this.now() },
      };
      try {
        await this.publish(next);
        this.document = next;
        return true;
      } catch {
        return false;
      }
    });
  }

  private async publish(document: StoredServices): Promise<void> {
    const temp = `${this.file()}.tmp-${randomUUID()}`;
    try {
      await writeFile(temp, `${JSON.stringify(document)}\n`, { encoding: 'utf8', flag: 'wx' });
      await rename(temp, this.file());
    } finally {
      await rm(temp, { force: true });
    }
  }
  private file() {
    return path.join(this.directory, 'source-services.json');
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

function storageError() {
  return {
    code: 'SOURCE_STORAGE_UNAVAILABLE' as SourceErrorCode,
    messageKey: 'sources.error.secureStorageUnavailable',
    retryable: true,
  };
}
