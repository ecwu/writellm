import { createHash } from 'node:crypto'
import type { Kysely, Transaction } from 'kysely'
import type { Logger } from 'pino'
import type { OpenedDatabase } from '../db/open-database'
import type { AppDatabaseSchema } from '../app-db/database-types'

export interface ProviderSecurityIdentity {
  providerConfigId: string
  provider: string
  role: string | null
  kind: string | null
  api: string | null
  authMode: string | null
  origin: string | null
}

export function providerSecurityIdentity(input: {
  providerConfigId: string
  provider: string
  configJson: string
}): ProviderSecurityIdentity {
  let config: Record<string, unknown>
  try {
    const parsed = JSON.parse(input.configJson) as unknown
    config =
      parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  } catch (err) {
    throw new Error('Provider configuration is invalid', { cause: err })
  }
  return {
    providerConfigId: input.providerConfigId,
    provider: input.provider,
    role: stringField(config, 'role'),
    kind: stringField(config, 'kind'),
    api: stringField(config, 'api'),
    authMode: stringField(config, 'authMode'),
    origin: normalizeOrigin(stringField(config, 'baseUrl'))
  }
}

export function credentialBindingFingerprint(input: {
  providerConfigId: string
  provider: string
  configJson: string
}): string {
  return createHash('sha256')
    .update(JSON.stringify(providerSecurityIdentity(input)))
    .digest('hex')
}

export async function expectedCredentialBinding(
  database: Kysely<AppDatabaseSchema> | Transaction<AppDatabaseSchema>,
  providerConfigId: string
): Promise<string> {
  const row = await database
    .selectFrom('provider_configs')
    .select(['id', 'provider', 'config_json'])
    .where('id', '=', providerConfigId)
    .executeTakeFirst()
  if (row === undefined) throw new Error('Provider configuration is missing')
  return credentialBindingFingerprint({
    providerConfigId: row.id,
    provider: row.provider,
    configJson: row.config_json
  })
}

export async function backfillCredentialBindings(
  database: OpenedDatabase<AppDatabaseSchema>,
  log: Pick<Logger, 'info' | 'error'>
): Promise<void> {
  const rows = await database.kysely
    .selectFrom('encrypted_credentials')
    .innerJoin(
      'provider_configs',
      'provider_configs.id',
      'encrypted_credentials.provider_config_id'
    )
    .select([
      'encrypted_credentials.id as credential_id',
      'encrypted_credentials.provider_config_id',
      'provider_configs.provider',
      'provider_configs.config_json'
    ])
    .where('encrypted_credentials.binding_fingerprint', 'is', null)
    .execute()
  if (rows.length === 0) return
  try {
    await database.kysely.transaction().execute(async (transaction) => {
      for (const row of rows) {
        const bindingFingerprint = credentialBindingFingerprint({
          providerConfigId: row.provider_config_id,
          provider: row.provider,
          configJson: row.config_json
        })
        await transaction
          .updateTable('encrypted_credentials')
          .set({ binding_fingerprint: bindingFingerprint })
          .where('id', '=', row.credential_id)
          .where('binding_fingerprint', 'is', null)
          .execute()
      }
    })
    log.info(
      { event: 'credential.binding_backfill.completed', credentialCount: rows.length },
      'Backfilled provider credential security bindings'
    )
  } catch (err) {
    log.error(
      { event: 'credential.binding_backfill.failed', err, credentialCount: rows.length },
      'Failed to backfill provider credential security bindings'
    )
    throw new Error('Credential security binding migration failed', { cause: err })
  }
}

function stringField(value: Record<string, unknown>, key: string): string | null {
  const field = value[key]
  return typeof field === 'string' ? field : null
}

function normalizeOrigin(baseUrl: string | null): string | null {
  if (baseUrl === null) return null
  try {
    return new URL(baseUrl).origin
  } catch (err) {
    throw new Error('Provider endpoint is invalid', { cause: err })
  }
}
