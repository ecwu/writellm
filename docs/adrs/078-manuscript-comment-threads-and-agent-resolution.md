# ADR 078: Manuscript Comment Threads And Agent Resolution

Status: accepted; implementation authorized
Date: 2026-09-04

## Context

ADR 077 removed the former Review Center, deterministic Review Issues, and manuscript annotations
so a later review workflow could begin with new product semantics. The author now wants local
text-range discussion threads that can be followed up or resolved by a person and explicitly
delegated to the existing writing Agent. Agent-authored manuscript edits must retain the accepted
typed-proposal, approval, revision, and undo boundaries.

## Decision

Add project-local manuscript comment threads, messages, anchors, and lifecycle events. A thread is
either open or resolved; processing, approval, and failure presentation is derived from linked
Agent runs and mutation proposals. Comments are excluded from manuscript publication.

Anchors are application-owned block-relative text ranges stored independently from BlockNote JSON.
The editor renders them as decorations. Main validates anchors against the canonical current
revision and only relocates an anchor when its quoted text has one unambiguous match in the same
stable block; otherwise it retains the thread and marks the anchor orphaned. It never binds a
repeated quote to the first manuscript occurrence.

The Renderer receives only project-session-scoped comment IPC. Main determines author identity,
validates optimistic thread versions, and writes lifecycle events transactionally. Agent Harness
Protocol v16 adds bounded `list_comments`, `read_comment`, `reply_comment`, and `resolve_comment`.
Ask and Plan may read; only Write may reply or resolve. Agent resolution requires a read receipt
for the current thread version and current section revision, plus an explicit verification note.
Any later reply or revision makes that receipt stale. Manuscript changes continue through ordinary
typed proposals and existing approval continuations.

Explicit delegation snapshots thread IDs into the user request. A batch processes that fixed list
in manuscript order and does not subscribe to future comments or create a durable background job.

## Consequences

- The new tables and contracts do not revive the schemas or tools removed by ADR 077.
- Comment threads survive project reopen, backup, clone, and ordinary revision changes.
- Deleting selected text can orphan an anchor without deleting its discussion.
- Semantic resolution remains an Agent judgment whose visible verification note and revision
  linkage can be reviewed and reopened by the author.
- Reverting a linked Agent revision reopens a thread only when the existing undo path can prove the
  resolved thread depended on that exact applied revision.

