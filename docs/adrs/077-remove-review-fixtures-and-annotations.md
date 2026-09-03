# ADR 077: Remove Review Fixtures And Manuscript Annotations

Status: accepted; implementation authorized
Date: 2026-09-03

## Context

The current Review Center combines two independently persisted products: Agent-authored Review
Issues and user-authored manuscript annotations. Review Issues also extend the Agent protocol with
one deterministic checker, three fixture tools, a dedicated policy layer, and proposal-resolution
links. The author intends to redesign review later and does not want the existing UI, protocol, or
project-local state to constrain that work.

Writing Rules and manuscript proposal approval are separate accepted capabilities. They remain
useful without Review Issues and must not be removed merely because their current modules or
terminology contain the word “review”.

## Decision

Remove the Review Center, manuscript annotations, `check_draft`, the three Review Issue tools,
Review Issue persistence and lifecycle, and proposal-to-issue reconciliation. Agent Harness
Protocol v15 contains no runtime or model-visible compatibility branch for those four removed
tools. Ordinary Agent conversations may still inspect manuscript and evidence through the general
read tools and provide non-persisted feedback.

Keep Writing Rules, `inspect_change`, typed proposals, manual/automatic approval, rejection,
`awaiting_review`, `review_feedback`, and undo. Extract Writing Rules from the old Review IPC and
Renderer namespace into a dedicated Writing Rules surface without changing its Brief authority.

Project migration 0043 destructively removes `review_issues`, `review_issue_events`, and
`manuscript_annotations`. It removes persisted events for the retired tools, strips annotation
presentation metadata from otherwise retained user messages, and removes Review Issue links from
proposal history. Historical migrations remain immutable so old projects can migrate forward;
the normal pre-migration verified backup remains the only recovery path for discarded data.

## Consequences

- Review has no dedicated UI, policy, checker, issue store, status machine, or background flow.
- Annotations have no creation, storage, navigation, or Agent-context path.
- Existing projects open after destructive forward migration, but removed Review/Annotation data
  is not exposed or replayed by the application.
- A future Review design starts from a new ADR, schema, protocol, and UI rather than reviving these
  contracts.

ADR 077 supersedes the Review Issue and annotation decisions in ADRs 024 and 035. ADR 024's
Writing Rules and ordinary proposal-approval decisions remain in force.
