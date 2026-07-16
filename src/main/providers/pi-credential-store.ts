import type { Credential, CredentialStore } from '@earendil-works/pi-ai'
import type { CredentialService } from './credential-service'

export class MainPiCredentialStore implements CredentialStore {
  readonly #tails = new Map<string, Promise<void>>()

  constructor(
    private readonly credentials: CredentialService,
    private readonly providerId = 'openai-compatible',
    private readonly providerConfigId = 'agent'
  ) {}

  async read(providerId: string): Promise<Credential | undefined> {
    this.assertProvider(providerId)
    if (!(await this.credentials.hasCredential(this.providerConfigId))) return undefined
    return this.credentials.withCredential(this.providerConfigId, async (key) => ({
      type: 'api_key',
      key
    }))
  }

  async modify(
    providerId: string,
    operation: (current: Credential | undefined) => Promise<Credential | undefined>
  ): Promise<Credential | undefined> {
    this.assertProvider(providerId)
    return this.serialize(providerId, async () => {
      const current = await this.read(providerId)
      const next = await operation(current)
      if (next === undefined) return current
      if (next.type !== 'api_key' || typeof next.key !== 'string' || next.key.length === 0) {
        throw new Error('Only non-empty API-key credentials are supported')
      }
      const ciphertext = this.credentials.encryptForPersistence(next.key)
      await this.credentials.persistEncrypted(this.providerConfigId, ciphertext)
      return { type: 'api_key', key: next.key }
    })
  }

  async delete(providerId: string): Promise<void> {
    this.assertProvider(providerId)
    await this.serialize(providerId, () => this.credentials.removeCredential(this.providerConfigId))
  }

  private assertProvider(providerId: string): void {
    if (providerId !== this.providerId) throw new Error('Credential provider is not available')
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
