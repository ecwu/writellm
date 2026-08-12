# ADR 015: Agent Flow Polish And Review Continuation

Status: accepted for Checkpoint 28.1
Date: 2026-08-12

## Context

WriteLLM already provides durable conversations, streaming, bounded tools, Stop, Steer,
Follow-up, typed mutation proposals, revision-safe approval, Thinking levels, and Writing Skills.
The Agent panel currently exposes those capabilities as separate navigation, status, composer, and
review controls. Opening the panel begins at a conversation list, runtime metadata competes with
the writing task, and a pending proposal disables the composer even though review feedback is the
next natural user input.

The accepted Agent authority boundary remains correct. This checkpoint improves the interaction
flow without adding tools, direct-write authority, durable Agent jobs, or new persistence tables.

## Decision

The Agent panel becomes one continuous conversation canvas. Opening it selects a running session,
then the newest session needing review, then the most recently updated active session. When none
exists, the panel shows an unpersisted draft conversation and creates the session only on first
send or the first session-setting mutation. Conversation history moves into a searchable header
switcher.

The default surface shows one human-readable status, one inferred context control, one composer,
and the current review action. Model, Thinking, Writing Skill, approval policy, token usage, run
metadata, and raw bounded tool diagnostics remain available through one details surface. Running
messages queue as Follow-up by default; Steer remains an explicit alternate action.

A pending proposal keeps its diff in the conversation but moves its controls into a focused,
sticky review composer. The primary action is Apply and continue. Request changes durably rejects
the proposal with the user's bounded feedback and starts a new immutable run using a Main-owned
revision prompt and the original run's Writing Skill snapshot. Apply-only and reject-without-
continuation remain available as secondary actions. An outdated proposal still requires the
existing operation-aware refresh before approval.

Main may attach additive presentation metadata to a persisted user-message event so the Renderer
can hide a synthetic approval-continuation prompt or show only the user's review feedback. Model
history continues to use the complete Main-owned content. Existing events remain readable, the
event schema version remains compatible, and no database migration is required.

## Consequences

Agent Harness Protocol v4, the typed proposal transaction, revision revalidation, citation
provenance, request-scoped cancellation, Renderer sandbox, and fixed worker roles are unchanged.
The start-run IPC accepts a rejected-proposal continuation that is mutually exclusive with an
approved-proposal continuation. Rejection records whether the user requested continuation. Main
validates proposal ownership and state, constructs the model prompt, reuses the frozen Skill
snapshot, and logs only safe identifiers and outcomes.

Checkpoint 28.1 does not add Goal or Plan modes, subagents, plugins, MCP, shell access, arbitrary
filesystem or network access, background recovery, new auto-approval authority, or persistence of
unsent Renderer drafts.
