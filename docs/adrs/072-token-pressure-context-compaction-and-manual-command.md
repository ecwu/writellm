# ADR 072: Token-Pressure Context Compaction And Manual Command

Status: accepted for Checkpoint 81; implementation authorized

Date: 2026-09-01

## Context

A hands-on Gemini 3.1 Pro conversation compacted after 203 durable events even though the latest
provider context used about 51,806 of 1,048,576 tokens. The event-count branch, rather than model
input pressure, selected compaction. The resulting checkpoint retained the latest raw request but
its broad historical `Next action` still anchored the resumed Agent away from that narrower request.

Codex, pi, and OpenCode trigger ordinary automatic compaction from model-visible token pressure.
They retain recent raw conversation and a rolling handoff; their durable event or tool-call counts
are not independent semantic-compaction thresholds.

## Decision

- Automatic pre-turn compaction is triggered only when checkpoint plus raw tail exceeds the final
  conversation token budget calculated after system prompt, exact tool envelope, current request,
  output reserve, model limits, and the existing safety buffer are known. The 200-event and 2-MiB
  runtime-envelope thresholds are removed.
- A provider-declared context overflow may still perform the existing single pre-activity recovery
  compaction. ADR 063's 2,000-event compaction-source ceiling and 180-event tool-loop finalization
  remain execution safeguards, not automatic-compaction triggers.
- Payload-v3, one summarization request, the 12,000-token checkpoint maximum, the 20,000-token raw
  recent-tail maximum, complete run boundaries, typed tool projection, and no-silent-omission rules
  remain unchanged.
- The compaction prompt explicitly updates the previous checkpoint with newer events. Still-active
  objectives, user requirements, exclusions, decisions, and unfinished workstreams carry forward;
  newer conversation wins conflicts. A checkpoint is background conversation memory, not a current
  user request. Its `Next action` is orientation only unless the latest real user message still
  requests it. Current authoritative project context continues to be rebuilt separately.
- The existing manual compaction IPC remains the only execution boundary. The leading slash catalog
  gains `/compact`; selecting it clears the composer and immediately invokes manual compaction
  without adding a user message or ordinary Agent run. The Add-context catalog remains context-only,
  and the existing Conversation actions entry retains its lossy-operation confirmation dialog.

## Consequences

Tool-heavy, low-token conversations no longer compact merely because observability events
accumulate. Actual model-input pressure and provider overflow remain bounded. The resumed Agent sees
an anchored rolling handoff, recent raw turns, and the latest real request in precedence order.

No database migration, new event schema, IPC, preload method, provider-specific fork, validation
model call, persistent instruction ledger, compaction table, or long-term memory is introduced.
This ADR amends ADR 019's automatic runtime-envelope trigger and ADR 049's interpretation of
`Next action`; ADRs 063 and 064 otherwise remain in force.
