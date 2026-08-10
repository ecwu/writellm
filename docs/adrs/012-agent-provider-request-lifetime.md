# ADR 012: Agent Provider Request Lifetime And Retry Policy

Status: accepted for Checkpoint 27.1
Date: 2026-08-10

## Context

Agent model calls currently share a provider preset `timeoutMs`, with built-in providers fixed at
60 seconds. The deadline covers the complete streamed response and all provider retries. Real
agentic runs can legitimately spend longer than 60 seconds reasoning or generating, so elapsed
wall-clock time is not evidence that a provider request has failed.

The provider transports also expose different retry behavior. A uniform product contract cannot
depend on one SDK's hidden retry defaults, and retrying after streamed content has been published
would make the visible response and any emerging tool call ambiguous.

## Decision

Agent provider generation has no WriteLLM wall-clock deadline. The Renderer shows the elapsed
Agent-run duration, and the request remains active until it completes, the provider reports a
failure, the user stops it, the project closes, or the worker terminates. User stop and project
close continue to propagate request-scoped cancellation through the existing `AbortSignal` chain.

WriteLLM applies one provider-neutral retry policy per authorized `model_request`:

- at most five logical attempts, including the initial attempt;
- retry only transient HTTP, provider-overload, and transport failures;
- never retry cancellation, authorization, permission, invalid-request, model-access,
  context-limit, content-policy, quota, billing, or other permanent failures;
- retry only before assistant text, thinking, or tool-call content has been published;
- use abortable bounded exponential backoff, preferring a bounded `Retry-After` when available;
- record the final retry count on the existing `model_requests` row.

An exhausted transient failure is a failed run with code `provider_retries_exhausted`. It remains
eligible for an explicit user Retry, which creates a new immutable run under the existing UI
contract. Historical `provider_timeout` records remain readable, but new Agent runs do not emit
that code.

Provider SDK retries are disabled where the pinned Pi transport exposes that control. The five
attempts are WriteLLM logical attempts; transport characterization must record any SDK-internal
requests that cannot be disabled or observed. WriteLLM does not patch Pi or bypass it with direct
provider SDK dependencies.

Tool deadlines remain internal tool-contract safeguards. They are not Agent generation timeouts,
are not merged into a run deadline, and remain independently cancellable. Embedding, reranking,
MinerU, image generation, provider probes, scheduler deadlines, and application close windows are
outside this decision.

The legacy custom-Agent `timeoutMs` field remains parseable and stored during this checkpoint but
has no Agent-generation effect. Avoiding a storage rewrite preserves existing credential bindings;
removal requires a separate credential-safe migration.

## Consequences

A silent or half-open provider request can remain active indefinitely until the user or project
lifecycle cancels it. This is intentional product behavior and is made visible by the existing
elapsed run timer and Stop control. Automatic retry improves transient-failure recovery without
duplicating already published output or creating additional model-request authority.

No durable Agent job, heartbeat, restart recovery, new persistence table, Pi fork, or provider SDK
dependency is introduced.
