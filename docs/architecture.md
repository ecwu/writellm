# WriteLLM v2 Architecture Baseline

Status: accepted implementation baseline, amended through accepted ADR 068
Recorded: 2026-07-31; amended through 2026-08-30

This document is the accepted WriteLLM v2 baseline around the clarified product model: WriteLLM opens exactly one self-contained project folder at a time. The project folder owns the manuscript, knowledge sources, parsed artifacts, embeddings, project databases, BlockNote materializations, and durable work state.

The active delivery state lives in [`docs/current-plan.md`](current-plan.md), while the compact
tracker and Phase links live in [`docs/implementation-todo.md`](implementation-todo.md). The
complexity-reduction and Agent-boundary audit is recorded in
[`docs/audits/2026-07-16-complexity-reduction-and-agent-boundary.md`](audits/2026-07-16-complexity-reduction-and-agent-boundary.md).

## 2026-07-16 Architecture Amendment

The following rules are now the current target. Any older section in this document or in a Phase file that contradicts them is historical and marked superseded below; it must not guide new implementation.

- Durable jobs are limited to external/import recovery and rebuildable indexing work: `mineru_parse`, `normalize_parse_revision`, `build_index_generation`, `build_embedding_generation`, `remove_index_item`, `rebuild_index`, and `artifact_cleanup`.
- Interactive search, query embedding, rerank, provider probes, ordinary manuscript saves,
  brief/outline mutations, Agent turns, and transient Notebook turns use request-scoped cancellation
  and concurrency limits, not `jobs` leases or restart recovery.
- MinerU signed/download URLs are ephemeral request memory only. The project persists `remote_task_id` and recovery metadata, never URL or encrypted URL capabilities.
- Agent Harness Protocol v6 uses bounded snapshot read/inspection tools, Review Issue and Writing Task fixture tools, typed manuscript submit tools, one typed `submit_writing_rules_change` proposal tool, and one bounded `generate_image` effect/proposal tool. ADRs 024 and 025 add no special Agent session/run, hidden model request, generic network/file/SQL authority, scheduler, or direct manuscript write.
- Agent Harness Protocol v10 adds one bounded `ask_user` clarification tool under ADR 061. Main
  may keep the original active Pi tool call waiting without a deadline, expose only its exact
  project/session/run/tool capability through live activity and answer IPC, and resume that same
  run after a validated answer. Clarification is not approval or permission, and restart retains
  interrupted-run recovery rather than reconstructing a live waiter.
- Agent Harness Protocol v11 adds hash-bound paged table inspection and typed rectangular table
  insert/edit proposals under ADR 066. Zero-based occupancy coordinates never outlive the complete
  table-block hash; Main alone normalizes cells, creates IDs, simulates changes, and commits the
  accepted proposal through the existing single section-revision authority. Existing spans are
  preserved, covered cells and span geometry changes fail closed, and no cell identifier exists.
- Agent Harness Protocol v12 keeps writing and Notebook as outer authority profiles, starts writing
  runs with nine core tools, and lets the model explicitly activate bounded run-local review,
  task, proposal, or image groups. Worker advertises only the active set, Main rejects inactive
  calls, and exact active schemas drive initial, continuation, compaction, and overflow budgets.
  Shared behavior lives once in application policy; short tool descriptions and object-root JSON
  schemas remain provider-neutral under ADR 067. Root object unions project their complete field
  vocabulary and common required fields at the root while retaining exact branches under `allOf`.
- Agent Harness Protocol v13 keeps those outer profiles and adds a writing-only `ask`, `plan`, or
  `write` interaction-mode ceiling. New and migrated writing conversations default to Write; each
  run snapshots its mode. One application policy derives the exact Worker-visible and Main-enforced
  tool set from profile, mode, and active groups. Ask is manuscript-aware read-only, Plan may also
  mutate Writing Task collaboration metadata, and only Write can activate proposal groups. See ADR
  068.
- Core Agent persistence remains `agent_sessions`, `agent_runs`, `agent_events`, `mutation_proposals`, and `model_requests`. ADR 024 adds project-local `review_issues` and `review_issue_events`; ADR 025 adds one `agent_writing_tasks` current-state table plus exact task/step correlation on runs and proposals. These are user-visible collaboration fixtures, not Agent-run recovery jobs or a second mutation authority.
- The three worker roles are `agent-worker`, `background-worker`, and `index-worker`; provider-specific and short-lived per-request worker roles are not added without evidence. The one recorded exception is the disposable, request-scoped, timeout-killed LaTeX/BibTeX parsing child added by ADR 033/034, which reuses the `background-worker` entrypoint and adds no long-lived role, database, or filesystem authority.
- `chokidar` is not part of the fixed stack until external editing/import synchronization is an explicit product requirement.
- The 8D vector run is a correctness smoke only. Performance claims require a real-dimension 10k/50k/100k benchmark.
- BlockNote autosave must canonicalize and hash before revision creation, use a 1–2 second idle debounce, and prune outside the body revision transaction.
- Critical file publication uses one tested shared atomic writer; create-only staging files and verified database backup publication remain separate protocols.
- Section deletion uses an internal tombstone: active outline reads exclude `sections.deleted_at`, while the section row, revision chain, and Agent proposal/model lineage remain durable. Tombstones are not restorable through the initial product UI and section IDs are never reused.

## 2026-07-31 Security Boundary Amendment

Checkpoint 26.8S is a blocking security-remediation gate before hosted release promotion. ADR 011
defines four enforcement boundaries:

- Main constructs one canonical, project-scoped `ProjectFilesystem` capability. Project services
  use it for managed reads, publication, deletion, extraction, and authoritative database paths;
  lexical containment alone is not sufficient. Existing ancestors, files, and directories must
  reject symbolic links and junctions before an operation can reach the filesystem.
- Existing `project.sqlite` files are identity-checked through a safe read-only preflight before
  backup, migration, application-ID assignment, pragma mutation, or any other write.
- Stored credentials are bound to the provider configuration security identity that is allowed to
  receive them. A changed or unbound identity is unauthenticated and must never be decrypted for a
  request.
- MinerU-provided upload and download capabilities are untrusted public-HTTPS destinations.
  Private/non-global DNS results and unsafe redirect hops are rejected before each request.
- Main-to-Renderer projections are independently byte-bounded. Large normalized knowledge
  artifacts use streaming verification plus paginated blocks and lazy bounded Markdown; Agent
  event pages enforce both row and serialized-byte budgets.

These controls preserve the Renderer sandbox, three fixed worker roles, forward-only migrations,
request-scoped provider work, and project portability. The filesystem threat model covers
malicious projects containing pre-existing links; protecting against a same-user process replacing
paths concurrently would require a future native handle/dirfd design.

## Product Scope And Invariants

WriteLLM v2 is a local-first desktop AI writing application with three product domains:

1. A block-based manuscript editor built on BlockNote.
2. A project knowledge base populated from local documents and MinerU parsing.
3. A Pi-based writing agent that reads project context, retrieves evidence, and proposes structured manuscript changes.

The project shell additionally exposes a transient Notebook workspace over the Knowledge domain.
It selects existing indexed sources and performs read-only, cited question answering; it is not a
fourth persistence domain and does not duplicate Knowledge management or indexing.

ADR 062 classifies that workspace as a transient read-only Agent. It reuses the Pi session runtime,
model capability mapping, and Thinking controls while exposing only selected-source Knowledge search
and citation expansion. It has no manuscript, fixture, proposal, image, clarification, or mutation
authority and creates no durable Agent session/run/event history.

The initial product has these fixed invariants:

- The application has zero or one active project at a time.
- Production uses Electron's single-instance lock. A second launch focuses the first process and exits; any future command-line open request must be routed through that first process. The project lock remains a defense-in-depth boundary for stale processes and non-standard launchers.
- A project is a portable folder named `<project-name>.writellm`, created under a user-selected parent directory.
- The initial product supports one primary manuscript per project. Internal identifiers should not prevent a later multi-manuscript extension, but no multi-manuscript UI or workflow is implemented now.
- All project business data lives under the project root.
- Application-global settings, encrypted provider credentials, recent-project pointers, diagnostic logs, and Chromium cache are not project business data and remain under Electron-managed application directories.
- Opening another project means closing the current project completely before opening the next one.
- A project must not be writable from two WriteLLM instances at the same time.
- The renderer never receives raw database, filesystem, credential, or generic IPC access.
- Markdown is an interchange and export format, not the lossless manuscript source of truth.
- Manuscript, outline, Brief, and trusted Writing Rule writes remain typed, revision-checked mutation proposals. Bounded Review Issue status updates are collaboration metadata and cannot mutate manuscript authority. The agent never receives arbitrary filesystem, SQL, shell, or unrestricted network tools. Accepted ADR 013 adds application-global, Main-installed, read-only writing guidance beneath the global policy without exposing installed files to the model.

The architecture continues to favor embedded components and explicit boundaries over local services:

- No Redis-backed queue.
- No standalone vector database in the initial implementation.
- No local HTTP backend between Electron processes.
- No renderer access to Node.js, files, SQLite, or credentials.
- No cross-project scheduler or global product database.

## Application-Global Versus Project-Local State

### Application-global state

Application-global state is stored under Electron `userData`, `logs`, and `sessionData` locations:

```text
Electron userData/
  app.sqlite

Electron logs/
  rotated NDJSON logs

Electron sessionData/
  Chromium cache and storage
```

`app.sqlite` contains only application-level state such as:

- application schema/version metadata;
- recent project paths and last-open timestamps;
- UI preferences;
- provider configuration metadata;
- `safeStorage` ciphertext and credential records;
- optional non-sensitive feature flags.

It must not contain manuscript content, knowledge items, project jobs, project agent history, project embeddings, or project file records.

### Project-local state

Each project folder contains all project business data:

```text
<project-name>.writellm/
  writellm.project.json

  manuscript/
    sections/
      <section-id>.blocknote.json
    assets/
      <asset-id>/...
    exports/

  knowledge/
    originals/
      sha256/<prefix>/<full-hash>/<original-name>
    parsed/
      <knowledge-item-id>/<parse-revision-id>/
        manifest.json
        document.md
        blocks.jsonl
        images/
        raw/

  .writellm/
    .gitignore
    project.sqlite
    index.sqlite
    history.git/
    temp/
    backups/
    recovery/
```

The exact names may be adjusted before implementation, but the ownership rules are fixed:

- `writellm.project.json` identifies the folder as a WriteLLM project.
- `project.sqlite` is the authoritative structured project database.
- `index.sqlite` is derived and fully rebuildable.
- `history.git` is an application-managed bare repository for the single linear checkpoint
  history. It is never discovered from the project root and never imports or modifies an outer
  repository.
