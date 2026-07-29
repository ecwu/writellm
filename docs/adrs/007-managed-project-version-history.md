# ADR 007: Managed Project Version History

Status: Accepted

Date: 2026-07-29

## Context

A WriteLLM project is a directory containing authoritative SQLite state and project-owned files.
Autosave revisions protect editor work, while verified snapshots provide portable backups, but
neither gives users a named, inspectable history of consistent whole-project states. Treating the
project root as a normal Git worktree would expose application internals, collide with a user's
own repository, and make correctness depend on a system Git installation.

## Decision

WriteLLM owns one bare Git repository at `.writellm/history.git` and accesses it only through a
Main-process `ProjectVersionStore` backed by exact-pinned `isomorphic-git@1.40.0`. Every operation
passes the explicit `gitdir`; repository discovery, shell Git, branches other than `main`, remotes,
merge, and user-authored Git configuration are out of scope.

Autosave does not create commits. Commits are created only for initial history setup, a
user-requested checkpoint, a pre-restore safety checkpoint, or the completion of a restore.
Checkpoint capture reuses the project snapshot consistency barrier: mutations and publishers are
paused, the editor performs its final flush, SQLite Online Backup produces the database image, and
all included files are validated before Git objects are written. The commit tree excludes the
derived index, SQLite sidecars, locks, logs, credentials, temporary and recovery content, backups,
and the history repository itself.

The repository has a strict project-ownership marker and a linear `refs/heads/main`. Objects and
the commit are written before the ref advances. A missing history repository is `uninitialized`;
an invalid, symbolic-link, foreign-project, or inconsistent repository is `damaged`. Either state
must not block opening or editing the project.

New projects receive an initial checkpoint after successful publication and opening. Existing
projects require user consent. Renderer APIs are session-authorized and return only bounded
checkpoint metadata and sanitized errors; they never expose project paths, Git paths, temporary
paths, or raw Git errors. Restore materializes and validates a selected commit, preserves the
existing repository, and appends a new restore commit instead of rewriting history.

## Consequences

- Version history is a local recovery mechanism, not an off-device backup.
- External Snapshot v2 can include the complete managed repository; Snapshot v1 remains readable
  and restores without version history.
- Users do not manage Git concepts such as branches or remotes in the product UI.
- Direct external modification of `.writellm/history.git` is unsupported and fails closed rather
  than being repaired or overwritten automatically.

