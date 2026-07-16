# Phase 2: Completed Database Primitives

## Phase overview

- Purpose: provide SQLite connections, pragmas, forward-only migrations, schema manifests, and database lifecycle tests.
- Checkpoints: 3.
- Current status: Completed.
- Implementation state: the database primitives are accepted; later phases own the project/application data split.

### Checkpoint 3: SQLite Connection And Migration Primitives

- [x] Install better-sqlite3, Kysely, and types.
- [x] Implement required pragmas and short transaction helpers.
- [x] Implement statically packaged forward-only migrations and schema manifests.
- [x] Add fresh-create, sequential-upgrade, failure rollback, and foreign-key tests.
- [x] Add database lifecycle logging and packaged migration smoke tests.

Correction (2026-07-16 implementation audit): lifecycle logging is implemented; the packaged migration smoke was a one-off historical verification run and no durable packaged-migration smoke script remains in `scripts/`. The durable packaged smokes are `smoke:packaged-hybrid` and the packaged vector smoke.

Acceptance criteria: completed under the original tracker. The primitives are accepted; the database ownership model is revised by Checkpoint 4.
