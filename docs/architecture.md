# WriteLLM v2 Architecture Baseline

Status: accepted implementation baseline  
Recorded: 2026-07-14

This document is the accepted WriteLLM v2 baseline around the clarified product model: WriteLLM opens exactly one self-contained project folder at a time. The project folder owns the manuscript, knowledge sources, parsed artifacts, embeddings, project databases, BlockNote materializations, and durable work state.

The ordered delivery plan lives in `docs/implementation-todo.md`.

## Product Scope And Invariants

WriteLLM v2 is a local-first desktop AI writing application with three product domains:

1. A block-based manuscript editor built on BlockNote.
2. A project knowledge base populated from local documents and MinerU parsing.
3. A Pi-based writing agent that reads project context, retrieves evidence, and proposes structured manuscript changes.

The initial product has these fixed invariants:

- The application has zero or one active project at a time.
- A project is a portable folder named `<project-name>.writellm`, created under a user-selected parent directory.
- The initial product supports one primary manuscript per project. Internal identifiers should not prevent a later multi-manuscript extension, but no multi-manuscript UI or workflow is implemented now.
- All project business data lives under the project root.
- Application-global settings, encrypted provider credentials, recent-project pointers, diagnostic logs, and Chromium cache are not project business data and remain under Electron-managed application directories.
- Opening another project means closing the current project completely before opening the next one.
- A project must not be writable from two WriteLLM instances at the same time.
- The renderer never receives raw database, filesystem, credential, or generic IPC access.
- Markdown is an interchange and export format, not the lossless manuscript source of truth.
- Agent writes are typed, revision-checked mutation proposals. The agent never receives arbitrary filesystem, SQL, shell, or unrestricted network tools.

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
    project.sqlite
    index.sqlite
    temp/
    backups/
    recovery/
```

The exact names may be adjusted before implementation, but the ownership rules are fixed:

- `writellm.project.json` identifies the folder as a WriteLLM project.
- `project.sqlite` is the authoritative structured project database.
- `index.sqlite` is derived and fully rebuildable.
- BlockNote JSON files under `manuscript/sections/` are deterministic materializations of the current manuscript revisions.
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

The manifest is an identity and compatibility marker, not a duplicate database. Manuscript metadata, section state, provider choices, jobs, imports, and agent history remain in `project.sqlite`.

Opening a folder requires:

- a recognized manifest format;
- a supported format version or an explicit migration path;
- a project ID matching the singleton project row in `project.sqlite`;
- successful project lock acquisition;
- successful database backup, migration, and integrity checks;
- containment validation for every referenced file record.

## Fixed Technology Stack

| Area                    | Choice                                                                        |
| ----------------------- | ----------------------------------------------------------------------------- |
| Desktop runtime         | Electron 43                                                                   |
| Build and development   | electron-vite 5                                                               |
| Packaging               | electron-builder                                                              |
| Renderer                | React 19, TypeScript, Tailwind CSS 4, shadcn/ui                               |
| Block editor            | BlockNote React with the shadcn-compatible UI integration                     |
| Renderer server state   | TanStack Query                                                                |
| Local UI state          | React state first; Zustand only when justified                                |
| IPC                     | `contextBridge`, narrow business APIs, `ipcMain.handle`, Zod                  |
| Structured logging      | Pino                                                                          |
| Correlation context     | Pino child loggers and Node.js `AsyncLocalStorage`                            |
| Log rotation            | pino-roll with application retention cleanup                                  |
| Application database    | `app.sqlite`, better-sqlite3 with Kysely                                      |
| Project database        | per-project `project.sqlite`, better-sqlite3 with Kysely                      |
| Durable jobs            | project-local SQLite jobs table with p-queue runtime scheduling               |
| Full-text search        | project-local SQLite FTS5                                                     |
| Vector search           | project-local sqlite-vec behind a `VectorIndex` interface                     |
| Hybrid retrieval        | FTS5, sqlite-vec, RRF, optional API reranking                                 |
| Files                   | `node:fs/promises`, write-file-atomic, chokidar                               |
| Agent runtime           | `@earendil-works/pi-agent-core`                                               |
| Agent model transport   | `@earendil-works/pi-ai`                                                       |
| Embedding and reranking | AI SDK Core behind separate `EmbeddingGateway` and `RerankGateway` interfaces |
| MinerU                  | independent HTTP adapter and durable polling workflow                         |
| Secrets                 | Electron `safeStorage` with an application credential-store adapter           |
| Tests                   | Vitest and Playwright Electron E2E                                            |

Do not force interactive agent generation, embeddings, and reranking through one artificial model interface. They have different lifecycle and capability requirements:

```ts
export interface AgentModelRuntime {
  createSession(config: AgentSessionConfig): Promise<AgentSessionHandle>
}

