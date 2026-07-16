# WriteLLM v2 Implementation Todo

Status: accepted implementation tracker; Checkpoints 1 through 19 completed after audit remediation, CP19.5 pending
Recorded: 2026-07-16

This is the persistent ordered implementation tracker for the clarified product: WriteLLM opens one self-contained project folder at a time. Update this document in the same change that starts or completes an item.

Do not start a later checkpoint until the current checkpoint passes its acceptance criteria and the user approves continuing.

Every checkpoint must add and test useful structured lifecycle events for its new behavior. Every caught error must preserve the original object in a top-level logger `err` field before recovery or boundary sanitization.

Status markers:

- `[ ]` not started
- `[~]` in progress
- `[x]` completed and verified
- `[!]` blocked; add the blocker immediately below the item

## Current Checkpoint

Checkpoints 1 through 19 are functionally completed and verified after the 2026-07-16 audit remediation. The 2026-07-16 complexity-reduction audit is recorded in [the audit record](audits/2026-07-16-complexity-reduction-and-agent-boundary.md). Checkpoint 19.5 is the current mandatory gate; Checkpoint 20 remains not started and cannot begin until 19.5 passes and the user approves continuing. MinerU research must use only the official MinerU API documentation at https://mineru.net/apiManage/docs, never Context7.

The functional completion records for CP1–19 remain useful historical evidence. Where they describe encrypted signed URLs, broad durable queues, the original Agent tool/table set, 650 ms autosave, an 8D performance benchmark, `chokidar`, or the old worker/module layout, those statements are superseded by the CP19.5 audit and must not be extended.

### Checkpoint 19.5: Complexity Reduction And Agent Boundary Freeze

- [ ] 19.5.1 Create the lean current-plan/ADR/history document entry points and mark superseded plan sections; update `AGENTS.md` reading rules without deleting historical evidence.
- [ ] 19.5.2 Remove persisted MinerU signed/download URL capabilities; add migration/cleanup and snapshot absence checks.
- [ ] 19.5.3 Restrict durable jobs to MinerU parse, normalization, index/embedding build, item removal, rebuild, and artifact cleanup; keep interactive requests request-scoped and abortable.
- [ ] 19.5.4 Freeze the first Agent read/write tool set and reduce persistence to `agent_sessions`, `agent_runs`, `agent_events`, `mutation_proposals`, and `model_requests`.
- [ ] 19.5.5 Add content-hash no-op detection, 1–2 second idle autosave, source classification, and background revision retention cleanup.
- [ ] 19.5.6 Rename/fix the three worker roles and verify stale-message handling without provider-specific workers or a generic RPC layer.
- [ ] 19.5.7 Reclassify the 8D vector test as correctness smoke and run representative 10k/50k/100k real-dimension benchmark coverage, including generation-build debounce evidence.
- [ ] 19.5.8 Remove unused `chokidar` and duplicate atomic-write implementations; merge only confirmed forwarding/empty modules.

Acceptance criteria: all eight audit items have source-level evidence, required migrations and cleanup are safe for existing projects, focused tests pass, structured lifecycle logs cover new boundaries, and no CP20 code starts before this gate is complete.

Maintenance fix completed: MinerU provider configuration now follows the official v4 contract and does not require a model revision; revision tracking remains limited to agent, embedding, and rerank providers. Legacy MinerU configurations are accepted without a database rewrite.

Maintenance fix completed: MinerU archive extraction accepts the documented Markdown/JSON/HTML and optional document export artifacts, preserves bounded extraction checks, and reports the rejected extension without logging a private archive path.

Maintenance fix completed: Parsed MinerU Markdown is rendered by the read-only `react-markdown`/`remark-gfm` viewer with shadcn typography utilities, and normalized image references are resolved through the session-authorized parsed-asset IPC before display.

Maintenance fix completed: Parsed Markdown now supports sanitized raw HTML and KaTeX math (`remark-math`/`rehype-katex`), while the inline knowledge card has an explicit bounded scroll chain for long results.

Maintenance fix completed: Markdown tables now use the shadcn Table primitives inside an independent horizontal overflow container, preventing wide tables from expanding the Parsed card.

Maintenance fix completed: KaTeX formulas inside parsed Markdown tables are represented as math AST nodes before `rehype-katex` rendering, preventing escaped KaTeX HTML in both GFM tables and raw HTML tables emitted by document parsers.

Maintenance fix completed: MinerU Markdown fallback now copies and rewrites local image references into normalized manifest assets, and parsed-asset reads accept the bounded legacy source-path alias for already-published revisions.

