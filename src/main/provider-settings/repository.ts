import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  deriveHarnessProfile,
  isAvailable,
  type ProviderConfig,
  type ProviderError,
  type ProviderSummary,
  type ValidationSummary,
} from '../../shared/provider-settings.js';
import type { SecretProtector } from './secret-protector.js';

type StoredValidation = {
  status: 'succeeded' | 'failed' | 'unknown' | 'stale';
  configRevision: string;
  completedAt: string;
  diagnosticCode: ValidationSummary['diagnosticCode'];
  safeMessage: string;
};
type SettingsDoc = {
  kind: 'writellm.provider-settings';
  schemaVersion: 1;
  revision: string;
  config: ProviderConfig | null;
  secretConfigured: boolean;
  validation: StoredValidation | null;
  updatedAt: string;
};
type SecretDoc = {
  kind: 'writellm.provider-secret';
  schemaVersion: 1;
  configRevision: string;
  ciphertext: string;
  updatedAt: string;
};
const storageError = (): ProviderError => ({
  code: 'PROVIDER_STORAGE_UNAVAILABLE',
  message: 'Settings could not be saved. Your previous settings remain current.',
});
export class ProviderSettingsRepository {
  private settings: SettingsDoc | null = null;
  private secret: SecretDoc | null = null;
  private secretState: ProviderSummary['secretState'] = 'not-configured';
  private queue = Promise.resolve();
  constructor(
    private dir: string,
    private protector: SecretProtector,
    private now = () => new Date().toISOString(),
    private id = () => randomUUID(),
  ) {}
  async initialize() {
    await mkdir(this.dir, { recursive: true });
    try {
      this.settings = JSON.parse(
        await readFile(path.join(this.dir, 'provider-settings.json'), 'utf8'),
      );
      if (this.settings?.kind !== 'writellm.provider-settings' || this.settings.schemaVersion !== 1)
        throw 0;
    } catch {
      this.settings = null;
    }
    try {
      this.secret = JSON.parse(await readFile(path.join(this.dir, 'provider-secret.json'), 'utf8'));
      if (this.secret?.kind !== 'writellm.provider-secret' || this.secret.schemaVersion !== 1)
        throw 0;
    } catch {
      this.secret = null;
    }
    if (this.settings?.secretConfigured) {
      if (!this.secret || this.secret.configRevision !== this.settings.revision)
        this.secretState = 'invalid';
      else
        try {
          await this.protector.unprotect(this.secret.ciphertext);
          this.secretState = 'configured';
        } catch {
          this.secretState = (await this.protector.available().catch(() => false))
            ? 'invalid'
            : 'unavailable';
        }
    }
  }
  summary(validationOverride?: ValidationSummary): ProviderSummary {
    const validation =
      validationOverride ??
      (this.settings?.validation
        ? {
            status: this.settings.validation.status,
            completedAt: this.settings.validation.completedAt,
            diagnosticCode: this.settings.validation.diagnosticCode,
            safeMessage: this.settings.validation.safeMessage,
          }
        : { status: 'not-run' });
    const summary: ProviderSummary = {
      revision: this.settings?.revision ?? null,
      config: this.settings?.config ?? null,
      harnessProfile: this.settings?.config ? deriveHarnessProfile(this.settings.config) : null,
      secretState: this.secretState,
      validation,
      available: false,
    };
    summary.available = isAvailable(summary);
    return summary;
  }
  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
  private conflict(expected: string | null) {
    return expected !== (this.settings?.revision ?? null);
  }
  async readSecret() {
    if (!this.secret || this.secretState !== 'configured') throw new Error('secret');
    return this.protector.unprotect(this.secret.ciphertext);
  }
  async save(expected: string | null, config: ProviderConfig, secret?: string) {
    return this.serialize(async () => {
      if (this.conflict(expected))
        return {
          ok: false as const,
          error: {
            code: 'PROVIDER_CONFLICT',
            message: 'Settings changed. Reload and review before retrying.',
          } as ProviderError,
        };
      let cipher: string;
      try {
        cipher =
          secret !== undefined
            ? await this.protector.protect(secret)
            : this.secret
              ? this.secret.ciphertext
              : await Promise.reject();
      } catch {
        return {
          ok: false as const,
          error: {
            code: 'PROVIDER_SECRET_STORAGE_UNAVAILABLE',
            message:
              'Secure storage is unavailable. Retry after unlocking the operating system secret service.',
          } as ProviderError,
        };
      }
      return this.publish(config, cipher, true);
    });
  }
  async replace(expected: string, secret: string) {
    return this.serialize(async () => {
      if (this.conflict(expected))
        return {
          ok: false as const,
          error: {
            code: 'PROVIDER_CONFLICT',
            message: 'Settings changed. Reload and review before retrying.',
          } as ProviderError,
        };
      let cipher: string;
      try {
        cipher = await this.protector.protect(secret);
      } catch {
        return {
          ok: false as const,
          error: {
            code: 'PROVIDER_SECRET_STORAGE_UNAVAILABLE',
            message: 'Secure storage is unavailable.',
          } as ProviderError,
        };
      }
      return this.publish(this.settings?.config ?? null, cipher, true);
    });
  }
  async remove(expected: string) {
    return this.serialize(async () =>
      this.conflict(expected)
        ? {
            ok: false as const,
            error: {
              code: 'PROVIDER_CONFLICT',
              message: 'Settings changed. Reload and review before retrying.',
            } as ProviderError,
          }
        : this.publish(this.settings?.config ?? null, null, false),
    );
  }
  private async publish(config: ProviderConfig | null, cipher: string | null, configured: boolean) {
    const revision = this.id(),
      updatedAt = this.now();
    const validation = this.settings?.validation
      ? {
          ...this.settings.validation,
          status: 'stale' as const,
          configRevision: revision,
          diagnosticCode: 'VALIDATION_STALE' as const,
          safeMessage: 'Settings changed. Validate again.',
        }
      : null;
    const settings: SettingsDoc = {
      kind: 'writellm.provider-settings',
      schemaVersion: 1,
      revision,
      config,
      secretConfigured: configured,
      validation,
      updatedAt,
    };
    const secret = cipher
      ? {
          kind: 'writellm.provider-secret' as const,
          schemaVersion: 1 as const,
          configRevision: revision,
          ciphertext: cipher,
          updatedAt,
        }
      : null;
    const sp = path.join(this.dir, 'provider-settings.json'),
      kp = path.join(this.dir, 'provider-secret.json');
    try {
      await writeFile(`${sp}.tmp`, JSON.stringify(settings));
      if (secret) await writeFile(`${kp}.tmp`, JSON.stringify(secret));
      await rename(`${sp}.tmp`, sp);
      if (secret) await rename(`${kp}.tmp`, kp);
      else await rm(kp, { force: true });
      this.settings = settings;
      this.secret = secret;
      this.secretState = configured ? 'configured' : 'not-configured';
      return { ok: true as const, summary: this.summary() };
    } catch {
      await rm(`${sp}.tmp`, { force: true });
      await rm(`${kp}.tmp`, { force: true });
      return { ok: false as const, error: storageError() };
    }
  }
  async persistValidation(revision: string, validation: StoredValidation) {
    return this.serialize(async () => {
      if (!this.settings || this.settings.revision !== revision) return false;
      const next = { ...this.settings, validation, updatedAt: this.now() };
      try {
        const target = path.join(this.dir, 'provider-settings.json');
        await writeFile(`${target}.tmp`, JSON.stringify(next));
        await rename(`${target}.tmp`, target);
        this.settings = next;
        return true;
      } catch {
        return false;
      }
    });
  }
}