export interface EmbeddingGateway {
  embedBatch(input: EmbeddingBatchInput): Promise<EmbeddingBatchResult>
}

export interface RerankGateway {
  rerank(input: RerankInput): Promise<RerankResult>
}
```

Pi owns the interactive agent loop and tool-call event model. AI SDK Core may implement embedding and reranking adapters. Provider configuration and trace metadata are normalized above both libraries.

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
7. Main atomically writes the project manifest as the final validity/publication marker.
8. Main canonicalizes the published root and opens it as the active project using the already-held lock.

A failed create must leave either no project or a clearly marked recoverable staging directory, never a folder that appears valid but lacks required state.

### Open project

Opening performs:

1. Validate and realpath the selected root.
2. Read and validate `writellm.project.json`.
3. Acquire the write lock.
4. Open `project.sqlite` with required pragmas.
5. Back up before migrations.
6. Apply forward-only migrations.
7. Run `quick_check` and `foreign_key_check`.
8. Validate the manifest/database project ID pair.
9. Validate or rebuild BlockNote materializations.
10. Open or create `index.sqlite`; schedule a rebuild if missing or incompatible.
11. Recover expired project jobs.
12. Start project-bound utility processes and the scheduler.
13. Publish a new opaque `projectSessionId` to project-scoped renderer APIs.

### Close project

Closing performs:

1. Reject new project mutations.
2. Flush pending renderer manuscript saves through a bounded protocol.
3. Stop claiming new jobs.
4. Abort or park interactive agent runs and mark interrupted requests accurately.
5. Persist resumable external state such as MinerU `remote_task_id`.
6. Stop project-bound workers and index access.
7. Checkpoint/close project databases.
8. Release the project lock.
9. Revoke the `projectSessionId` and all project subscriptions.

Delayed IPC responses or worker messages carrying an old `projectSessionId` are rejected after close or project switch.

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
   |-- Agent utility process
   |     |-- pi-agent-core loop and event stream
   |     |-- pi-ai model calls
   |     `-- custom tool bridge only; no direct DB/filesystem APIs
   |
   |-- Import/API utility process
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

Responsibilities are strict:

- Renderer displays and edits application state. It never accesses privileged resources.
- Main owns the active project identity, authorization, authoritative project state, short transactions, mutation validation, scheduling, file publication, locks, and secrets.
- Agent utility owns Pi runtime state for an active run but cannot directly read or modify the project.
- Import/API utility owns external API calls and CPU-heavy normalization, but authoritative stage transitions are committed by Main.
- Index utility owns all writes to `index.sqlite` and exposes a narrow search/index protocol.
- Only Main owns the file log sink.

Use Electron `utilityProcess` rather than introducing a local HTTP backend. Agent tools communicate with Main through a dedicated MessagePort protocol distinct from model streaming and logging traffic.

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
mineru, worker, security, updater
```

Project logs remain in the global Electron logs directory rather than inside the project. A project diagnostic export may filter by `projectId`, but rotatable logs are not project authority.

Never log:

- full manuscript blocks or article metadata bodies;
- full prompts, model responses, retrieved source text, or tool-result bodies;
- original or parsed document bodies;
- embedding vectors;
- credentials, signed URLs, or private absolute paths.

Persist agent messages, tool calls, proposals, accepted mutations, job state, and model request metadata in `project.sqlite`; do not attempt to reconstruct them from logs.

## Database Boundaries

Use three database roles:

```text
app.sqlite                 <ProjectRoot>/.writellm/project.sqlite
  app_settings               project_meta
  recent_projects            manuscript
  provider_configs           manuscript_briefs
  encrypted_credentials      sections
  app_schema_manifest        section_revisions
                             section_materializations
                             knowledge_items
                             parse_revisions
                             file_records
                             imports
                             jobs
                             model_requests
                             agent_sessions
                             agent_runs
                             agent_messages
                             agent_tool_calls
                             mutation_proposals
                             mutation_applications
                             accepted_source_links
                             project_schema_manifest

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

