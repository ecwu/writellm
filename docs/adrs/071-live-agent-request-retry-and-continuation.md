# ADR 071: Live Agent Request Retry And Continuation

Status: accepted for Checkpoint 80; implementation authorized

Date: 2026-09-01

## Context

The Agent panel's current `Try again` action starts a new immutable run with the latest prompt. The
failed run's user message remains in durable history and the new run appends the same prompt again.
For a long prompt, the next model context can therefore contain two copies of the same user content.
This is a new user turn, not a retry of the failed provider request.

The desired product behavior distinguishes two provider failure stages:

- a request that fails before any assistant content is published should retry that request without
  adding another conversation message; and
- a request that fails after partial streaming, or after earlier tool results in the same run,
  should continue from the last safe model-call boundary without clearing completed context or
  replaying tools.

WriteLLM pins `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai` at `0.80.10`. Research
against that exact installed version establishes the following boundary:

- low-level Pi `Agent.continue()` adds no user message and accepts a transcript whose final message
  is a user message or tool result;
- a failed provider response is appended to Pi state as an assistant message with `stopReason:
  "error"`, so calling `continue()` directly after failure is rejected;
- `Agent.state.messages`, `Agent.state.systemPrompt`, and `Agent.state.tools` are assignable. A
  caller can retain the state before a provider request, restore it after failure, and then call
  `continue()`;
- Pi completes an assistant provider response before it executes that response's tool calls. An
  error response ends the loop before tools from that response run. A later request made after a
  completed tool batch begins from the corresponding tool results; and
- `pi-ai` classifies retryable assistant errors, but leaves budgets, backoff, reporting, and
  restart policy to the caller. `AgentHarness` in `0.80.10` does not expose a manual retry or
  continuation control and would not remove the need for a WriteLLM-owned protocol.

Existing ADR 012 permits automatic physical retries only before visible assistant content and says
the explicit UI retry creates a new run. ADRs 019, 046, and 063 prohibit unsafe replay, retain
atomic assistant/tool-result batches, and allow low-level Pi continuation from a final tool result.
ADR 069 makes exact traces diagnostic evidence only, never recovery authority. A new decision is
therefore required before changing product behavior.

## Decision

If this ADR is accepted, WriteLLM will replace generic prompt-resubmission `Try again` with a
capability-bound retry of the latest failed provider request while the original Agent run and
Worker remain live.

### Logical requests and physical attempts

Automatic transport retry remains unchanged: one authorized `model_request` may make at most five
physical attempts, only for transient failures and only before assistant text, thinking, or tool
call content has been published.

One explicit user click authorizes one new logical `model_request`. That new request receives its
own immutable row, trace span, usage, physical retry count, and terminal outcome. It does not create
a new `agent_run`, append a `user_message`, rerun Skill routing, or reconstruct the request from
Renderer-supplied prompt text. The new logical request may use the normal bounded automatic
physical retry policy. If it fails again, another click is required for another logical request.

### Worker-owned retry anchor

Immediately before every Agent provider request, the Worker retains one in-memory retry anchor for
that request. The anchor contains only runtime state required to reproduce the model-call boundary:

- the source `modelRequestId`, request purpose, and an opaque one-use retry capability ID;
- a deep copy of the full Pi transcript before the assistant response;
- the exact system prompt, model-visible `AgentTool[]`, interaction mode, active tool groups, and
  runtime message budget selected for that request;
- the provider-facing transformed context used by the first logical request, plus its canonical
  SHA-256 fingerprint; and
- the retry reason, HTTP status when available, whether assistant content was published, and
  whether the boundary follows completed tool results.

The full transcript remains Pi execution state. The transformed context snapshot is a one-shot
override for the first transform of the retry, so context projection and active-batch recovery do
not advance merely because the same provider request is retried. Before network I/O, the Worker
recomputes the canonical provider-context fingerprint. A mismatch rejects the retry as
`retry_context_mismatch`; it never silently sends changed context.

The anchor is memory-only and belongs to the active run capability. It is not reconstructed from
`agent_trace_payloads`, logs, Renderer state, or an interrupted assistant message. Starting a later
request replaces it. Successful settlement, Stop, project close, worker loss, or run finalization
revokes it.

### Live retry protocol

On an eligible terminal provider error, the Worker finishes and reports the failed source
`model_request`, emits one interrupted assistant message when content was published, and enters a
retry-waiting barrier instead of settling the run. Main keeps the existing work slot, run handle,
credential scope, and Stop path alive. The activity snapshot exposes a bounded retry descriptor,
not prompt text or recovery authority.

Renderer invokes a dedicated `retryAgentRequest` IPC method with `projectSessionId`, `agentRunId`,
and the opaque retry capability ID. The contract contains no prompt, editor context, Skill
selection, model choice, or tool arguments.

Main validates that:

- the project session, conversation, run, Worker handle, and retry capability are still active;
- the offered source request is the run's latest failed model request and its persisted error is
  retryable;
