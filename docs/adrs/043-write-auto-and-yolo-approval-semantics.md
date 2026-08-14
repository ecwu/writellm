# ADR 043: Write Auto And YOLO Approval Semantics

Status: accepted for the Checkpoint 50 follow-up refinement; implementation authorized
Date: 2026-08-14

## Context

ADR 004 defined the three run-snapshotted approval modes with size- and operation-based
automatic-application limits, and ADR 005 kept Brief and Writing Rules proposals under mandatory
review in every mode. Hands-on use shows the result feels broken: even in `yolo`, Brief/Writing
Rules proposals always pause for review, section patches fall back to review whenever they touch
more than twenty blocks or carry styled content, and outline patches pause on any delete/move or
beyond ten operations. The review panel gives no hint that these prompts are policy ceilings
rather than manual-mode behavior, so the automatic modes are not trusted.

The user asked for a simpler contract: `manual` stays unchanged; the middle mode becomes Write
Auto and applies all writing changes without counting blocks or characters; `yolo` keeps its name
and applies every operation, including Brief, Writing Rules, and outline changes.

## Decision

`MainAgentTools.shouldAutoApprove` now implements exactly three rules:

- `manual`: every proposal pauses for review (unchanged).
- `section_auto`, presented as **Write Auto**: every `section_patch`, `outline_patch`, and
  `generated_image_insert` proposal is applied automatically, regardless of touched-block counts,
  inserted/deleted character volumes, block structure, or outline operation types.
  `brief_update` proposals (Brief and Writing Rules changes) still pause for review.
- `yolo`: every proposal kind, including `brief_update`, is applied automatically.

The per-mode block/character ceilings and the section-operation policy helper are removed. The
persisted mode values (`manual`, `section_auto`, `yolo`), their CHECK constraints, run snapshots,
and IPC contracts are unchanged, so no migration is required; Write Auto is a presentation name
for the existing `section_auto` value. The composer shorthand for the middle mode becomes
`Write Auto`, and the menu descriptions restate the behavioral truth.

Automatic application still never bypasses the existing proposal transaction, revision, and
operation-aware refresh checks from ADR 004; only the decision of whether to ask the user
changes.

## Alternatives Considered

- Keep the ceilings and explain them in the UI. The limits were the confusing part, and honest
  labeling does not restore trust in a mode that still pauses on routine large edits.
- Rename the persisted `section_auto` value to `write_auto`. This requires a table-rebuild
  migration of `agent_sessions` and `agent_runs` for zero behavioral gain; the presentation
  rename delivers the user-facing change without touching forward-only migrations.
- Drop the middle mode entirely. Write Auto remains useful as the setting that trusts the Agent
  with manuscript, outline, and image changes while keeping document-level Brief and Writing
  Rules decisions with the user.

## Consequences

YOLO now means what users expect: no proposal prompts at all. Write Auto auto-applies any size of
manuscript, outline, or image change; only Brief/Writing Rules proposals still pause. The only
remaining review prompts in automatic modes are Brief/Writing Rules changes in Write Auto and
genuine conflicts that fail the unchanged transaction/refresh checks. No migration, dependency,
IPC, worker, provider, package, release, or hosted CI boundary changes.
