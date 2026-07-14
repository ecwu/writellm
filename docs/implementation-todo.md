# WriteLLM v2 Implementation Todo

Status: accepted implementation tracker  
Recorded: 2026-07-14

This is the persistent ordered implementation tracker for the clarified product: WriteLLM opens one self-contained project folder at a time. Update this document in the same change that starts or completes an item.

Do not start a later checkpoint until the current checkpoint passes its acceptance criteria and the user approves continuing.

Every checkpoint must add and test useful structured lifecycle events for its new behavior. Every caught error must preserve the original object in a top-level logger `err` field before recovery or boundary sanitization.

Status markers:

- `[ ]` not started
- `[~]` in progress
- `[x]` completed and verified
- `[!]` blocked; add the blocker immediately below the item

## Current Checkpoint

Checkpoints 1 through 4 are completed and verified. Waiting for explicit approval before starting Checkpoint 5; no later storage, queue, editor, import, search, or agent work may begin first.

Checkpoint 4 replaced the ambiguous global `core.sqlite` product role with an application-global `app.sqlite`, a parameterized per-project `project.sqlite`, a validated project manifest/identity boundary, and normalized project-relative path rules.

## Phase 0: Baseline And Guardrails

- [x] Replace ESLint and Prettier with Biome for formatting and style checks, document the commands in `AGENTS.md`, and verify the repository.
- [x] Record the original fixed architecture and technology choices.
- [x] Add root agent instructions requiring architecture and todo review.
- [x] Record the repository's initial gaps.
- [x] Confirm initial foundation scope.
- [x] Replace the architecture baseline with the accepted project-container revision after review.
- [x] Replace the future implementation tracker with this accepted sequence after review.

## Phase 1: Completed Security And Observability Foundations

### Checkpoint 1: Secure Electron Foundation

- [x] Align Electron to major 43 and electron-vite to stable 5.x.
- [x] Enable sandboxed, isolated renderer settings.
- [x] Remove broad Electron/IPC exposure.
- [x] Add narrow typed preload APIs and shared contracts.
- [x] Add sender, navigation, and external-URL authorization.
- [x] Add custom production protocol and CSP.
- [x] Add contract and authorization tests plus development and packaged smoke tests.

Acceptance criteria: completed under the original tracker.

### Checkpoint 2: Structured Logging And Error Capture

- [x] Implement centralized Pino logging, rotation, retention, correlation, redaction, diagnostics APIs, utility-process aggregation, renderer error reports, and fatal handling.
- [x] Prove Error stack/cause preservation and packaged transport startup.

Acceptance criteria: completed under the original tracker.

## Phase 2: Completed Database Primitives

### Checkpoint 3: SQLite Connection And Migration Primitives

- [x] Install better-sqlite3, Kysely, and types.
- [x] Implement required pragmas and short transaction helpers.
- [x] Implement statically packaged forward-only migrations and schema manifests.
- [x] Add fresh-create, sequential-upgrade, failure rollback, and foreign-key tests.
- [x] Add database lifecycle logging and packaged migration smoke tests.

Acceptance criteria: completed under the original tracker. The primitives are accepted; the database ownership model is revised by Checkpoint 4.

## Phase 3: Project Container And Recovery Boundary

### Checkpoint 4: Split Application And Project Database Roles

- [x] Add an application-global `app.sqlite` connection under Electron `userData`.
- [x] Limit `app.sqlite` schema to application settings, recent projects, provider configuration metadata, encrypted credential records, and app schema metadata.
- [x] Refactor the existing authoritative connection code into a parameterized `ProjectDatabase` opened from `<ProjectRoot>/.writellm/project.sqlite`.
- [x] Remove or prevent project/manuscript/knowledge/job tables from the global application database.
- [x] Define and validate the `writellm.project.json` manifest schema with stable `projectId` and `formatVersion`.
- [x] Add the singleton project row and require its `projectId` to match the manifest.
- [x] Define the initial project directory constants and project-relative path normalization rules.
- [x] Ensure no project table or job payload stores an absolute path; Checkpoint 4 creates only the path-free singleton project row, and future project tables/jobs must use the validated project-relative path boundary.
- [x] Add migration handling for the current development `core.sqlite` state; unreleased development files are explicitly quarantined with a `.development-reset` suffix rather than reinterpreted as application state.
- [x] Add lifecycle events for app database open/migrate and project database open/migrate with distinct `databaseRole` fields.
- [x] Test app/project isolation, manifest/database ID mismatch, unsupported manifest versions, and Unicode project roots.

