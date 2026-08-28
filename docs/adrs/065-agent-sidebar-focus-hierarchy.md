# ADR 065: Agent Sidebar Focus Hierarchy

Status: accepted for Checkpoint 73
Date: 2026-08-25

## Context

The Writing Agent sidebar already exposes durable conversations, concurrent run attention,
streaming answers, bounded activity, clarification, proposal review, writing-task progress, and a
progressively disclosed composer. Continued use shows that these complete capabilities compete for
attention inside the same 360–640 px column. Conversation status occupies a separate row, completed
activity and duration markers interrupt answer reading, the writing-task capsule opens an overlay,
and queued follow-ups plus prompt context can expand above the composer without a single hierarchy.

Beautiful UI's useful precedent is its AI-native interaction rhythm: summary first, detail on
demand, persistent state, and actions beside the state they resolve. Its visual identity and code
are not adopted. WriteLLM continues to use the official shadcn/ui `new-york` language and the
existing desktop shell.

## Decision

The Agent sidebar has four stable regions: a conversation header with a compact live status, the
conversation timeline, an inline task or attention dock, and the composer. The separate status row
is removed. The header remains the searchable conversation switcher and groups sessions by needs
answer, needs review, working, recent, and archived without adding nested navigation.

Activity is projected as one human-readable summary per group. Running activity opens to the
current steps; completed activity collapses; failed or stopped activity opens for recovery. Run
duration joins that summary or the terminal answer instead of occupying an independent timeline
marker. Raw arguments, results, and provider metadata remain in Agent Details.

Writing-task progress becomes a bounded inline collapsible dock immediately above the composer.
Clarification, proposal review, recovery, and error states use the same attention-dock region with
one primary action. The composer auto-sizes within a fixed bound, shows only non-default context
chips, and collapses queued follow-ups behind a count summary. Approval, model/effort, Add, and
Send/Stop retain ADRs 038–041 semantics.

Renderer derives every presentation state from existing session, run, event, task, proposal, and
selection data. Expansion and search preferences remain ephemeral. Motion is limited to one active
work signal, is short-lived for attention, and respects reduced motion. Timeline following occurs
only while the reader is already near the newest content.

## Consequences

Checkpoint 73 is Renderer-only. It adds no migration, database table, IPC method, shared contract,
Agent tool, provider behavior, worker, dependency, permission, or persistence. Existing task and
proposal authority, three-run concurrency, clarification continuation, queued-message actions, and
conversation recovery remain unchanged.

The sidebar gains internal presentation helpers and focused components so hierarchy can be tested
without adding a second design system. Verification covers 360, 480, and 640 px layouts, keyboard
and reduced-motion behavior, live status, background conversation attention, task/review states,
and existing Agent E2E flows.
