import type { Credential, CredentialInfo, CredentialStore } from '@earendil-works/pi-ai'
import type { CredentialService } from './credential-service'

export class MainPiCredentialStore implements CredentialStore {
  readonly #tails = new Map<string, Promise<void>>()

  constructor(
    private readonly credentials: CredentialService,
    private readonly providerId = 'openai-compatible',
    private readonly providerConfigId: string | ((providerId: string) => Promise<string>) = 'agent'
  ) {}

  async read(providerId: string): Promise<Credential | undefined> {
    const providerConfigId = await this.resolveProviderConfigId(providerId)
    const value = await this.credentials.readPersistedValue(providerConfigId)
    if (value === undefined) return undefined
    if (!value.startsWith('{')) return { type: 'api_key', key: value }
    return parseCredential(value)
  }

  async list(): Promise<readonly CredentialInfo[]> {
    if (typeof this.providerConfigId === 'function') return []
    const credential = await this.read(this.providerId)
    return credential === undefined ? [] : [{ providerId: this.providerId, type: credential.type }]
  }

  async modify(
    providerId: string,
    operation: (current: Credential | undefined) => Promise<Credential | undefined>
  ): Promise<Credential | undefined> {
    return this.serialize(providerId, async () => {
      const current = await this.read(providerId)
      const next = await operation(current)
      if (next === undefined) return current
      const serialized = JSON.stringify(validateCredential(next))
      const ciphertext = this.credentials.encryptForPersistence(serialized)
      await this.credentials.persistEncrypted(
        await this.resolveProviderConfigId(providerId),
        ciphertext
      )
      return next
    })
  }

  async delete(providerId: string): Promise<void> {
    await this.serialize(providerId, async () =>
      this.credentials.removeCredential(await this.resolveProviderConfigId(providerId))
    )
  }

  private async resolveProviderConfigId(providerId: string): Promise<string> {
    if (typeof this.providerConfigId === 'function') return this.providerConfigId(providerId)
    if (providerId !== this.providerId) throw new Error('Credential provider is not available')
    return this.providerConfigId
  }

  private async serialize<T>(providerId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(providerId) ?? Promise.resolve()
    let release: () => void = () => undefined
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.then(() => current)
    this.#tails.set(providerId, tail)
    await previous
    try {
      return await operation()
    } finally {
      release()
      if (this.#tails.get(providerId) === tail) this.#tails.delete(providerId)
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