Acceptance criteria: completed and verified. A real Electron startup created and migrated `app.sqlite` without a project; isolated Unicode project roots created separate `project.sqlite` databases; the app schema contains no project tables; and identity mismatch is rejected before a project database handle is returned. Verification: `pnpm check`, `pnpm typecheck`, 46 Vitest tests, `pnpm build`, and an isolated-userData Electron runtime smoke.

### Checkpoint 5: Project Create, Open, Close, Switch, And Lock

- [ ] Implement `ProjectManager` states: closed, creating, opening, open, closing, and recovery-required.
- [ ] Implement native create-project and open-project folder selection through Main-owned dialogs.
- [ ] Create the complete staged project directory layout and atomically publish a valid new project.
- [ ] Create the initial project, manuscript, writing brief, and first section records.
- [ ] Implement a cross-platform project write lock with owner token, process/host metadata, heartbeat, and stale-lock recovery policy.
- [ ] Reject concurrent writable opens from a second application instance.
- [ ] Generate a new opaque `projectSessionId` on every successful open.
- [ ] Require the active `projectSessionId` on every project-scoped IPC subscription and mutation.
- [ ] Reject delayed results and requests from a closed or previously active project.
- [ ] Implement ordered close: block new mutations, request editor flush, stop claims, park/abort workers, close databases, release lock, revoke session.
- [ ] Implement project switch strictly as close-then-open.
- [ ] Store only recent project pointers and display metadata in `app.sqlite`.
- [ ] Handle moved/renamed projects by stable manifest ID rather than absolute-path identity.
- [ ] Add E2E coverage for create, reopen, switch, app restart, moved project, lock contention, stale lock, and stale IPC.

Acceptance criteria: exactly one active project exists; two instances cannot write the same project; closing revokes every project capability; a project can be moved and reopened without database path repair.

### Checkpoint 6: Backup, Integrity, Restore, And Project Snapshot

- [ ] Implement online backup for `app.sqlite` and `project.sqlite` using the SQLite backup API or `VACUUM INTO`.
- [ ] Run project backup after lock acquisition and before project migrations.
- [ ] Run `quick_check` and `foreign_key_check` after migrations.
- [ ] Add explicit database restore with safety checks, pre-restore backup, and actionable failure reporting.
- [ ] Add tests containing committed WAL-resident data.
- [ ] Define retention and cleanup for migration backups under `.writellm/backups/`.
- [ ] Implement an initial project snapshot operation that captures the manifest, an online `project.sqlite` backup, referenced manuscript/source/parsed files, and a snapshot manifest.
- [ ] Allow `index.sqlite` to be omitted from a snapshot and mark it for rebuild.
- [ ] Validate file hashes before publishing the snapshot.
- [ ] Never present a raw copy of an open project folder as a verified backup.
- [ ] Test snapshot restore into a different absolute path and subsequent project open.

Acceptance criteria: backups include WAL-resident committed data; restore returns the project to a verified usable state; a snapshot restored elsewhere opens by project ID and rebuilds a missing index.

## Phase 4: Project-Local Durable Work

### Checkpoint 7: Persistent Job State Machine

