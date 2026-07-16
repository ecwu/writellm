# Phase 3: Project Container And Recovery Boundary

## Phase overview

- Purpose: define portable project containers, application/project database ownership, lifecycle state, locking, backup, restore, and snapshots.
- Checkpoints: 4–6.
- Current status: Completed.
- Implementation state: project lifecycle and recovery boundaries are complete and historically verified.

### Checkpoint 4: Split Application And Project Database Roles

- [x] Add an application-global `app.sqlite` connection under Electron `userData`.
- [x] Limit `app.sqlite` schema to application settings, recent projects, provider configuration metadata, encrypted credential records, and app schema metadata.
- [x] Refactor the existing authoritative connection code into a parameterized `ProjectDatabase` opened from `<ProjectRoot>/.writellm/project.sqlite`.
- [x] Remove or prevent project/manuscript/knowledge/job tables from the global application database.
- [x] Define and validate the `writellm.project.json` manifest schema with stable `projectId` and `formatVersion`.
- [x] Add the singleton project row and require its `projectId` to match the manifest.
- [x] Define the initial project directory constants and project-relative path normalization rules.
- [x] Ensure no project table or job payload stores an absolute path; Checkpoint 4 creates only the path-free singleton project row, and future project tables/jobs must use the validated project-relative path boundary.
- [x] Add migration handling for the current development `core.sqlite` state; unreleased development files are explicitly quarantined with a `.development-reset` suffix rather than reinterpreted as application state.
- [x] Add lifecycle events for app database open/migrate and project database open/migrate with distinct `databaseRole` fields.
- [x] Test app/project isolation, manifest/database ID mismatch, unsupported manifest versions, and Unicode project roots.

Acceptance criteria: completed and verified. A real Electron startup created and migrated `app.sqlite` without a project; isolated Unicode project roots created separate `project.sqlite` databases; the app schema contains no project tables; and identity mismatch is rejected before a project database handle is returned. Verification: `pnpm check`, `pnpm typecheck`, 46 Vitest tests, `pnpm build`, and an isolated-userData Electron runtime smoke.

### Checkpoint 5: Project Create, Open, Close, Switch, And Lock

- [x] Implement `ProjectManager` states: closed, creating, opening, open, closing, and recovery-required.
- [x] Implement named project creation into a new `<name>.writellm` child of a Main-selected parent directory, plus existing-project folder selection through Main-owned dialogs.
- [x] Replace empty-destination adoption with validated project names and creation of a new `<name>.writellm` child; keep clean pre-publication failures retryable in the same app session.
- [x] Create the complete staged project directory layout and atomically publish a valid new project.
- [x] Create the initial project, manuscript, writing brief, and first section records.
- [x] Implement a cross-platform project write lock with owner token, process/host metadata, heartbeat, and stale-lock recovery policy.
- [x] Reject concurrent writable opens from a second application instance.
- [x] Generate a new opaque `projectSessionId` on every successful open.
- [x] Require the active `projectSessionId` on every active-project IPC subscription and mutation.
- [x] Reject delayed results and requests from a closed or previously active project at the core manager boundary.
- [x] Implement ordered close: block new mutations, request editor flush, stop claims, park/abort workers, close databases, release lock, revoke session.
- [x] Implement project switch strictly as close-then-open.
- [x] Store only recent project pointers and display metadata in `app.sqlite`.
- [x] Expose up to five recent project pointers on the startup screen and open them by opaque project ID.
- [x] Handle moved/renamed projects by stable manifest ID rather than absolute-path identity.
- [x] Maximize each newly created application window once by default without coupling window state to project open, close, or switch transitions.
- [x] Add built-app E2E coverage for create, reopen, switch, app restart, moved project, lock contention, and stale IPC, plus deterministic integration coverage for stale-lock recovery.
- [x] Replace the temporary renderer with the approved shadcn/ui `new-york` application shell: global Menubar, `sidebar-09` workspace, and an anywhere-accessible Command settings surface while preserving project lifecycle behavior.

Checkpoint 5 verification now includes built-app Playwright Electron coverage for real renderer/preload/Main create, close/reopen, switch, recent-project startup listing and direct reopen, moved-root stable manifest identity, stale IPC session rejection, and live lock contention across two application processes with isolated `userData`. Deterministic integration tests retain explicit observed-owner stale-lock recovery, owner-change races, delayed-result/session rejection, immediate closing authority revocation, ordered close participants, recovery-required cleanup, and moved-project recent-pointer updates. Stale-lock recovery remains outside E2E because no user-facing explicit recovery workflow exists yet; E2E also does not claim automatic startup reopen or packaged-artifact coverage.

