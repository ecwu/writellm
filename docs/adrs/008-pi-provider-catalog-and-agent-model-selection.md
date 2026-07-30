# ADR 008: Pi Provider Catalog And Agent Model Selection

Status: accepted and implemented in Checkpoint 23P
Date: 2026-07-30

## Decision

WriteLLM replaces the singleton OpenAI-compatible Agent configuration with an application-global
Pi provider catalog. The exact-pinned `@earendil-works/pi-ai` provider factories remain the source
of truth for built-in providers, wire protocols, model metadata, and authentication behavior.
Custom presets are limited to endpoint-addressable OpenAI Completions/Responses, Anthropic
Messages, Google Generative AI, Mistral Conversations, and Azure OpenAI Responses transports.

Application state owns provider presets, encrypted Pi credentials, the last successful dynamic
model catalog, and the default selection. Project-local Agent sessions store only a preset/model
selection reference. Every Agent run snapshots the resolved provider, API, model metadata, limits,
and fingerprints before the worker starts. Missing or changed application configuration never
rewrites project history and never triggers a silent model fallback.

Main owns the Pi `CredentialStore`, OAuth refresh serialization, ambient-auth resolution, catalog
validation, and run authorization. Credentials and resolved request auth cross only the
Main-to-worker run envelope and are never persisted in project data, logged, or exposed to the
Renderer. OAuth/login interaction is request-scoped and cancellable. The Renderer receives only a
bounded non-secret catalog/status projection.

Static built-in catalogs follow the exact Pi package. Dynamic providers refresh only on an
explicit user action and retain the last successful bounded catalog after a refresh failure.
Switching models is allowed only while a conversation is idle and affects the next immutable run;
steering, follow-ups, tool continuations, and active runs retain their snapshotted model.

## Consequences

Provider configuration remains application-global and the existing three worker roles remain
unchanged. The Agent still has no provider-configuration tool or generic network authority.
Embedding, reranking, MinerU, and image-provider configuration remain singleton role-based
surfaces. Existing Agent configurations migrate to one legacy custom preset and seed its cached
model so an offline upgrade remains usable.

ADR 004's statement that the Renderer receives no model catalog is superseded only for this
bounded, non-secret selection catalog. ADR 001 and ADR 005 remain authoritative for Agent tools,
project capabilities, persistence authority, and proposal semantics.
