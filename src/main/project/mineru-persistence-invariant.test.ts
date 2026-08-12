import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { assertNoPersistedMineruCapabilities } from './mineru-persistence-invariant'

const databases: Database.Database[] = []

function databaseWithSchema(schema: string): Database.Database {
  const database = new Database(':memory:')
  databases.push(database)
  database.exec(schema)
  return database
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

describe('MinerU persistence invariant', () => {
  it('allows capability marker words in user-authored manuscript content', () => {
    const database = databaseWithSchema(`
      CREATE TABLE sections (
        section_id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL,
        objective TEXT
      ) STRICT;
      INSERT INTO sections VALUES (
        'section-1',
        'Signed URL discussion',
        'Compare signature=, encrypted_url_ciphertext, and recovery_capability handling.'
      );
    `)

    expect(() => assertNoPersistedMineruCapabilities(database)).not.toThrow()
  })

  it('rejects capability markers in persisted external workflow references', () => {
    const database = databaseWithSchema(`
      CREATE TABLE parse_tasks (
        parse_task_id TEXT PRIMARY KEY NOT NULL,
        remote_task_id TEXT,
        trace_id TEXT
      ) STRICT;
      INSERT INTO parse_tasks VALUES (
        'parse-1',
        'https://download.example.test/result?signature=private',
        NULL
      );
    `)

    expect(() => assertNoPersistedMineruCapabilities(database)).toThrow(
      'Project database contains a forbidden MinerU capability value in parse_tasks.remote_task_id'
    )
  })

  it('rejects capability markers in durable job metadata', () => {
    const database = databaseWithSchema(`
      CREATE TABLE jobs (
        job_id TEXT PRIMARY KEY NOT NULL,
        payload_json TEXT NOT NULL,
        progress_json TEXT,
        deduplication_key TEXT,
        error_json TEXT
      ) STRICT;
      INSERT INTO jobs VALUES (
        'job-1',
        '{"download":"https://download.example.test/result?signature=private"}',
        NULL,
        NULL,
        NULL
      );
    `)

    expect(() => assertNoPersistedMineruCapabilities(database)).toThrow(
      'Project database contains a forbidden MinerU capability value in jobs.payload_json'
    )
  })

  it('rejects legacy capability columns anywhere in the project schema', () => {
    const database = databaseWithSchema(`
      CREATE TABLE legacy_state (
        id TEXT PRIMARY KEY NOT NULL,
        download_url_ciphertext TEXT
      ) STRICT;
    `)

    expect(() => assertNoPersistedMineruCapabilities(database)).toThrow(
      'Project database persists a forbidden MinerU capability marker: download_url in legacy_state'
    )
  })
})
