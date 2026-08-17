# ADR 046: Pi Active Tool-Loop Context Recovery

- Status: Accepted
- Date: 2026-08-17
- Checkpoint: Phase 12 Checkpoint 51

## Context

The Pi runtime receives a provider-facing transcript through `transformContext`, while its full
in-memory transcript remains the execution record. WriteLLM previously bounded that provider copy
by whole user-message groups. During one long request this could retain several completed reads and
replace a newer, still-active body read with a non-authoritative projection. The model then saw
`projected: true` without the body and optimistic-concurrency identifiers it needed, inferred that
the editor had to be refreshed, and stopped even though the manuscript and write protection were
healthy.

Pi's tool loop requires an assistant tool call and every corresponding tool result to remain an
atomic conversational batch. A provider-context transform must not split that batch, convert a
mutation result into a summary, replay an effect, or make projected history look authoritative.

## Decision

The current Pi runtime constructs its provider-facing context around the current user request and
atomic assistant/tool-result batches:

- the current user request is always retained;
- an assistant tool call stays paired with all of its consecutive tool results, including parallel
  results;
- the newest batch that fits is retained in full, including body content, `blockId`, `blockHash`,
  and `revisionId`;
- only older complete read batches may become a `historical_projection`, which has
  `contentAvailable: false` and `mutationAuthority: false`;
- mutation and effect results are never projected.

If the newest read batch cannot fit, the first transform substitutes an `active_batch_retry`
result inside the original assistant/result batch. This typed delivery error says that content is
unavailable, prohibits guessing, and permits exactly one normal Pi-loop retry using one smaller,
sequential read. A smaller batch clears the run-local recovery state. A second oversized batch
raises `tool_batch_context_exhausted` before another provider request. WriteLLM never replays a
mutation or any other side effect to recover context.

The full Pi transcript, durable Agent events, checkpoints, and manuscript state remain unchanged;
the transform creates only a provider-facing copy. Successful recovery emits structured worker
lifecycle logs and no Renderer timeline item. Final exhaustion crosses the existing Worker-to-Main
error channel and produces one actionable Renderer termination message: earlier confirmed changes
remain, unprocessed content was not force-edited, and the user should continue with one section or
a smaller range.

## Consequences

- Long active requests preserve the newest editable evidence instead of favoring earlier reads.
- Projected history can support orientation but can never authorize a mutation.
- Recovery is bounded, deterministic, run-local, and silent when successful.
- A model that still cannot accept a single reduced read fails safely without a provider-overflow
  replay or false editor-refresh advice.
- No tool name, IPC method, database schema, durable checkpoint marker, dependency, or process
  boundary changes.

## Alternatives Rejected

- **Continue grouping by user message:** a long request remains an indivisible context unit and can
  discard the wrong active evidence.
- **Project the newest read and ask the user to refresh:** refresh cannot restore data deliberately
  omitted from the provider copy and misdiagnoses healthy document state.
- **Guess hashes or reuse projected identifiers:** this would weaken optimistic concurrency and
  could authorize edits against content the model did not receive.
- **Replay the whole request after overflow:** prior proposals and effects make replay unsafe.
- **Add a new recovery tool or persistence table:** the existing read tools and Pi loop already
  provide the required bounded retry.

## Verification

Checkpoint 51 requires unit coverage for atomic grouping and projection authority, worker-level
oversized-read recovery and terminal exhaustion, Main/Renderer error propagation, a long-document
Real-Electron regression, and the repository's fast, Electron, E2E, and package gates.