- BlockNote JSON files under `manuscript/sections/` are deterministic materializations of the current manuscript revisions.
- Content-addressed PNG/JPEG/WebP manuscript assets live under `manuscript/assets/`; SQLite owns
  their IDs, hashes, validated dimensions, deletion state, revision references, and generation
  lineage. The bounded asset workspace projects this authority with session-bound previews; it
  never scans the directory from Renderer or exposes project paths/raw bytes. Current revisions,
  retained historical revisions, and retained proposals protect deletion. See ADR 028.
- Original knowledge files and parsed MinerU artifacts remain in the project folder.
- Embeddings live in the project-local `index.sqlite`.
- Temporary files never become visible as complete artifacts before atomic publication.
- No project table stores an absolute path. Project records use normalized project-relative paths and stable IDs.

The application may move or rename a project folder. Project identity comes from the manifest's stable `projectId`, not from the absolute folder path.

## Project Manifest

The root manifest is small, versioned, non-secret, and atomically written:

```json
{
  "format": "writellm-project",
  "formatVersion": 1,
  "projectId": "uuid",
  "createdAt": "2026-07-14T00:00:00.000Z"
}
```

The manifest is an identity and compatibility marker, not a duplicate database. Its `formatVersion` is the project-container format version and evolves independently from `project.sqlite`'s `schema_manifest.schema_version`. Manuscript metadata, section state, provider choices, jobs, imports, and agent history remain in `project.sqlite`.

Opening a folder requires:

- a recognized manifest format;
- a supported format version or an explicit migration path;
- a project ID matching the singleton project row in `project.sqlite`;
- successful project lock acquisition;
- successful authoritative `project.sqlite` backup, migration, and integrity checks;
- containment validation for every referenced file record.

The rebuildable `index.sqlite` is not part of the authoritative open gate. Main may publish the
project session and manuscript workspace after the checks above, then initialize and validate the
Index worker in the background. Knowledge search remains explicitly `preparing` or `unavailable`
until that validation finishes; a missing, incompatible, or corrupt derived index is rebuilt
without closing the manuscript workspace. A clean Index-worker shutdown may take a fast reopen
path, while an unknown or unclean shutdown still requires the full derived-database check before
search becomes available.

## Fixed Technology Stack

| Area                    | Choice                                                                        |
| ----------------------- | ----------------------------------------------------------------------------- |
| Desktop runtime         | Electron 43; 43.4.1 maintenance baseline                                      |
| Build and development   | electron-vite 5                                                               |
| Packaging               | electron-builder                                                              |
| Renderer                | React 19, TypeScript, Tailwind CSS 4, shadcn/ui                               |
| PDF preview rendering   | `pdfjs-dist` 6.2.108 with a bundled Vite worker and Main-owned stream          |
| Block editor            | BlockNote React 0.54.0 with the shadcn-compatible UI integration               |
| Rich media rendering    | Native BlockNote image/inline Math plus application Mermaid and display Math  |
| Renderer server state   | TanStack Query                                                                |
| Local UI state          | React state first; Zustand only when justified                                |
| IPC                     | `contextBridge`, narrow business APIs, `ipcMain.handle`, Zod                  |
| Structured logging      | Pino                                                                          |
| Correlation context     | Pino child loggers and Node.js `AsyncLocalStorage`                            |
| Log rotation            | pino-roll with application retention cleanup                                  |
| Application database    | `app.sqlite`, better-sqlite3 with Kysely 0.28.17                              |
| Project database        | per-project `project.sqlite`, better-sqlite3 with Kysely 0.28.17              |
| Durable jobs            | project-local SQLite jobs table with p-queue runtime scheduling               |
| Full-text search        | project-local SQLite FTS5                                                     |
| Vector search           | project-local sqlite-vec behind a `VectorIndex` interface                     |
| Hybrid retrieval        | FTS5, sqlite-vec, RRF, optional API reranking                                 |
| Files                   | `node:fs/promises` plus one tested atomic-publication implementation            |
| Project version history | exact-pinned `isomorphic-git@1.41.8` behind a Main-only adapter                 |
| Agent runtime           | `@earendil-works/pi-agent-core`                                               |
| Agent model transport   | `@earendil-works/pi-ai`                                                       |
| Embedding and reranking | AI SDK Core behind separate `EmbeddingGateway` and `RerankGateway` interfaces |
| Image generation        | Fixed Gemini/OpenAI/xAI catalog in the background-worker                       |
| MinerU                  | independent HTTP adapter and one durable parse workflow; URLs stay ephemeral  |
| Secrets                 | Electron `safeStorage` with an application credential-store adapter           |
| Tests                   | Vitest and Playwright Electron E2E                                            |

Do not force interactive agent generation, embeddings, and reranking through one artificial model interface. They have different lifecycle and capability requirements:

```ts
export interface AgentModelRuntime {
  run(
    config: ProviderConfig,
    credential: string,
    input: AgentRunInput,
    signal: AbortSignal,
    onEvent: (event: AgentStreamEvent) => void,
    projectSessionId?: string
  ): Promise<AgentRunResult>
}

export interface AgentSessionRuntime {
  beginSessionRun(
    config: ProviderConfig,
    credential: string,
    input: AgentSessionRunInput,
    signal: AbortSignal,
    onEvent: (event: AgentRuntimeEvent) => void | Promise<void>,
    onToolRequest?: (
      request: AgentToolRequest,
      signal: AbortSignal
    ) => Promise<AgentToolResponse>
  ): AgentSessionRunHandle
}

export interface EmbeddingGateway {
  embedBatch(input: EmbeddingBatchInput): Promise<EmbeddingBatchResult>
}

export interface RerankGateway {
  rerank(input: RerankInput): Promise<RerankResult>
}
```

Pi owns the interactive agent loop and tool-call event model. AI SDK Core may implement embedding and reranking adapters. Provider configuration and trace metadata are normalized above both libraries.

The active interactive boundary is the sessionful `AgentSessionRuntime` hosted in the single
`agent-worker` process. Main owns durable session/run/event state, per-call `model_requests`,
version compatibility, and persist-before-publish ordering in `project.sqlite`; the worker owns
only request-scoped Pi loops. One project may have at most three Agent work reservations in
different conversations, while each conversation remains single-line. A reservation is a run or a
manual context compaction; automatic compaction reuses its run reservation. Slot reservation in
Main precedes asynchronous preparation and covers routing, compaction, model, and tool work. The
older single-shot `AgentModelRuntime` remains the request-scoped model boundary for bounded
conversation-title generation, rolling compaction, and ADR 058's read-only transient Notebook
answers; interactive tool-using Agent turns use `AgentSessionRuntime`. Notebook, Agent runs, and
manual Agent compaction share one project-level maximum of three active interactive model work
reservations. The low-level `Agent` class is used directly; the Pi harness's JSONL session storage
is an explicit non-choice because durable Agent history must live in the project database. See
ADRs 018, 019, and 058.

Pin the package manager in `package.json`. Pin exact Pi package versions and major versions for Electron, electron-vite, AI SDK, BlockNote, and native dependencies. Pi and BlockNote API changes must be reviewed rather than accepted through broad version ranges.

## Project Lifecycle

Main owns a single `ProjectManager` with an explicit state machine:

```text
closed
  -> creating
  -> opening
  -> open
  -> closing
  -> closed

opening/closing failures
  -> recovery-required
```

### Create project

Creating a project performs, in order:

1. The user enters a validated project name and selects a parent directory.
2. Main derives a new `<project-name>.writellm` child, validates that it does not exist, and verifies that it is not inside a forbidden application directory.
3. Main reserves the final child path with an exclusive directory create; an existing directory or symlink is never replaced.
4. Main creates the internal layout and acquires the project write lock while the container remains unpublished.
5. Main initializes `project.sqlite` and `index.sqlite`.
6. Main creates the singleton project and manuscript records plus the initial section.
7. Main atomically writes the project manifest as the final validity/commit marker. This is a manifest-last publication protocol, not an atomic rename of the entire directory; a directory without a valid manifest is incomplete and must never be opened as a project.
8. Main canonicalizes the published root and opens it as the active project using the already-held lock.

A failed create must leave either no project or a clearly marked recoverable staging directory, never a folder that appears valid but lacks required state.

### Open project

Opening performs:

1. Validate and realpath the selected root.
2. Read and validate `writellm.project.json`.
3. Acquire the write lock.
4. Open `project.sqlite` with required pragmas.
5. If the schema is behind the packaged migration set, create and verify an online pre-migration backup before any project-database write. Do not update `lastOpenedAt` or other project state before that backup completes.
6. Apply forward-only migrations.
7. Run `quick_check` and `foreign_key_check`.
8. Validate the manifest/database project ID pair.
9. Validate or rebuild BlockNote materializations.
10. Recover expired project jobs.
11. Publish a new opaque `projectSessionId` and the manuscript workspace to project-scoped
    renderer APIs.
12. Start the scheduler and initialize the project-bound Index worker in the background.
13. Keep Knowledge search in an explicit preparing state until the derived index passes its
    structural/logical checks; rebuild a missing, incompatible, or corrupt index without closing
    the manuscript workspace.

### Close project

Closing performs:

1. Reject new project mutations.
2. Enter an internal `closing-accepting-final-flush` phase. Only the already-authorized final editor flush may mutate, and it must carry the active `projectSessionId`, current revision, and a close-scoped token.
3. Resolve the final flush with a bounded timeout; a non-responsive renderer produces a recoverable close outcome rather than an infinite wait. Recheck the revision after flush completion.
4. Stop claiming new jobs.
5. Abort or park interactive agent runs and mark interrupted requests accurately.
6. Persist resumable external state such as MinerU `remote_task_id`.
7. Stop project-bound workers and index access.
8. Checkpoint/close project databases.
9. Release the project lock.
10. Revoke the `projectSessionId` and all project subscriptions.

Delayed IPC responses or worker messages carrying an old `projectSessionId` are rejected after close or project switch.

`recovery-required` is recoverable, not a dead-end state. Its allowed exits are explicit `retry-open`, `retry-close`, `restore-from-backup`, `discard-incomplete-create`, `locate-moved-project`, `export-diagnostics`, and `return-to-closed` operations. A failed migration or restore never silently replaces the authoritative database.

### Project locking

The initial product supports one writer and no read-only secondary open mode. The lock contains an owner token, process identity, host identity, acquisition time, and heartbeat. Stale-lock recovery must be explicit and logged. A user must not be able to bypass an active lock merely by deleting a visible file from the renderer.

## Process Model

