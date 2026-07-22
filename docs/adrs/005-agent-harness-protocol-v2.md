# ADR 005: Agent Harness Protocol v2

Status: accepted
Date: 2026-07-22

## Context

Production use of the initial seven-tool Agent surface exposed three protocol gaps: Main-owned
domain errors lost their structure in the worker, Pi-local tool attempts were absent from the
durable audit trace, and one model request could combine an editor selection captured at run start
with manuscript data read from a later revision. The approval-policy implementation also kept
ordinary tool promises open while waiting for a human decision.

The initial freeze in ADR 001 successfully prevented generic filesystem, shell, SQL, network, and
plugin authority. This decision preserves those trust boundaries while replacing the provisional
tool protocol now that concrete product pressure exists.

## Decision

WriteLLM adopts Agent Harness Protocol v2 before Checkpoint 24.

- The model-visible surface contains eight bounded read/inspection tools and three typed submit
  tools. It still exposes no generic computing or project authority.
- Every dispatched tool returns a versioned success or structured domain-error result. Protocol or
  capability corruption remains exceptional.
- A model request owns an in-memory writing snapshot keyed by `modelRequestId`. Manuscript reads and
  mutation bases use that snapshot; each provider continuation receives a fresh snapshot and
  trusted system context.
- Submit tools finish after the proposal is durably created or automatically decided. A pending
  proposal pauses the run; approval continuation is a new immutable run and model request.
- `manual`, `section_auto`, and `yolo` remain user-facing presets. Main computes the actual effect
  from canonical arguments and may require review even in an automatic preset.
- Pi-local attempts and pre-dispatch failures become durable Agent events. Raw private arguments are
  not duplicated; audit records contain a hash and bounded structural shape.
- Outline references and section block preconditions are resolved by Main. `prepareArguments` is
  reserved for compatibility shims and does not allocate domain identifiers.
- Citation snippets are discovery results. A proposal may cite only evidence expanded through
  `read_citations`, and its bounded evidence snapshot is stored with the immutable proposal.

The project keeps the existing five Agent persistence tables. Writing snapshots and progress are
request-scoped memory. Migration 0021 only extends the allowed `agent_events` types and upgrades the
event contract while retaining v1 payload readers.

## Consequences

ADR 001 remains authoritative for process, persistence-table, and generic-authority boundaries, but
its exact seven-tool list is superseded. ADR 004 remains authoritative for run-snapshotted presets
and model limits, but its approval-waiter semantics and unconditional YOLO matrix are superseded.

Existing sessions and proposal payloads remain readable. The event parser admits v1 tool names and
payloads, while new runs register only Protocol v2 tools. No Pi fork, durable Agent job, new Agent
table, raw patch tool, or semantic black-box validation is introduced.