The project migration protocol is:

```text
acquire project lock
-> open project.sqlite
-> inspect manifest and schema versions
-> create online backup including WAL-resident committed data
-> apply forward-only migrations
-> PRAGMA quick_check
-> PRAGMA foreign_key_check
-> validate projectId and file-record containment
-> update schema manifest
-> continue project open
```

Never back up a live WAL database by copying only the main `.sqlite` file.

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
createdAt
updatedAt
```

The section title and status live outside BlockNote content. A section's BlockNote document represents the section body. Whole-manuscript assembly renders section headings from the outline and then the section body, preventing duplicated or diverging title state.

### BlockNote source of truth

BlockNote's native block JSON is the lossless manuscript representation. Each block retains its stable BlockNote block ID.

The canonical current and historical section JSON lives in `section_revisions.content_json` in `project.sqlite` so revision changes, accepted agent lineage, and optimistic concurrency are transactional. After a revision commits, a durable materialization step atomically writes:

```text
manuscript/sections/<section-id>.blocknote.json
```

The materialized file contains the current native BlockNote JSON plus a small schema/revision envelope. It is portable and inspectable but is rebuildable from `project.sqlite`; it is not a second authority.

A missing or stale materialization does not invalidate the manuscript. Project open schedules or performs repair after verifying the canonical revision hash.

Markdown import/export is explicitly lossy. Exported Markdown is written under `manuscript/exports/` and never silently replaces native BlockNote JSON.

### Manual editing

Renderer editing uses:

- a BlockNote instance scoped to the active section;
- debounced saves carrying `sectionId`, `baseRevisionId`, and the complete validated native document;
- optimistic concurrency in Main;
- atomic revision commit followed by materialization;
- a visible save state: clean, saving, saved, conflict, failed;
- bounded local retry without swallowing errors.

Because only one project is active, collaboration infrastructure such as Yjs is deferred. Manual editor changes and agent mutation application are still serialized through revision checks to prevent stale overwrites.

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

For mixed Chinese and English corpora, evaluate `unicode61` and `trigram` FTS behavior with representative fixtures. Short-query fallback is mandatory.

## Agent Architecture

### Runtime choice

Use `@earendil-works/pi-agent-core`, not the Pi coding-agent CLI. The runtime lives in the Agent utility process and uses `@earendil-works/pi-ai` for tool-capable language model streaming.

Pi is a harness, not an authorization boundary. WriteLLM supplies only application-specific tools and does not expose Pi's generic file, shell, process, or network capabilities.

### Agent persistence

Persist normalized project-local records for:

- agent session;
- agent run/turn;
- user and assistant messages;
- tool calls and results;
- model request metadata and usage;
- interruption/cancellation status;
- context compaction summaries;
- mutation proposals and decisions.

Pi runtime events stream to the renderer for responsive UI, but durable records are created before the corresponding external operation or mutation can become authoritative.

### Context construction

Do not send the whole project on every turn. A `ContextBuilder` constructs a bounded context from:

- manuscript brief;
- outline, section objectives, statuses, and word counts;
- active section and selected blocks;
- neighboring section summaries where useful;
- explicit user attachments or selected knowledge citations;
- prior conversation after compaction;
- tool descriptions and safety policy.

Full manuscript and knowledge access is through tools with pagination and size limits.

Retrieved knowledge is untrusted content. It is clearly delimited and never allowed to redefine tool policy, authorization, or system instructions.

### Initial read tools

```text
get_manuscript_brief
get_manuscript_overview
list_sections
read_section
read_blocks
search_manuscript
search_knowledge
read_knowledge_citations
get_active_editor_context
```

Read-only tools may execute in parallel when their results are independent.

### Initial write tools

```text
propose_update_manuscript_brief
propose_create_section
propose_update_section
propose_reorder_sections
propose_delete_section
propose_block_mutation
```

Write tools are sequential and create `mutation_proposals`; they do not directly commit project state.

Main uses Pi's tool preflight hook plus its own policy engine to block disallowed calls. The renderer displays a structured preview. The user can approve or reject. Approved proposals are revalidated against the current project and revision immediately before application.

An optional future auto-apply mode may be limited to explicitly selected low-risk operations. It is not the default architecture.

### Agent tool bridge

Agent utility sends a validated envelope to Main:

```ts
interface AgentToolRequest {
  projectSessionId: string
  agentSessionId: string
  agentRunId: string
  toolCallId: string
  toolName: string
  args: unknown
}
```

Main:

1. validates the envelope and active project session;
2. validates tool arguments against the registered contract;
3. authorizes read/write policy;
4. executes the domain service or creates a proposal;
5. persists tool lifecycle state;
6. returns a bounded structured result;
7. logs metadata without logging content.

Tool errors are thrown and preserved as structured errors. They are not returned as successful text content.

## Durable Job Model

Jobs are project-local. `app.sqlite` does not schedule project work.

Required state machine:

```text
queued -> running -> succeeded
                  -> failed
                  -> queued      retry
                  -> cancelled
                  -> paused      explicit project close when supported
