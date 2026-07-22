# ADR 002: Preserve Section Lineage With Internal Tombstones

Status: accepted
Date: 2026-07-22

## Context

An outline proposal may delete a section whose accepted Agent revisions are still referenced by
`mutation_proposals`. Physical deletion cascades through `section_revisions`, while the proposal
foreign keys correctly prevent that immutable lineage from being discarded. The result is a raw
SQLite foreign-key failure during proposal approval.

The alternatives were to cascade away Agent history, null its revision links, or reject the user's
outline deletion. The first two violate the accepted lineage boundary, and the last leaves the
document operation incomplete.

## Decision

Deleting a section creates an internal tombstone. Main sets `sections.deleted_at`, removes the
section from every active outline query, deletes its materialization registration, and keeps the
section row, revision chain, and proposal/model lineage intact. Active-section position indexes
exclude tombstones, and section identifiers are never reused.

The existing leaf-only and last-active-section guards remain. Tombstoned sections cannot be read,
edited, moved, used as parents, or targeted by new section proposals. Undoing an older section
proposal after its section is tombstoned fails explicitly as not undoable.

## Consequences

This is not reversible outline deletion. The initial product exposes no restore UI and no outline
undo. A future restore feature requires a separate decision covering parent recovery, position
conflicts, current-revision selection, and materialization publication.

Project schema migration 0018 adds the tombstone marker and active-only position indexes without
adding a new table. Existing projects migrate with every section active. Failed pre-migration
approval transactions remain pending and may be retried after upgrade if their outline base is
still current.