```text
Renderer
   |
   | narrow typed IPC; opaque projectSessionId
   v
Preload / shared Zod contracts
   |
   v
Main process
   |-- application lifecycle and app.sqlite
   |-- ProjectManager and project lock
   |-- project.sqlite and migrations
   |-- manuscript and knowledge domain services
   |-- durable task scheduler
   |-- workspace authorization and atomic file publication
   |-- secret management
   |-- agent tool authorization and mutation application
   |-- centralized LogCollector
   |
   |-- agent-worker
   |     |-- pi-agent-core loop and event stream
   |     |-- pi-ai model calls
   |     `-- custom tool bridge only; no direct DB/filesystem APIs
   |
   |-- background-worker (formerly Import/API utility process)
   |     |-- MinerU submit/poll/download
   |     |-- normalization work
   |     |-- embedding and rerank API calls
   |     `-- no authoritative database ownership
   |
   `-- Index utility process
         |-- index.sqlite ownership
         |-- deterministic chunking
         |-- FTS5 and sqlite-vec
         `-- generation build, switch, and rebuild
```

Responsibilities are strict. The older names `Agent utility process`, `Import/API utility process`, and `Index utility process` remain in completed Phase verification only; the role names below are the current target:

- Renderer displays and edits application state. It never accesses privileged resources.
- Main owns the active project identity, authorization, authoritative project state, short transactions, mutation validation, scheduling, file publication, locks, and secrets.
- `agent-worker` owns Pi runtime state for an active run but cannot directly read or modify the project.
- `background-worker` owns external API calls and CPU-heavy normalization, embedding, and reranking, but authoritative stage transitions are committed by Main.
- `index-worker` owns all writes to `index.sqlite` and exposes a narrow search/index protocol.
- Only Main owns the file log sink.

Use Electron `utilityProcess` rather than introducing a local HTTP backend. An open project has at most one worker for each of the three roles; the ADR 033/034 disposable parsing child is a request-scoped exception, not a fourth long-lived role. Agent tools communicate with Main through a dedicated MessagePort protocol distinct from model streaming and logging traffic. A stale response is rejected and logged; a worker is terminated only for protocol or capability violations, not for one ordinary late response.

## Electron Security Invariants

Every BrowserWindow must use:

```ts
webPreferences: {
  preload: preloadPath,
  nodeIntegration: false,
  contextIsolation: true,
  sandbox: true,
}
```

Additionally:

- Restrict navigation and deny unapproved new windows.
- Open approved external URLs through a validated allowlist.
- Validate the sender for every privileged IPC request.
- Validate IPC inputs and outputs with schemas under `src/shared/contracts/`.
- Prefer a custom application protocol over production `file://` loading.
- PDF previews use a session-authorized opaque capability over the application
  protocol. Main revalidates the active project session, PDF signature, size,
  and single-range request before streaming the original from its content-
  addressed project storage. The renderer receives only the capability URL and
  bounded metadata; it never receives an absolute path, raw MinerU JSON, or a
  complete embedding vector. Preview capabilities are revoked on component
  cleanup, source deletion, and project close, and the packaged PDF.js worker
  is loaded from the application bundle rather than a CDN. The privileged
  application scheme enables CORS for development-renderer requests, while
  preview responses allow only the configured development renderer origin.
- Define a restrictive Content Security Policy.
- Do not expose fallback behavior for a non-isolated preload context.
- Never accept an arbitrary absolute project path from normal renderer feature APIs.
- The native folder picker returns control to Main; renderer receives project metadata and opaque IDs, not a reusable filesystem capability.
- Resolve and realpath all existing targets and verify containment under the active project root.
- Reject traversal, symlink escape, stale project sessions, unknown roots, and manifest/database ID mismatch.

The intended contract layout is:

```text
src/shared/contracts/
  app.ts
  projects.ts
  manuscript.ts
  knowledge.ts
  jobs.ts
  search.ts
  agent.ts
  providers.ts
  diagnostics.ts
  errors.ts
```

Do not introduce a broad RPC framework solely to reduce IPC boilerplate.

## Observability And Logging

The centralized Pino design remains. Add project and product-domain correlation fields:

```text
app, appVersion, sessionId, time
processRole, pid, subsystem, component, event
operationId, jobId, requestId, traceId
projectId, projectSessionId
manuscriptId, sectionId, sectionRevisionId, blockId
knowledgeItemId, parseRevisionId, chunkId, citationId
agentSessionId, agentRunId, toolCallId, proposalId
provider, model, durationMs, attempt
err
```

Fixed subsystem names are extended to:

```text
app, project, ipc, db, queue, storage, manuscript, knowledge,
import, index, search, agent, tool, llm, embedding, rerank,
mineru, worker, security
```

Project logs remain in the global Electron logs directory rather than inside the project. A project diagnostic export may filter by `projectId`, but rotatable logs are not project authority.

Never log:

- full manuscript blocks or article metadata bodies;
- full prompts, model responses, retrieved source text, or tool-result bodies;
- original or parsed document bodies;
- embedding vectors;
- credentials, signed URLs, or private absolute paths.

Persist Agent messages, tool calls, proposals, accepted mutations, job state, and model request
metadata in `project.sqlite`; do not attempt to reconstruct them from logs. Notebook questions,
answers, source-boundary state, and citation registries are project-session memory only and must
never enter SQLite or logs.

## Database Boundaries

Use three database roles:

```text
app.sqlite                  <ProjectRoot>/.writellm/project.sqlite
  app_settings                project_meta
  recent_projects             manuscripts
  provider_configs            manuscript_briefs
  encrypted_credentials       sections
  agent_model_catalogs        section_revisions
  agent_model_preferences     section_materializations
  agent_provider_preferences  manuscript_assets
  agent_skills                section_revision_assets
  publication_presets         manuscript_asset_variants
  project_templates           manuscript_annotations
  schema_manifest             knowledge_items
                              parse_revisions
                              parse_tasks
                              active_parse_revisions
                              normalization_runs
                              parse_task_events
                              file_records
                              imports
                              jobs
                              job_transitions
                              artifact_cleanup_requests
                              model_requests
                              agent_sessions
                              agent_runs
                              agent_events
                              agent_writing_tasks
                              agent_change_set_commands
                              mutation_proposals
                              review_issues
                              review_issue_events
                              schema_manifest

<ProjectRoot>/.writellm/index.sqlite
  chunks
  chunk_sources
  chunk_fts_unicode61
  chunk_fts_trigram
  chunk_vectors
  embedding_generations
  index_manifests
```

`app.sqlite` and `project.sqlite` are authoritative for their own domains. `index.sqlite` is derived.

Do not attempt cross-database transactions. Cross-boundary work uses explicit state machines, hashes, generation IDs, and idempotent durable jobs.

Required pragmas:

```sql
-- app.sqlite and project.sqlite
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;

-- index.sqlite
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

Main-process database work must be short. Do not wait for external APIs, process large block documents, generate embeddings, or build vector batches inside a transaction.

### Migration and backup

Application migrations run at app startup. Project migrations run during project open after lock acquisition and before workers or the renderer receive project access.

The fixed backup implementation is better-sqlite3's SQLite Online Backup API. `VACUUM INTO` is reserved for a future compact/export mode and is not used for migration backups or ordinary snapshots.

The project migration protocol is:

```text
acquire project lock
-> open project.sqlite
-> inspect manifest and schema versions
-> if migration is needed, block project writes and create an online backup to a partial file
-> open and verify the backup (projectId, schema manifest/checksum, quick_check, foreign_key_check, hash, size)
-> atomically publish the verified migration backup
-> apply forward-only migrations
-> PRAGMA quick_check
-> PRAGMA foreign_key_check
-> validate schema manifest/checksum and projectId
-> update schema manifest
-> continue project open
```

Never back up a live WAL database by copying only the main `.sqlite` file.
The backup source connection remains write-quiescent until backup completion. `quick_check` and `foreign_key_check` must inspect returned rows; a successful PRAGMA call alone is not a passing check. Explicit restore/import additionally runs `integrity_check`, validates the snapshot/file inventory, and rejects schema versions or checksums the current build cannot understand. Failed migrations retain a verified pre-migration backup and enter recovery-required.

## Manuscript Domain

### Manuscript brief

The project has one primary manuscript and a versioned writing brief. Initial structured fields include:

- title;
- one-sentence description or purpose;
- topic and intended coverage;
- target audience;
- language;
- writing style and tone;
- scope and exclusions;
- target length or section-level length guidance;
- citation/style requirements;
- additional user instructions.

Core fields should be queryable columns where useful. Extensible style and constraint data may use validated versioned JSON.

### Section structure

Sections form an ordered tree:

```text
sectionId
parentSectionId | null
position
level
title
objective | null
status: planned | drafting | completed
currentRevisionId
deletedAt | null (Main-internal tombstone; never returned as an active section)
createdAt
updatedAt
```

The section title and status live outside BlockNote content. A section's BlockNote document represents the section body. Whole-manuscript assembly renders section headings from the outline and then the section body, preventing duplicated or diverging title state.

### BlockNote source of truth

BlockNote's native block JSON is the lossless manuscript representation. Each block retains its stable BlockNote block ID.

Section content schema v3 admits native `image` blocks only with
`writellm-asset:<assetId>` references and adds application-owned `figureId` plus independent
`altText`, alongside source-backed `mermaid` and display-only `math` blocks. Schema v4 adds native
atomic inline formulas shaped exactly as `{ type: "math", content: string }`, bounded to one line,
8,192 characters, and 8 KiB UTF-8 with no styles, props, or NUL. Readers remain compatible with
v1-v3 revisions and deterministically supply legacy figure metadata in memory. Schema v5 replaces
the display-only block with native `mathBlock` and moves the application-owned Mermaid block to a
plain-content `diagram` with `engine`, `caption`, and `altText` props. Block Math is bounded to
32,000 characters and 32 KiB UTF-8; Diagram remains bounded to 64,000 characters and 64 KiB UTF-8.
Both reject NUL and canonicalize adjacent unstyled text. Forward migrations append a new current
revision rather than rewriting immutable historical JSON or hashes.

The mathematical model is deliberately two-layered and BlockNote-native: Inline Math handles
formulas inside prose and `mathBlock` handles display formulas as plain source content. Diagram
remains application-owned because its caption/alternative-text metadata, dynamic theme, serialized
Mermaid execution, strict configuration, sanitized SVG-as-image isolation, and last-valid-preview
recovery are durable product and security semantics. KaTeX trust stays disabled and publication
rendering bounds expansion and size. Syntax errors stay local to Math or Diagram and never prevent
persistence. See ADRs 027, 057, and 060.

The canonical current and historical section JSON lives in `section_revisions.content_json` in `project.sqlite` so revision changes, accepted agent lineage, and optimistic concurrency are transactional. After a revision commits, a durable materialization step atomically writes:

```text
manuscript/sections/<section-id>.blocknote.json
```

The materialized file contains the current native BlockNote JSON plus a small schema/revision envelope. It is portable and inspectable but is rebuildable from `project.sqlite`; it is not a second authority.

A missing or stale materialization does not invalidate the manuscript. Project open schedules or performs repair after verifying the canonical revision hash.

Markdown import/export is explicitly lossy. Diagram uses a `mermaid` fence, block Math uses
`$$...$$`, inline math uses `$...$`, and images use registered `../assets/<sha256>.<ext>` references. Import never fetches a
remote URL, opens an absolute path, or accepts a data URL. Exported Markdown is written under
`manuscript/exports/` and never silently replaces native BlockNote JSON. The completed Checkpoint
24 whole-manuscript packages reuse this conversion boundary and add verified asset portability,
deterministic manifests, explicit loss reporting, and atomic publication. Section and whole-
manuscript Markdown conversion are both Main/shared-owned and derive the same current manuscript
reference index. Canonical citations are emitted only as manuscript-wide `[n]` markers, without a
References appendix or reversible mapping; single-section exports retain global numbers and may
therefore contain gaps. Importing those markers does not recover citation identity.

Interactive manuscript import is Main-owned under ADR 032. Main captures one bounded selected
source into project-temporary storage, records its SHA-256, resolves only contained regular local
resources, and returns a typed project-session plan rather than paths or bytes. The 30-minute plan
is the preview/apply capability; restart, switch, cancellation, and completion revoke it and remove
staging. Immutable assets may be registered before approval, but no manuscript revision changes
until apply and multi-section creation is one short atomic transaction. Format adapters receive
bytes plus a constrained resolver and have no filesystem, network, process, model, or mutation
authority.

Single-file LaTeX import follows ADR 033. Main sends bounded UTF-8 source text and its hash to a
disposable utility process with a fixed timeout; that child receives no paths, project state,
credentials, network authority, or mutation authority. Exact-pinned unified-latex performs syntax
parsing without macro expansion, and only an application-owned bounded projection crosses back.
Unsupported constructs are serialized as visible inert source with exact findings. No TeX
compiler, bibliography executable, package hook, include resolver, shell escape, external
converter, or model runs during this core profile.

Full-profile LaTeX import follows ADR 034. Main captures only a bounded selected directory,
archive, or dependency closure rooted at a selected `.tex` entry, revalidates a deterministic
manifest at apply, and registers images through the ordinary immutable asset authority.
Normalized includes cannot escape staging and are depth/file/byte bounded. Exact-pinned
citation-js is bundled into the same disposable worker with structural no-network aliases; only
canonical readable bibliography fields and the application-owned neutral projection return.
There is no TeX execution, package loading, shell escape, path authority, or network bibliography
lookup.

Publication formats derive from one ephemeral, typed assembly over the exact captured manuscript,
reference index, stable figure metadata, and verified asset inventory. It is a format-neutral
projection, never a second manuscript authority. Preflight errors fail closed and all permitted
losses are recorded. DOCX conversion is isolated behind that contract and reuses the existing
Main-owned snapshot barrier, asset capture, create-only staging, hash inventory, validation, and
atomic publication. Binary variance from library-generated relationship/drawing identifiers,
metadata dates, and ZIP metadata is removed by a deterministic canonicalization post-pass before
the content hash is recorded.

Publication assembly schema v2 retains table header rows and columns, cell alignment, widths, and
spans. GFM Markdown records all non-portable table losses; semantic Chromium HTML provides paged
headers and normalized widths for PDF; inert LaTeX `longtable` repeats headers, retains colspan,
and records rowspan fallback. These are projections of native BlockNote section schema v5, never a
second table authority.

LaTeX publication uses the same assembly and export boundary with the single XeLaTeX/ctexart
profile fixed by ADR 030. The application owns the complete preamble and context-specific escaping;
manuscript content cannot supply templates, commands, file paths, or compiler options. Formula
source is emitted only after bounded validation. The product never discovers, invokes, downloads,
or bundles a TeX compiler, and it never fabricates bibliography fields that are absent from the
authoritative reference data.

PDF publication uses the same assembly through the Main-owned hidden Chromium boundary fixed by
ADR 031. Each export creates one sandboxed, context-isolated, JavaScript-disabled BrowserWindow
with a unique in-memory session; captured verified images are available only through an ephemeral
asset protocol, never paths or a local server. Tagged PDF, document outlines, CSS page geometry,
and footer page numbers come from `printToPDF`. TOC page numbers use at most three captures with
`pdfjs-dist` destination inspection. Cancellation destroys the browser and the existing export
barrier removes partial staging. Publication hashing remains Main-injected so shared IPC schemas
cannot pull Node authority into the sandboxed preload.

Reusable publication presets are non-sensitive application-global state in one bounded
`app.sqlite` catalog. Application-owned rows are immutable; user rows are capped; exactly one
default resolves before the shared CP38 assembly is built. Stored options are strictly versioned
and fail closed. Preset mutation never opens or changes a project database and therefore cannot
create manuscript revisions.

### Manual editing

Renderer editing uses:

- a BlockNote instance scoped to the active section;
- canonicalize the complete validated native document and calculate its content hash before creating a revision;
- 1–2 second idle-debounced saves carrying `sectionId`, `baseRevisionId`, and the canonical document;
- single-flight persistence where new input replaces an unsubmitted pending save;
- optimistic concurrency in Main;
- atomic revision commit followed by materialization;
- a visible save state: clean, saving, saved, conflict, failed;
- bounded local retry without swallowing errors.

An unchanged content hash is a no-op and must not create a new revision. Revision sources are `manual_autosave`, `manual_checkpoint`, `agent_accepted`, `import`, and `undo`. Retention keeps the latest 20 manual autosaves per section, hourly checkpoints for 24 hours, daily checkpoints for 30 days, the latest 5 `import`-class revision bodies per section (including the current revision), all `agent_accepted` revisions, each Agent edit's direct parent, and the direct parent body of every retained `manual_checkpoint` revision (so ADR 022's per-section Undo always retains its restore source). Cleanup is best-effort background maintenance after the body revision transaction, never part of that transaction.

Because only one project is active, collaboration infrastructure such as Yjs is deferred. Manual editor changes and agent mutation application are still serialized through revision checks to prevent stale overwrites.

Project-local annotations follow ADR 035. They live in one bounded `manuscript_annotations` table
outside BlockNote content, anchor only to exact stable section/block IDs, and derive explicit
current/orphaned state without fuzzy relocation. They are excluded from counts, search, citations,
exports, and default model context. A user may attach at most ten selected annotations to one
ordinary Agent prompt; this adds no separate conversation or model route.

Figure identity is stable metadata; figure numbering is not. Publishing derives manuscript-order
`Figure N` labels from current revisions and emits a shared figure node with exact
section/revision/block target, asset ID, caption, and alt text. Reordering changes only the derived
number. Missing caption or alt text is an additive deterministic `check_draft` finding and never a
persistence blocker or a reason to start a separate model flow.

Image iteration remains an ordinary `generate_image` Agent tool effect. Main resolves an exact
block-hash-guarded generated-image target, combines its retained prompt/specification with a
bounded Agent instruction and current section context, and uses the existing image model gateway.
The immutable parent/candidate relation is project-local and keeps exact generation proposal,
model request, Agent run, and tool-call provenance. Candidate generation and manuscript mutation
are separate approvals: generation produces a normal `section_patch`; rejecting it keeps the
current image, while replacement changes only the logical asset URL and therefore preserves figure
identity, caption, alt text, and undo history. See ADR 029.

Canonical readable citation labels (`[Source: exact title, p. N]` and
`【来源：准确标题，第 N 页】`, with the page omitted when unavailable) remain ordinary editable
manuscript text. Shared parsing uses one English/Chinese canonical rule; titles group by NFC plus
trim with case preserved, and page does not split a source. The current outline and body first-
occurrence order derives manuscript-wide numbers dynamically. The section editor may present the
labels in full, as `[n]`, or as a reference icon through ProseMirror decorations, but presentation
must not change BlockNote JSON, revision identity, autosave behavior, copied text, or Agent/LLM
input. Compact citations reveal their full editable text when the caret enters them.

The References rail is a derived, bounded view over current revisions. It keeps the editor mounted,
shows the manuscript-wide number, exact title, and occurrence count, and uses section/revision/block
occurrences only to invoke the existing provenance-gated resolver. The active section may overlay a
Renderer-local occurrence snapshot for unsaved edits; persisted revisions remain authoritative.

Section count algorithm v2 replaces valid canonical citations with boundary whitespace before the
fixed Unicode word and non-whitespace character rules run, so a citation contributes zero without
joining surrounding words. Every current and new revision must be v2. Retained historical bodies
are migrated and recalculated; a retention-pruned row keeps its original v1 counts and version
because its body cannot be reconstructed.

Interactive citation preview is provenance-gated. Main validates the active project session,
revision, and stable block ID, then walks the bounded revision lineage from newest to oldest and
considers only applied proposals that created, updated, or replaced that block. Candidate
`citationId` values come only from each proposal's persisted provenance and are expanded through
the active retrieval index before NFC-and-trim exact title and optional page matching. The
resolver never searches or guesses across the project by title. A copied or manually authored
label without qualifying block provenance remains highlighted but cannot open source content;
removed or rebuilt sources fail closed as unavailable.

### Block mutations

Agent and programmatic changes use domain operations rather than arbitrary JSON Patch:

```ts
type BlockMutationOperation =
  | {
      type: 'insertBlocks'
      anchorBlockId: string | null
      placement: 'before' | 'after' | 'start' | 'end'
      blocks: PartialBlock[]
    }
  | { type: 'updateBlock'; blockId: string; update: PartialBlock }
  | { type: 'removeBlocks'; blockIds: string[] }
  | { type: 'replaceBlocks'; blockIds: string[]; blocks: PartialBlock[] }
  | { type: 'moveBlocks'; blockIds: string[]; anchorBlockId: string; placement: 'before' | 'after' }
