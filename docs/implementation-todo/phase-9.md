# Phase 9: Pi Writing Agent

## Phase overview

- Purpose: add durable Pi agent sessions, bounded read tools, typed mutation proposals, approval/application, and the assisted-writing UI.
- Checkpoints: 20–23.
- Current status: Not started.
- Implementation state: planned only; do not begin until the reopened prior phases pass and the user approves continuing.

> **计划已冻结并收窄，旧清单不再是 CP20–23 的目标。** The original plan below lists nine read tools, six write tools, `agent_messages`/`agent_tool_calls`, durable Agent turns, and a persistent compaction subsystem. CP19.5 supersedes those items before implementation: use four read tools (`get_writing_context`, `read_section`, `search_knowledge`, `read_citations`), three proposal tools (`propose_brief_update`, `propose_outline_patch`, `propose_section_patch`), `agent_events` instead of message/tool-call tables, request-scoped Agent turns, and bounded summaries as ordinary events. Do not implement the old entries without first updating this Phase after CP19.5 acceptance.

### Checkpoint 20: Agent Utility Process, Sessions, Events, And Durable Trace

- [ ] Launch a dedicated Agent utility process only while a project is open or an agent run requires it.
- [ ] Instantiate `@earendil-works/pi-agent-core` with the selected pi-ai model runtime.
- [ ] Define project-local `agent_sessions`, `agent_runs`, `agent_messages`, `agent_tool_calls`, and model request records.
- [ ] Persist session/run/request records before starting an external model stream.
- [ ] Stream Pi agent, message, thinking, and tool events through a narrow MessagePort contract.
- [ ] Persist normalized message and tool lifecycle state without relying on rotatable logs.
- [ ] Support abort, renderer closure, worker crash, steering, and follow-up queues with explicit state.
- [ ] Mark interrupted output as interrupted, never complete.
- [ ] Store Pi package/runtime version with serialized session state and define compatibility handling.
- [ ] Use a mock/faux model to test event order, tool calls, abort, retry/continue, and crash recovery.

Acceptance criteria: an agent conversation is project-local and durable; renderer or worker interruption cannot create a falsely complete answer; project close revokes the run and a later reopen shows accurate history.

### Checkpoint 21: Context Builder And Read-Only Agent Tools

- [ ] Implement a token-budgeted `ContextBuilder` using manuscript brief, outline, statuses, active section, selected blocks, neighboring summaries, user request, and prior compacted conversation.
- [ ] Define read tools: manuscript brief, manuscript overview, section list, section read, block read, manuscript search, knowledge search, citation expansion, and active editor context.
- [ ] Give every tool a strict TypeBox model-facing schema and a corresponding Main/domain validation schema.
- [ ] Route every tool through the Agent-to-Main bridge; do not expose database/filesystem primitives.
- [ ] Add project session, agent run, and tool call identity to every request.
- [ ] Enforce result count, text size, image size, and pagination limits.
- [ ] Permit parallel execution only for independent read tools.
- [ ] Clearly delimit retrieved knowledge as untrusted source content and prevent it from changing system/tool policy.
- [ ] Persist citation IDs and tool provenance in the agent transcript.
- [ ] Test prompt-injection fixtures, stale project sessions, unauthorized tool names, malformed arguments, oversized results, parallel ordering, and source deletion during a run.

Acceptance criteria: the agent can understand the writing brief, outline, active section, full project through bounded tools, and relevant knowledge with citations; it has no generic project or operating-system access.

### Checkpoint 22: Typed Mutation Proposals, Preview, Approval, And Application

- [ ] Define versioned domain mutation schemas for manuscript brief updates, section create/update/reorder/delete, and block insert/update/remove/replace/move.
- [ ] Require target IDs and `baseRevisionId`/base outline revision on every proposal.
- [ ] Configure write tools as sequential.
- [ ] Use Pi tool preflight plus Main policy to block disallowed or oversized mutations.
- [ ] Persist a `mutation_proposal` before returning tool success.
- [ ] Build a pure validator/simulator that applies block operations to native BlockNote JSON without committing.
- [ ] Validate block IDs, schema, nesting, content size, operation count, target existence, and resulting document.
- [ ] Generate a structured preview showing affected sections/blocks, before/after text, and cited sources.
- [ ] Default to user approval; rejection records a decision without changing manuscript state.
- [ ] Revalidate against the current revision immediately before approval application.
- [ ] Apply accepted mutations in Main, create new revisions, materialize files, and notify the active editor.
- [ ] Link accepted revisions to agent session, run, tool call, proposal, prior revision, model request, and cited source blocks.
- [ ] Implement undo as a new revision, not destructive history rewriting.
- [ ] Test stale proposal rejection, concurrent manual edit, missing block, invalid nesting, duplicate IDs, partial multi-operation failure, approve-after-project-switch, reject, undo, and crash after proposal but before apply.

Acceptance criteria: the agent cannot bypass user/policy approval or revision checks; accepted changes are atomic, visible, undoable, and fully traceable; stale proposals never overwrite newer manual work.

### Checkpoint 23: Agent Writing UI, Compaction, And End-To-End Workflow

- [ ] Build the agent panel with session list, message streaming, thinking visibility policy, stop, retry/continue, steering, and follow-up controls.
- [ ] Render tool calls as structured cards with status, bounded arguments, results, errors, and citations.
- [ ] Render mutation proposals with section/block diff, source citations, approve, reject, and undo state.
- [ ] Show active model/provider, usage, estimated cost, interruption, and retry state without exposing secrets.
- [ ] Implement conversation compaction through Pi context transformation while retaining durable full history.
- [ ] Prevent compacted summaries from becoming manuscript or source authority.
- [ ] Allow starting an agent request from current selection, active section, or project overview.
- [ ] Add an E2E scenario: create project, write brief/outline, import source, complete MinerU/indexing, ask agent for evidence, propose a section edit, approve it, verify citations/lineage, close, reopen, and undo.

Acceptance criteria: the complete assisted-writing workflow is understandable and recoverable; tool and mutation states remain accurate across cancellation, close, reopen, and compaction.
