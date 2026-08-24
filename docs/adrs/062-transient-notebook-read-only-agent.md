# ADR 062: Transient Notebook Read-Only Agent

Status: accepted for Checkpoint 70
Date: 2026-08-24

## Context

ADR 058 implemented Notebook as selected-source retrieval followed by one legacy single-shot Agent
utility request. That boundary cannot share the writing Agent's model capability mapping or Thinking
level, and it sent a fixed `temperature` to Codex models that reject the parameter. Notebook is a
transient conversational Agent even though it has no writing authority.

## Decision

- Notebook uses the existing Pi session runtime with transient in-memory session/run capabilities.
  It does not write `agent_sessions`, `agent_runs`, or `agent_events`.
- A strict `notebook_knowledge` tool profile exposes only `search_knowledge` and `read_citations`.
  Main freezes each turn's selected Knowledge scope, rejects out-of-scope source IDs, and permits
  citation expansion only for citations returned by that turn's scoped search.
- Notebook reuses the Agent catalog, runtime model descriptor, supported Thinking levels, clamping,
  and the existing two-level model/effort picker. Its initial selection is seeded from application
  defaults, but later Notebook choices remain project-session memory and do not update those defaults.
- The Agent decides when to search and expand citations. Notebook no longer performs an unconditional
  pre-retrieval. At most twelve unique per-turn citations receive stable ordinals for `[[cite:n]]`.
- Every initial or tool-continuation provider call remains request-scoped and records metadata-only
  `model_requests`. Questions, answers, evidence, content fingerprints, and external response IDs
  are not persisted or logged.
- Notebook history remains bounded, source-epoch-scoped, and in memory. Clear, project close/switch,
  and application shutdown erase it.

## Consequences

This supersedes only ADR 058's single-shot answer-model boundary and ADR 014's exclusion of Notebook
from Thinking controls. Notebook remains selected-source-only, transient, non-writing, non-durable,
and confined to the existing `agent-worker`. Manuscript reads, Writing Skills, `ask_user`, review or
task fixtures, proposal tools, image generation, and every mutation capability remain unavailable.
