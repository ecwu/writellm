# ADR 076: Agent model configuration and output completion

Status: accepted
Date: 2026-09-02

## Context

Two local writing traces ended with `length` after nearly all of an 8,192-token output
allowance was spent on reasoning. The selected manual model declared 65,536 output tokens and
reasoning support, but the runtime discarded that capability, sent no thinking configuration,
and classified the truncated response as completed. The user explicitly requested repairs and
immediate use of updated model catalogs and configuration by subsequent requests.

## Decision

- Main resolves the selected model from the current application catalog at the start of each
  new run. That single resolution supplies identity, reasoning, context and output limits to
  planning, the Worker, and immutable run provenance. Legacy singleton models retain their
  metadata resolver. The catalog must not be replaced by an older limits cache.
- Interactive runs default to the resolved model's output allowance. An explicit smaller
  request still applies; the existing generic output bound remains. The 8,192-token fallback
  is used only when no output capability is known. Auxiliary title and summary requests keep
  their purpose-specific budgets.
- Manual and custom models retain their declared reasoning metadata. Pi's existing supported
  level and clamping helpers and provider adapters own parameter translation, including the
  provider's supported interpretation of `off`. No handwritten provider parameter mapping is
  introduced. This supersedes ADR 014's manual/custom reasoning exclusion.
- A provider response ending in `length` is incomplete. The request and run fail with a concrete
  output-limit diagnostic, retain usage and interrupted visible text, and do not replay completed
  tools or automatically repeat the request. Partial output must not become a successful answer
  in later model context. Other provider failure and cancellation behavior is unchanged.
- Successful catalog refreshes and configuration mutations promptly refresh the open settings
  and Agent selectors, including an already-selected model's metadata. The next user-started
  run resolves the new configuration without reselecting the model or reopening the project.
  Active runs and their tool continuations retain their original snapshot, as in ADR 008.

## Alternatives and consequences

Increasing one fixed output constant would still ignore model-specific limits. Removing reasoning
support to hide controls prevents Pi from sending a supported off/minimal configuration. Retrying
truncated writing automatically could repeat effects and cost. Those alternatives are rejected.

There is no schema migration, dependency change, new provider adapter, or new background job.
Existing history and active-run authority remain immutable. This maintenance affects model
catalog/configuration delivery, run budgeting, completion classification, and their focused
verification; it does not advance the paused Writing Task checkpoint.