- [ ] Finalize the project-local STRICT jobs schema and state/error schemas.
- [ ] Include type, small JSON payload, state, priority, attempts, max attempts, `run_after`, lease owner, `locked_until`, heartbeat, progress, deduplication key, cancellation request, structured error, and timestamps.
- [ ] Implement enqueue, dedupe, atomic claim, lease renewal, heartbeat, completion, retry, failure, cancellation, and optional paused transition.
- [ ] Use short `BEGIN IMMEDIATE` claims and transitions.
- [ ] Implement startup/project-open recovery for expired leases.
- [ ] Add exponential backoff with jitter and retryability classification.
- [ ] Keep document bodies, BlockNote JSON, vectors, absolute paths, signed URLs, and credentials out of payloads.
- [ ] Add deterministic clock and worker-identity seams.
- [ ] Test concurrent claims, process crash, lease expiry, cancellation races, deduplication, retry exhaustion, and project close during running work.
- [ ] Emit project-correlated lifecycle events without treating logs as job history.

Acceptance criteria: one job is not owned by two workers; process or project closure is recoverable; payloads are bounded references; transitions are deterministic and auditable in `project.sqlite`.

### Checkpoint 8: Runtime Scheduler And Project Close Semantics

- [ ] Install and pin p-queue.
- [ ] Map job types to resource queues for MinerU, embedding, rerank, indexing, and auxiliary LLM work.
- [ ] Dispatch claimed jobs with configured concurrency, priority, timeout, and `AbortSignal` handling.
- [ ] Persist progress and expose bounded job status through project-scoped IPC.
- [ ] Stop claiming before project close.
- [ ] Define handler-specific close behavior: finish, abort-and-requeue, recover by lease expiry, or persist external continuation state.
- [ ] Ensure a submitted MinerU task retains `remote_task_id` before workers stop.
- [ ] Ensure index generation publication is atomic and a half-built generation never becomes active.
- [ ] Add interruption/restart and close/reopen integration tests.

Acceptance criteria: p-queue remains an execution detail; `project.sqlite` is authoritative; project reopen resumes unfinished work without duplicate external submission or duplicate index publication.

## Phase 5: Manuscript And BlockNote Product Slice

### Checkpoint 9: Manuscript Brief, Outline, Section State, And Revisions

- [ ] Define the initial one-primary-manuscript schema.
- [ ] Define a versioned manuscript brief with title, description/purpose, topic/coverage, audience, language, style/tone, scope/exclusions, target length, citation requirements, and extra instructions.
- [ ] Define ordered hierarchical sections with stable IDs, parent, position, level, title, objective, status, and current revision.
- [ ] Fix the section status enum to `planned`, `drafting`, and `completed` for the initial product.
- [ ] Define section body content as native BlockNote JSON separate from the section title.
- [ ] Add `section_revisions` with source type, content JSON, content hash, prior revision, agent lineage fields, and timestamps.
- [ ] Define optimistic concurrency using `baseRevisionId` and content hash.
- [ ] Add domain services for brief read/update, section create/update/reorder/delete, revision read, and whole-manuscript assembly.
- [ ] Prevent deleting a section with unresolved agent proposals without an explicit policy.
- [ ] Define deterministic word/character count extraction from BlockNote content.
- [ ] Test nested outline ordering, status transitions, revision conflicts, delete/reorder constraints, and full assembly.

Acceptance criteria: manuscript metadata, ordered structure, status, and section bodies have explicit non-overlapping ownership; stale writes cannot silently overwrite a newer section revision.

### Checkpoint 10: BlockNote Editor Persistence And Materialization

- [ ] Install and pin BlockNote React and the shadcn-compatible UI packages required by the chosen integration.
- [ ] Define the approved BlockNote schema and initial allowed block types/props.
- [ ] Preserve native BlockNote block IDs and reject duplicate IDs.
- [ ] Implement active-section load into BlockNote.
- [ ] Implement debounced save of the complete native BlockNote document with `baseRevisionId`.
- [ ] Validate document shape, nesting, inline content, block count, and serialized size in Main.
- [ ] Commit the canonical revision transactionally in `project.sqlite`.
- [ ] Atomically materialize the current revision to `manuscript/sections/<section-id>.blocknote.json`.
- [ ] Store materialization revision/hash and repair missing or stale files on project open.
- [ ] Expose explicit save states: clean, saving, saved, conflict, failed.
- [ ] Retain useful manual and accepted-agent revisions under a bounded retention policy.
- [ ] Implement native JSON export and lossy Markdown import/export as separate operations.
- [ ] Ensure Markdown export never replaces the canonical native document.
- [ ] Add tests for rich text, nested blocks, tables, links, Unicode, duplicate IDs, invalid props, stale saves, crash between revision commit and materialization, and materialization repair.