```

A mutation proposal includes the target section and `baseRevisionId`. Main validates:

- current revision matches the base revision;
- referenced block IDs exist and are unique;
- inserted IDs do not collide;
- block types, properties, inline content, nesting depth, and size limits match the approved BlockNote schema;
- the resulting document is valid;
- the proposal remains within operation and content-size limits.

Accepted operations create a new revision and retain provenance to the agent run, tool call, proposal, source revision, and cited knowledge blocks.

Existing-image cross-section relocation is the narrow exception to ordinary single-section block
resolution. `submit_section_change.insertExistingImage` names one exact current-run source-image
precondition; Main copies the authoritative active-asset-backed block into the target section as an
ordinary `insertBlocks` proposal with a new block ID and stable figure identity. Only an applied or
satisfied insertion permits a later exact-hash removal proposal against the source section. The
two proposals are not atomic: source conflict leaves the safe duplicate and is never refreshed
into deletion of newer content. Generic cross-section targets remain rejected. See ADR 048.

When a pending section proposal's base is no longer current, Main does not apply it. Main performs
operation-aware three-way checks against the retained base and current BlockNote documents. A
non-conflicting result creates a new pending replacement proposal based on the current revision;
the original proposal remains immutable and becomes superseded. The replacement requires a new
user approval and must still pass the exact revision check before application. Overlapping writes
become an explicit conflict, while field writes already present in the current document complete as
already satisfied without creating a revision. Brief and outline proposals continue to use strict
version-conflict behavior. See ADR 003.

## Knowledge Base Domain

### Source import

The initial supported set follows the configured MinerU provider capability. The first product slice should target PDF, DOCX, PPTX, and common image formats. Legacy binary DOC and PPT are not silently treated as DOCX/PPTX; they require an explicit converter or a clear unsupported-format response.

Batch import performs:

1. User selects or drops files.
2. Main validates type, size, count, and the active project session.
3. Main copies each source into project-local temporary storage.
4. Main computes SHA-256 while copying.
5. Main deduplicates by content hash according to product policy.
6. Main atomically publishes the original under `knowledge/originals/`.
7. Main creates `file_records`, `knowledge_items`, and import state.
8. Main enqueues the durable MinerU workflow.

Renderer paths are never trusted as long-lived source references.

### MinerU workflow

MinerU is the canonical initial parser for supported knowledge sources:

```text
source stored
-> submit
-> persist remote_task_id immediately
-> poll
-> download
-> validate archive and declared files
-> safely extract to temp
-> atomically publish raw result
-> normalize blocks and assets
-> publish parse revision
-> chunk
-> embed
-> build index generation
-> activate index generation
```

On restart or project reopen, resume the persisted remote task rather than submitting again.

The project never persists a MinerU signed or download URL, encrypted URL ciphertext, or recovery capability. `parse_tasks` stores only the remote task identity, provider state, timestamps, result fingerprint, download state, and retry metadata. A reopened or expired download always polls the persisted `remote_task_id` to obtain a fresh URL. The URL may exist only in background-worker request memory and is discarded after the request.

Safe extraction rejects traversal entries, absolute paths, symlinks where unsupported, excessive expanded size, excessive file count, and invalid MIME/extension combinations.

### Raw and normalized artifacts

Preserve the provider result rather than discarding it after Markdown conversion. Each parse revision records:

- source file hash;
- provider and API version/fingerprint;
- parsing mode and options;
- remote task ID;
- raw archive/result hash;
- normalization schema version;
- parse status and structured error;
- creation and activation timestamps.

Normalized `blocks.jsonl` uses stable local block IDs and retains source provenance:

```ts
interface NormalizedKnowledgeBlock {
  id: string
  ordinal: number
  type: 'heading' | 'paragraph' | 'list' | 'table' | 'formula' | 'image' | 'caption' | 'other'
  text?: string
  markdown?: string
  headingPath: string[]
  page?: number
  bbox?: [number, number, number, number]
  sourceProviderBlockId?: string
  assetRefs: string[]
  contentHash: string
}
```

The application stores MinerU Markdown and images for inspection, but chunking and citations are based on normalized blocks so provider output changes remain isolated behind the adapter.

Captions emitted from a provider image or table field remain independent
normalized blocks. They may retain the parent page, provider, and asset
association for reading order and chunking, but they do not inherit the
parent's `bbox`; Mapping only draws a caption overlay when the verified raw
artifact supplies caption-level geometry and otherwise labels the extracted
caption as unlocated.

Knowledge Mapping keeps each bbox in the coordinate space declared by the
verified MinerU artifact that supplied it. In particular, official v4 VLM
`content_list` bboxes use a top-left `1000 × 1000` page space and must not be
scaled against the PDF-point `page_size` from `layout.json`; pipeline geometry
continues to use its validated page dimensions. Provider-prefixed
`*_content_list.json` filenames are accepted, while `_content_list_v2.json`
remains a distinct unsupported normalization shape. Legacy Markdown-fallback
blocks may recover page/bbox provenance only from unique normalized-text or
content-addressed asset matches against the hash-verified raw revision;
ambiguous matches remain unlocated rather than being guessed.

## Indexing And Retrieval

### Deterministic chunks

Chunking starts from normalized MinerU blocks:

- preserve heading path and reading order;
- keep tables, formulas, captions, and image references coherent;
- merge adjacent short text blocks when appropriate;
- split overlong text blocks by a deterministic token policy;
- retain exact source block IDs and page/bounding-box provenance;
- derive `chunkId` from parse revision, source block range, chunker version, and content hash.

Deleting `index.sqlite` must not lose authoritative knowledge. Rebuild reads active parse revisions and normalized block artifacts.

Index generation activation is guarded by a final current-source check after
the generation build and before activation. If the active parse/normalization
fingerprint changed during the build, Main records the superseded generation,
does not activate it, and queues the current generation instead.

### Embedding generations

Every embedding generation records:

- provider;
- model and revision;
- dimension;
- distance metric;
- normalization strategy;
- chunker version;
- parse/content fingerprint;
- creation time and active state.

Never mix incompatible vectors in one generation. Query embeddings must use the active generation's model contract.

### Retrieval pipeline

The initial retrieval pipeline is:

```text
FTS5 candidates + sqlite-vec distance candidates
-> reciprocal rank fusion
-> bounded candidate set
-> optional API reranking
-> final results with source citations
```

The public project search API returns bounded, provenance-rich results:

```ts
interface KnowledgeSearchHit {
  citationId: string
  knowledgeItemId: string
  parseRevisionId: string
  chunkId: string
  title: string
  snippet: string
  score: number
  page?: number
  headingPath: string[]
  sourceBlockIds: string[]
  assetRefs: string[]
}
```

Agent tools receive the same citation IDs as the UI. A separate read tool may expand selected citations; the initial search tool must not dump whole documents into model context.

ADR 058's Notebook chat reuses this pipeline without copying source or index data. Each turn forms
one bounded retrieval query from the current question and at most two recent user questions after
the latest source boundary, restricts retrieval to at most 50 selected active sources, expands at
most 12 results, and admits at most 64 KiB of evidence. No expandable evidence means a deterministic
insufficient-evidence response and no answer-model call. Otherwise one single-shot provider request
receives bounded current-boundary history and explicitly untrusted evidence. Per-message citation
registries bind only that turn's `[[cite:n]]` markers to retrieved citation IDs.

For mixed Chinese and English corpora, evaluate `unicode61` and `trigram` FTS behavior with representative fixtures. Short-query fallback is mandatory.

### Citation coverage checks

Knowledge citation coverage is a Main-owned, read-only derivation over the current manuscript
revisions and the source set of the active current index generation. Text-index readiness defines
the denominator; vector-embedding readiness is not required. A stale active generation is never
used as a fallback denominator.

Canonical citation titles use the same NFC-plus-trim, case-sensitive grouping as the References
rail and ignore page for article identity. A unique match counts the indexed article once, repeated
occurrences remain an article-level count, duplicate indexed titles are ambiguous and do not enter
the numerator, and titles with no indexed source remain separate unmatched citations. An empty
denominator has no percentage.

The Renderer receives only bounded, paginated source identity, display metadata, status, counts,
and snapshot identity through project-session-scoped IPC. It receives no normalized artifact path,
source block or page location, manuscript text, or index database authority. Coverage is not
persisted and does not replace the Agent draft checker, citation provenance, or retrieval filters.

## Agent Architecture

### Runtime choice

Use `@earendil-works/pi-agent-core`, not the Pi coding-agent CLI. The runtime lives in the `agent-worker` utility process and uses `@earendil-works/pi-ai` for tool-capable language model streaming.

Pi is a harness, not an authorization boundary. WriteLLM supplies only application-specific tools and does not expose Pi's generic file, shell, process, or network capabilities.

### Agent persistence

Persist normalized project-local records for:

- agent session;
- agent run/turn;
- ordered Agent events (`user_message`, `assistant_message`, `tool_attempted`, `tool_preflight_failed`, `tool_call`, `tool_result`, `approval_decision`, `run_interrupted`, `run_completed`, `compaction_started`, `compaction_summary`, `compaction_failed`);
- model request metadata and usage;
- mutation proposals and decisions.

Pi runtime events stream to the renderer for responsive UI, but durable records are created before the corresponding external operation or mutation can become authoritative.

Core execution persistence is limited to `agent_sessions`, `agent_runs`, `agent_events`,
`mutation_proposals`, and `model_requests`. Bounded collaboration fixtures separately use
`review_issues`, `review_issue_events`, and the one-current-row-per-conversation
`agent_writing_tasks` table. `mutation_proposals` owns decision status, decision time, rejection
reason, kind-specific applied result (`applied_revision_id`, `applied_brief_version`, or
`applied_outline_version`), the optional section `undo_revision_id`, and immutable optional writing
task/step correlation. `agent_runs` snapshots the current task/step at run creation; presentation
derives ready, in-progress, review, stopped, failed, verified, report-only, and disagreement states
from run plus proposal truth rather than assistant narration. Do not add separate `mutation_applications`, `accepted_source_links`, a
compaction table, task event table, scheduler, or long-term-memory table before real usage proves
they are necessary. A task-wide change set is a derived read model over immutable task/step
proposal correlation. It may group persisted exact previews, current outcomes, and ADR 003
refresh chains, but it cannot own decision status or apply work; project reopen reconstructs it
from project SQLite without a change-set cache, proposal copy, report row, or model analysis.
Accepted ADR 026 permits only `agent_change_set_commands`: a bounded durable command receipt and
recovery cursor that sequences existing individual proposal decisions. Brief, outline, body, then
image order is deterministic; refresh, conflict, or failure stops with explicit partial results;
and authoritative proposal state reconciles the crash window without replaying committed effects.
It is not manuscript or proposal authority and cannot become a generic transaction coordinator.
Compaction
lifecycle records and rolling checkpoints are ordinary
`agent_events` rows; raw events and current project business rows remain authoritative.

Notebook calls still create the required `model_requests` row, but use metadata-only retention.
The row may retain an internal request ID, provider/model identity, state, timings, attempts, and
usage; its fingerprint derives only from that internal ID and external response IDs are discarded.
Questions, answers, evidence text, and content-derived fingerprints are forbidden. No Notebook
session, message, citation, scope, or recovery table is added.

### Context construction

Do not send the whole project on every turn. Main resolves the conversation model and Writing Skill,
builds the final system prompt and current request, then uses a pure `AgentContextPlanner` to account
for the exact model-visible tool schemas, reserved output, model input/context limits, and a
five-percent safety buffer clamped to 4,096–16,384 tokens. If fixed context plus the current request
cannot fit, fail as `current_turn_too_large`; never recursively truncate the current request.

A `ContextBuilder` constructs current authoritative context from:

- manuscript brief;
- outline, section objectives, statuses, and word counts;
- active section and selected blocks;
- neighboring section summaries where useful;
- explicit user attachments or selected knowledge citations;
- the latest successful rolling checkpoint plus a continuous recent tail;
- tool descriptions and safety policy.

Full manuscript and knowledge access is through tools with pagination and size limits.

Automatic compaction is triggered by the final conversation budget or before the 200-event/2-MiB
runtime envelope could omit uncheckpointed history. It advances only across continuous complete
run/turn boundaries and persists each successful step immediately. The post-compaction history
budget is the smaller of 32,000 tokens or half the conversation budget; at its maximum it reserves
12,000 tokens for a bounded writing handoff and 20,000 tokens for recent complete raw turns.
User and terminal assistant messages enter compaction verbatim, while tool data remains a safe
typed projection. Re-readable Knowledge, manuscript, Writing Skill, review, task, and proposal
tool bodies are never compaction memory: an exhaustive per-tool policy retains only deduplicated
identity, freshness, outcome, and safe error facts, while current authority is reread before use.
Intermediate tool-use narration and duplicate tool outcomes do not enter the summary request.
Automatic and manual work share this tail-preserving policy and remain limited
to four and eight steps respectively. Source selection scans safe projections in bounded pages to
the next complete run boundary, subject to the calculated provider input budget and a 2,000-event
absolute ceiling; it does not split checkpoint coverage merely because a run crosses a page
boundary. Final escaped prompt characters and system-plus-prompt tokens are checked before any
provider call. See ADR 064.

Payload-v3 handoffs are conversation memory rather than manuscript, evidence, proposal, approval,
or mutation authority. Application policy preserves their recorded user requirements and
unfinished work unless the current request supersedes them, while every authoritative project
fact and mutation precondition is freshly rebuilt or reread. Legacy checkpoints retain no such
continuation semantics. A compaction failure may continue only without omitting an uncheckpointed
user turn; otherwise it fails before provider activity. Provider overflow is retried once only
before assistant, tool, proposal, or other external activity and is never replayed afterward. See
ADRs 019 and 049.

Within an active Pi request, provider-context transforms preserve the current user message and each
assistant tool-call message with all of its consecutive tool results as one atomic batch. The newest
batch that fits remains complete; only older completed read batches may become typed,
non-authoritative historical projections, and mutation/effect results are never projected. If the
newest read batch alone is too large, the ordinary Pi loop receives one typed request for a smaller,
sequential read. A second oversized batch terminates as `tool_batch_context_exhausted` before
another provider call, without replaying any mutation or side effect. The full runtime transcript
and durable events remain unchanged; successful recovery is structured-log-only. See ADR 046.

A writing run that reaches 180 durable events at a tool-continuation boundary receives one final
tool-free model call. The Worker must consume every Main-authorized continuation before successful
settlement and may resume once from the final tool result when Pi settles early. See ADR 063.

Retrieved knowledge is untrusted content. It is clearly delimited and never allowed to redefine tool policy, authorization, or system instructions.

### Agent composer interaction

The default idle composer uses progressive disclosure: Add, approval policy, combined model plus
Thinking effort, and Send are its four top-level action groups. Context scope is available through
the shared Add/leading-slash command catalog. Writing Skills are not composer or session state and
have no persistent selector, chip, badge, or attachment. At the start of a new-run message, `$`
may autocomplete up to four canonical Skill names into ordinary editable prompt text. Main reparses
that text; the Agent still discovers and loads guidance only through visible tool calls. Active-run
Steer and Follow-up input does not reopen Skill preparation. See ADR 055.
The collapsed model trigger uses the recognizable model display name
plus the exact lower-case provider-neutral Thinking token and omits redundant provider branding.
Provider identity remains visible inside model browsing and diagnostics where duplicate names need
disambiguation.

When the latest valid assistant context usage belongs to a run matching the conversation's current
model selection, a neutral read-only circular indicator appears immediately before the model trigger.
It uses that same run's immutable context window, exposes used/left percentages and compact token
counts on hover or keyboard focus, and stays hidden for unknown or mismatched usage rather than
claiming zero. The indicator has no click action and remains inside the elastic model/Thinking group,
so the four top-level composer actions and narrow-panel truncation rules do not change. Agent Details
uses the same matched snapshot. See ADR 050.

Approval uses the compact `Manual`, `Section`, and `YOLO` labels without a status icon; its menu
describes the existing WriteLLM proposal policy and must never imply generic computer, shell,
filesystem, or unrestricted network access. Add and approval stay compact, Send stays visible,
and the elastic model/effort trigger truncates before controls can overlap. Idle Send is the
icon-only circular primary action with an upward arrow and an explicit accessible name; Queue,
Steer, retry, and Stop retain their distinct running-state forms. The interaction layer cannot
broaden Main-owned automatic-application eligibility, mandatory-review rules, model capability
clamping, immutable run snapshots, or the registered Agent tool set. See ADRs 038–040.

### Agent prompt architecture

Application-owned Agent prompts live under `src/main/agent/prompts/` and are split by responsibility:
base policy, system-prompt composition, Writing Skill companion guidance, bounded task templates,
and dynamic-block encoding. Business services select a template and supply typed data; they do not
own inline prompt prose.

Prompt precedence is fixed: application safety and tool authority; application collaboration,
academic-writing, review, and citation policy; the application Writing Skill companion; installed
Skill entrypoints and selected references; trusted writing requirements; trusted active project
Writing Rules; untrusted manuscript data;
durable conversation history; and the current user request. Later content cannot redefine an
earlier authority layer. Prompt text remains provider-neutral; a provider- or model-specific fork
requires a separate decision with behavioral evidence, fallback behavior, and parity tests.

Every application-wrapped dynamic payload uses a named block, declares whether it has instruction
semantics, and escapes block-significant characters before composition. This includes project
context, installed Skill entrypoints and optional references, title and compaction inputs, and
Main-authored review continuations. Full prompts, Skill bodies, manuscript content, and
conversation content are never logged. Tests freeze layer order, escape behavior, task-template
invariants, and the 65,536-byte system-prompt budget. See ADR 017.

Notebook prompt composition follows the same application-owned block encoding. Its system policy is
provider-neutral, permits answers only from the supplied evidence, treats every source block as
untrusted data that cannot redefine instructions, and requires registered `[[cite:n]]` markers.

### Agent Harness Protocol v6 tools

```text
# Snapshot read and inspection
get_writing_context
read_outline
read_section
search_manuscript
search_knowledge
read_citations
inspect_change
check_draft
read_writing_skill

