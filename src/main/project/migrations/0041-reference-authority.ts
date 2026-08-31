import type { DatabaseMigration } from '../../db/migrations'

export const migration0041: DatabaseMigration = {
  version: 41,
  name: '0041-reference-authority',
  checksum: 'sha256:820fab50388222163d995b139c6aec181c1ee3928ecb13d5c555b1327d25d815',
  up(database) {
    database.exec(`
      CREATE TABLE reference_items (
        reference_id TEXT PRIMARY KEY NOT NULL,
        citation_key TEXT NOT NULL UNIQUE COLLATE BINARY
          CHECK (
            length(citation_key) BETWEEN 1 AND 128
            AND citation_key GLOB '[A-Za-z0-9]*'
            AND citation_key NOT GLOB '*[^A-Za-z0-9._:+-]*'
          ),
        csl_type TEXT NOT NULL CHECK (length(csl_type) BETWEEN 1 AND 100),
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 4096),
        container_title TEXT CHECK (container_title IS NULL OR length(container_title) <= 2048),
        issued_year INTEGER CHECK (issued_year IS NULL OR issued_year BETWEEN -9999 AND 9999),
        doi TEXT CHECK (doi IS NULL OR length(doi) <= 512),
        isbn TEXT CHECK (isbn IS NULL OR length(isbn) <= 256),
        url TEXT CHECK (url IS NULL OR length(url) <= 4096),
        csl_json TEXT NOT NULL CHECK (
          json_valid(csl_json)
          AND json_type(csl_json) = 'object'
          AND length(CAST(csl_json AS BLOB)) <= 1048576
        ),
        metadata_completeness TEXT NOT NULL
          CHECK (metadata_completeness IN ('complete', 'partial', 'incomplete')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE reference_creators (
        reference_id TEXT NOT NULL REFERENCES reference_items(reference_id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('author', 'editor', 'translator', 'container-author')),
        ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
        given_name TEXT CHECK (given_name IS NULL OR length(given_name) <= 1024),
        family_name TEXT CHECK (family_name IS NULL OR length(family_name) <= 1024),
        literal_name TEXT CHECK (literal_name IS NULL OR length(literal_name) <= 2048),
        PRIMARY KEY (reference_id, role, ordinal),
        CHECK (given_name IS NOT NULL OR family_name IS NOT NULL OR literal_name IS NOT NULL)
      ) STRICT;

      CREATE TABLE reference_import_bindings (
        reference_id TEXT PRIMARY KEY NOT NULL
          REFERENCES reference_items(reference_id) ON DELETE CASCADE,
        connector_id TEXT NOT NULL CHECK (length(connector_id) BETWEEN 1 AND 128),
        upstream_key TEXT NOT NULL CHECK (length(upstream_key) BETWEEN 1 AND 1024),
        source_format TEXT NOT NULL CHECK (source_format IN ('better-csl-json', 'bibtex')),
        source_fingerprint TEXT NOT NULL
          CHECK (length(source_fingerprint) = 64 AND source_fingerprint NOT GLOB '*[^0-9a-f]*'),
        sync_status TEXT NOT NULL
          CHECK (sync_status IN ('synced', 'changed', 'relink_required', 'source_unavailable')),
        last_synced_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (connector_id, upstream_key)
      ) STRICT;

      CREATE TABLE knowledge_reference_links (
        reference_id TEXT NOT NULL REFERENCES reference_items(reference_id) ON DELETE CASCADE,
        knowledge_item_id TEXT NOT NULL REFERENCES knowledge_items(knowledge_item_id) ON DELETE CASCADE,
        relationship TEXT NOT NULL CHECK (relationship IN ('primary', 'supplement')),
        created_at TEXT NOT NULL,
        PRIMARY KEY (reference_id, knowledge_item_id),
        UNIQUE (knowledge_item_id)
      ) STRICT;

      CREATE TABLE reference_settings (
        singleton_id INTEGER PRIMARY KEY NOT NULL CHECK (singleton_id = 1),
        style_id TEXT NOT NULL CHECK (length(style_id) BETWEEN 1 AND 256),
        locale TEXT NOT NULL CHECK (length(locale) BETWEEN 2 AND 35),
        custom_style_relative_path TEXT
          CHECK (custom_style_relative_path IS NULL OR (
            length(custom_style_relative_path) BETWEEN 1 AND 1024
            AND custom_style_relative_path NOT LIKE '/%'
            AND custom_style_relative_path NOT LIKE '%..%'
          )),
        custom_style_sha256 TEXT CHECK (custom_style_sha256 IS NULL OR (
          length(custom_style_sha256) = 64
          AND custom_style_sha256 NOT GLOB '*[^0-9a-f]*'
        )),
        updated_at TEXT NOT NULL,
        CHECK ((custom_style_relative_path IS NULL) = (custom_style_sha256 IS NULL))
      ) STRICT;

      CREATE INDEX reference_items_title_idx ON reference_items(title COLLATE NOCASE);
      CREATE INDEX reference_items_year_idx ON reference_items(issued_year);
      CREATE INDEX reference_creators_name_idx
        ON reference_creators(family_name COLLATE NOCASE, literal_name COLLATE NOCASE);
      CREATE INDEX reference_bindings_connector_idx
        ON reference_import_bindings(connector_id, sync_status);
      CREATE INDEX knowledge_reference_links_knowledge_idx
        ON knowledge_reference_links(knowledge_item_id);
      CREATE UNIQUE INDEX knowledge_reference_links_primary_idx
        ON knowledge_reference_links(reference_id) WHERE relationship = 'primary';

      INSERT INTO reference_settings
        (singleton_id, style_id, locale, custom_style_relative_path, custom_style_sha256, updated_at)
      VALUES (1, 'apa', 'en-US', NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

      INSERT INTO reference_items (
        reference_id, citation_key, csl_type, title, container_title, issued_year,
        doi, isbn, url, csl_json, metadata_completeness, created_at, updated_at
      )
      SELECT knowledge_item_id,
             'doc-' || lower(replace(knowledge_item_id, '-', '')),
             'document',
             display_name,
             NULL,
             NULL,
             NULL,
             NULL,
             NULL,
             json_object(
               'id', 'doc-' || lower(replace(knowledge_item_id, '-', '')),
               'type', 'document',
               'title', display_name
             ),
             'incomplete',
             created_at,
             updated_at
        FROM knowledge_items
       WHERE state = 'stored';

      INSERT INTO knowledge_reference_links
        (reference_id, knowledge_item_id, relationship, created_at)
      SELECT knowledge_item_id, knowledge_item_id, 'primary', created_at
        FROM knowledge_items
       WHERE state = 'stored';
    `)
  }
}
