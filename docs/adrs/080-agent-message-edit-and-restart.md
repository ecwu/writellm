# ADR 080: Agent Message Editing and Restart

Status: accepted under the author's explicit implementation request
Date: 2026-09-07

## Decision

Copy user and assistant message text directly from the message payload. Editing applies only to
the latest delivered ordinary user message, including follow-up and steer, after work has stopped.
Copy and edit controls appear on message hover or keyboard focus; inline editor actions remain visible.
Generated prompts and clarification answers cannot be edited. Inline cancellation preserves history.

Main reserves the session before provider preparation and rechecks the exact message and raw event
head in the commit transaction. A new run, its prompt, a persistent replacement interval, and
rejection of superseded pending proposals commit together. Preparation failure preserves the old
conversation; subsequent execution failure leaves the replacement prompt available for editing.

Migration 0046 adds replacement intervals and sequence-bound business-effect receipts. SQLite
triggers record actual proposal application/undo and Agent comment writes in their own transaction;
legacy effects are conservatively reconstructed from persisted decision/event timestamps. These
receipts only disqualify editing; they are not manuscript or recovery authority. Agent writing-plan
changes also disqualify editing because their current collaboration state cannot be silently rewound.
Manual and other-session edits do not disqualify the target message. Pending image work must settle
or be cancelled first. Pending proposals whose tool call precedes the editable boundary must be
resolved first; superseded proposals cannot later be approved, refreshed, or continued.

Raw events, runs, usage, and diagnostic traces remain intact. One SQL view supplies effective
conversation events to timeline replay, model history, compaction, and title generation. Replacement
intervals exclude the target and its suffix; checkpoints created before replacement that cover the
replaced prefix are also excluded. New checkpoints summarize only effective events. Tool history
projection drops unmatched calls/results at an edited steer boundary. No old external work is replayed.

## Consequences

Adds narrow eligibility and edit/restart IPC with shared contracts and project-session validation.
Renderer refreshes effective history after a replacement and on session updates, preserving newer
stream events. No new worker protocol, provider API, dependency, background recovery, or release.
Migration uses the existing verified backup/integrity/recovery gate. Verification covers atomicity,
effects, stale callers, repeat edits, compaction, reopening, clipboard, and desktop interaction.