# Bounded project fixture mutation
list_review_issues
record_review_issues
update_review_issues
get_writing_task
create_writing_task
update_writing_task

# Typed proposal and effect
submit_brief_change
submit_writing_rules_change
submit_outline_change
submit_section_change
generate_image
```

`get_writing_context` is a lightweight snapshot manifest and never returns active section text.
`read_outline`, `read_section`, and `search_manuscript` are bound to the source
`modelRequestId` snapshot. `read_section` supports paginated block summaries with canonical hashes,
a complete canonical block view, and bounded canonical JSON fragments. `inspect_change` reads only
proposals from the current Agent session. `check_draft` performs bounded deterministic checks from
one immutable run snapshot and reports P0-P3 findings plus explicit passed, failed, skipped, and
unavailable outcomes; it never persists issues or modifies the draft.
The UI injects selection capture time and revision; stale block selections are not combined with a
newer body.

`read_writing_skill` reads only a virtual `writellm://skills/...` capability authorized for the
active run. In Auto mode, one Skill-only response may add one previously unselected top-level
`SKILL.md`; a run may compose at most four ordered top-level Skills plus a deduplicated closure of
at most eight dependencies. Every top-level and dependency manifest contributes exact reference
capabilities. A run may retain at most twelve complete reference files and 32 KiB of reference
content, keyed by Skill ID, commit, and relative path. Skill guidance is delimited below global
policy and is never treated as manuscript data. Durable events store only IDs, pins, relative
paths, hashes, and byte counts, never Skill bodies or private paths. See ADR 053.

Writing Skill reads form a preparation barrier for downstream work. Already injected explicit
entrypoints are not reread; Auto adds at most one new top-level entrypoint in an otherwise
Skill-only assistant response. The model may then issue independent authorized reference reads
together within the remaining count and byte budgets, but it waits for every selected result
before issuing manuscript, knowledge, citation, generation, checking, or submission tools in a
later assistant response.

Read-only tools may execute in parallel when their results are independent.

`list_review_issues`, `record_review_issues`, and `update_review_issues` can read or mutate only
bounded project-local Review Issue metadata. They receive no manuscript, filesystem, SQL, network,
credential, or generic task authority. Exact optimistic versions guard refresh, assignment, and
status transitions. They are sequential fixture operations, not proposal/effect tools.

`get_writing_task`, `create_writing_task`, and `update_writing_task` read or mutate only the current
conversation's bounded durable plan. Main allocates task and step UUIDs, requires an exact monotonic
plan version, enforces the step state machine and one-active-step invariant, and snapshots the
current task/step correlation when a run or proposal is created. Idle user revisions use the same
optimistic service, while Resume sends one Main-authored prompt through the same ordinary Agent
conversation and first rereads the current task. The tools do not schedule work, start a
model request, apply manuscript changes, or infer success from assistant prose. See ADR 025.

### Submit tools

```text
submit_brief_change
submit_writing_rules_change
submit_outline_change
submit_section_change
```

Model arguments do not contain schema, manuscript, version, revision, or generated domain IDs.
Main binds those values from the source snapshot. Outline operations use `SectionRef`, `clientRef`,
and first/last/before/after placement. Section operations use the block-hash DSL; plain text
replacement cannot erase links, marks, tables, or child structures, and canonical replacement
requires a matching canonical read in the current run. `submit_brief_change` cannot change the
reserved `writingRulesV1` namespace. `submit_writing_rules_change` supports only bounded add,
update, activate/deactivate, and remove operations, binds the source Brief version in Main, and
uses the ordinary proposal timeline and approval continuation.

Outline deletion tombstones a leaf section rather than physically deleting its revision graph.
The tombstone is absent from active writing context, assembly, editor, and Agent tools, but its
revision and proposal lineage remains authoritative. Outline-delete undo and section restoration
remain deferred.

`generate_image` accepts one bounded prompt, output specification, and section placement. Main binds
the active image provider, source revision, block ID, and asset ID; the background worker performs
one typed request through the fixed catalog in ADRs 051 and 052. Google Gemini retains exact-pinned
`@google/genai@2.18.0`; Google Vertex AI uses that SDK's fixed `global` Vertex client with local
Application Default Credentials and the three fixed Nano Banana model IDs; OpenAI
`gpt-image-2` and xAI `grok-imagine-image-2.0` use exact-pinned `openai@7.5.0`, with xAI's client
fixed to `https://api.x.ai/v1`. SDKs and provider transports are confined to that worker
gateway and are not exposed through Main, preload, renderer, or Agent tool code. The tool produces
one project asset and one typed insertion proposal, never a reusable network or filesystem
capability. No image source accepts a configurable endpoint, SDK retries are disabled, and xAI
must return base64 rather than a temporary URL. The worker accepts bounded PNG/JPEG output and
reports its actual MIME; only Main validates image magic, dimensions, hash, and bytes and atomically
publishes the project asset before a `writellm-asset:<assetId>` block reference can be committed.
The three encrypted API-key credentials may coexist with Vertex's ambient ADC configuration, but
zero or one source is explicitly active;
removal clears an active selection and never triggers fallback. OpenAI `aspectRatio = auto` may
return a nullable effective size intent while project asset lineage still records the requested
size and Main-validated actual dimensions.