```

A project close must stop new claims. Running handlers must either:

- finish within the bounded close window and commit;
- abort at a safe point and requeue;
- retain a renewable lease until the worker exits, then recover by expiry;
- persist external continuation state, such as a MinerU remote task, before stopping.

Handlers are idempotent and deduplicated by stable content/operation keys. Job payloads contain IDs, relative references, hashes, and small options—not document bodies, BlockNote JSON, embeddings, absolute paths, or credentials.

Initial resource queues remain subject to provider limits and benchmarks:

```text
agent: 1 active run per project
llm auxiliary: 2
embedding: 3
rerank: 3
mineru: 1
indexing: 1
```

Write-type agent tools remain sequential even when Pi permits parallel tool execution globally.

## Secrets And Provider Configuration

Provider configuration is application-global because credentials are device/user concerns, not portable project content.

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

Chokidar observes the active project only where external edits are intentionally supported. Internal atomic writes are suppressed or reconciled to avoid feedback loops.

A raw folder copy while the project is open is not treated as a verified backup. Provide a project snapshot operation that:

1. quiesces project mutations or captures a consistent point;
2. uses SQLite backup APIs for authoritative databases;
3. copies referenced authoritative files by hash;
4. validates the snapshot manifest;
5. optionally omits `index.sqlite` and marks it for rebuild;
6. atomically publishes the completed snapshot/archive.

A moved or restored project must open without absolute-path repair.

## Native Packaging And Verification

Native risks remain better-sqlite3 and sqlite-vec. electron-builder must rebuild against the target Electron ABI and unpack required runtime assets.

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
      project-lifecycle.ts
      project-snapshot.ts
    ipc/
    observability/
    manuscript/
      repositories/
      services/
      blocknote-schema.ts
      block-mutations.ts
      materialization.ts
      assembly.ts
    knowledge/
      repositories/
      storage/
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
      context-builder.ts
      tool-registry.ts
      tool-policy.ts
      proposal-service.ts
    providers/
      credentials/
      embedding/
      rerank/
    storage/
    secrets/
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

  import-worker/
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

## Impact On The Previous Baseline

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

The following decisions must be revised before continuing product work:

- Replace the ambiguous global `core.sqlite` product role with `app.sqlite` plus per-project `project.sqlite`.
- Make the active project folder a first-class lifecycle and authorization boundary.
- Add a project manifest, project lock, and stale project-session rejection.
- Add the manuscript/BlockNote domain, knowledge normalization domain, and Pi agent tool/proposal domain.
- Split interactive agent models from embedding/rerank gateways.
- Replace the old infrastructure-only future roadmap with product-oriented vertical checkpoints.