- the run is not waiting for review or user clarification and is not being stopped or closed; and
- no later model request or uncertain tool/effect operation has crossed the offered boundary.

Main then durably creates a new `model_request`, appends a schema-v4 `model_retry` Agent event, and
only after both writes succeed sends a retry authorization to the Worker. The event records safe
lineage only: source and target model-request IDs, failure stage, retry reason, user trigger, and
timestamp. It contains no prompt or response body. The retry trace keeps the source request's
semantic purpose and sets `parent_span_id` to the source model-request span; traces remain
diagnostic and do not authorize the action.

The Worker validates the one-use authorization, restores the anchor, places the new authorized
model-request ID at the provider-call boundary, and invokes `agent.continue()`. Stale, duplicated,
cross-run, or mismatched authorization fails closed before network I/O. If durable creation succeeds
but Worker delivery fails, Main aborts the target request with `retry_delivery_failed`; it does not
reopen the source request.

### Message, tool, and queue semantics

The source user message remains exactly once in `agent_events` and exactly once in the restored Pi
transcript. The failed assistant message remains visible as interrupted evidence but is excluded
from the restored model context. A retried partial answer is regenerated from the request boundary;
WriteLLM does not claim token-level stream resumption and does not concatenate old partial text
with the new answer.

If the failed request followed completed tools, the anchor ends in the existing tool results.
Those assistant tool calls and results remain in context, while `continue()` requests only the next
assistant response. Tools are never rerun by this feature. A provider failure after a partial tool
call is also safe because Pi has not executed that call before a successful assistant terminal
event.

Steer and Follow-up messages accepted before or during failure remain Main-authoritative but are
held behind a retry barrier. The Worker removes them from Pi's immediate queues before restoring
the anchor and requeues them in original order only after the retried assistant turn settles. New
Steer input is disabled while the UI is waiting for retry; Follow-up may remain queued. Queued user
content never changes the provider context fingerprint of the retried request.

### Eligibility and UI

The live retry is offered only for transient network, rate-limit, retryable HTTP, provider overload,
or premature-stream termination failures after a provider request boundary and while the Worker
anchor remains available.

The UI labels the same operation by stage:

- `Retry request` when no assistant content was published; and
- `Continue` when partial assistant content was shown or the failed request followed completed tool
  results.

The operation is not offered for context overflow, authentication, permission, invalid request,
missing model access, content policy, quota, billing, cancellation, user Stop, project close,
trace-persistence failure, setup or Skill-routing failure, tool execution failure, review/input
pauses, process restart, Worker crash, or any boundary with uncertain effects. Context overflow
continues to use ADR 019's existing bounded pre-activity compaction recovery. Non-eligible terminal
states may offer an explicitly named `Send as new request` action, but never reuse the words
`Retry request` or `Continue` and never silently repeat the prior prompt.

## Consequences

- Long prompts are no longer duplicated by an eligible UI retry.
- Mid-stream failures can be regenerated from the last safe model-call boundary without clearing
  completed conversation or replaying tools.
- A retry-waiting run continues to occupy one of the three project Agent work slots and can wait
  indefinitely until Retry, Stop, project close, or Worker loss.
- Interrupted partial output remains auditable, but neither it nor diagnostic traces become model
  context or recovery authority.
- Project event schema v4 and a forward migration are required. The migration must preserve all
  existing events, foreign keys, indexes, backup/integrity behavior, and Pi runtime compatibility.
- There is no durable Agent job, provider SDK dependency, Pi fork, `AgentHarness` migration,
  automatic post-content retry, token-level stream resume, cross-process resume, or tool replay.

This decision narrowly amends ADR 012's explicit user-retry clause. Its automatic retry budget and
permanent-failure exclusions remain unchanged. ADRs 019, 046, 063, and 069 remain authoritative.

## Alternatives Rejected

- **Start another run with the same prompt:** this is the current bug; it duplicates durable user
  content and inflates future context.
- **Delete the failed run or user event before resending:** this destroys audit history and can
  detach already completed tool or proposal evidence.
- **Call `continue()` on the failed Pi state:** Pi rejects continuation from the terminal assistant
  error message.
- **Resume from diagnostic traces after restart:** ADR 069 explicitly forbids traces from becoming
  recovery authority, and trace capture may contain provider-projected rather than full Pi state.
- **Retry from the latest durable session history in a new Worker:** a process loss can make tool or
  effect completion uncertain and would weaken the existing request-scoped no-resume boundary.
- **Adopt `AgentHarness` for this feature:** the pinned harness has session and retry-related
  facilities but no public manual request retry/continue control; migration would broaden the
  checkpoint without removing the required protocol.
- **Automatically retry after published content:** visible partial output makes unattended replay
  ambiguous. Explicit user authorization is required.

## Acceptance Gate

Checkpoint 80 may begin only after the user accepts this ADR and the corresponding architecture
amendment. Implementation must prove request-context identity before network dispatch, exactly-once
user-message history, no tool replay, stale-capability rejection, queue ordering, migration
recovery, and truthful UI behavior for every eligible and excluded failure class.
