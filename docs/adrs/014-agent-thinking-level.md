# ADR 014: Agent Thinking Level

Status: accepted for Checkpoint 27.5
Date: 2026-08-10

## Context

The pinned Pi runtime already models provider-neutral reasoning depth as `off`, `minimal`, `low`,
`medium`, `high`, `xhigh`, and `max`, with per-model `thinkingLevelMap` metadata and helpers for
listing and clamping supported levels. WriteLLM currently discards that metadata when it creates
the worker-side Pi model and fixes every interactive Agent run to `off`.

Reasoning depth changes quality, latency, and token use, so it must be an explicit user choice and
part of immutable run provenance. It must not expose provider-specific request fields to the
Renderer or be confused with displaying model thinking content.

## Decision

WriteLLM adds one project-local Thinking level to each Agent conversation. It may change only while
the conversation is idle. Each run snapshots the effective level; every provider call, retry,
steer, follow-up, and tool continuation within that run retains the snapshot.

The shared level set is Pi's exact `ModelThinkingLevel` order. Main derives availability with the
pinned Pi `getSupportedThinkingLevels()` helper and uses `clampThinkingLevel()` when a remembered
or previously stored level must be adapted to a different model. `xhigh` and `max` therefore
remain opt-in model capabilities and a `null` Pi mapping remains unsupported. Direct Renderer
requests for an unsupported level are rejected rather than clamped.

Only non-manual models owned by a Pi built-in provider preset may expose reasoning controls in
this checkpoint. Custom provider presets and every manual model expose only `off`, even if their
metadata advertises reasoning. This avoids inventing compatibility or provider-parameter mappings
that the custom model catalog cannot verify.

The application stores the last explicitly selected level in `app_settings`, initially `medium`.
It seeds new conversations that already have a model and conversations selecting their first
model. Existing conversations and historical runs migrate to `off`. Automatic model-capability
clamping never overwrites the application preference or other conversations.

Main sends the Agent worker a strict, bounded, non-secret Pi model descriptor containing only the
resolved model identity, reasoning metadata, input types, limits, and bounded compatibility data.
Headers and credentials continue through the existing request-scoped authorization envelope and
are never part of the descriptor. The worker reconstructs the Pi model and sets the low-level
Agent's initial Thinking level; Pi remains solely responsible for provider-specific translation.

Thinking content remains filtered from persisted Agent messages and Renderer projections. This
checkpoint does not add chain-of-thought display, reasoning summaries, persisted reasoning,
provider Pro modes, per-message overrides, or reasoning controls for auxiliary model calls.

## Consequences

`project.sqlite` adds `thinking_level` to `agent_sessions`, `agent_runs`, and the existing
`model_requests` table; no new Agent table or durable job is introduced. The dedicated nullable
`model_requests.thinking_level` column records only the safe level for interactive Agent calls;
WriteLLM does not add generic request JSON that could persist prompts. The app database needs no
schema change because the remembered value uses the existing bounded settings table.

The Renderer receives only the supported level list and current/effective selections. Credentials,
raw Pi model objects, provider payloads, and model thinking content remain outside Renderer
authority. The legacy single-shot `AgentModelRuntime`, writing-skill routing, history compaction,
embeddings, reranking, images, and MinerU remain unchanged.
