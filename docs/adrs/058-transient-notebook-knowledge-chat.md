# ADR 058: Transient Notebook Knowledge Chat

Status: accepted
Date: 2026-08-23

## Context

WriteLLM already owns a Knowledge workspace for source import, parsing, indexing, inspection, and
precise search. Users also need a focused NotebookLM-style surface for asking follow-up questions
across selected Knowledge sources without turning those questions into durable Agent history or
duplicating the project's search index.

The existing architecture restricts interactive Agent turns to the sessionful Pi runtime and keeps
the older single-shot `AgentModelRuntime` for bounded auxiliary work. A Knowledge-grounded answer is
neither a tool-using Agent run nor an import/index job: it is one read-only retrieval request followed
by at most one source-constrained model request. Admitting this surface therefore requires an explicit
model-boundary and persistence decision.

## Decision

- Keep Knowledge as the independent source-management and exact-search workspace. Add a separate
  Notebook workspace with a read-only Sources selector, transient multi-turn Chat, inline citations,
  and the existing citation preview. Notebook does not upload, delete, parse, or index sources.
- Main owns one `KnowledgeChatService` per active `projectSessionId`. Its messages, per-message
  citation registries, selected sources, source-context boundary, active turn, and temporary model
  selection exist only in memory. Renderer reload may recover a snapshot from Main, but project
  close/switch, application shutdown, and an explicit Clear cancel active work and erase the state.
- Every turn forms one bounded query from the current question and at most two recent user questions
  after the latest source boundary. It reuses FTS5, sqlite-vec, reciprocal-rank fusion, and optional
  reranking, restricted to at most 50 selected active Knowledge sources. At most 12 results are
  expanded into no more than 64 KiB of evidence.
- If retrieval yields no relevant expandable evidence, Main returns a deterministic insufficient-
  evidence answer without calling the answer model. Otherwise Main invokes the existing single-shot
  `AgentModelRuntime` in the `agent-worker` at most once. Notebook adds no Agent tool loop, new worker,
  durable job, query-rewrite model, vector store, or provider SDK dependency.
- Notebook, Agent runs, and manual Agent compaction share one project-level limit of three active
  interactive model work reservations. A project has one active Notebook turn and no pending turn
  queue. Stop and project teardown cancel both retrieval and model work.
- Application prompt policy treats every Knowledge evidence block as untrusted data. The answer model
  may use only supplied evidence and emits `[[cite:n]]` markers. Main binds each assistant message to
  its own `n -> citationId` registry. Renderer promotes only registered markers to citation controls;
  unknown, stale, duplicate, or fabricated markers remain ordinary text and emit a content-free
  security warning.
- Strict Zod contracts and preload methods expose snapshot, start, stop, clear, source selection,
  temporary model selection, and subscribed events. Every operation validates the sender and active
  `projectSessionId`; Renderer receives no database, filesystem, credential, or raw IPC authority.
- Notebook state is capped at 200 visible messages and 2 MiB. Reaching either cap rejects further
  turns until Clear. Scope changes preserve visible history, append a visible boundary, and exclude
  history before that boundary from later model context.
- `model_requests` remains the required provider-call metadata authority, but Notebook requests use
  metadata-only retention. Rows may contain an internal request ID, provider/model identity, status,
  timestamps, duration, attempt count, and usage. Their request fingerprint is derived only from the
  internal request ID; external response IDs are discarded. Questions, answers, evidence text, and
  any content-derived fingerprint are forbidden in SQLite and logs.
- The UI discloses that WriteLLM does not save Notebook chat while the selected provider still
  receives the question and retrieved evidence under that provider's own retention policy.

## Consequences

Notebook gains a citation-first, multi-turn source Q&A experience while Knowledge remains the sole
management surface and the existing project index remains the sole retrieval authority. Navigation
and Renderer reload do not destroy an active project-session conversation, but reopening a project
always creates a fresh conversation. Model and retrieval failures are transient UI state rather than
recoverable jobs.

The shared three-slot limiter may reject a Notebook turn or an Agent reservation while the project is
at capacity. Citation registration proves that a rendered citation was part of that turn's retrieved
evidence; it does not independently prove that every natural-language claim is semantically entailed
by the cited passage.

Web search, cross-project sources, saved chats, saved Notes, Studio, Audio Overview, multiple Notebook
conversations, Agent tools, and manuscript mutation remain out of scope. This ADR extends the
single-shot runtime boundary in ADRs 018–019 and otherwise preserves their Agent authority and
persistence decisions.
