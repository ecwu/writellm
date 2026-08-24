# ADR 061: Agent User Clarification Tool

Status: accepted for Checkpoint 69
Date: 2026-08-24

## Context

The Agent policy tells the model to ask a targeted question when an answer materially changes the
writing task, but Agent Harness Protocol v9 has no structured way to do so. A plain assistant
message ends the run, loses the tool-loop continuation, and cannot give the Renderer bounded,
accessible choice metadata. The accepted Main/worker/Renderer boundary already supports
request-scoped Pi tool calls and live activity snapshots, so clarification does not require a
second runtime, durable job, or Renderer authority over the model loop.

## Decision

Agent Harness Protocol v10 adds one application-owned `ask_user` tool. One isolated call carries
one to three required single-choice questions with stable snake-case IDs, short headers, prompts,
and two to four mutually exclusive options. The Renderer always offers a bounded freeform answer;
the model does not add an Other option. Answers are returned in question order as an exact option
label or non-empty bounded custom value.

Main persists the ordinary `tool_call`, installs one active-run waiter keyed by run and tool-call
capabilities, and publishes an `awaiting_input` activity snapshot. The original Pi run and tool
call remain pending without a deadline. A project-session-scoped IPC validates the active session,
run, tool call, question IDs, option membership, and answer cardinality before accepting the
answer. Main then records the ordinary `tool_result` before completing the answer IPC and
returning the resolved tool response to the Worker. Stop, project close, application shutdown, or
worker cancellation aborts the waiter and interrupts the run. Restarted runs retain the existing
interrupted recovery behavior; an old unanswered call is historical and cannot be answered.

The Worker enforces that `ask_user` is the only tool call in its assistant message and serializes a
successful answer as trusted user clarification below application policy. The application prompt
requires discoverable facts to be resolved first and prohibits using clarification as permission
or approval. Existing raw events remain authoritative. Context compaction uses a dedicated bounded
projection for question text, option labels, and answers so explicit user decisions survive a
handoff without granting manuscript or mutation authority.

The Agent composer shows the pending interaction inline through the official shadcn Questionnaire
primitive. It supports one question per step, fixed single choices, freeform input, Previous/Next,
final submission, and Stop. It does not expose multi-select or Skip. The session switcher marks
waiting conversations, while other conversation runs remain usable under the existing three-slot
limit. Completed ask/answer pairs render as a read-only timeline item.

## Consequences

Protocol v10 adds a bounded model-visible tool, one Renderer-to-Main IPC method, one live activity
phase, and one session workflow state. It adds no database migration, table, event type, worker,
job, provider fork, generic permission prompt, cross-restart active-run recovery, or mutation
authority. Tool result schema and Agent event schema versions remain unchanged; persisted v1-v9
events remain readable. The existing `@shadcn/react` dependency advances to the version containing
Questionnaire, and the official component source is copied locally because the new-york-v4
registry item is not currently published.

## Alternatives Rejected

- End the run with a normal assistant question. This cannot resume the same tool loop or provide a
  capability-bound answer.
- Persist a separate pending-question table. Unanswered questions are request-scoped active-run
  state, while the existing tool events already provide durable audit history.
- Allow Renderer-supplied prompts or approvals through the answer endpoint. This would widen the
  endpoint beyond the exact question and option contract.
- Add a timeout or restore an active waiter after restart. The user selected indefinite in-run
  waiting and existing interrupted restart recovery.
