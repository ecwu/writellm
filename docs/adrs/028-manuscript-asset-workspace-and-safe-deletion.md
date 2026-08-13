# ADR 028: Manuscript Asset Workspace And Safe Deletion

Status: Accepted
Date: 2026-08-13

## Context

WriteLLM already has one project-local immutable image authority: `manuscript_assets`, referenced
by `section_revision_assets`, generated-image proposals, and session-bound preview capabilities.
Checkpoint 42 must expose that authority without adding a Renderer filesystem scan, duplicate
catalog, mutable image store, or cleanup rule that can invalidate retained history.

Validated dimensions were available while storing an image but were not durable. Cleanup could
remove only database-unreferenced assets after a grace period, but an explicit user deletion also
needs a crash-safe boundary between reserving a row and removing its file.

## Decision

1. Migration 0034 adds nullable validated `width`/`height`, a bounded `deletion_state`, and indexes
   for asset-first usage queries and stable workspace pagination. New stores persist dimensions;
   legacy rows are lazily backfilled only after their immutable bytes pass size, hash, MIME, and
   dimension validation.
2. `ManuscriptAssetService` remains the single asset catalog. It projects current block-level
   references from current revision bodies, retained historical revision counts from
   `section_revision_assets`, and retained proposal counts from strict JSON traversal. It exposes
   no path or raw byte field.
3. The workspace is cursor-paginated by `(created_at, asset_id)`, bounded to 100 rows per request,
   and supports used/unused, generated/uploaded, and current-section filters. Preview URLs remain
   short-lived project-session capabilities.
4. Current revisions, every retained historical revision, and every retained proposal protect an
   asset. Historical-only purge is deferred. A section proposal may reference only an active asset.
5. Explicit deletion first rechecks protection and atomically moves an unprotected row from
   `active` to `deleting`. New revisions and proposals then reject the asset. File removal and row
   removal follow; a failed cleanup remains `deleting`, is hidden from the workspace, and is
   retried by the existing artifact-cleanup job and project-open reconciliation.
6. Missing or changed files remain visible with an integrity status. The workspace never repairs,
   replaces, or silently trusts changed bytes.

## Consequences

- No second asset database, background model flow, provider call, mutable candidate file, or raw
  Renderer filesystem authority is introduced.
- Retained project history can deliberately keep unused-looking assets undeletable; the UI states
  the exact protecting authority.
- Listing a page performs bounded file verification for that page. Large libraries remain bounded
  by pagination and indexed SQL projections.
- CP43B can add candidate lineage to this same asset authority rather than create an image library
  of its own.