The detailed plan is split into 11 ordered Phase files plus one maintenance file. The existing checkpoint verification paragraphs and completion entries in the Decision Log are retained as historical records; they do not override the unchecked audit remediation items.

## How To Read This Tracker

1. Read this file first for the current gate, phase order, checkpoint status, and Decision Log.
2. Read `docs/architecture.md`, the [audit record](audits/2026-07-16-complexity-reduction-and-agent-boundary.md), and only the Phase/ADR material directly related to the current item.
3. Treat historical verification and older Phase details as evidence, not as permission to extend superseded designs.
4. Do not start a later Phase or Checkpoint until the current one passes its acceptance criteria and the user approves continuing.

## Plan File Inventory

There are 13 planning files in total: this overview, 11 Phase detail files, and one maintenance detail file. The 11 Phase files contain 26 Checkpoints.

| Phase | Detail file | Main purpose | Checkpoints | Current status |
| --- | --- | --- | --- | --- |
| 0 | [phase-0.md](implementation-todo/phase-0.md) | Baseline and guardrails | None | Completed |
| 1 | [phase-1.md](implementation-todo/phase-1.md) | Secure Electron, logging, and error capture | 1–2 | Completed |
| 2 | [phase-2.md](implementation-todo/phase-2.md) | SQLite connection and migration primitives | 3 | Completed |
| 3 | [phase-3.md](implementation-todo/phase-3.md) | Project container, lifecycle, backup, restore, and snapshots | 4–6 | Completed |
| 4 | [phase-4.md](implementation-todo/phase-4.md) | Project-local durable jobs and scheduler | 7–8 | Completed |
| 5 | [phase-5.md](implementation-todo/phase-5.md) | Manuscript, BlockNote, and writing workspace | 9–11 | Completed |
| 6 | [phase-6.md](implementation-todo/phase-6.md) | Knowledge import, providers, and model gateways | 12–14 | Completed |
| 7 | [phase-7.md](implementation-todo/phase-7.md) | MinerU submission, normalization, and parsed viewer | 15–16 | Completed |
| 8 | [phase-8.md](implementation-todo/phase-8.md) | Indexing, embeddings, and hybrid retrieval | 17–19 | Completed |
| 9 | [phase-9.md](implementation-todo/phase-9.md) | Pi writing agent | 20–23 | Not started |
| 10 | [phase-10.md](implementation-todo/phase-10.md) | Export, packaging, and release confidence | 24–26 | Not started |

| Maintenance | [maintenance.md](implementation-todo/maintenance.md) | Cross-cutting window-state maintenance | — | Completed |

## Status Rules

- '[ ]' not started
- '[~]' in progress
- '[x]' completed and verified
- '[!]' blocked; record the blocker immediately below the item

## Deferred Until Evidence Requires It