Acceptance criteria: BlockNote native JSON round-trips without loss; Markdown is treated as lossy interchange; a committed revision survives renderer crash even if its mirror must be repaired later.

### Checkpoint 11: Writing Workspace UI

- [ ] Build the active-project shell with manuscript, knowledge, agent, and settings areas.
- [ ] Build the manuscript outline panel with nested sections, drag/reorder, create/delete, title editing, objectives, and status controls.
- [ ] Build the manuscript brief editor with validated fields and unsaved/error state.
- [ ] Build the BlockNote section editor with current section title/status context.
- [ ] Preserve editor selection and active block context for agent use without persisting unnecessary high-frequency cursor events.
- [ ] Display section and manuscript word/character counts.
- [ ] Add next/previous section navigation and outline completion indicators.
- [ ] Build a read-only whole-manuscript preview assembled from section order and bodies.
- [ ] Add keyboard shortcuts and accessible focus behavior for save, section navigation, and agent panel toggling.
- [ ] Add Playwright E2E for project creation through manual writing, reload, conflict handling, section reorder, and whole-manuscript preview.

Acceptance criteria: a user can create a project, define the writing brief and outline, write multiple sections, assign statuses, close the app, and reopen with identical native content and structure.

## Phase 6: Project Knowledge Source Storage And Providers

### Checkpoint 12: Batch Source Import And Project-Local File Records

- [ ] Implement batch file picker and drag/drop contracts without exposing renderer filesystem access.
- [ ] Define exact supported MIME/extension capability checks for PDF, DOCX, PPTX, and common images.
- [ ] Reject or clearly route legacy DOC/PPT rather than misidentifying them.
- [ ] Copy each source to project temp storage while hashing.
- [ ] Sanitize display names while preserving the original name in metadata.
- [ ] Publish originals under content-addressed project-local paths.
- [ ] Define duplicate policy by SHA-256 and ensure repeated import is idempotent.
- [ ] Create `file_records`, `knowledge_items`, and high-level ingestion state.
- [ ] Build the knowledge item list with per-file progress, failure, retry, cancel, delete, and reveal/open-original actions.
- [ ] Implement deletion policy that cancels pending work and schedules index removal without leaving active references.
- [ ] Add tests for Unicode names, spaces, long names, duplicate content, MIME mismatch, interrupted copy, insufficient disk space, and project close during import.

Acceptance criteria: imported originals are durable inside the project before remote submission; duplicate imports do not create duplicate bytes or external tasks; renderer-controlled paths cannot escape the active project.

### Checkpoint 13: Secrets, Provider Configuration, And Capability Registry

- [ ] Implement `app.sqlite` provider configuration records and `safeStorage` ciphertext persistence.
- [ ] Detect and report the Linux safeStorage backend, including the `basic_text` policy.
- [ ] Expose configured/unconfigured provider status without returning secret values.
- [ ] Define a provider capability registry for agent chat/tool-calling, embeddings, reranking, and MinerU parsing.
- [ ] Validate base URLs, provider IDs, models, dimensions, batch limits, file limits, timeout limits, and supported formats.
- [ ] Implement a credential resolver that decrypts only for the current utility request.
- [ ] Ensure secrets never enter project files, job payloads, renderer state, logs, snapshots, or diagnostic exports.
- [ ] Add settings UI for provider endpoints, model choices, connection tests, and capability status.
- [ ] Test redaction, missing keys, invalid auth, key replacement, provider removal, project portability without keys, and Linux backend reporting.

Acceptance criteria: project folders and snapshots contain no plaintext credentials; only Main can persist/decrypt secrets; provider capability failures are explicit before durable work starts.

