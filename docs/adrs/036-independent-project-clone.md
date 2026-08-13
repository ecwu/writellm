# ADR 036: Independent Project Clone

- Status: Accepted
- Date: 2026-08-13
- Checkpoint: 46

## Context

Restore deliberately preserves project identity because it replaces or relocates one authority.
Clone / Save As creates a second independently writable authority and therefore must mint a new
identity. A raw directory copy is unsafe: an open SQLite database may have WAL state, transient or
rebuildable files may be copied, links may escape the project, and the manifest can disagree with
the database.

## Decision

Clone is a Main-owned, cancellable operation built on the existing snapshot barrier and verified
opened-database backup. It first captures the current source through the same mutation pause,
final editor flush, file-publisher pause, integrity checks, migration validation, and hashed file
inventory used by snapshots. The fixed first-version policy copies the project database and all
inventoried authoritative manuscript, asset, knowledge, parsed-artifact, Brief, annotation, and
Agent-history state. It omits `index.sqlite` and its sidecars, `.writellm/history.git`, backups,
recovery, temporary files, exports, snapshots, partial files, and application-global credentials.

The captured candidate is transformed only in a private sibling staging directory. Main mints a
new UUID and creation timestamp. The complete project-database rewrite list is exactly:

- `project_meta.project_id`;
- `manuscripts.project_id`.

No other project table stores project identity; stable manuscript, knowledge, asset, annotation,
Agent session/run, proposal, review, and task IDs remain unchanged because they identify copied
content inside the new project. The rewrite runs in one deferred-foreign-key transaction. A schema
assertion rejects cloning if a future migration adds an unenumerated `project_id` column. The
candidate then passes full SQLite integrity/foreign-key/migration/invariant validation, hashed
inventory validation, forbidden-path checks, and manifest/database identity validation.

The old manifest and snapshot metadata are removed before transformation. The new project
manifest is written last inside staging, and the complete directory is published with one
create-only rename. Failure or cancellation removes staging and never changes the source or
publishes a destination. After successful publication, Save As closes the source and opens the
clone through the normal project lifecycle, which is the first point at which recent-project state
may be updated. The clone has no version-history repository and opens with history uninitialized (ADR 007's
initial-checkpoint rule does not apply to clone);
its missing derived index follows the normal rebuild path.

## Consequences

- Source and clone may be opened sequentially and can never share a `projectId`.
- Clone is not a restore mode, folder watcher, multi-project runtime, or configurable backup UI.
- Copied content keeps internal IDs and provenance; only project-level identity changes.
- Application-global provider credentials and settings are available to the application as usual
  but are never copied into the project folder.
- A later schema change that introduces project identity must update this ADR and the asserted
  rewrite list before cloning can proceed.
