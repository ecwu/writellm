# ADR 044: Live Approval Mode Reads At Proposal Time

Status: accepted for the Checkpoint 50 follow-up refinement; implementation authorized
Date: 2026-08-14

## Context

ADR 004 snapshotted the approval mode into each run, and `setApprovalMode` refused to change the
mode while a run was active or a proposal awaited review. Hands-on use shows this is the wrong
granularity: a user who watches the Agent start an automatic run and realizes the mode is wrong
cannot correct it without stopping the run, and a user paused on a review cannot switch to YOLO to
let the remaining proposals flow through.

The approval mode is a session-level preference, not run input. The only moment it has an effect
is when a proposal has just been produced and Main decides between automatic application and
pausing for review.

## Decision

`AgentSessionService.setApprovalMode` no longer refuses changes during an active run or a pending
review; only the existing compatibility check remains. When a proposal-producing tool result
arrives, `#handleToolRequest` reads the session's current approval mode from the project database
at that moment and passes it to `shouldAutoApprove`, instead of using the run-start snapshot.

The `agent_runs.approval_mode` column keeps recording the mode in effect at run start as audit
history; it no longer drives any decision. The Renderer approval picker and its handler stay
enabled during runs and review pauses (still disabled for archived sessions and while a write is
in flight), so the session details pane and the composer can switch modes at any time.

An already-paused proposal is unaffected by a later mode change: it was created under the mode
read at its decision time and still requires a manual review action. Mode changes apply to the
next proposal decision.

This amends ADR 004's run-snapshot rule and the "run snapshots unchanged" statement in ADR 043.
The three mode semantics from ADR 043 are unchanged.

## Alternatives Considered

- Re-evaluate already-paused proposals on mode change. This mixes a user preference write with
  proposal application, races with a user who is mid-review, and can apply a proposal the user
  was about to reject. Deciding only at proposal time keeps one decision point.
- Keep the run snapshot as the decision input and only relax the setter. That would let the UI
  show a mode the run ignores, which is the confusion being removed.
- Drop the `agent_runs.approval_mode` column. It remains useful audit history of the mode at run
  start and removing it would require a migration for no behavioral gain.

## Consequences

Users can correct the approval mode at any moment, including mid-run and mid-review, and the next
proposal follows the new mode immediately. The proposal transaction, revision checks, and the ADR
043 mode semantics are untouched. No migration, dependency, IPC-shape, worker, package, release,
or hosted CI boundary changes.