### Checkpoint 14: Pi Model Runtime, Embedding Gateway, And Rerank Gateway

- [ ] Install and pin `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai`.
- [ ] Install and pin AI SDK Core plus only the embedding/rerank provider packages required by the first product slice.
- [ ] Define separate `AgentModelRuntime`, `EmbeddingGateway`, and `RerankGateway` interfaces.
- [ ] Implement a Pi `CredentialStore` adapter backed by Main-owned safeStorage records rather than Pi's default file store.
- [ ] Implement AI SDK `embedMany` adapters with batch limits, retry policy, usage, response IDs, and abort support.
- [ ] Implement AI SDK rerank adapters with top-N limits, retry policy, usage where available, and abort support.
- [ ] Implement OpenAI-compatible custom endpoint support only behind validated adapters.
- [ ] Normalize provider/model fingerprints, timing, token/usage metadata, estimated cost, retry count, and structured errors in `model_requests`.
- [ ] Place external requests in the appropriate utility process and keep credentials ephemeral.
- [ ] Add mock-provider contract tests for success, streaming, abort, rate limit, authentication failure, malformed response, retryable server error, and redaction.

Acceptance criteria: Pi owns interactive agent generation; AI SDK owns embedding/rerank adapters; business code does not depend on provider-specific response shapes; no credential or unredacted body leaks into ordinary logs.

## Phase 7: MinerU And Parsed Knowledge

### Checkpoint 15: Durable MinerU Submit, Poll, Download, And Publish

- [ ] Define the MinerU adapter contract and capability limits independently of UI and job handlers.
- [ ] Implement submit and persist `remote_task_id` immediately before further polling.
- [ ] Implement durable polling without duplicate resubmission.
- [ ] Persist remote state transitions and retry metadata.
- [ ] Implement download to project temp storage with content-length and hash checks.
- [ ] Validate archive format and reject path traversal, absolute entries, unsafe symlinks, excessive expanded size, excessive file count, and unexpected file types.
- [ ] Extract only into a project temp directory.
- [ ] Preserve the provider's raw output and response manifest.
- [ ] Atomically publish a new parse revision under `knowledge/parsed/<item>/<revision>/`.
- [ ] Handle cancellation according to provider capability without pretending a remote task was cancelled when only local polling stopped.
- [ ] Resume after project reopen at submit, poll, download, extraction, and pre-publish boundaries.
- [ ] Add fixtures and mock HTTP tests for all retry and restart boundaries.

Acceptance criteria: reopening the project resumes the same remote task; no unsafe or partial archive is published; each stage is idempotent and traceable to source hash and remote task ID.

### Checkpoint 16: MinerU Normalization And Parsed Document Viewer

- [ ] Define a versioned `NormalizedKnowledgeBlock` schema with stable local ID, ordinal, type, text/Markdown, heading path, page, bounding box, provider block ID, asset references, and content hash.
- [ ] Normalize the active MinerU raw output into `blocks.jsonl`, `document.md`, `images/`, and `manifest.json` without discarding raw artifacts.
- [ ] Preserve tables, formulas, captions, images, and reading-order provenance.
- [ ] Record normalization version and allow re-normalization from raw output without re-upload.
- [ ] Validate that every referenced image/asset exists and remains contained under the parse revision.
- [ ] Define activation rules so a failed new parse revision does not replace the prior active revision.
- [ ] Build a parsed document viewer with Markdown/content view, page/source metadata, image display, parse status, and raw-result diagnostics.
- [ ] Add tests using representative PDF, DOCX, PPTX, scanned image, table, formula, multi-column, and malformed provider fixtures.

Acceptance criteria: the UI can inspect normalized content and images with provenance; changing the normalizer does not require re-upload; an invalid revision never becomes active.

## Phase 8: Rebuildable Index And Retrieval

### Checkpoint 17: Project Index Database And Deterministic Chunk Pipeline

