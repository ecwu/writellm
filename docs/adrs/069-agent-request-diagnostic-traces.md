# ADR 069: Project-local Agent request diagnostic traces

Status: accepted

Date: 2026-08-31

## Context

`model_requests` records lineage, outcome, usage, retries, and latency, while `agent_events` is the
authoritative Agent lifecycle stream. Neither retained the exact model-visible context, transformed
provider body, structured provider response, invalid preflight tool input, injected Writing Skill
content, or compaction source. Pino deliberately excludes those private bodies. A failed request
could therefore be localized, but not reconstructed directly from durable evidence.

Persisting a complete copy of the growing conversation on every call would make long projects grow
quadratically. Diagnostic evidence also must not become recovery state or another business-event
authority.

## Decision

WriteLLM stores model-visible diagnostic evidence in the project database as immutable,
content-addressed canonical JSON objects plus ordered references:

- `agent_trace_payloads` owns deduplicated JSON objects keyed by SHA-256.
- `model_request_traces` owns request purpose, trace/span correlation, capture status, physical
  attempt count, HTTP status, TTFT, duration, and failure metadata.
- `agent_trace_records` orders harness, provider, tool, Skill, compaction, and image evidence and
  carries the applicable session, run, request, tool-call, and compaction identifiers.
- `agent_model_request_trace_v` reconstructs semantic harness requests, physical provider attempts,
  and responses; existing model requests without evidence are reported as `legacy_unavailable`.
- `agent_run_trace_v` interleaves trace records with authoritative `agent_events` for diagnosis.

Trace capture is fail-closed for Agent model traffic. The Worker captures the complete Pi context
and Pi `onPayload` result, sends both to Main, and waits for a durable SQLite acknowledgement before
the provider request may start. Every retry is a separate physical attempt. Serialization, size,
or persistence failure terminates the request before network I/O. Provider response headers use an
explicit diagnostic allowlist; authentication, cookies, signed URLs, and binary bodies are never
stored.

Trace payloads may contain private prompt, response, invalid tool, and Skill bodies. This is the
only persistence boundary allowed to retain those model-visible bodies. Ordinary logs remain
metadata-only and preserve the original diagnostic error as top-level `err` without private
content. Project databases and backups are sensitive data.

Each JSON document is limited to 8 MiB and each physical request to 32 MiB before network I/O.
JSON reconstruction preserves values, hierarchy, array order, and types, but not textual object-key
order or whitespace. Image bytes remain asset-owned; traces store only request/response metadata,
asset references, and hashes.

The trace covers initial Agent requests, steer/follow-up continuations, tool continuations, session
titles, automatic/manual/provider-overflow compaction, Agent-originated image generation, raw
pre-validation tool calls, and injected Writing Skill entrypoints/references. Notebook, embedding,
and rerank requests are excluded.

## Consequences

- `agent_events` remains runtime authority; traces never drive recovery, context construction,
  mutation authorization, or audit decisions.
- Trace data follows normal project backup, restore, clone, and snapshot behavior because it lives
  in `project.sqlite`; there is no independent trace bundle, exporter, UI, sampling, disable switch,
  or automatic retention policy.
- Repeated system prompts, histories, tool definitions, and Skill text share payload objects while
  ordered references retain each occurrence.
- AsyncLocalStorage remains useful for local logs, but cross-process trace correlation is carried
  explicitly in protocol messages.