Asset deletion is a Main-owned two-phase operation. Protection is rechecked in the same immediate
transaction that changes an unprotected row from `active` to `deleting`; new revision/proposal
references accept only active rows. File and row cleanup follows outside the transaction, and a
failed deletion is retried through the existing artifact-cleanup lifecycle and project-open
reconciliation. Missing or changed bytes remain visible as integrity failures and are never
silently replaced. Legacy nullable dimensions are backfilled only after the immutable bytes pass
size, hash, MIME, and dimension validation. See ADR 028.

The Agent surface does not include generic file/SQL/JSON Patch/shell/process/network tools, custom
tool creation, executable plugins, multiple agents, long-term memory, provider configuration
mutation, or restore/snapshot triggers. Accepted ADR 013 is the narrow exception to the former
skill-registry freeze: Main may install bounded `.md`/`.txt` writing guidance into application-
global, hash-verified storage and compose it beneath the global policy. Skills cannot add tools,
execute code, discover files, read projects, fetch arbitrary URLs, or write manuscripts directly.

### Application-global Writing Skills

Writing Skill authority lives in `app.sqlite` plus `userData/agent-skills`, never in a project.
Renderer receives bounded metadata only; Main owns GitHub inspection, download, git-blob and local
SHA-256 verification, startup integrity checks, and atomic publication. Curated entries update only
to a reviewed pin and file allowlist shipped in a later application catalog. Custom entries use a
user-confirmed immutable GitHub commit under TOFU semantics. Only UTF-8 `.md` and `.txt` files are
accepted, and no skill content is executable.

Writing Skills are dynamic per-run Agent actions, never session or composer state. Every new run
receives a bounded automatic metadata catalog. A leading `$skill-name` prompt prefix may additionally
identify ordered, Main-resolved requested entrypoints, including explicit-only Skills; the text is
not a Renderer authorization object. Ordinary-language requests and Agent-initiated choices remain
valid. Every path resolves through `read_writing_skill`, and Skill content cannot enter the run
before that visible tool call succeeds. Versioned run snapshots persist immutable requested pins,
user-versus-Agent actual-load provenance, dependencies, resources, routing status, and safe errors,
but never Skill bodies. Retry reauthorizes exact recorded versions and reproduces their loading as
visible tool activity. Historical session selection fields, single-primary snapshots, and
`skill_route` model requests remain readable compatibility data but do not control new runs. See
ADRs 054 and 055.
`listRuns` projects only their bounded token/cost/retry usage, not an additional provider or
credential surface, so historical conversation totals remain complete.

Pi `loadSourcedSkills` runs over a read-only, manifest-backed virtual `ExecutionEnv`; WriteLLM's
stricter metadata, path, UTF-8, size, symlink, and hash rules remain authoritative, and any Pi or
WriteLLM diagnostic makes the Skill unavailable. Auto prompt composition uses
`formatSkillsForSystemPrompt` for a stable name/ID-sorted catalog of at most 32 complete entries and
16 KiB; truncation is logged as `skill_catalog_truncated`. A successful tool read places that exact
immutable entrypoint or reference below global policy in one escaped application-owned semantic
block for later turns in the same run. Top-level precedence follows successful load order;
dependencies remain below every top-level Skill. Prompt order remains global policy,
companion/catalog and loaded guidance, trusted requirements, then manuscript data.
Model-visible locations use `writellm://skills/...`, never private filesystem paths.

Custom-skill update availability is an ephemeral result of the user's explicit GitHub check. Main
persists only the confirmed immutable commit pin; it does not persist or automatically trust a
mutable default-branch head across Settings lifecycles.

Submit tools are sequential and create `mutation_proposals`; they do not directly commit project state.

Main uses Pi's tool preflight hook plus its own effect policy. Pure reads may run in parallel; a
mixed read/write batch executes reads and blocks the mutation, and one assistant message may contain
at most one mutation. A manual proposal returns `pause_for_review` immediately and terminates the
run; there is no approval waiter. The renderer offers approval alone or approval followed by a new
immutable run whose prompt includes Main's authoritative application result. Brief changes and
complex canonical section replacements always require review. Automatic thresholds are calculated
from canonical operations, never a Worker declaration. See ADR 005.

### Agent tool bridge

Agent utility sends a validated envelope to Main:

```ts
interface AgentToolRequest {
  requestId: string
  projectSessionId: string
  agentSessionId: string
  agentRunId: string
  toolCallId: string
  modelRequestId: string
  toolName: string
  args: unknown
}
```

The bridge uses one dedicated transferable `MessagePort` per active run. Up to three ports and Pi
loops may coexist in the one worker process, and every controller, queue command, authorization,
and tool capability remains indexed by its exact run. Its request and response envelopes repeat
the run, tool-call, and source-model capabilities; model-facing arguments contain none of those
capabilities.

Main:

1. validates the envelope and active project session;
2. validates tool arguments against the registered contract;
3. authorizes read/write policy;
4. executes the domain service or creates a proposal;
5. persists tool lifecycle state;
6. returns a bounded structured result;
7. logs metadata without logging content.

Tool errors are thrown and preserved as structured errors. They are not returned as successful text content.

Under ADRs 042 and 067, model-visible tool schemas are compact Pi preflight shapes rather than replicas of
every Main domain invariant. Every standard call accepted by Main must pass preflight; Main remains
authoritative and may reject a broader preflight-valid call with a self-contained safe error and
one bounded recovery. Shared sequencing and recovery stay in application policy and structured
results; tool descriptions contain only local purpose and unique boundaries. Writing begins with a
20 KiB nine-tool core envelope and explicitly accumulates run-local capability groups, while the
complete 22-tool envelope remains limited to 48 KiB with no tool over 8 KiB. Every parameter root
is an object; root unions remain under `allOf`. Contract v12 and event schema v3 preserve historical
replay because persisted arguments and results are opaque records, not reparsed through current
per-tool schemas.

The tool bridge carries tool requests and results only. Provider-call authorization remains on the capability-bound Agent run protocol: initial, steering, and follow-up calls use pre-authorized `model_requests` IDs, while a post-tool continuation must request a new ID from Main and wait until Main has durably created the linked row. The worker never invents a model-request ID and never starts an unrecorded provider call.

Accepted ADR 041 keeps pending Follow-up content request-scoped and Main-authoritative. Main creates
its model-request record before queue delivery, while the worker mirrors the ordered queue and
places only its head in Pi. An awaited consumption barrier appends the durable `user_message`
before the corresponding provider call may start. Per-item delete and Steer promotion are
correlated to the exact active run and pending-message ID; unconsumed items are aborted rather than
projected into Agent history. The queue is cleared with its run and adds no durable queue table or
job.

## Durable Job Model

Jobs are project-local. `app.sqlite` does not schedule project work.

Required state machine:

```text
queued -> running -> succeeded
                  -> failed
                  -> queued      retry
                  -> cancelled
```

`paused` is not a current state because there is no handler or recovery contract for it.

A project close must stop new claims. Running handlers must either:

- finish within the bounded close window and commit;
- abort at a safe point and requeue;
- retain a renewable lease until the worker exits, then recover by expiry;
- persist external continuation state, such as a MinerU remote task, before stopping.

Handlers are idempotent and deduplicated by stable content/operation keys. Job payloads contain IDs, relative references, hashes, and small options—not document bodies, BlockNote JSON, embeddings, absolute paths, or credentials.

`jobs` is the sole current-state and recovery authority. `job_transitions` durably audits material state transitions and control events in the same transaction as each mutation; it does not participate in scheduling or recovery. Audit history intentionally excludes high-frequency heartbeat and progress updates.

The only durable job types are `mineru_parse`, `normalize_parse_revision`, `build_index_generation`, `build_embedding_generation`, `remove_index_item`, `rebuild_index`, and `artifact_cleanup`. MinerU submit, poll, download, and publish are stages of the one `mineru_parse` job. Search, query embedding, rerank, provider probes, ordinary manuscript saves, brief/outline mutations, Agent turns, and transient Notebook turns are request-scoped work; they use `AbortController`, ordinary concurrency limits, `projectSessionId`, and `model_requests` where needed, but never lease or heartbeat rows.

Agent provider generation has no WriteLLM wall-clock deadline. Each authorized model request may
make at most five logical attempts for transient failures before any assistant content is
published. Permanent failures, cancellation, and failures after streamed text, thinking, or tool
call content are not automatically retried. User stop and project close remain authoritative
request-scoped cancellation boundaries. Tool deadlines remain independent internal tool-contract
safeguards. See ADR 012.

Current resource queues (rerank is request-scoped and has no durable queue; the set remains subject to provider limits and benchmarks):

```text
mineru: 1
embedding: 3
index: 1
local-io: 2
```

Write-type agent tools remain sequential even when Pi permits parallel tool execution globally.

## Secrets And Provider Configuration

Provider configuration is application-global because credentials are device/user concerns, not portable project content.

- The application-global image role uses the fixed four-source catalog in ADRs 051 and 052. Gemini,
  Vertex AI, OpenAI, and xAI configurations are independently bound and may coexist; Gemini,
  OpenAI, and xAI credentials use safeStorage while Vertex uses local ADC without persisting a
  credential. One explicit app setting selects zero or one active source. Saving the first usable
  source may initialize that selection; removing the active source clears it. Generation never
  falls back, rotates, retries through another source, or accepts an arbitrary endpoint.

- Agent configuration is an application-global Pi provider catalog rather than one singleton
  endpoint. The pinned Pi built-in providers define their static model metadata, wire protocol,
  ambient/API-key/OAuth authentication, and request auth resolution. User-defined endpoint presets
  are limited to the approved endpoint-addressable Pi transports in ADR 008.
- Dynamic model discovery is explicit. Main stores one bounded last-successful catalog per preset
  in `app.sqlite`; a failed refresh records a safe status and retains the prior catalog. Renderer
  receives only bounded model/status metadata.
- Application-global provider/model availability and bounded manual Agent model metadata remain
  separate from Pi's packaged and last-successful discovered catalogs. Manual models may overlay
  one provider/model ID, but never carry credentials or mutate immutable run history. Built-in Pi
  endpoints remain fixed; custom preset endpoints are editable without changing their transport.