- [ ] Add the project-local `index.sqlite` connection and manifest schema.
- [ ] Launch one project-bound Index utility process with a narrow protocol and centralized logging port.
- [ ] Define deterministic chunk IDs from parse revision, source block range, chunker version, and content hash.
- [ ] Implement chunking from normalized blocks, not from unstructured Markdown alone.
- [ ] Preserve heading path, page/bbox, source block IDs, table/formula/image references, and item metadata in `chunk_sources`.
- [ ] Merge short adjacent text blocks and split only overlong text with deterministic overlap.
- [ ] Implement idempotent add/update/delete jobs and generation build/switch.
- [ ] Implement full deletion and rebuild from active parse revisions and normalized artifacts.
- [ ] Handle Index utility crash, project close, and missing/corrupt `index.sqlite`.
- [ ] Add golden chunk fixtures and equivalent-rebuild tests.

Acceptance criteria: deleting `index.sqlite` loses no authoritative knowledge; rebuild produces equivalent active chunks and provenance; a partial generation never becomes active.

### Checkpoint 18: FTS5, Embeddings, sqlite-vec, And Generation Compatibility

- [ ] Implement FTS5 indexing behind a search repository.
- [ ] Benchmark and test `unicode61` and `trigram` on representative Chinese and English fixtures.
- [ ] Implement the approved dual-index or short-query fallback strategy.
- [ ] Install sqlite-vec and implement the `VectorIndex` abstraction.
- [ ] Load the packaged extension from a platform/architecture resource path.
- [ ] Define embedding generation records with provider, model, revision, dimension, metric, normalization, chunker version, and content fingerprint.
- [ ] Implement project-local embedding jobs using `EmbeddingGateway.embedBatch`.
- [ ] Cache/reuse vectors only when content hash and the complete embedding contract match.
- [ ] Reject incompatible dimensions, model revisions, normalization strategies, or chunker versions.
- [ ] Implement vector upsert, deletion, query, generation switch, and rebuild.
- [ ] Add development and packaged extension/vector smoke tests.
- [ ] Benchmark at 100k representative chunks before considering another vector engine.

Acceptance criteria: Chinese and English fixtures have an explicit tested path; incompatible vectors cannot mix; a packaged app can build and query the project-local vector index.

### Checkpoint 19: Hybrid Retrieval, Reranking, Citations, And Search UI

- [ ] Implement FTS and vector candidate retrieval with configurable limits.
- [ ] Implement deterministic reciprocal-rank fusion.
- [ ] Implement optional `RerankGateway` refinement over a bounded candidate set.
- [ ] Return stable citation IDs, source item, parse revision, chunk, title, snippet, page, heading path, source block IDs, and asset references.
- [ ] Implement filters by knowledge item, file type, parse revision, and optional page/heading fields.
- [ ] Add a separate citation-expansion API rather than returning full source documents in initial search results.
- [ ] Implement graceful behavior when rerank is unconfigured or unavailable.
- [ ] Build knowledge search UI with score/debug information behind a developer option, source preview, page context, and image links.
- [ ] Add ranking fixtures, deletion/update tests, query-embedding compatibility tests, rerank failure fallback tests, and bounded-result tests.

Acceptance criteria: retrieval is deterministic before rerank; rerank improves ordering without losing provenance; every result shown to the user or agent can be traced back to normalized source blocks and project files.

## Phase 9: Pi Writing Agent

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

## Phase 10: Export, Packaging, And Release Confidence

### Checkpoint 24: Manuscript Export And Project Portability

- [ ] Implement whole-manuscript native JSON export with outline and section revision metadata.
- [ ] Implement deterministic whole-manuscript Markdown export from section headings and BlockNote bodies.
- [ ] Make the lossy nature of Markdown explicit where unsupported BlockNote structures exist.
- [ ] Export or copy manuscript assets using project-relative references.
- [ ] Finalize verified project snapshot/clone UI and conflict-safe destination handling.
- [ ] Validate a project copied or restored to Windows/macOS/Linux-compatible paths.
- [ ] Ensure opening a project with a missing index schedules rebuild rather than failing manuscript access.
- [ ] Add export fixtures and moved/restored project E2E tests.

