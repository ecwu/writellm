# ADR 027: Figure Semantics And Section Content Schema V3

Status: accepted for Checkpoint 43A; implementation authorized
Date: 2026-08-13

## Context

BlockNote 0.47.2's native image block persists a file `name`, URL, caption, preview state, and
width, but it has no independent accessibility description or application-owned figure identity.
The filename-like `name` field cannot safely serve both purposes. Review, publishing assembly, and
future image iteration need one stable semantic target that is independent of derived figure
numbering.

Existing section revisions are immutable and their content hashes participate in optimistic
concurrency and proposal lineage. Adding props in place would invalidate those hashes and make
historical evidence ambiguous.

## Decision

### 1. Image blocks gain two application-owned props

Section content schema v3 extends only the existing BlockNote `image` block with:

- `figureId`: a stable bounded identity;
- `altText`: an explicit bounded accessibility description.

`caption` remains reader-visible prose and `name` remains BlockNote/file compatibility metadata.
New and accepted Agent-generated images receive both semantic props. Main normalizes every newly
persisted section document; a missing figure ID is deterministically derived from the stable
section and block IDs. An explicitly empty `altText` remains empty so deterministic review can
report it rather than inventing content.

The Renderer uses a custom image spec built from BlockNote's public React custom-block APIs and
the native resizable file wrapper. A shadcn popover edits caption and alt text. The editor never
owns persistence authority.

### 2. Migration appends current v3 revisions

Migration 0033 widens the revision constraint to schemas 1–3. It never rewrites historical JSON or
hashes. For each active section it appends one `import`-class v3 revision from the current retained
body, backfills `figureId` and `altText` (using the prior `name` only when the new field did not
exist), copies asset references, advances the current pointer, and invalidates only rebuildable
materialization records.

Schema 1/2 revisions remain readable. When an old retained body is inspected or reused by Undo,
Main applies the same deterministic normalization in memory and any resulting new revision is v3.
Pending proposals against the pre-migration current revision become honestly stale and follow ADR
003 refresh rules.

### 3. Figure numbers are derived, never persisted

The shared publication contract walks current manuscript order and emits figure nodes containing
`figureId`, derived `figureNumber`/label, exact section/revision/block targets, asset ID, caption,
and alt text. Reordering changes the number but not the identity. CP38 consumes this contract; no
number is written into BlockNote JSON or SQLite.

### 4. Missing metadata is reviewable, not blocking

The existing deterministic `check_draft` fixture gains `figure_metadata`. It emits exact block-
anchored findings for blank captions and blank alt text. Persistence accepts either as empty prose;
there is no provider call, hidden analysis flow, or dedicated review conversation.

## Consequences

Checkpoint 43A adds one forward-only project migration, one BlockNote image-spec extension, one
shared publication-node projection, and one additive deterministic review check. It adds no
dependency, provider, worker, job, conversation type, generation behavior, asset lineage table, or
second content authority.
