# ADR 035: Project-Local Manuscript Annotations

Status: Accepted

Date: 2026-08-13

## Context

Writers need durable private notes and actionable TODOs attached to manuscript content without
placing editorial text in the publishable BlockNote body. Existing review issues are Agent-owned
review findings with different lifecycle and provenance. Reusing them would blur user intent,
while putting annotations into BlockNote would leak them into counts, search, exports, citations,
and model context.

## Decision

Add one bounded `manuscript_annotations` table in project.sqlite and one Main-owned
`AnnotationService`. An annotation belongs to one section and one stable BlockNote block ID. It
stores note/TODO kind, open/resolved status, bounded author text, the anchor revision, and an
optional bounded selected-text anchor plus SHA-256 fingerprint.

Anchor state is derived against the current authoritative section revision. A tombstoned section
or missing block is explicitly `orphaned`; the application never guesses a replacement block.
Preserved block IDs remain current across ordinary revisions. Managed project checkpoints include
project.sqlite, so restoring a checkpoint restores annotations atomically with manuscript state.

Renderer APIs are sender- and project-session-authorized, bounded, paginated, and optimistic by
annotation version. Runtime annotation failures never block manuscript edits; database integrity
rules remain strict. Annotations are absent from manuscript bodies and all manuscript-derived
counts, search, citation, export, and default Agent context paths.

A user may explicitly select at most ten annotations for one ordinary Agent prompt. Main resolves
those IDs from the active project and appends a bounded, clearly delimited untrusted annotation
context to that prompt. This creates no new conversation, model route, tool loop, or mutation
authority.

## Consequences

- Notes and TODOs are single-author records, not comments or collaboration threads.
- There are no mentions, permissions, realtime sync, Yjs state, external sync, or background model
  work.
- Orphan relocation is a future explicit user operation; automatic fuzzy relocation is forbidden.
- Project snapshot, backup, clone, and managed-history behavior follows the existing project.sqlite
  authority without a second annotation archive.
