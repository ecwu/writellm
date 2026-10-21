# ADR 089: Shared Manuscript Section Write Authority

Status: accepted under Issue 18
Date: 2026-10-21

## Context

Manuscript editor saves, replacement and undo, and approved Agent mutations all write the
`sections` and `section_revisions` tables. The same revision serialization, asset-reference
registration, and current-revision compare-and-set logic was implemented in more than one module.
That duplication made it possible for a new writer to omit a required invariant, especially the
content hash, revision lineage, asset references, or optimistic concurrency check.

## Decision

Add a small Main-process `SectionRepository` write boundary. The repository owns the shared
prepared revision insert, section creation, current-revision compare-and-set update, outline
metadata update, and tombstone operations. It uses the existing content preparation, asset
reference, and database contracts. Callers keep their existing transaction, validation, logging,
comment-anchor mapping, materialization, and domain-error behavior.
Editor retention continues to own policy-specific compaction of old revision bodies because it
does not create revisions or move the current head.

The repository is a prepared-SQL adapter, not a general ORM or RPC layer. It does not move network
work into transactions, expose database access to the Renderer, or change the authoritative
`project.sqlite` boundary. Migrations and project initialization retain their existing ownership.

## Alternatives

Keeping each writer local preserves short-term file locality but retains the invariant drift that
Issue 18 identified. Moving every manuscript operation to a large service would increase coupling
and make the transaction boundaries less clear. A narrow repository gives shared write primitives
without introducing a broad persistence framework.

## Migration impact

Existing callers continue to run their own short transactions and keep their current error types.
The change removes duplicate SQL helpers and routes revision inserts and current-revision updates
through one implementation. Existing database rows, migration versions, materialization files,
comment mapping, and Agent lineage remain unchanged.