The renderer shell refresh is verified with the official shadcn/ui `new-york` generated components, Tailwind CSS 4, a persistent Menubar in closed and active-project states, `sidebar-09`-style nested sidebars, and a global Command settings surface. Named creation validates a renderer-provided project name and its UTF-8 filesystem component length at the preload and Main boundaries, lets Main select an arbitrary parent directory, exclusively reserves a new `<name>.writellm` child without replacing a directory or symlink, acquires its lock before publishing the manifest, and canonicalizes it before open. Component-aware containment protects forbidden application directories, recent-project metadata updates are best effort, recent startup entries are capped at five and opened by opaque project ID, filesystem errors are path-redacted in every logger destination, and project dialogs are state/concurrency gated before display. Existing target names are rejected cleanly and retry remains available in the same app session. Verification: the installed Biome, TypeScript, Vitest, electron-vite, and Playwright binaries passed (`biome check` with one pre-existing generated shadcn sidebar cookie warning, typecheck, 112 Vitest tests, build, and 4 Electron E2E tests). The local pnpm shim could not switch to the lockfile-pinned pnpm 11.10.0 because registry signature verification was unavailable; no dependencies or lockfiles were changed during verification.

Acceptance criteria: exactly one active project exists; two instances cannot write the same project; closing revokes every project capability; a project can be moved and reopened without database path repair.

### Checkpoint 6: Backup, Integrity, Restore, And Project Snapshot

- [x] Fix the implementation to the SQLite Online Backup API; reserve `VACUUM INTO` for a future compact/export mode.
- [x] Run app/project backup only when migration is needed, after lock acquisition and before any project-database write; verify the backup before migration.
- [x] Run and inspect `quick_check` plus `foreign_key_check` after migrations; use full `integrity_check` for explicit restore/import.
- [x] Add explicit project database restore with safety checks, pre-restore backup, staged atomic replacement, sidecar cleanup, and actionable failure reporting.
- [x] Add tests containing committed WAL-resident data, destination conflicts, failed validation, and migration backup retention.
- [x] Define retention and cleanup for verified migration backups under `.writellm/backups/`; failed migrations retain their verified backup because cleanup runs only after successful open.
- [x] Implement an initial project snapshot with a consistency barrier: pause mutations, authorize final editor flush, pause file publishers, back up `project.sqlite`, derive inventory from that backup, copy/hash registered files, and atomically publish.
- [x] Define and validate the snapshot manifest with independent format/schema versions, project ID, database hash/size, relative file inventory, and index omission flags.
- [x] Allow `index.sqlite` to be omitted from a snapshot and mark it `indexRebuildRequired`; do not implement actual index rebuild in CP6.
- [x] Exclude locks, temp/backups/recovery, SQLite sidecars, app data, logs, credentials, caches, partial files, unregistered/orphan files, and the snapshot itself.
- [x] Distinguish restore (same project ID) from clone/save-as (new project ID); reject mismatched restore candidates at the manifest/database boundary.
- [x] Test snapshot file-copy hash mismatch detection, traversal/symlinks/case collisions, Unicode/space paths, restore into a different absolute path, and subsequent project open without index.sqlite.

Acceptance criteria: verified backups include WAL-resident committed data; migration is never attempted without a verified pre-migration backup; restore returns the project to a verified usable state without stale sidecars; a snapshot restored elsewhere opens by project ID, preserves authoritative data, and reports `indexRebuildRequired` without claiming an index rebuild.

Checkpoint 6 verification: `biome check` passes with one pre-existing generated shadcn sidebar cookie warning; Node and web TypeScript checks pass; Electron-hosted Vitest passes 27 test files and 130 tests; and `electron-vite build` passes. Recovery-boundary tests additionally prove WAL-resident backup and restore data, pre- and mid-backup cancellation, simulated `ENOSPC`, no-replace backup publication, failed backup validation before migration, migration failure rollback and retention, restore identity/schema/checksum rejection, sidecar quarantine, symbolic-link parent rejection, file mutation during snapshot copy, Unicode relocation, and missing/incompatible index rebuild reporting without rebuilding. Direct system-Node Vitest is not a valid verification path for this repository because its Node ABI differs from the Electron-native `better-sqlite3` build.