The following items remain deferred until evidence requires them. See the Phase files for the active ordered plan.

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
- 2026-07-15: Started Checkpoint 6 after review. Fixed the backup implementation choice to SQLite Online Backup API and documented manifest-last publication, final-flush close authorization, recovery exits, consistency-barrier snapshots, restore/clone project-ID semantics, and deferred index rebuild.
- 2026-07-15: Completed and verified Checkpoint 6: Online Backup API for app/project migration backups, WAL-aware verification, staged project restore, snapshot consistency barriers and manifests, same-ID restore semantics, index rebuild deferral, final-flush authorization/timeout, and production single-instance locking.
- 2026-07-15: Started Checkpoint 7 after approval. Scope is the project-local persistent job schema and deterministic state machine, including lease recovery, retries, cancellation, bounded reference payloads, lifecycle logging, and tests; runtime scheduling and job IPC remain in Checkpoint 8.
- 2026-07-15: Completed and verified Checkpoint 7: project-local STRICT jobs schema, bounded reference payload enforcement, deterministic `BEGIN IMMEDIATE` state transitions, atomic claims and deduplication, lease/heartbeat recovery, cancellation-safe retry/failure handling, project-open recovery, structured lifecycle logging, and concurrency/crash/close tests. Runtime dispatch remains in Checkpoint 8.
- 2026-07-15: Decoupled application window state from project lifecycle. Each new application window now requests maximization once before first display; later project create/open/close/switch transitions preserve user-managed window state.
- 2026-07-15: Reopened Checkpoint 7 for review hardening. Scope is claim-scoped lease tokens, total safe error normalization, strict per-job-type reference payload schemas, and durable material transition auditing; p-queue, scheduler dispatch, job IPC, and Checkpoint 8 close handling remain out of scope.
- 2026-07-15: Completed and re-verified Checkpoint 7 hardening with schema v4 lease capabilities, total safe failure archival, strict typed reference payloads, and durable transactional transition history. Runtime scheduling and Checkpoint 8 remain unstarted.
- 2026-07-15: Started Checkpoint 8 after approval. Scope is one Main-owned runtime scheduler per open project, p-queue resource concurrency, same-attempt close requeue, bounded job IPC, worker-message revocation, and fake-handler contract verification. Real MinerU remote-task persistence and index generation activation remain owned by Checkpoints 15 and 17 respectively.
- 2026-07-15: Completed and verified Checkpoint 8 with p-queue 9.3.1 resource scheduling, Main-owned per-project runtime lifecycle, schema v5 same-attempt close recovery, bounded project-scoped job IPC, stale worker-message rejection, and fake persistence/publication contract tests. Checkpoints 15 and 17 retain mandatory real-domain close/reopen and crash-atomicity verification.
- 2026-07-15: Reopened Checkpoint 8 for review hardening after identifying missing running-scheduler lease recovery, unsafe close-timeout handling for non-cooperative handlers, and cancellation/close arbitration that could leave jobs running. Completion is withdrawn until the three P1 cases and full lifecycle integration tests pass.
- 2026-07-15: Completed and re-verified Checkpoint 8 review hardening. The running scheduler now recovers leases that expire after open; close timeout revokes execution-scoped authority and invokes bounded worker termination before database close; cancellation versus close is transactionally arbitrated; stale execution cleanup cannot affect a newer claim; and ProjectManager/runtime/JobStore close/reopen integration completes the same job exactly once without spending another attempt.
- 2026-07-15: Reopened Checkpoint 9 for review hardening after identifying manuscript conversion failures outside the lifecycle logging boundary and deletion-guard errors transformed before the original object was logged at top level. Completion is withdrawn until both logging paths and regression tests pass.
- 2026-07-15: Completed and re-verified Checkpoint 9 review hardening. Manuscript body and brief serialization failures now emit content-free lifecycle failures with the original top-level `err`; deletion guards log their original error before returning a safe domain error. Biome and both TypeScript checks pass, Electron-hosted Vitest passes 34 files and 183 tests, and the production Electron build passes.
- 2026-07-16: Started Checkpoint 11 under the user's approval to continue sequentially through Checkpoint 19. Scope is the project-session-scoped writing workspace UI and manuscript IPC for brief/outline operations, active-section BlockNote switching, counts, whole-manuscript preview, keyboard/focus behavior, and E2E verification; knowledge, provider, import, search, and functional agent behavior remain owned by later checkpoints.
- 2026-07-16: Completed Checkpoint 11 after review-driven hardening of final-flush leases, explicit active-section authority, conflict-preserving brief/metadata/body drafts, current-version outline mutations, serialized materialization publication, and expanded E2E coverage. All checkpoint and repository gates pass.
- 2026-07-16: Started Checkpoint 12. The implementation order is schema/contracts first, then Main-owned selection and streaming content-addressed publication, project-session IPC, knowledge list actions, and fault/E2E verification. Provider submission, parsing, and indexing remain outside this checkpoint.
- 2026-07-16: Completed Checkpoint 12 after security review of preload-only drop path extraction, content/MIME validation, serialized content-addressed publication, SHA deduplication, cancel/close cleanup, and delete semantics. All checkpoint and repository gates pass.
- 2026-07-16: Started Checkpoint 13. The implementation order is app schema and contracts, safeStorage credential authority/backend policy, capability validation and renderer-safe IPC, settings Command UI, then redaction/portability/backend/failure tests. Model execution remains owned by Checkpoint 14.
- 2026-07-16: Completed Checkpoint 13 after moving connection-test networking from Main into an ephemeral utility process, enforcing the Linux `basic_text` deny policy for both writes and reads, and proving the safeStorage/utility/UI/project-portability path with unit, integration, build, and Electron E2E gates.
- 2026-07-16: Started Checkpoint 14. The order is current package/API characterization and exact pinning, separate runtime interfaces and `model_requests` schema, Main credential adapters plus agent/import utility execution, then mock-provider streaming/retry/abort/auth/redaction verification. MinerU remains governed only by its official documentation and is outside this checkpoint's model transports.
- 2026-07-16: Completed Checkpoint 14 after review hardened true Pi retry counting, safe utility diagnostics, rerank/vector validation, credential bounds, and event-delivery abort behavior; all unit, type, format, build, diff, and Electron E2E gates pass.
- 2026-07-16: Started Checkpoint 15. The order is official MinerU contract characterization, project schema and state invariants, submit-ID persistence barrier, resumable polling/download/extraction/publication, then restart/cancellation/archive-adversary verification. Context7 is explicitly prohibited for MinerU.
- 2026-07-16: Completed Checkpoint 15 after review hardened encrypted signed-URL recovery, same-remote-task restart barriers, expired-download refresh, bounded hostile-ZIP extraction, atomic raw-revision reconciliation, retry auditing, and the production `p-queue` ESM interop path. All unit, type, format, build, diff, and Electron E2E gates pass.
- 2026-07-16: Started Checkpoint 16. The order is versioned normalized-block contracts and project activation schema, deterministic raw-output normalization with asset containment, re-normalization and invalid-revision arbitration, then parsed-viewer IPC/UI and representative fixture verification. MinerU API research remains restricted to the official MinerU documentation.
- 2026-07-16: Completed Checkpoint 16 after review moved CPU-heavy normalization from Main into the Import/API utility, added independent Main-side staging verification, fixed the strict parsed-image IPC boundary, and proved re-normalization, invalid-revision arbitration, representative provider output, and the complete Electron viewer path. All checkpoint and repository gates pass.
- 2026-07-16: Started Checkpoint 17. The order is index manifest/schema and utility protocol, deterministic normalized-block chunking and provenance, staged generation build/activation plus add/update/delete jobs, then rebuild/crash/corruption/close recovery and golden-equivalence verification. FTS5, embeddings, sqlite-vec, and retrieval remain owned by Checkpoint 18.
- 2026-07-16: Completed Checkpoint 17 after review hardened request-ID correlation, independent source/artifact hashing, generation-currentness checks, utility-exit retry, derived-index corruption recovery, and normal close. Golden, deletion-equivalence, forced-crash, missing-index, corrupt-index, unit, build, and full Electron regression gates pass.
- 2026-07-16: Started Checkpoint 18. The order is tokenizer benchmark fixtures and FTS schema, packaged sqlite-vec loading plus vector schema, immutable embedding-generation contracts and batched utility requests, compatibility-gated activation/query operations, then generation deletion/rebuild and 100k-chunk benchmark verification. Hybrid retrieval, reranking, and citation UI remain owned by Checkpoint 19.
- 2026-07-16: Completed Checkpoint 18 after review hardened FTS literal parsing, embedding job replay, active-index revalidation, and generation-contract collision handling. Bilingual fixtures, complete-contract cache reuse, incompatible vector rejection, the measured 100k benchmark, unpacked packaged extension insert/search, full unit/build/Electron regression, and diff gates pass.
- 2026-07-16: Started Checkpoint 19. The order is strict bounded search contracts and Index utility candidate/provenance queries, deterministic RRF plus compatibility-gated query embeddings, optional bounded reranking with fallback, filters and citation expansion, then project-session IPC, shadcn search UI, ranking/deletion/update/adversarial tests, and full regression. Agent functionality remains owned by Phase 9.
- 2026-07-16: Completed Checkpoint 19 after review tightened candidate and expansion payload bounds, execution-time embedding contract guards, abort propagation, active-generation citation isolation, and atomic image-chunk expectations. Deterministic hybrid/rerank fixtures, full provenance filters, deletion/update invalidation, strict IPC, search/citation UI, recovery E2E, unit/build/package, and diff gates pass. Work stops before Phase 9 as requested.
- 2026-07-16: Audited Checkpoints 11 through 19 against their acceptance criteria and the fixed architecture invariants. The functional bodies and recorded gates remain valuable evidence, but the audit reopened all nine checkpoints: 11 and 14 require bounded-contract or verification hardening, while 12, 13, and 15 through 19 have correctness, lifecycle, capability, provenance, or revocable-session gaps listed under `Audit Remediation`. Checkpoint 20 remains not started, and remediation requires explicit user approval before implementation.
- 2026-07-16: Completed the approved remediation for Checkpoints 11 through 19. Added bounded manuscript/workspace contracts and terminate/relaunch verification; non-blocking durable imports, cleanup durability, TIFF capability alignment, model-request recovery, and strict rerank response validation; terminal MinerU failure, cancellation arbitration, allocation idempotency, redirect validation, and monotonic normalization activation; and project-session-bound Index protocol, logical fingerprints, independent model revisions, bounded derived-data cleanup, pre-Top-K filters, parse-revision citation assets, project-scoped aborts, and the Electron-run `smoke:packaged-hybrid` active-generation workflow. Final gates: Node/web TypeScript, Biome on changed files, Electron-hosted Vitest 62 files/280 tests, writing-workspace Playwright 3/3, packaged hybrid smoke, and `git diff --check`.
- 2026-07-16: Recorded the complexity-reduction and Agent-boundary audit. CP1–19 remain historical functional evidence, but CP19.5 is now a mandatory pre-CP20 gate for ephemeral MinerU URLs, a narrow durable-job boundary, a frozen first Agent tool/schema surface, revision-growth controls, three worker roles, real-dimension sqlite-vec benchmarking, removal of unused watchers/atomic-write duplication, and confirmed empty-module cleanup. Conflicting historical Phase statements are superseded and must not guide new implementation.
- 2026-07-16: Implemented the parsed-document lifecycle hardening within CP19.5.3 scope: repeated starts remain idempotent through active normalization, the renderer distinguishes parsing from normalization, session-authorized parse cancellation aborts associated durable jobs and removes unpublished staging artifacts, and knowledge deletion removes the item's parsed artifact tree. CP19.5.3 remains in progress until the broader durable-job boundary and artifact-cleanup job migration are complete.
- 2026-07-16: Started the Knowledge workspace redesign within the existing knowledge/search UI scope. The renderer is moving from a modal Sheet to a full-screen workspace with a shared Manuscript/Knowledge rail, source/task sidebar, compact drag target, aggregate processing status, and inline parsed-document details; existing project-session IPC remains unchanged.
- 2026-07-16: Completed the Knowledge workspace redesign. The Sheet was replaced by a full-screen shadcn workspace with direct Manuscript/Knowledge switching, source/task sidebar, compact drag target that expands on drag, aggregate parse/embedding/queue/failure status, inline parsed content, reparse/cancel controls, Finder/open/delete actions, and updated E2E selectors. Web typecheck, focused Biome checks, and the Electron renderer build pass; Electron E2E and native SQLite Vitest remain environment-blocked by Electron SIGABRT and a better-sqlite3 Node ABI mismatch.
- 2026-07-16: Started a user-requested Knowledge workspace layout refinement within the existing CP19 knowledge/search surface. Scope is limited to replacing card-heavy summary, detail, search, and parsed-block presentation with a flatter source-reader hierarchy; behavior, IPC, and checkpoint boundaries remain unchanged.
- 2026-07-16: Completed the Knowledge workspace layout refinement. Aggregate metrics are now one compact status strip; source details, parsed blocks, empty state, search controls, and search results use a flat reader/list hierarchy with semantic sections and separators instead of general-purpose Cards. Existing behavior and IPC are unchanged, the duplicated file-name E2E selector is now scoped to the document heading, focused Biome and web TypeScript checks pass, and the production Electron build passes. The focused Electron E2E reached the redesigned workspace on its first run, then exposed the corrected duplicate selector; subsequent full reruns stopped earlier on unrelated existing fixture flakes in project-name entry and provider credential persistence.
- 2026-07-16: Started the user-requested Knowledge overview/detail state correction. Entering Knowledge must show an unselected, vertically and horizontally centered statistics overview; selecting a source alone opens its document, and an accessible close action returns to the overview without changing source data or background work.
- 2026-07-16: Completed the Knowledge overview/detail state correction. Knowledge now enters with no selected source and centers the title, upload action, and aggregate status in the available workspace; search remains below that first-screen overview. A source opens only after an explicit sidebar click, and the document header has an accessible X action that clears selection and returns to the intact overview. Focused Biome and web TypeScript checks, the production Electron build, `git diff --check`, and the complete parsed-knowledge Electron E2E pass, including import-without-auto-open, explicit selection, close-to-overview, parsing, search, citation, recovery, and rebuild coverage.
- 2026-07-16: Fixed KaTeX rendering inside parsed Markdown tables. Raw HTML table text is converted to the same `math-inline`/`math-display` AST contract used by `remark-math` before `rehype-katex`, rather than rendering KaTeX to raw HTML and reparsing it in table context. Focused GFM/raw-HTML table regression tests pass, along with the repository Biome check, Node/web TypeScript checks, production Electron build, and `git diff --check`; Biome retains the pre-existing generated shadcn sidebar cookie warning.