- Each project-local Agent conversation stores a preset/model reference. Switching is authorized
  only while that conversation is idle and applies to its next run. Every run snapshots the
  resolved provider, API, model names/IDs, limits, and fingerprints so later application-global
  changes cannot rewrite history or silently redirect an active run.
- Each Agent conversation also stores one Pi Thinking level. Main exposes the exact supported
  levels only for non-manual models from Pi built-in provider presets, clamps remembered or stale
  values with Pi's model helper, and snapshots the effective level on every run. Custom presets and
  manual models remain `off`. The worker receives only a bounded non-secret runtime model
  descriptor; Pi owns provider-specific reasoning parameter translation. Thinking content remains
  excluded from persisted Agent messages and Renderer projections. See ADR 014.
- OAuth interaction is request-scoped and cancellable. Main runs the provider-owned Pi flow,
  opens only URLs emitted by that flow, and brokers bounded prompts to the initiating Renderer.
  Returned credentials are encrypted directly through the Main-owned Pi `CredentialStore` and
  never returned to Renderer.
- Store only `safeStorage` ciphertext in `app.sqlite`.
- Implement a Pi `CredentialStore` adapter that requests and updates credentials through Main.
- Do not let Pi's default file credential store write into the project.
- Main decrypts only the credential needed for a current request.
- Utility processes may hold a credential in memory for the active request but never persist or log it.
- Project records store provider/model fingerprints and request provenance, never plaintext credentials.
- Opening a project on another machine remains possible without credentials; browsing and existing index use should work, while new API operations report missing configuration.

On Linux, detect and disclose `safeStorage`'s selected backend. Do not claim secure persistence when the backend is `basic_text`.

## File Integrity And Portability

All critical project file writes use temporary files, fsync where supported, and atomic rename. File records include:

```text
fileId, role, relativePath, sha256, size, mimeType,
sourceName, sourceType, revision, createdAt, updatedAt
```

External project watching is intentionally not implemented until an external-edit synchronization requirement exists. The historical watcher design is superseded by the CP19.5 fixed-stack rule; internal atomic writes therefore have no watcher feedback loop to suppress.

A raw folder copy while the project is open is not treated as a verified backup. Provide a project snapshot operation that:

1. pauses project mutations, authorizes one final editor flush, and pauses file-publishing workers;
2. uses SQLite backup APIs for authoritative databases;
3. derives its file inventory from the just-created project database backup, not a later read of the live database;
4. copies only registered immutable/materialized files by hash and aborts if a source changes during the copy;
5. validates the snapshot manifest;
6. optionally omits `index.sqlite` and marks it for rebuild;
7. atomically publishes the completed snapshot directory in the destination parent.

The snapshot manifest contains `snapshotFormat`, `snapshotFormatVersion`, `projectId`, independent project and database schema versions, creation/source-app metadata, `indexIncluded`, `indexRebuildRequired`, a hashed database record, and hashed relative file records. Snapshot contents exclude locks, temp/backups/recovery directories, all SQLite `-wal`/`-shm` sidecars, `index.sqlite`, app databases, logs, credentials, caches, partial files, and the snapshot itself. Relative paths must be normalized, contained, non-symbolic, unique, and free of case-collisions.

Checkpoint capture uses this same barrier and validation path, then writes a complete validated
project state into the managed bare repository at `.writellm/history.git`. Autosave never creates
a Git commit. Initial, manual, safety, and restore checkpoints are linear commits on `main`; Git
objects are written before the ref advances. Missing or damaged history never prevents project
opening or editing. The exact boundary, ownership marker, state hashing, opt-in rules, and recovery
semantics are fixed by ADR 007.

Verified external Snapshot v2 may include a separately inventoried and validated
`.writellm/history.git` tree. Snapshot v1 remains readable and restores as history-uninitialized.

Restore preserves the existing `projectId` and is intended to replace or relocate the same project. Clone/Save As is a separate operation that creates a new `projectId`; two independently located folders with the same ID must not be silently treated as separate projects. Restore stages and fully validates the candidate, creates a pre-restore backup, quarantines the current database, atomically renames the candidate into place, removes old `-wal`/`-shm` sidecars, and only then reopens. CP6 does not hot-replace `app.sqlite`; any future app-database restore must record intent and apply it during early startup after the app database is closed.

Clone/Save As is implemented under ADR 036 as a separate identity boundary. It captures a verified
opened-database backup and authoritative file inventory through the snapshot barrier, excludes the
derived index, history repository, backups, recovery/temp state, exports, snapshots, and
application-global credentials, then rewrites exactly `project_meta.project_id` and
`manuscripts.project_id` in a deferred-foreign-key transaction. A schema assertion fails closed if
a future migration adds another `project_id` column. The new manifest is written last in staging;
the validated directory is published create-only before normal lifecycle open and recent-project
registration.

Project templates follow ADR 037. Built-ins are strict immutable application resources. User
templates are strict canonical JSON files in application user data with a bounded app.sqlite
metadata/hash catalog. The allowed projection is only Brief skeleton, outline metadata, Writing
Rules without source IDs, and an optional publication-preset reference. Application creates a
normal new project first and applies this data through existing authorities with freshly minted
identities; bodies, knowledge, citations, assets, annotations, Agent/review/history state,
credentials, project IDs, paths, executable content, and unknown fields are structurally absent.

A moved or restored project must open without absolute-path repair.

## Native Packaging And Verification

Native risks remain better-sqlite3 and sqlite-vec. electron-builder must rebuild against the target Electron ABI and unpack required runtime assets.

Routine package verification disables Apple signing-identity discovery and permits only an
unsigned bundle or the upstream no-Team-ID ad-hoc/linker signature. Developer ID signing and strict
deep signature validation are a separate opt-in release gate. Distribution signing is not a
prerequisite for packaged native/runtime smoke coverage. Notarization remains disabled until
release distribution work explicitly enables it.

Packaged tests must cover:

- app.sqlite open and migration;
- project create/open/close/switch;
- project locking and stale-session rejection;
- project.sqlite backup, migration, and restore with WAL-resident data;
- BlockNote revision persistence and materialization repair;
- sqlite-vec load and search;
- Unicode project paths and moved project folders;
- job interruption and project reopen recovery;
- MinerU polling recovery;
- index deletion and rebuild;
- agent stream interruption, tool bridge authorization, stale proposal rejection, and accepted mutation lineage;
- safeStorage backend reporting;
- CSP, navigation restrictions, and IPC sender rejection;
- centralized log transport and redaction.

## Target Source Layout

The detailed tree that follows in older revisions is illustrative history, not a requirement that every directory become a class or forwarding module. Keep a module only when it has an independent security/transaction boundary, multiple callers, a replaceable implementation, a lifecycle, or a testable invariant. Do not create a large rename-only refactor during CP19.5.

```text
src/
  main/
    bootstrap/
    app-db/
      connection.ts
      repositories/
      migrations/
    project/
      project-manager.ts
      project-context.ts
      project-manifest.ts
      project-lock.ts
      project-snapshot.ts
    ipc/
    observability/
    manuscript/
      *-store.ts only where a transaction boundary exists
      blocknote-schema.ts
      block-mutations.ts
      materialization.ts
    knowledge/
      mineru/
      normalization/
    jobs/
      scheduler/
      handlers/
    search/
      index-client.ts
      retrieval-service.ts
    agent/
      session-service.ts
      tool-registry.ts
      proposal-service.ts
    providers/
      embedding/
      rerank/
      credential-service.ts
    storage/
    workers/

  preload/

  renderer/
    app/
    features/
      project/
      manuscript/
      knowledge/
      search/
      agent/
      settings/
      diagnostics/
    components/

  shared/
    contracts/
    schemas/
    observability/
    errors/
    types/

  agent-worker/
    runtime/
    pi-models/
    tool-bridge/

  background-worker/
    mineru/
    normalization/
    embedding/
    rerank/

  index-worker/
    db/
    chunks/
    fts/
    vector/
    hybrid-search/

  workers/shared/
    port-logger.ts
    protocols/

resources/
  native/sqlite-vec/
```

The old `import-worker` name, split `providers/credentials` plus `secrets` abstractions, duplicate storage layers, per-table repository directories, standalone `tool-policy.ts`/`context-builder.ts`/`assembly.ts`, and early updater/provider-factory modules are superseded by the CP19.5 worker and module rules.

Remain a single package initially. Introduce a pnpm workspace split only when a real reusable CLI, service, or SDK exists.

## Explicit Non-Choices

Do not use in the current architecture:

- multiple simultaneously open projects;
- a global product `core.sqlite` containing every project's data;
- project content or embeddings under Electron `userData`;
- BullMQ or Redis;
- Chroma, Qdrant, Milvus, or another standalone vector service;
- Prisma or `node-sqlite3`;
- renderer database, filesystem, provider, credential, or generic IPC access;
- Markdown as the lossless editor authority;
- arbitrary JSON Patch as the agent manuscript-edit protocol;
- persisted MinerU signed/download URLs or encrypted bearer capabilities;
- durable jobs for search, query embedding, rerank, provider probes, ordinary saves, or Agent turns;
- project-wide file watchers before an external-edit synchronization feature exists;
- provider-specific workers, a local HTTP server, or a generic RPC framework;
- an updater subsystem before release-updater work is approved;
- generic Pi filesystem, shell, process, or network tools;
- direct agent writes that bypass proposal validation and revision checks;
- Yjs or collaboration infrastructure before a real collaboration requirement;
- plaintext project credentials or credential exports;
- SQLite BLOB storage for PDFs, images, archives, or other large source artifacts;
- absolute project paths stored in project records;
- network calls inside SQLite transactions;
- MinerU Python/PyTorch inside Electron Main;
- subsystem-owned log files alongside the centralized Pino stream;
- logs as authoritative agent, job, import, or mutation history.
- persisted Notebook conversations, questions, answers, citation registries, or source-scope state.

## Historical Transition Into This Baseline

The following previous decisions remain valid:

- Electron security and narrow typed IPC;
- centralized structured logging and error preservation;
- better-sqlite3 with Kysely;
- SQLite-backed durable jobs with p-queue as a runtime scheduler;
- separate rebuildable index database;
- sqlite-vec behind an interface;
- MinerU as a durable asynchronous workflow;
- safeStorage-backed credentials;
- utility-process isolation;
- native packaged smoke tests.

The following earlier decisions were revised to form the current baseline:

- Replace the ambiguous global `core.sqlite` product role with `app.sqlite` plus per-project `project.sqlite`.
- Make the active project folder a first-class lifecycle and authorization boundary.
- Add a project manifest, project lock, and stale project-session rejection.
- Add the manuscript/BlockNote domain, knowledge normalization domain, and Pi agent tool/proposal domain.
- Split interactive agent models from embedding/rerank gateways.
- Replace the old infrastructure-only future roadmap with product-oriented vertical checkpoints.
