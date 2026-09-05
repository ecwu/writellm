# ADR 079: Comment Acceptance Boundaries

Status: accepted under the author's explicit acceptance-remediation request
Date: 2026-09-05

## Context

Acceptance of ADR 078 identified that quote-only relocation and run-level revision receipts do
not satisfy the authorized Writer comment plan. A matching excerpt is not proof of occurrence
identity, and a successful `read_section` can contain only a page or no blocks.

## Decision

Supersede ADR 078's quote-only relocation rule with bounded old/new canonical-content mapping.
Every manuscript revision producer invokes the same comment mapper inside its revision transaction.
Stable block identity and uniquely determined edit mappings preserve ranges, including replacement
ranges; ambiguity retains an orphaned thread. Persist the revision represented by the stored
anchor independently of the latest document revision. Anchor history may restore positions only
when the entire canonical document content hash matches. Explicit author relinking is authoritative.
Original migration 0044 remains immutable; forward migration 0045 supplies the additional state.

Main persists a fixed delegated thread set for an existing Write session. A running or paused
review cannot silently replace its scope. Replies and resolution require an active Write run in
that session and membership in the delegated set. Existing session and proposal lifecycles remain
the execution authority; no new job or comment task state machine is introduced.

Comment reads carry a model request identity and current thread/revision. Section verification
accumulates actual untruncated block reads or complete canonical fragments for that revision.
Empty selections and missing pages cannot qualify. The resolve decision must originate from a
subsequent model request so the model can inspect the returned evidence. Fresh request snapshots
must reflect the current section before recording a comment read.

Link comment work to ordinary proposals. Main checks applied state and current revision in the
resolution transaction. A lost anchor normally requires relinking; an applied deletion qualifies
only with a preserved pre-deletion anchor and proof that its block or exact selected range was
removed. Undo reopens only a thread whose latest resolution depended on that proposal.

Renderer comment lists and detail views refresh with manuscript revisions and Agent changes,
retain drafts, expose event/proposal evidence, and offer a chooser for overlapping ranges.
Processing status derives from session runs and proposals. Publication exports remain unchanged.

## Consequences

Verification receipts from the earlier implementation are invalidated during migration. Comments
and their discussion remain project-local and travel with verified project backups. Semantic
verification remains an Agent judgment; structural read coverage, version, delegation, and
applied-change checks are enforced by Main. Very large or ambiguous edits can intentionally orphan
an anchor rather than assign an unsupported location.
