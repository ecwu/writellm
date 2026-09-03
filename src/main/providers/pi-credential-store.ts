import type {
  AuthOperationOptions,
  Credential,
  CredentialInfo,
  CredentialStore
} from '@earendil-works/pi-ai'
import type { CredentialService } from './credential-service'

export class MainPiCredentialStore implements CredentialStore {
  readonly #tails = new Map<string, Promise<void>>()

  constructor(
    private readonly credentials: CredentialService,
    private readonly providerId = 'openai-compatible',
    private readonly providerConfigId: string | ((providerId: string) => Promise<string>) = 'agent'
  ) {}

  async read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
    options?.signal?.throwIfAborted()
    const providerConfigId = await this.resolveProviderConfigId(providerId)
    options?.signal?.throwIfAborted()
    const value = await this.credentials.readPersistedValue(providerConfigId)
    options?.signal?.throwIfAborted()
    if (value === undefined) return undefined
    if (!value.startsWith('{')) return { type: 'api_key', key: value }
    return parseCredential(value)
  }

  async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
    options?.signal?.throwIfAborted()
    if (typeof this.providerConfigId === 'function') return []
    const credential = await this.read(this.providerId, options)
    return credential === undefined ? [] : [{ providerId: this.providerId, type: credential.type }]
  }

  async modify(
    providerId: string,
    operation: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: AuthOperationOptions
  ): Promise<Credential | undefined> {
    return this.serialize(
      providerId,
      async () => {
        const current = await this.read(providerId, options)
        const next = await operation(current)
        options?.signal?.throwIfAborted()
        if (next === undefined) return current
        const providerConfigId = await this.resolveProviderConfigId(providerId)
        options?.signal?.throwIfAborted()
        const serialized = JSON.stringify(validateCredential(next))
        const ciphertext = this.credentials.encryptForPersistence(serialized)
        await this.credentials.persistEncrypted(providerConfigId, ciphertext)
        return next
      },
      options?.signal
    )
  }

  async delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
    await this.serialize(
      providerId,
      async () => {
        const providerConfigId = await this.resolveProviderConfigId(providerId)
        options?.signal?.throwIfAborted()
        await this.credentials.removeCredential(providerConfigId)
      },
      options?.signal
    )
  }

  private async resolveProviderConfigId(providerId: string): Promise<string> {
    if (typeof this.providerConfigId === 'function') return this.providerConfigId(providerId)
    if (providerId !== this.providerId) throw new Error('Credential provider is not available')
    return this.providerConfigId
  }

  private async serialize<T>(
    providerId: string,
    operation: () => Promise<T>,
    signal?: AbortSignal
  ): Promise<T> {
    signal?.throwIfAborted()
    const previous = this.#tails.get(providerId) ?? Promise.resolve()
    let release: () => void = () => undefined
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.then(() => current)
    this.#tails.set(providerId, tail)
    void tail.then(() => {
      if (this.#tails.get(providerId) === tail) this.#tails.delete(providerId)
    })
    const abort = Promise.withResolvers<never>()
    const onAbort = (): void => abort.reject(signal?.reason)
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      await Promise.race([previous, abort.promise])
      signal?.throwIfAborted()
      // Once active, retain the lock until the operation settles, even after cancellation.
      return await operation()
    } finally {
      signal?.removeEventListener('abort', onAbort)
      release()
    }
  }
}

function parseCredential(serialized: string): Credential {
  let value: unknown
  try {
    value = JSON.parse(serialized)
  } catch (err) {
    throw new Error('Stored Pi credential is invalid', { cause: err })
  }
  return validateCredential(value)
}

function validateCredential(value: unknown): Credential {
  if (value === null || typeof value !== 'object' || !('type' in value)) {
    throw new Error('Stored Pi credential is invalid')
  }
  if (value.type === 'api_key') {
    const key = 'key' in value ? value.key : undefined
    const env = 'env' in value ? value.env : undefined
    if (key !== undefined && (typeof key !== 'string' || key.length > 16_384)) {
      throw new Error('Stored Pi API-key credential is invalid')
    }
    if (
      env !== undefined &&
      (env === null ||
        typeof env !== 'object' ||
        Object.entries(env).some(
          ([name, entry]) =>
            name.length === 0 ||
            name.length > 200 ||
            typeof entry !== 'string' ||
            entry.length > 16_384
        ))
    ) {
      throw new Error('Stored Pi provider environment is invalid')
    }
    return {
      type: 'api_key',
      ...(key === undefined ? {} : { key }),
      ...(env === undefined ? {} : { env: env as Record<string, string> })
    }
  }
  if (value.type === 'oauth') {
    if (
      !('refresh' in value) ||
      typeof value.refresh !== 'string' ||
      !('access' in value) ||
      typeof value.access !== 'string' ||
      !('expires' in value) ||
      typeof value.expires !== 'number' ||
      !Number.isFinite(value.expires)
    ) {
      throw new Error('Stored Pi OAuth credential is invalid')
    }
    return value as Credential
  }
  throw new Error('Stored Pi credential type is invalid')
}