Acceptance criteria: users can export the article and move or snapshot the complete project without hidden absolute-path dependencies; native content remains lossless and Markdown limitations are explicit.

### Checkpoint 25: Native Packaging

- [ ] Enable electron-builder native dependency rebuilding for Electron 43.
- [ ] Configure sequential rebuilding and ASAR unpack rules for better-sqlite3, sqlite-vec, and native resources.
- [ ] Audit pnpm build-script allowlists from the lockfile.
- [ ] Copy sqlite-vec binaries into platform/architecture resource directories.
- [ ] Keep Pino/thread-stream/transport assets available in packaged builds.
- [ ] Verify BlockNote, Pi, AI SDK provider lazy imports, utility entrypoints, and MessagePort protocols in packaged artifacts.
- [ ] Smoke-test installed or unpacked artifacts rather than source-mode paths.

Acceptance criteria: each target artifact creates and opens a project, persists BlockNote content, loads sqlite-vec, starts Pi and utility processes, and performs a local vector insert/search without source-tree dependencies.

### Checkpoint 26: Cross-Platform Recovery CI And Release Gate

- [ ] Add CI builds for Windows x64, macOS arm64, macOS x64, and Linux x64.
- [ ] Run Vitest and Playwright Electron E2E at appropriate layers.
- [ ] Test app/project migrations, backup/restore, project locking, stale sessions, moved project paths, BlockNote persistence/materialization repair, vector loading, Unicode paths, lease recovery, MinerU polling recovery, index rebuild, agent interruption, tool authorization, stale proposal rejection, and accepted mutation lineage.
- [ ] Test CSP, navigation restrictions, IPC sender rejection, and safeStorage backend reporting.
- [ ] Test centralized logging transport, cross-process aggregation, Error serialization, redaction, rotation/retention, and shutdown flush in packaged artifacts.
- [ ] Define artifact retention, migration-fixture retention, and release gating.

Acceptance criteria: all required target-platform jobs pass on real packaged artifacts before release.

## Deferred Until Evidence Requires It

- [ ] Multiple simultaneously open projects or multiple project windows.
- [ ] Multiple manuscripts per project UI/workflow.
- [ ] Real-time collaboration or Yjs.
- [ ] Automatic agent write application beyond narrowly approved low-risk modes.
- [ ] Multimodal image embeddings; initial indexing embeds text and retains image/caption provenance.
- [ ] Legacy DOC/PPT conversion unless a reliable converter is selected.
- [ ] Local document parsing as a MinerU replacement; keep only optional preview extraction until needed.
- [ ] Evaluate LanceDB only after measured sqlite-vec limits.
- [ ] Split into a pnpm monorepo only after a reusable CLI, service, or SDK exists.
- [ ] Add Zustand only when shared UI state cannot remain local or query-derived.
- [ ] Tune queue concurrency only from provider limits and target-device benchmarks.

## Decision Log

- 2026-07-14: Accepted the original embedded local-first architecture and completed secure Electron, centralized logging, and SQLite migration primitives.
- 2026-07-14: Clarified that WriteLLM opens one project at a time and every project's manuscript, sources, parsed artifacts, embeddings, BlockNote JSON materializations, project database, index, and durable work live inside its folder.
- 2026-07-14: Accepted replacing global product `core.sqlite` with application-global `app.sqlite` plus per-project `project.sqlite` and `index.sqlite`.
- 2026-07-14: Accepted BlockNote native JSON as the lossless manuscript representation, with canonical revisions in `project.sqlite` and atomic project-folder materializations; Markdown remains lossy interchange.
- 2026-07-14: Accepted `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai` for interactive agent execution, with AI SDK Core retained behind separate embedding and reranking gateways.
- 2026-07-14: Accepted a Main-authorized agent tool bridge and typed mutation proposals instead of direct filesystem/database/editor access.
- 2026-07-14: Completed and verified Checkpoint 4: application-global `app.sqlite`, per-project `project.sqlite`, project manifest/database identity validation, portable relative-path rules, explicit legacy development reset handling, and role-specific database lifecycle logs.
