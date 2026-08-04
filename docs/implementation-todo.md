# WriteLLM v2 Implementation Todo

Status: Checkpoint 26.8S security remediation is complete; Checkpoint 26.9 is blocked on hosted
release evidence
Recorded: 2026-07-31

This is the persistent ordered implementation tracker for the clarified product: WriteLLM opens one self-contained project folder at a time. Update this document in the same change that starts or completes an item.

Do not start a later checkpoint until the current checkpoint passes its acceptance criteria and the user approves continuing.

Every checkpoint must add and test useful structured lifecycle events for its new behavior. Every caught error must preserve the original object in a top-level logger `err` field before recovery or boundary sanitization.

Status markers:

- `[ ]` not started
- `[~]` in progress
- `[x]` completed and verified
- `[!]` blocked; add the blocker immediately below the item

## Current Checkpoint

Checkpoints 24 and 25 are complete and verified. Whole-manuscript export is Main-authoritative,
deterministic, asset-verified, collision-safe, and path-bounded. Native packaging now has four
explicit native-host targets, fail-closed Electron ABI/architecture preparation, executable
ASAR/resource inventory, source-independent packaged runtime coverage, deterministic artifact
evidence, and product metadata. Exact pnpm 11.17.0 static, canonical Electron Vitest, production
build, all 18 Electron Playwright scenarios, and the macOS arm64 no-identity package/DMG/ZIP gate
passed. The strengthened package gate also passed 12 runtime smoke scenarios and all 18 E2E
scenarios against the packaged executable; the recovery manifest binds 22 executable cases to
exact test names and 20 source hashes. Checkpoint 26.1–26.8 are implemented and locally verified;
Checkpoint 26.9 requires the
committed/tagged four-runner GitHub matrix and protected dry-run promotion, which were not
performed without authorization to commit, push, tag, or dispatch. The realigned Checkpoints
24–26 are authoritative in [`phase-10.md`](implementation-todo/phase-10.md).

### Checkpoint 26.8S: Security Boundary Remediation

- [x] 26.8S.1 Add the canonical Main-owned project-filesystem capability and migrate MinerU
  cleanup/extraction, knowledge import/delete/publication, normalization staging/publication, and
  project-database path access.
- [x] 26.8S.2 Add application migration 0004 and bind encrypted credentials to the current
  provider security identity; invalidate unverifiable custom Agent credentials and clear them on
  endpoint-origin/auth changes without a replacement key.
- [x] 26.8S.3 Add public-HTTPS MinerU artifact URL validation, manual redirect validation, and a
  shared actual-byte-bounded response reader for MinerU, provider probes, models.dev, and custom
  model catalogs.
- [x] 26.8S.4 Replace the full parsed-document IPC with verified metadata, bounded block pages, and
  lazy Markdown; bound Agent event pages by both rows and encoded bytes.
- [x] 26.8S.5 Pass focused adversarial regressions, `check:fast`, the canonical Electron suite,
  fresh-build E2E, no-identity package verification, and final change-aware bypass review.

Started 2026-07-31 after explicit user approval. The validated scan covered revision
`9c3119b5f29e1636671ce7b18ce4a13e2230ef3d` plus the recorded dirty-worktree snapshot. ADR 011
preserves the existing Renderer, project-session, database, worker, and provider authority while
adding common enforcement points for the eleven findings.

Completed and verified 2026-07-31. Focused filesystem, database, archive, HTTP, credential,
knowledge-budget, and Agent-budget regressions passed, including a near-200-MiB/20,000-block
fixture and 200 near-limit Agent events. `pnpm check:fast` passed; canonical Electron Vitest
passed 115 files/582 tests with one opt-in benchmark skipped; fresh-build Electron E2E passed
18/18; recovery fixtures passed with 22 cases and 20 bound sources; and `pnpm check:package`
passed the no-Team-ID signature policy, native inventory, twelve packaged smoke scenarios,
packaged E2E 18/18, and DMG/ZIP inspection. `check:release` was not run. CP26.9 remains blocked
only on its own hosted-runner and protected-promotion evidence.

### Maintenance: Tag-only cross-platform CI triggers (2026-08-04)

- [x] Keep the static/fixture gate on pull requests and `main`, run the four-platform Electron and
  native-package matrices only for tag refs, and remove the scheduled cron trigger.

Started and completed 2026-08-04 at the user's request. The release-candidate workflow remains an
explicit exact-tag rebuild and promotion path; branch-based manual CI dispatches no longer spend
four-platform runner capacity. YAML parsing and repository diff checks passed.

### Maintenance: Outline editor workspace refinement (2026-07-30)

- [x] Replace the current-section Sheet with a responsive full-outline Dialog, add explicit
  metadata/status and hierarchy controls, centralize create/delete operations, relocate
  section interchange actions to the active editor, and preserve the existing Main/IPC/schema
  authority.

Started 2026-07-30 after explicit user approval of the implementation plan. This maintenance
retains manual section statuses, outline-version concurrency, leaf-only tombstone deletion,
BlockNote revision authority, and the unstarted Checkpoint 24 export boundary. It adds no schema,
IPC, provider, Agent-authority, or packaging changes.

Completed and verified 2026-07-30. The responsive Dialog now exposes the complete accessible
outline tree, a desktop inspector and narrow-screen drill-in flow, manual status and metadata
editing, explicit hierarchy operations, guarded creation/deletion, independent save/conflict
recovery, and an explicit Open in editor action. The sidebar is read-only, and current-section
import/export actions live beside the editor title. Exact pnpm 11.17.0 `check:fast` passed;
canonical Electron Vitest passed 108 files and 535 tests with one opt-in benchmark file/test
skipped; the production build and all 18 Electron Playwright scenarios passed; and
`git diff --check` passed. Checkpoint 24 remains unstarted.

### Maintenance: Large-Knowledge project open and workspace loading (2026-07-30)

- [x] Publish the authoritative project/manuscript session before rebuildable Index-worker
  initialization, expose explicit index readiness, add clean-shutdown fast reopen with unclean
  background validation, bound inactive/orphaned index storage, and replace Knowledge's
  all-document polling with one lightweight summary plus selected-document loading.

Started 2026-07-30 after explicit user approval of ADR 010 and the implementation plan. The
maintenance preserves the single-project/session capability, authoritative project-database
integrity gate, three fixed worker roles, seven durable job types, and Checkpoint 24 boundary.
Completed and verified 2026-07-30. A SQLite-online-backup copy of the reported 29-source,
1.0 GiB, 19-generation project opened its Manuscript in 260 ms while the conservative first
background index validation completed in 22,348 ms; after a clean close, Manuscript was visible
in 201 ms and index initialization completed in 171 ms. The temporary copy retained one active
plus three inactive generations, one vector root table, matching 19,322-row FTS indexes, a clean
shutdown marker, and `integrity_check=ok`; the original project was opened read-only only to make
the temporary backups and was not modified. Exact pnpm 11.17.0 `check:fast` passed; canonical
Electron Vitest passed 107 files and 531 tests with one opt-in benchmark skipped; the production
build and all 17 Electron Playwright scenarios passed. The no-identity package gate verified no
Apple Team ID and passed packaged native hybrid/vector search, Provider-failure fallback, and
stale-session recovery. No `VACUUM` was run, so the derived file is not expected to shrink
immediately. Checkpoint 24 remains unstarted.

### Checkpoint 23V: Project Git Version History

- [x] Add ADR 007, exact-pinned `isomorphic-git@1.40.0`, the Main-only
  `ProjectVersionStore`, strict repository ownership, explicit bare `gitdir`, linear `main`
  commits, atomic ref advancement, and non-blocking `uninitialized | ready | damaged` state.
  Dependency blocker resolved 2026-07-29 by upgrading the repository package-manager pin to
  pnpm 11.17.0; `isomorphic-git@1.40.0` is exact-pinned in the manifest and lockfile.
- [x] Reuse the production Snapshot barrier to create consistent checkpoint trees and exact state
  hashes; exclude derived, secret, transient, backup, recovery, and repository content; initialize
  new projects automatically and let existing projects opt in with a durable dismissal.
- [x] Add session-authorized enable, create, list, compare, reinitialize, and restore contracts,
  IPC, preload, structured lifecycle logs, and shadcn Menubar/Dialog/Sheet/AlertDialog surfaces
  without exposing paths or raw Git errors to the Renderer.
- [x] Implement fail-closed restore with a pre-restore safety checkpoint, validated materialization,
  a recovery journal and rollback at every rename/ref boundary, a history-preserving restore
  commit, and index rebuild.
- [x] Upgrade verified external snapshots to v2 with validated version-history inventory while
  retaining v1 restore compatibility.
- [x] Pass focused fault/adversarial/performance coverage, `pnpm check:fast`, canonical Electron
  Vitest, production build, complete Electron E2E, `pnpm check:package`, and `git diff --check`.

Started 2026-07-29 after explicit user approval of the complete recommended plan. Checkpoint 24
remains unstarted. Completed 2026-07-29. Exact pnpm 11.17.0 `check:fast` passed with Biome checking
368 files and reporting only the existing generated shadcn cookie warning. Canonical
Electron-hosted Vitest passed 103 files and 504 tests (the opt-in benchmark file was skipped);
production build and all 17 Electron Playwright scenarios passed. The no-identity package gate
confirmed no Apple Team identity and packaged native search, provider-failure fallback, and
stale-session smoke passed. Focused coverage includes independent outer repositories, strict
ownership, symlinks, simulated ref-advance disk failure, linear pagination/state comparison,
Snapshot v1/v2, recovery-journal rename boundaries, safety checkpoints, and history-preserving
restore. With one unchanged 1 MiB knowledge file, a growing database, 100 checkpoints, and no GC,
the Electron benchmark recorded 237/1,001/1,954 ms cumulative time and
12,117/55,447/111,855 bytes at 10/50/100 checkpoints. `git diff --check` passed.

### Checkpoint 23M: Rich Media Blocks And Gemini Image Generation

- [x] Add content schema v2 with v1 compatibility, native project-asset image blocks, bounded
  source-backed Mermaid and display-math blocks, safe preview rendering, source editing, and the
  single-section Markdown import/export mappings.
- [x] Add migration 0022, content-addressed project assets, transactional revision references,
  24-hour orphan cleanup, validated upload, session-bound preview capabilities, and strict
  sender/session-authorized preload IPC.
- [x] Add the global Gemini image provider role, request-scoped background-worker Interactions
  gateway, safe model-request accounting, cancellation, and the bounded `generate_image` Agent
  proposal/application flow with stale-before-billing and conflict reuse.
- [x] Upgrade the Agent Tool Contract to v3, support Main-normalized Mermaid/math insertion, retain
  old event/proposal/content readers, update ADR 006 and architecture boundaries, and pass the full
  unit, migration, production, Electron, and packaged acceptance gate.

Started and completed 2026-07-22 after explicit user approval. Local Biome checked 347 files with
only the existing generated shadcn cookie warning; Node/Renderer typechecks and the production
build passed; canonical Electron Vitest passed 99 files/470 tests; all 14 built-app Electron
Playwright scenarios passed; migration 0022 and project database integrity coverage passed; the
signed macOS arm64 unpacked application passed strict deep verification; packaged hybrid native
search, provider-failure fallback, and stale-session smoke passed; and `git diff --check` passed.
The installed Biome binary and documented npm/direct runner equivalents were used because the
local pnpm wrapper could not verify its registry signature offline. Checkpoint 24 remains unstarted
and requires separate approval.

### Maintenance: Rich-media image preview correction (2026-07-23)

- [x] Let BlockNote resolve an empty native image placeholder without rejecting, allow the
  session-bound `writellm://bundle/project-asset/` preview source under the development renderer
  CSP, and add focused regression coverage for both boundaries.

Completed after a field report from the Vite development renderer. BlockNote's native image
renderer resolves the empty URL before an upload, while the development page has an HTTP origin
that does not treat the application protocol as `'self'`; the two conditions caused an unhandled
resolver rejection and a CSP-blocked preview. The resolver now preserves only the empty placeholder
as a non-asset value, keeps rejecting every other non-project source, and exchanges logical asset
IDs through the existing session-bound IPC once populated. The CSP explicitly permits only the
`writellm://bundle` application source in addition to `'self'` and `data:` images. Focused Biome,
Node/Renderer typechecks, the production build, canonical Electron Vitest (101 files/474 tests),
all 14 Electron Playwright scenarios including image upload/reopen, isolated real-app SQLite
identity/integrity/schema verification, and `git diff --check` passed. Follow-up coverage also
asserts that an applied Gemini proposal persists the exact `writellm-asset:<assetId>` logical URL,
so generated and uploaded images use the same renderer resolution path.

### Maintenance: Gemini image error diagnostics (2026-07-23)

- [x] Preserve Gemini's bounded HTTP status and machine-readable error code across the background
  worker boundary, classify `generate_image` provider failures separately from read-tool failures,
  and prevent the Agent from blindly retrying non-retryable HTTP 400 responses.

Completed after runtime evidence showed four real Gemini Interactions requests failing with HTTP
400 in 95–180 ms across long, short, 2K, and default 1K prompts. The request shape matches the
current official Gemini image-generation contract, so prompt retry is not a valid recovery.
Background-worker diagnostics now extract only a bounded uppercase provider status/reason such as
`API_KEY_INVALID` or `INVALID_ARGUMENT`; response messages, prompts, credentials, and image bytes
remain excluded. Main preserves the code through the utility boundary and reports
`generate_image` provider rejection as non-retryable `unavailable` with `ask_user` recovery instead
of the incorrect `internal / Agent read tool failed`. Canonical Electron Vitest passed 101
files/476 tests, including the safe-response and Agent error-projection regressions; Node/Renderer
typechecks, the production build, full-repository Biome (with only the existing generated shadcn
cookie warning), all 14 Electron Playwright scenarios, and `git diff --check` passed.

### Maintenance: Official Gemini SDK transport (2026-07-23)

- [x] Pin `@google/genai@2.12.0` and replace the handwritten Interactions REST transport with
  `GoogleGenAI.interactions.create` inside the existing background-worker image gateway, retaining
  cancellation, timeout, no-retry, bounded response validation, and safe error projection.

Started after repeated field requests continued to receive HTTP 400 and the user explicitly
approved the official SDK transport. ADR 006 is amended without expanding Agent network, file,
credential, or manuscript-write authority. The default auto/1K request now follows the official
minimal `model`/`input` example. Explicit aspect ratio or size uses the SDK's typed
`response_format`, with PNG represented by the required top-level `response_mime_type` instead of
the old nested PNG MIME field. The worker normalizes the legacy `/v1beta` provider base URL
for the SDK, disables SDK retries, consumes `output_image`, and retains the existing outer
AbortController timeout/cancellation boundary. Canonical Electron Vitest passed 101 files/477
tests; Node/Renderer typechecks and the production build passed; full Biome passed with only the
existing generated shadcn cookie warning; isolated real-app SQLite identity, integrity,
foreign-key, and schema-manifest checks passed; all 14 Electron Playwright scenarios passed; and
`git diff --check` passed.

### Maintenance: Fixed Gemini endpoint and image model catalog (2026-07-23)

- [x] Remove editable image-provider URL and free-form model input; expose only the encrypted API
  key and a dropdown containing the four user-approved Gemini image models.
- [x] Enforce the official endpoint marker and model allowlist at the shared/Main boundary, while
  normalizing the legacy official `/v1beta` value for existing installations.
- [x] Construct `GoogleGenAI` with only the request-scoped API key, use the minimal
  `interactions.create({ model, input })` generation request, and move image connection testing
  from handwritten HTTP to the official SDK.
- [x] Pass focused contract/worker/provider tests, Node and Renderer typechecks, production build,
  Biome, canonical Electron Vitest, built Electron E2E, runtime database verification, and
  `git diff --check`.

Started after the user reported that the official SDK transport still returned HTTP 400 despite a
valid API key and explicitly approved a fixed official endpoint plus four-model catalog. This is a
post-completion Checkpoint 23M maintenance correction; it does not start Checkpoint 24.
Completed with a Main-validated legacy normalization and fixed model catalog, an official shadcn
Select settings surface, API-key-only SDK construction, minimal generation request, and SDK model
probe. Full Biome checked 351 files with only the existing generated shadcn cookie warning;
Node/Renderer typechecks and production build passed; canonical Electron Vitest passed 101
files/480 tests; all 14 built Electron Playwright scenarios passed, including no-URL UI,
four-model selection, encrypted-key storage, and restart persistence; isolated real-app SQLite
reported application ID 1464615248, schema/user version 1, integrity `ok`, and no foreign-key
failures; and `git diff --check` passed.

### Maintenance: Correct Gemini Interactions image contract (2026-07-23)

- [x] Exact-pin `@google/genai@2.13.0`, serialize the documented image `response_format`, preserve
  Interactions default storage, and verify the actual SDK endpoint, headers, and request JSON.
- [x] Normalize model size capabilities, accept Main-validated PNG/JPEG, and retain requested and
  effective size in project-local asset lineage.
- [x] Remove current Gemini `baseUrl` persistence while accepting and stripping only the legacy
  official marker; preserve original SDK errors locally and expose only safe status/code fields.
- [x] Pass focused and full checks, build, Electron Vitest, out-of-sandbox Electron E2E, and
  isolated runtime database inspection.
- [!] Complete the authorized live Gemini 1:1/1K asset/block gate. The single authorized request
  reached Gemini but returned through the safe auxiliary-provider failure path before asset
  publication. It was not retried because approval covered one real request, and the temporary
  isolated runtime was removed before its safe HTTP status/code could be retained.

Started after the user confirmed the Gemini API was usable and the application's HTTP 400 pointed
to its request contract. This correction follows Google's official image-generation documentation
and does not use Context7. Agent authority, worker roles, project-local asset publication,
proposal/revision checks, and Checkpoint 24 remain unchanged.

### Checkpoint 23H: Agent Harness Protocol v2 Hardening

- [x] 23H.1 Replace approval waiters with durable submit/pause/decision/continue semantics; preserve
  structured domain errors through Pi; persist attempted and preflight-failed tool events; add the
  Protocol v2 event migration and compatibility readers.
- [x] 23H.2 Bind every model request to an in-memory writing snapshot; rebuild trusted context before
  continuations; move outline references and block-hash DSL normalization into Main; enforce
  Main-computed effect-based approval and expanded-evidence-only proposal provenance.
- [x] 23H.3 Deliver the final eleven-tool surface, deterministic `check_draft`, manuscript search,
  change inspection, bounded outline/citation pagination, per-tool deadlines, progress projection,
  renderer approval continuation, and the full migration/unit/Electron/packaged acceptance gate.

Started 2026-07-22 after explicit user approval of the complete implementation plan. ADR 005 is the
authority for this remediation window. Checkpoint 24 remains unstarted.

Completed 2026-07-22. Tool Result schema v2, the 0021 event migration, attempt/preflight/decision
auditing, non-blocking proposal review, approval continuation, request-scoped snapshots, Main-owned
SectionRef and block-hash DSL normalization, effect policy, expanded evidence, ID mappings, all
eleven tools, per-tool deadlines, bounded pagination, manuscript search, change inspection, and
deterministic draft verification are implemented. Local Biome passed with only the existing
generated shadcn cookie warning; Node/Renderer typechecks and the production build passed; canonical
Electron Vitest passed 96 files/449 tests; all 13 Electron Playwright scenarios passed; the signed
macOS arm64 unpacked build passed strict deep verification; packaged hybrid smoke passed native
search, provider-failure fallback, and stale-session scenarios; isolated real-app SQLite identity,
schema manifest, integrity, and foreign-key checks passed; arm64 native artifacts and the packaged
Agent worker were verified; and `git diff --check` passed. The installed Biome binary and documented
npm/direct runner equivalents were used because the local pnpm wrapper could not verify its registry
signature offline. Checkpoint 24 remains unstarted and requires separate approval.

### Maintenance: Section Body Title Deduplication (2026-07-22)

- [x] Tell the Agent that section titles are outline metadata rendered separately from BlockNote
  body content, so section proposals must not repeat or restate the target section title as the
  opening body heading; add focused prompt regression coverage.

Acceptance criteria: the bounded Agent system prompt explicitly distinguishes section metadata
from body content, preserves legitimate lower-level subheadings, and focused Agent context tests
plus formatting checks pass without changing proposal authority or renderer behavior.

Completion evidence: the bounded system prompt now tells the model to begin with body content,
never insert an opening heading that repeats or restates the target section title, and reserve
heading blocks for genuine lower-level subheadings. The canonical Electron-hosted Vitest suite
passed 96 files/448 tests; Biome checked 339 files with only the existing generated shadcn cookie
warning; and `git diff --check` passed. The `pnpm check` wrapper hung without output, so the
installed Biome binary was used and no `pnpm check` pass is claimed.

### Maintenance: Agent Run-State Reconciliation (2026-07-22)

- [x] Prevent stale renderer queries or fast terminal events from restoring a finished Agent run
  to `running`; make Stop idempotent after durable completion; reconcile stale steer/follow-up
  actions from authoritative run truth; and add focused regression verification.

Acceptance criteria: terminal run state never regresses to running; Stop does not surface a false
`Agent run is not active` failure; a stale action restores the idle composer; focused renderer and
Main tests, typechecks, formatting, and the relevant Electron workflow pass.

Completion evidence: terminal events immediately freeze renderer run truth, later stale snapshots
cannot regress it, fast completion cannot be overwritten by the `startRun` response, repeated Stop
is idempotent against a durable terminal run, and stale steer/follow-up failures refresh
authoritative truth. Local Biome checked 339 files with only the existing generated shadcn cookie
warning; Node/Renderer typechecks and production build passed; canonical Electron Vitest passed 96
files/448 tests; all 13 built-app Electron Playwright scenarios passed with explicit Stop/Idle/
Continue assertions; isolated app-database integrity/schema verification and `git diff --check`
passed. The focused in-sandbox Electron attempt was blocked by loopback `EPERM` and passed outside
the sandbox before the complete suite.

Checkpoints 1 through 19 remain historical functional evidence. The 2026-07-16 complexity-reduction audit is recorded in [the audit record](audits/2026-07-16-complexity-reduction-and-agent-boundary.md). Checkpoint 19.5 remediation is complete and its acceptance gate passed. A follow-up source-level implementation audit of Checkpoints 1–19 on 2026-07-16 confirmed the functional bodies match their records (Electron-hosted Vitest passed 65 files/292 tests at audit time) and fixed its findings into Checkpoints 19.6 (product-surface gaps) and 19.7 (rule violations and hardening) below; documentation overclaims found by the audit were corrected in place. Checkpoints 19.6 and 19.7 were the approved current work window and their final verification gate passed on 2026-07-17. The user approved Phase 9 implementation on 2026-07-21; Checkpoints 20 through 23 passed their acceptance gates after explicit continuation approvals, completing Phase 9. Checkpoint 24 and later checkpoints remain gated. MinerU research must use only the official MinerU API documentation at https://mineru.net/apiManage/docs, never Context7.

The functional completion records for CP1–19 remain useful historical evidence. Where they describe encrypted signed URLs, broad durable queues, the original Agent tool/table set, 650 ms autosave, an 8D performance benchmark, `chokidar`, or the old worker/module layout, those statements are superseded by the CP19.5 audit and must not be extended.

### Maintenance: Silent Electron E2E Window (2026-07-22)

- [x] Add a Main-owned silent E2E window presentation that keeps the real Electron renderer and protocol active without showing or focusing the application window; default the Playwright fixture and packaged hybrid smoke to this mode, retain an explicit visible debugging command, and verify the hidden/background-throttling invariants.

Acceptance criteria: normal launches remain interactive; silent E2E does not show or focus a BrowserWindow, does not throttle its renderer, does not activate the macOS Dock application, preserves existing dialog seams and test coverage, and the formatter, typechecks, Electron-hosted Vitest, E2E, packaged smoke, and diff checks pass.

### Maintenance: Outline Row Hover Actions (2026-07-22)

- [x] Let each Outline section button use the full available row width by replacing its trailing
  word count with add/delete actions only while the row is hovered or keyboard-focused.

Acceptance criteria: hidden actions reserve no layout width; the active/hover row surface reaches
the Sidebar boundary; word count remains visible at rest; actions replace it on hover/focus; long
titles remain contained; focused renderer checks and the Writing Workspace Electron scenario pass.

### Post-completion correction: stale section-proposal refresh (2026-07-22)

- [x] Preserve stale section proposals as immutable review history, distinguish non-conflicting
  refresh from overlapping conflict, require a second approval for every refreshed diff, protect
  pending bases from body pruning, and keep Brief/Outline version handling unchanged.

Acceptance criteria: unrelated block edits and non-overlapping fields can be refreshed and applied;
overlapping or structurally unsafe edits terminate as explicit conflicts; already-present field
updates create no revision; replacement chains remain linear and auditable; Renderer, migration,
service, IPC, retention, and Electron workflow coverage pass without starting Checkpoint 24.

### Post-Phase-9 checkpoint: Agent context and approval policy (2026-07-22)

- [x] Replace the fixed Agent context window with bounded models.dev/manual metadata, expose actual
  prompt-context utilization, and add `manual`, `section_auto`, and `yolo` proposal approval modes.
  Brief and Outline proposals must hold the tool response in every non-YOLO run until the user
  decides; automatic decisions must pass through the same revision checks and immutable lineage as
  manual decisions. Checkpoint 24 remains unstarted.

Acceptance criteria: application and session approval preferences are durable and run-snapshotted;
the complete approval matrix is covered; no post-Brief/Outline provider call starts before a manual
decision; models.dev is an optional bounded background-worker metadata source with offline/manual
fallback; Main and the Agent worker use one limits snapshot; the renderer shows latest prompt
context against that snapshot; project migration, IPC, cancellation, conflict, renderer, E2E,
packaged-worker, database-integrity, and repository gates pass.

Completion evidence: migration 0020 and the bounded models.dev background-worker path are covered;
the full approval matrix and provider-call blocking assertions pass; Biome checked 339 files with
only the existing generated shadcn cookie warning; Node/Renderer typechecks and production build
passed; canonical Electron-hosted Vitest passed 96 files/447 tests; all 13 built-app Electron
Playwright scenarios passed; the signed macOS arm64 unpacked build and packaged hybrid smoke passed
native search, provider-failure fallback, and stale-session scenarios; isolated app-database
schema/integrity checks and `git diff --check` passed. The documented direct test runner and npm
build equivalent were used because the local pnpm wrapper did not start reliably in this
environment.

### Checkpoint 19.5: Complexity Reduction And Agent Boundary Freeze

- [x] 19.5.1 Create the lean current-plan/ADR/history document entry points and mark superseded plan sections; update `AGENTS.md` reading rules without deleting historical evidence.
- [x] 19.5.2 Remove persisted MinerU signed/download URL capabilities; add migration/cleanup and snapshot absence checks. Migration, snapshot bytes, and stored-value scanning pass.
- [x] 19.5.3 Restrict durable jobs to MinerU parse, normalization, index/embedding build, item removal, rebuild, and artifact cleanup; keep interactive requests request-scoped and abortable. Production artifact-cleanup registration and reopen recovery pass, including strict paused-state schema evidence.
- [x] 19.5.4 Freeze the first Agent read/write tool set and reduce persistence to `agent_sessions`, `agent_runs`, `agent_events`, `mutation_proposals`, and `model_requests`.
- [x] 19.5.5 Add content-hash no-op detection, 1–2 second idle autosave, source classification, and background revision retention cleanup. Direct Agent-parent retention coverage passes.
- [x] 19.5.6 Rename/fix the three worker roles and verify stale-message handling without provider-specific workers or a generic RPC layer. Fixed-role persistent lifecycle passes.
- [x] 19.5.7 Reclassify the 8D vector test as correctness smoke and run representative 10k/50k/100k real-dimension benchmark coverage, including generation-build debounce evidence. The 1536D benchmark records one persisted rebuild request for ten sequential inputs. Note (2026-07-16 implementation audit): the 1536D benchmark measurements were not committed to the repository; `pnpm benchmark` reproduces them, and the benchmark corpus is a fixed-length English template rather than bilingual representative text.
- [x] 19.5.8 Remove unused `chokidar` and duplicate atomic-write implementations; merge only confirmed forwarding/empty modules.

Acceptance criteria: all eight audit items have source-level evidence, required migrations and cleanup are safe for existing projects, focused tests pass, structured lifecycle logs cover new boundaries, and no CP20 code starts before this gate is complete. The gate passed on 2026-07-16; CP20 remains not started.

### Checkpoint 19.6: Product Surface Completion (2026-07-16 CP1–19 Implementation Audit)

The source-level audit confirmed the CP1–19 functional bodies but found documented behaviors with no production implementation. This checkpoint wires them into the product; it does not change the frozen CP19.5 boundaries.

- [x] 19.6.1 Implement the six missing `recovery-required` exits as `ProjectManager` operations: `retry-open`, `retry-close`, `discard-incomplete-create`, `locate-moved-project`, `export-diagnostics`, and `return-to-closed` (`restore-from-backup` and stale-lock recovery already exist). Include state-machine tests for each exit.
- [x] 19.6.2 Expose the recovery exits through sender-authorized IPC and preload contracts, and replace the renderer's restart-only advice in the recovery-required state with a real recovery flow.
- [x] 19.6.3 Wire the project snapshot operation into production: a production `SnapshotBarrier` (pause mutations, authorize the final editor flush, pause file publishers) plus `ProjectManager` snapshot create/restore methods. The service in `src/main/project/project-snapshot.ts` is currently exercised only by tests.
- [x] 19.6.4 Expose snapshot create/restore through session-authorized IPC/preload and a Menubar entry, with Playwright E2E covering snapshot creation and restore-elsewhere open.
- [x] 19.6.5 Wire the shared AsyncLocalStorage correlation context into production paths (an IPC operation wrapper, job scheduler execution, and worker message dispatch) so `withLogContext` populates `operationId`/`jobId`/`requestId`; it is currently invoked only in tests. Explicit correlation fields remain at process boundaries.
- [x] 19.6.6 Extend centralized log aggregation to `background-worker` and `agent-worker` through the existing `port-logger`/`log-collector` MessagePort mechanism; only `index-worker` is wired today.

Acceptance criteria: all six recovery exits are reachable from the renderer and covered by tests; a user can create and restore a snapshot from the UI without touching the filesystem; production log records on IPC/job/worker paths carry ALS-populated correlation IDs; all three worker roles aggregate into the centralized log stream; focused tests and the final repository/runtime gates recorded below pass.

### Checkpoint 19.7: Rule Violations And Hardening (2026-07-16 CP1–19 Implementation Audit)

Code-level rule violations and improvements found by the audit. Each item is small and independently reviewable.

- [x] 19.7.1 Log the original per-file error in `KnowledgeImportService.startImportPaths` before continuing the batch (the catch at `knowledge-import-service.ts:104-106` currently swallows everything except `project_closing`), with a regression test proving a row-creation failure is logged and surfaced.
- [x] 19.7.2 Clamp renderer-supplied revision source classes per IPC channel in Main: manual save/import channels accept only their manual classes (`editor-persistence-service.ts:88` currently honors any of the four classes), and `agent_accepted` is minted only by the future agent application path. Include an adversarial contract test.
- [x] 19.7.3 Log export failures in the editor IPC export handlers (`editor-ipc.ts:104-133`) with the original top-level `err` before a sanitized error reaches the renderer, and prove no absolute path escapes in the renderer-facing error.
- [x] 19.7.4 Replace the scheme-only external-URL check (`src/shared/security/urls.ts`) with a validated host allowlist that drops plain `http:`, and strip the development allowances (`ws:`, `http://localhost:*`) from the production CSP in `src/renderer/index.html`.
- [x] 19.7.5 Enforce the outline depth cap (≤64) at `createSection`/`moveSection` write time instead of only at contract parse time, with tests.
- [x] 19.7.6 Carry and validate `projectSessionId` on `background-worker`/`agent-worker` request and response envelopes, matching the index-worker protocol; reject and log stale responses.
- [x] 19.7.7 Propagate project-close aborts into persistent workers' in-flight requests (a cancel message plus a worker-side `AbortController`) for embedding, rerank, agent, and probe operations.
- [x] 19.7.8 Decide and implement a retention policy for `import`-class revision bodies, which are currently never pruned, and document the chosen bound.
- [x] 19.7.9 Compact sub-24-hour manual checkpoints to one per hour per the amended retention rule (all sub-24h checkpoints are currently retained), and wire or remove the test-only `ProjectIndexService.requestItemUpsert` API.
- [x] 19.7.10 Backfill the test coverage promised by earlier remediation records: import progress/cancel/retry/delete/open/reveal E2E scenarios; a MinerU cancellation-race concurrency regression test; reverse-completion-order and concurrent-normalization tests; a terminal parse-failure test; direct `IndexClient` stale-session/unmatched-response termination tests; the parse/index activation-race test; and packaged provider-failure-fallback and stale-session scenarios.

Acceptance criteria: every item has source-level evidence and focused tests; no new durable job types, worker roles, or renderer capabilities are introduced; the local Biome check, both typechecks, Electron-hosted Vitest, production build, full E2E suite, and packaged smoke pass. The pnpm wrapper failure is recorded in the final verification entry rather than represented as a false pnpm pass.

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
| 9 | [phase-9.md](implementation-todo/phase-9.md) | Pi writing agent | 20–23 | Completed |
| 10 | [phase-10.md](implementation-todo/phase-10.md) | Export, packaging, and release confidence | 24–26 | Blocked at Checkpoint 26.9 (real hosted-runner evidence) |

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
- [ ] Client-side MinerU page-count enforcement; the capability registry's `maxPages` remains display/provider-enforced metadata until a local page-count check is justified.
- [ ] Model cost estimation; `estimated_cost_usd_micros` remains null until provider pricing data exists.

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
- 2026-07-16: Started Checkpoint 19.5 convergence. The lean current plan, ADR entry point, and implementation history now govern new work while the Phase files remain historical evidence.
- 2026-07-16: Completed Checkpoint 19.5 convergence. Migrations 0012/0013 remove persisted MinerU URL fields and add revision classes; the seven-job boundary is enforced at contracts, migrations, and database-open/snapshot validation; editor autosave uses 1.5s idle debounce with 20 retained autosave bodies and best-effort pruning; the three worker roles use `agent-worker`, `background-worker`, and `index-worker`; atomic file publication is centralized; and the 1536D benchmark passed at 10k, 50k, and 100k chunks. Checkpoint 20 remains deferred pending user approval.
- 2026-07-16: Implemented the parsed-document lifecycle hardening within CP19.5.3 scope: repeated starts remain idempotent through active normalization, the renderer distinguishes parsing from normalization, session-authorized parse cancellation aborts associated durable jobs and removes unpublished staging artifacts, and knowledge deletion removes the item's parsed artifact tree. The remaining durable-job and artifact-cleanup work was completed in the CP19.5 audit-remediation entry below.
- 2026-07-16: Reopened CP19.5 acceptance remediation after audit: artifact cleanup required a persisted request and production `artifact_cleanup` handler; Agent-parent retention, fixed-role persistent workers, strict paused-state schema, snapshot byte/value evidence, and ten-file generation-build debounce evidence were the remaining gate items. The following completion entry records that they passed; CP20 remains not started.
- 2026-07-16: Started the Knowledge workspace redesign within the existing knowledge/search UI scope. The renderer is moving from a modal Sheet to a full-screen workspace with a shared Manuscript/Knowledge rail, source/task sidebar, compact drag target, aggregate processing status, and inline parsed-document details; existing project-session IPC remains unchanged.
- 2026-07-16: Completed the Knowledge workspace redesign. The Sheet was replaced by a full-screen shadcn workspace with direct Manuscript/Knowledge switching, source/task sidebar, compact drag target that expands on drag, aggregate parse/embedding/queue/failure status, inline parsed content, reparse/cancel controls, Finder/open/delete actions, and updated E2E selectors. Web typecheck, focused Biome checks, and the Electron renderer build pass; Electron E2E and native SQLite Vitest remain environment-blocked by Electron SIGABRT and a better-sqlite3 Node ABI mismatch.
- 2026-07-16: Started a user-requested Knowledge workspace layout refinement within the existing CP19 knowledge/search surface. Scope is limited to replacing card-heavy summary, detail, search, and parsed-block presentation with a flatter source-reader hierarchy; behavior, IPC, and checkpoint boundaries remain unchanged.
- 2026-07-16: Completed the Knowledge workspace layout refinement. Aggregate metrics are now one compact status strip; source details, parsed blocks, empty state, search controls, and search results use a flat reader/list hierarchy with semantic sections and separators instead of general-purpose Cards. Existing behavior and IPC are unchanged, the duplicated file-name E2E selector is now scoped to the document heading, focused Biome and web TypeScript checks pass, and the production Electron build passes. The focused Electron E2E reached the redesigned workspace on its first run, then exposed the corrected duplicate selector; subsequent full reruns stopped earlier on unrelated existing fixture flakes in project-name entry and provider credential persistence.
- 2026-07-16: Started the user-requested Knowledge overview/detail state correction. Entering Knowledge must show an unselected, vertically and horizontally centered statistics overview; selecting a source alone opens its document, and an accessible close action returns to the overview without changing source data or background work.
- 2026-07-16: Completed the Knowledge overview/detail state correction. Knowledge now enters with no selected source and centers the title, upload action, and aggregate status in the available workspace; search remains below that first-screen overview. A source opens only after an explicit sidebar click, and the document header has an accessible X action that clears selection and returns to the intact overview. Focused Biome and web TypeScript checks, the production Electron build, `git diff --check`, and the complete parsed-knowledge Electron E2E pass, including import-without-auto-open, explicit selection, close-to-overview, parsing, search, citation, recovery, and rebuild coverage.
- 2026-07-16: Fixed KaTeX rendering inside parsed Markdown tables. Raw HTML table text is converted to the same `math-inline`/`math-display` AST contract used by `remark-math` before `rehype-katex`, rather than rendering KaTeX to raw HTML and reparsing it in table context. Focused GFM/raw-HTML table regression tests pass, along with the repository Biome check, Node/web TypeScript checks, production Electron build, and `git diff --check`; Biome retains the pre-existing generated shadcn sidebar cookie warning.
- 2026-07-16: Completed a source-level implementation audit of Checkpoints 1–19 against the amended architecture, using eight read-only audit slices with line-level evidence. The functional bodies match their records and the Electron-hosted Vitest suite passed 65 files/292 tests at audit time. Findings are fixed into Checkpoint 19.6 (product-surface gaps: six missing recovery exits and no recovery IPC, snapshot operation without a production entry point, ALS correlation unused in production, background/agent worker log aggregation unwired) and Checkpoint 19.7 (rule violations and hardening). Neither checkpoint has started; implementation requires the user's approval, and Checkpoint 20 remains deferred behind them.
- 2026-07-16: Corrected documentation overclaims found by the audit in place: the architecture resource-queue list now matches the code (`mineru:1, embedding:3, index:1, local-io:2`; no rerank queue) and the manifest table is `schema_manifest`; Phase 2 notes the packaged migration smoke left no durable script; Phase 6 records the actual import E2E coverage and marks "short-lived utility process" wording superseded by the persistent three-role workers; Phase 7 and Phase 8 remediation records now distinguish implemented guards from the still-missing promised tests, which moved to 19.7.10.
- 2026-07-16: User approved implementation of Checkpoints 19.6 and 19.7; the window is now in progress.
- 2026-07-16: An initial completion note for Checkpoints 19.6 and 19.7 was withdrawn after audit found that the recorded gate claims were not true on the then-current tree; the final implementation and verification record is dated 2026-07-17 below.
- 2026-07-16: Applied two audit small fixes directly. Recent-project pointers are now physically pruned to the newest five on upsert (`RECENT_PROJECT_LIMIT`, previously a read-side slice only), with a new repository test. The three superseded one-shot worker entry files `src/workers/mineru.ts`, `src/workers/auxiliary-model.ts`, and `src/workers/provider-probe.ts` were removed; the built worker entries remain exactly `agent-worker`, `background-worker`, `index-worker`, and the env-gated logging fixture.
- 2026-07-16: Started a user-requested application theme preference feature. Scope is limited to persisted `system`/`light`/`dark` selection in the existing Settings command surface, shared application/BlockNote theme resolution, and renderer/main IPC coverage; project data and the deferred Agent checkpoints remain unchanged.
- 2026-07-16: At that intermediate theme-feature state, the focused Electron tests and build passed while the full suite still had nine unrelated failures in index-worker/IPC fixtures and revision/provider assertions; this intermediate result is superseded by the 2026-07-17 final gate below.
- 2026-07-17: Started a user-requested writing workspace immersion refinement within the existing Checkpoint 11 surface. Scope is limited to removing the central summary/card and metadata/tool controls, moving manuscript statistics to the sidebar footer, and keeping brief/preview, outline mutation, and interchange behavior outside the正文 editor area.
- 2026-07-17: Completed the writing workspace immersion refinement. The central workspace now presents one editable section title followed directly by a full-width BlockNote editor; Objective/status fields, central outline-position controls, central import/export controls, project/brief summary, and duplicate top actions are removed. Statistics are fixed at the secondary sidebar bottom, while title CAS saves and sidebar outline drag/reorder remain intact. The focused in-sandbox run was blocked by the then-current environment's Electron SIGABRT and a renderer diagnostic; both are superseded by the final external E2E and typecheck gate below.
- 2026-07-17: Started the user-requested Outline edit panel within the existing Checkpoint 11 writing workspace. The panel owns section hierarchy controls, Markdown/native interchange, and whole-manuscript preview; its entry remains in the left manuscript sidebar and the正文 editor stays tool-free.
- 2026-07-17: Completed the Outline edit panel. Added the left-sidebar `Edit outline` entry and accessible Sheet panel, moved Up/Down/Indent/Outdent and Markdown/native import/export plus Preview all into that panel, retained sidebar drag/reorder, and exposed the existing editor IPC through a narrow imperative handle. The focused in-sandbox run was blocked before assertions by Electron SIGABRT and a renderer diagnostic; this intermediate result is superseded by the final external E2E and typecheck gate below.
- 2026-07-17: Started the user-requested BlockNote alignment refinement. Scope is limited to the active writing editor's default side-menu gutter and responsive title alignment; no editor content or persistence behavior changes.
- 2026-07-17: Completed the BlockNote alignment refinement. Desktop body text now shares the title's left edge while the floating add/drag controls sit outside the writing column; narrow layouts restore BlockNote's safe gutter and apply the same inset to the title. The in-sandbox E2E launch limitation is superseded by the final external 11/11 E2E gate below.
- 2026-07-17: Completed and verified the approved 19.6/19.7 window. The C2 backfill now covers the import progress/cancel/retry/delete/open/reveal flow, MinerU cancellation races, normalization completion ordering, terminal parse failure, direct IndexClient stale/unmatched responses, parse/index activation races, and packaged provider-failure/stale-session scenarios. The shared E2E project assertion follows the current sidebar project name plus `Active` badge, including `project-lifecycle.spec.ts`. A post-build current-source recheck prevents an index generation from activating after its parse revision is superseded. Local Biome and Node/web TypeScript checks pass; Electron-hosted Vitest passes 70 files/322 tests; production `electron-vite build` passes; the full Electron Playwright suite passes 11/11; unpacked packaging and hybrid packaged smoke pass; runtime app.sqlite reports application_id 1464615248, user_version 1, and a valid schema_manifest. Corepack/pnpm could not start because its pnpm 11 registry signature could not be verified; equivalent local commands were used and no pnpm pass is claimed.
- 2026-07-19: Started a user-requested Knowledge embedding refresh surface within the completed Checkpoints 18/19 boundary. Scope is limited to session-authorized durable re-embedding for one already-normalized knowledge source or all normalized sources, cache bypass for the selected scope, atomic replacement through a fresh embedding generation, Knowledge workspace controls/status feedback, and focused contract/IPC/index/UI verification; no new durable job type or provider boundary is introduced.
- 2026-07-19: Completed the Knowledge embedding refresh surface. The Knowledge workspace exposes source-scoped and all-source embedding refresh actions, both disabled while an embedding generation is queued/running. Main validates the active project session, parsed-source scope, provider contract, current index generation, and concurrent work before extending the existing durable `build_embedding_generation` payload. The Index worker clears only the selected current-generation cache entries, builds a fresh immutable full vector generation (reusing unaffected cached vectors), and atomically activates it while the prior vectors remain queryable; superseded item requests end safely. Strict job/IPC/worker contracts, cache-scope database coverage, durable-generation service tests, IPC tests, and UI E2E selectors were added. `pnpm check`, Node/web TypeScript, Electron-hosted Vitest (70 files/326 tests), the production build, focused parsed-knowledge Electron E2E (2/2), and `git diff --check` pass.
- 2026-07-19: Started the user-requested Knowledge action-hierarchy refinement. Scope is limited to replacing the meaningless Knowledge header lifecycle badge with a bulk-actions menu, moving bulk MinerU reprocessing and embedding refresh into that menu, and consolidating per-source state badges and maintenance actions into the existing source actions menu; no job, IPC, or persistence boundary changes are introduced.
- 2026-07-19: Completed the Knowledge action-hierarchy refinement. The Knowledge header's lifecycle badge is replaced by a three-dot bulk-actions menu containing all-source MinerU reprocessing and embedding recalculation; the overview again presents upload as its only primary action. Source details no longer show `stored`/`Parsed` badges or standalone maintenance buttons, and their MinerU/embedding actions live in the existing source menu alongside open, reveal, and delete. Active parsing, normalization, and embedding work disables conflicting menu actions. Local Biome passes with the existing shadcn `document.cookie` warning; Node/web TypeScript and the production build pass; the canonical Electron-hosted suite passes 70 files/326 tests; the full built-app Electron E2E suite passes 11/11; isolated runtime verification reports application_id 1464615248, user_version 1, and schema version 1. The `pnpm` wrapper could not start because its pnpm 11 registry signature could not be verified, so the documented local binary/npm equivalents were used.
- 2026-07-19: Started the user-requested Knowledge overview-to-search refinement. Scope is limited to replacing the historical embedding-job counter with truthful normalized-block and current-index status, exposing that status through a sender- and session-authorized bounded IPC result, moving five compact metrics (`Files`, `Parsed`, `Blocks`, `Indexed`, `Queue`) into the Knowledge header, and making search the overview's primary content; no index mutation, durable job, or persistence boundary changes are introduced.
- 2026-07-19: Completed the Knowledge overview-to-search refinement. The overview hero and large metric strip are removed; project-wide search is now the primary Knowledge content. The header shows compact `Files`, `Parsed`, normalized `Blocks`, authoritative `Indexed`, and active `Queue` values immediately left of the bulk-actions menu. `Indexed` is derived by comparing the Index worker's active generation with the generation required by the current published parse revisions through a strict sender- and session-authorized IPC result; it is no longer inferred from historical embedding jobs. Local Biome passes with the existing shadcn `document.cookie` warning; Node/web TypeScript and the production build pass; the canonical Electron-hosted suite passes 70 files/327 tests; the focused Knowledge Electron E2E passes 1/1 and the full built-app suite passes 11/11; isolated runtime verification reports application_id 1464615248, user_version 1, and schema version 1. The unavailable `pnpm` wrapper was bypassed with the documented local binary/npm equivalents.
- 2026-07-19: Started the user-requested Knowledge PDF block–chunk Mapping surface. Scope is limited to PDF-only single-page PDF.js rendering, session-authorized streamed original-PDF preview, MinerU bbox overlays, block/chunk coverage inspection, active embedding metadata plus a 16-dimension preview, and focused mapping contracts/IPC/index/UI verification. No raw MinerU JSON, absolute paths, full vectors, new durable jobs, or CP20 Agent work is introduced.
- 2026-07-19: Completed the Knowledge PDF block–chunk Mapping surface. Added the pinned bundled PDF.js worker, session-revocable streamed PDF capability with GET/HEAD/single-Range enforcement, active-generation Index inspection and vector norm/16-dimension preview, verified MinerU page geometry adapter, strict Mapping contracts and IPC, PDF-only Content/Markdown/Mapping UI with bbox overlays, character-coverage approximation, overlap hatching, bidirectional block/chunk selection, and Content block usage links. No raw MinerU JSON, absolute paths, full vectors, new durable jobs, or CP20 Agent work was introduced. Node/web TypeScript passes, the Electron-hosted Vitest suite passes 72 files/332 tests, the parsed-knowledge Playwright E2E passes 2/2, production build includes the worker, packaged hybrid smoke passes, Biome passes with the existing shadcn sidebar cookie warning, and `git diff --check` passes.
- 2026-07-19: Fixed PDF.js Mapping in the Vite development renderer by enabling CORS on the privileged `writellm` scheme; the preview response still restricts `Access-Control-Allow-Origin` to the configured development renderer origin. The parsed-knowledge E2E now uses a valid minimal PDF and verifies capability fetch plus a rendered Mapping canvas.
- 2026-07-19: Started a user-requested persisted-index reopen fix within the completed Checkpoints 17/18 boundary. Scope is limited to correcting logical source fingerprint verification, preserving a valid active index and embedding generation across application restarts, and adding a multi-source close/reopen regression test; no schema, job, provider, or CP20 boundary changes are introduced.
- 2026-07-19: Completed the persisted-index reopen fix. Logical source verification now includes the active generation's stored chunker version, and logical chunk verification replays the same knowledge-item/ordinal ordering used by deterministic multi-source builds. A real sqlite-vec regression closes and reopens a two-source database and proves that the active index generation, active embedding contract, cached vectors, and vector queries survive. The focused IndexDatabase suite passes 8/8; the canonical Electron-hosted suite passes 72 files/332 tests; Node/web TypeScript and the production build pass; the full built-app Electron E2E suite passes 11/11; isolated runtime app.sqlite verification reports application_id 1464615248, user_version 1, and schema version 1; targeted Biome and `git diff --check` pass. The `pnpm` wrapper could not start because its pnpm 11 registry signature could not be verified, and the full local Biome check remains non-green only for pre-existing uncommitted formatting/unused-code findings in `e2e/parsed-knowledge.spec.ts` plus the existing generated shadcn cookie warning; those unrelated edits were left untouched.
- 2026-07-19: Started a Knowledge Mapping provenance compatibility fix after a MinerU VLM archive used a provider-prefixed `_content_list.json` filename. Scope is limited to recognizing the official prefixed artifact, recovering verified page/bbox provenance for already-normalized revisions without rebuilding their index or embeddings, and adding regression coverage across the normalizer, index worker contract, and Mapping service.
- 2026-07-20: Completed the Knowledge Mapping provenance and coordinate-space compatibility fix. Provider-prefixed `*_content_list.json` artifacts now drive future normalization; existing Markdown-fallback blocks recover page/bbox provenance only through unique normalized-text or content-addressed asset evidence, and the Index worker can select their null-page chunks by recovered block ordinal without rebuilding the active index or embedding generation. VLM content-list bboxes now use their validated top-left `1000 × 1000` coordinate space instead of the PDF-point `layout.json` dimensions. On the reported `001 - Attention Is All You Need.pdf`, all 17 page-one regions and 178 regions across 15 pages align with the layout reference at a maximum 0.784 PDF-point coordinate error. Targeted Biome and 14 focused tests pass; Node/web TypeScript, the production build, the canonical Electron-hosted suite (73 files/336 tests), the full built-app Electron E2E suite (11/11), isolated runtime app.sqlite verification, full Biome with only the existing generated shadcn cookie warning, and `git diff --check` pass. The `pnpm` wrapper could not verify its registry signature, so the documented local binary/npm equivalents were used.
- 2026-07-20: Started a user-requested project-opening loading indicator within the existing project lifecycle UI. Scope is limited to a prominent indeterminate spinner for manual open, recent-project open, switch, and the existing `opening` lifecycle state because project open exposes no truthful completed/total progress contract; no IPC, persistence, or lifecycle boundary changes are introduced.
- 2026-07-20: Completed the project-opening loading indicator. Manual folder opens, recent-project opens, project switches, and an observed `opening` lifecycle state now show one prominent accessible indeterminate spinner while keeping the global Menubar visible. Switches retain the old writing workspace inert beneath the overlay so the close-scoped final editor flush can complete before the new project opens. The spinner has focused static-render coverage and does not expose fake progress semantics. Local Biome passes with the existing generated shadcn cookie warning; Node/web TypeScript, the production build, the canonical Electron-hosted suite (74 files/337 tests), and the full built-app Electron E2E suite (11/11) pass. The `pnpm` wrapper remains unavailable because its registry signature could not be verified, so the documented local binary/npm equivalents were used.
- 2026-07-20: Started a user-requested Knowledge retrieval correctness fix within the completed Checkpoints 18/19 boundary. Scope is limited to Han-character short-query substring fallback, sqlite-vec queries beyond the 4096 `k` limit while preserving pre-Top-K filters, and an explicit no-candidate rerank status; no persisted schema, embedding generation, provider boundary, durable job, or CP20 work is introduced.
- 2026-07-20: Completed the Knowledge retrieval correctness fix. One- and two-Han-character queries now use a filtered deterministic substring fallback; unfiltered vector queries use bounded vec0 KNN and filtered queries use exact metric-aware distance ordering without the 4096 `k` overflow; zero-candidate searches report `skipped-no-candidates` while configured rerank behavior remains unchanged for real candidates. Regression coverage includes middle-of-token Chinese matches, all search filters, cosine/L2 vectors, an active generation above 4096 chunks, configured rerank skipping, and Knowledge E2E empty-result status. Node/web TypeScript, the canonical Electron-hosted suite (74 files/339 tests), production build, full Biome check with only the existing shadcn cookie warning, full Electron E2E (11/11), packaged hybrid smoke, isolated runtime app.sqlite verification, and `git diff --check` pass. The `pnpm` wrapper was bypassed with the equivalent npm/local commands because its registry signature could not be verified.
- 2026-07-20: Fixed image-caption provenance and chunk grouping within the existing Knowledge Mapping boundary. Nested image captions remain independent normalized blocks without inheriting the image bbox; legacy inherited caption geometry is suppressed in Mapping, direct caption provenance is not guessed from the parent image, and the Mapping sidebar labels extracted-but-unlocated captions explicitly. Consecutive related captions now remain with their image in one deterministic chunk while unrelated following text starts a new group. Regression coverage includes multiple nested captions, legacy provenance, separate caption regions, and provider-only caption association. Node/web TypeScript, the canonical Electron-hosted suite (75 files/342 tests), and targeted Biome checks pass; no new durable job, schema, worker, or renderer capability was introduced.
- 2026-07-20: Realigned the Phase 9 (Checkpoints 20–23) plan with the CP19.5 freeze and the verified codebase state before implementation. `docs/implementation-todo/phase-9.md` now replaces the superseded pre-freeze items (nine read tools, six write tools, `agent_messages`/`agent_tool_calls`, durable turns, persistent compaction subsystem) with the frozen surface (four read tools, three proposal tools, `agent_sessions`/`agent_runs`/`agent_events`/`mutation_proposals`, request-scoped turns, bounded summaries as ordinary events) and records design decisions: low-level Pi `Agent` over `AgentHarness`, the existing app-level lazy agent-worker, a dedicated tool-bridge MessagePort, dual TypeBox/Zod schemas, envelope-scoped credentials with Main-owned `model_requests`, event-sourced session rebuild with version compatibility rules, a Main-owned application path minting `agent_accepted` revisions, and undo as a new revision. Architecture overclaims were corrected in place (`AgentModelRuntime.createSession` did not exist; the actual single-shot `run` interface is now documented, and the runtime role is named `agent-worker`). Checkpoint 20 remains unstarted pending user approval.
- 2026-07-21: Ran the final pre-Checkpoint-20 documentation check of `docs/architecture.md` and `docs/implementation-todo/phase-9.md` against the verified source and the installed Pi 0.80.7 packages. All phase-9 codebase-starting-point claims and decisions D1–D9 re-verified (worker wiring, migration `0009` `agent_run_id` hook, next migration `0016`, CP19.7.2 agent-source clamp, renderer-only selection context, diagnostics push pattern, exact 0.80.7 pins, D1 `Agent` API surface, harness-only JSONL storage). One infeasible plan item was corrected: pi-ai 0.80.7 through 0.80.10 expose no retry-count hook (`onResponse` fires once after OpenAI-SDK-internal retries; no fetch injection point), so 20.3 now specifies per-call attempt counting scoped inside the custom `streamFn` wrapper instead of "Pi hook-reported retry metadata", with the 20.1 changelog review re-checking newer releases. `architecture.md` now lists `compaction_summary` among the ordered Agent event types to match 20.2, and phase-9 records the exact diagnostics-channel path plus the verified `gateways.ts`/`model-runtime.ts` boundary facts (`stopReason` already admits `'toolUse'`). No code changed; Checkpoint 20 remains unstarted pending user approval.
- 2026-07-21: Extended the documentation audit to the whole Phase 9 plan (Checkpoints 20–23 and D1–D9) ahead of full-phase implementation. Verified against source and the Pi 0.80.7 type surface: `RetrievalService.search`/`expand` back 21.3's tools; the logging-port transfer precedent makes the 21.2 dedicated tool-bridge MessagePort feasible; `beforeToolCall` returns `{ block, reason }` and `toolExecution: 'sequential'` is already in use (22.2); brief/outline domain operations with version conflicts already exist in `ManuscriptService` (22.1); the `section_revisions` 0006 CHECK constraint enforces agent lineage (D8/22.6); the placeholder agent `Sheet` with ⌘/Ctrl+J exists in `writing-workspace.tsx` (23.1); the loopback mock-provider E2E pattern exists (23.7). Corrections landed in `docs/implementation-todo/phase-9.md`: 21.1's stale "D9 of architecture" cross-reference now points to architecture.md "Initial read tools" and records that the `ContextBuilder` is real logic inside the Main agent module area, not the superseded standalone wrapper from the CP19.5 audit's module rule; D4 records that Pi 0.80.7 tools take `typebox` v1 schemas and CP21 must add an exact direct `typebox` pin (today only transitive 1.1.38); 22.1 no longer claims "existing typed BlockNote operations" — the architecture.md "Block mutations" operation set has no code contracts yet and is created in that checkpoint, while brief/outline operations already exist; 20.2 notes that `compaction_summary` extends the freeze audit's six event types under that audit's own summary-as-ordinary-event rule. No code changed; Phase 9 remains unstarted pending user approval.
- 2026-07-21: Started Checkpoint 20 under the user's approval to implement Phase 9. Scope is limited to the durable Agent session/run/event/proposal schema, request-scoped sessionful `agent-worker` runtime without tools, Main-owned run lifecycle and model-request linkage, steering/follow-up queues, structured logging, and Checkpoint 20 verification. Checkpoints 21–23 remain gated on the Checkpoint 20 acceptance criteria.
- 2026-07-21: Completed and verified Checkpoint 20. Exact Pi 0.80.10 pins and the current `Agent` API were characterized; migration 0016 adds strict project-local Agent session/run/event/proposal storage; the request-scoped tool-free worker now has a capability-bound session protocol, sequential persist-before-publish events, per-call retry/usage reporting, steering/follow-up, and cancellation; Main owns history rebuild, compatibility checks, interruption recovery, and one linked `model_requests` row per Pi call. `pnpm check` passed 281 files with only the existing generated shadcn cookie warning; Node/web typecheck passed; canonical Electron Vitest passed 78 files/353 tests; production build and signed macOS arm64 unpacked packaging passed; Electron Playwright passed 11/11; packaged hybrid smoke and `git diff --check` passed. Checkpoint 21 remains unstarted pending the required continuation approval.
- 2026-07-21: Completed a read-only Checkpoint 21 preimplementation audit without starting 21.x product code. Confirmed the authoritative manuscript/retrieval APIs, Pi 0.80.10 `AgentTool`/`beforeToolCall`/parallel semantics, TypeBox 1.1.38 transitive version, and Electron 43 transferable `MessagePortMain`. Corrected the plan to require Agent-specific Zod contracts, an exact direct TypeBox pin, revision-bound section pagination, and an on-demand run-protocol handshake that persists and links a new `model_requests` row before Pi's automatic post-tool provider call. Checkpoint 21 remains fully unchecked pending user approval.
- 2026-07-21: Started Checkpoint 21 after the user's explicit continuation approval. Scope is limited to the bounded Main `ContextBuilder`, a dedicated capability-bound Agent tool bridge, the exact TypeBox pin and four frozen read tools, revision-bound pagination, untrusted-content delimiting, provenance persistence, automatic post-tool model-call authorization, and the 21.7 adversarial/acceptance gate. Mutation proposals, approval/application, Agent IPC/UI, and compaction remain Checkpoints 22–23.
- 2026-07-21: Completed and verified Checkpoint 21. Main now assembles bounded brief/outline/editor context and explicit user-request input; Pi history is bounded per provider call and fails closed on an oversized current turn. A dedicated transferable port carries only strict run/tool/model capabilities and the four frozen read tools backed by exact TypeBox 1.1.38 plus Main-authoritative Zod contracts. Section reads use revision-bound opaque pagination; retrieval is bounded and delimited as untrusted source data; tool/citation provenance is durable before results return; and every automatic post-tool model call waits for a newly persisted linked `model_requests` row. Adversarial coverage includes injection, unknown/malformed/oversized calls and results, stale cursors and project capabilities, reverse parallel completion, deleted sources, revoked ports, reopened history, and a real Pi tool loop. Local Biome passed 288 files with only the existing shadcn cookie warning; Node/web TypeScript passed; canonical Electron Vitest passed 81 files/370 tests; production build, signed macOS arm64 unpack, 11/11 Electron E2E, packaged hybrid smoke, packaged Agent-worker inspection, isolated real-app database verification (application ID 1464615248, user/schema version 1, integrity and foreign keys valid), and `git diff --check` passed. The `pnpm` executable hung before command startup, so documented npm/direct-runner equivalents were used and no `pnpm` pass is claimed. Checkpoint 22 remains unstarted pending explicit approval.
- 2026-07-21: Completed a read-only Checkpoint 22 preimplementation audit without starting 22.x product code. The existing BlockNote schema, editor flush, materialization, brief/outline CAS, tool bridge, and renderer-push precedent support the planned implementation. The audit found one required decision: migration `0016` incorrectly requires a section `applied_revision_id` for applied brief/outline proposals and cannot link the D9 undo revision, while the CP22 acceptance wording ambiguously extends revision-based section undo to every proposal kind. The recommended resolution is a forward-only `0017` rebuild with kind-specific result columns and `undo_revision_id`, keeping undo scoped to `section_patch` and preserving the frozen table set; full outline-delete undo would require a broader reversible-outline/soft-delete architecture. Checkpoint 22 remains fully unchecked pending explicit continuation and schema-semantics approval.
- 2026-07-21: Started Checkpoint 22 after the user's explicit continuation and recommended schema-semantics approval. Scope is limited to migration `0017`, versioned brief/outline/section proposal contracts, the pure BlockNote simulator and previews, sequential proposal tools, durable proposal-before-success ordering, session-authorized approve/reject, atomic stale-safe Main application with lineage and renderer notification, and D9 section-revision undo. Agent UI, compaction, full workflow E2E, and reversible brief/outline undo remain outside this checkpoint.
- 2026-07-21: Completed and verified Checkpoint 22. Migration `0017` preserves the frozen table set while enforcing kind-specific base/result columns and a linked section undo revision. The Agent now has three exact sequential proposal tools in addition to the four read tools; Main validates citations against prior same-run reads, simulates bounded native BlockNote operations, persists a structured preview before success, authorizes approve/reject with the active project capability, applies every proposal atomically with stale-base revalidation, records brief/outline result versions or an `agent_accepted` revision with full lineage, materializes and pushes authoritative section changes, and implements section-only revision undo. Adversarial coverage includes stale/manual races, missing/duplicate/deep blocks, partial-operation failure, stale project approval, rejection, crash/restart before apply, successful/stale undo, schema constraints, renderer source clamping, and flush-before-approve ordering. Biome passed 300 files with only the existing shadcn cookie warning; Node/web typecheck passed; canonical Electron Vitest passed 86 files/388 tests; production build, signed macOS arm64 unpack and strict signature inspection, 11/11 Electron E2E, packaged hybrid/native/asar inspection, isolated real-app database integrity verification, and `git diff --check` passed. Checkpoint 23 remains unstarted pending explicit continuation approval.
- 2026-07-21: Completed a read-only Checkpoint 23 preimplementation audit without starting 23.x product code. Confirmed that editor selection state and the CP20–22 service foundations are reusable, but production has no Agent session/run/event IPC, no live-delta publisher, no cursor-based replay, no session proposal-state query, no compaction implementation, and only a placeholder Agent panel. Recorded the recommended semantics: generic activity without chain-of-thought; a session-revocable lease-before-replay event broker with sequence de-duplication; current proposal-state overlay from `mutation_proposals`; retry/continue as visible new immutable runs; and one bounded raw-event summary only when whole-turn truncation would otherwise be required, recorded through `ModelExecutionService` and consumed by a non-throwing token-budgeted transform. Existing loopback mock-server fixtures can cover the full MinerU/index/Agent/proposal/reopen/undo E2E without a new dependency. Checkpoint 23 remained fully unchecked pending explicit continuation approval.
- 2026-07-21: Started Checkpoint 23 after the user's explicit continuation and recommended-semantics approval. Scope is limited to the real shadcn Agent writing panel, session-authorized replayable Agent event IPC with ephemeral deltas and durable truth, authoritative proposal-state queries and actions, visible immutable retry/continue runs, selection/section/project context starts, one bounded ModelExecutionService-recorded compaction summary plus non-throwing token-budgeted context transformation, and the complete loopback mock-provider assisted-writing E2E. Provider reasoning controls, chain-of-thought display, extra Agent tools/tables, multi-level compaction, and Checkpoint 24 remain out of scope.
- 2026-07-21: Completed and verified Checkpoint 23 and Phase 9. The shadcn Agent panel now exposes durable sessions, replay/live streaming, generic activity, provider/model/usage/retry state, stop/retry/continue/steer/follow-up, all three editor-context scopes, structured tool/citation/proposal cards, and authoritative approve/reject/undo state. Main owns cursor-based session-authorized replay with lease-before-query ordering, queued live delivery, sequence de-duplication, project revocation, and renderer-delivery isolation. Token handling is deterministic, CJK-aware, non-throwing, whole-turn bounded, and permits at most one raw-event, ModelExecutionService-recorded compaction summary while retaining full history. The new loopback E2E covers brief/outline/section writing, MinerU/indexing, real Pi search and proposal calls, citations, preview, approval, full Agent revision lineage, editor reload, panel/project reopen, undo, cancellation, and interrupted-state replay. Biome passed 312 files with only the existing shadcn cookie warning; Node/web typecheck passed; canonical Electron Vitest passed 91 files/402 tests; production build, signed macOS arm64 unpack, strict signature and packaged asar/native inspection, 12/12 Electron E2E, packaged hybrid smoke, isolated real-app database integrity verification, and `git diff --check` passed. Checkpoint 24 remains unstarted pending explicit approval.
- 2026-07-21: Corrected two Checkpoint 23 defects found in a real DeepSeek V4 Flash session. Runtime evidence showed an approved Brief proposal was durably applied while the renderer retained a stale manuscript-workspace query, and outline proposal calls failed with `stale_base` because the Agent context omitted the authoritative `outlineVersion`. The writing context and tool guidance now expose/use current Brief/Outline versions; stale proposal bases become retryable `conflict` results with one refresh-and-retry instruction; and successful approve/undo actions invalidate the manuscript workspace so Brief and Outline changes appear immediately. Added unit coverage for the context version and conflict mapping, and expanded the real Electron Agent E2E to assert provider context plus approved Brief/Outline UI refresh. Verification passed Biome on 312 files with only the existing generated shadcn warning, Node/web typecheck, canonical Electron Vitest (91 files/403 tests), production build, all 12 Electron Playwright scenarios, and `git diff --check`. Phase 9 remains complete; Checkpoint 24 remains unstarted.
- 2026-07-21: Started a user-requested Agent writing-panel presentation refinement within the completed Checkpoint 23 boundary. Scope is limited to labeling `search_knowledge` citations with their validated source titles instead of opaque citation hashes, safely rendering persisted and streaming assistant Markdown with the existing React Markdown/GFM stack, and focused renderer/E2E verification; Agent tools, persistence, proposal behavior, and Checkpoint 24 remain unchanged.
- 2026-07-21: Started a user-reported outline-proposal tool correction within the completed Checkpoint 23 boundary. Scope is limited to removing model responsibility for internal section UUID generation, normalizing model-local create-section references to application-generated UUIDs before Pi tool validation, preserving same-patch parent/reference relationships, and focused worker/runtime verification; proposal persistence, approval semantics, schemas at the Main trust boundary, and Checkpoint 24 remain unchanged.
- 2026-07-21: Completed the Agent writing-panel presentation refinement. Structured `search_knowledge` and `read_citations` results now label every citation with the validated knowledge-source title and one-based page while retaining the opaque citation ID only as metadata/fallback. Persisted and live-streaming assistant messages share a React Markdown/GFM renderer with raw HTML removed, remote images suppressed, and links limited to the existing external HTTPS allowlist. Focused renderer coverage proves GFM structure and unsafe-content handling; the real Agent Electron workflow asserts semantic Markdown output and `agent evidence.pdf · Page 1`. Local Biome checked 314 files with only the existing generated shadcn cookie warning; Node/web typecheck and production build passed; canonical Electron Vitest passed 92 files/407 tests; the full built-app Electron E2E suite passed 12/12 and the focused Agent rerun passed 1/1; isolated runtime `app.sqlite` reported application ID 1464615248, user/schema version 1, integrity `ok`, and no foreign-key failures; and `git diff --check` passed. The `pnpm` wrapper hung before command startup, so documented local/npm equivalents were used and no pnpm pass is claimed.
- 2026-07-21: Started a user-requested Agent response-card metadata refinement within the completed Checkpoint 23 boundary. Scope is limited to removing repeated provider/model badges from each assistant response while preserving the panel-level active provider/model status and per-response usage, retry, and interruption metadata; runtime, persistence, tools, and Checkpoint 24 remain unchanged.
- 2026-07-21: Completed the Agent response-card metadata refinement. Assistant responses no longer repeat provider or model badges; the active run header remains the single provider/model surface, while per-response input/output usage, retry count, and interruption status remain visible. Node/web typecheck, production build, focused Biome, `git diff --check`, and the built Electron Agent E2E passed; the E2E waits for `Idle` and proves no completed response exposes the configured `openai-compatible` provider or `writer-model` model labels.
- 2026-07-21: Started a user-requested Agent Side Chat presentation refinement within the completed Checkpoint 23 boundary. Scope is limited to replacing the Sheet with a responsive resizable writing-workspace panel, adding session-list/conversation navigation, projecting consecutive non-proposal tools into compact expandable activity groups, and composing the timeline from the official shadcn MessageScroller, Message, Bubble, Attachment, Marker, Resizable, and shimmer surfaces. Agent IPC, persistence, tool authority, proposal semantics, and Checkpoint 24 remain unchanged.
- 2026-07-21: Completed the Agent Side Chat presentation refinement. The Writing Workspace now uses a responsive right-side resizable panel with session-list-first navigation; reopening returns to the list without stopping active runs, while narrow layouts replace and restore the manuscript without an overlay. The renderer projects ordered Agent events into assistant/user messages, standalone proposals, terminal markers, and deterministic expandable activity groups with title-first citation attachments, safe Markdown, running shimmer, collapsed success, and expanded failure states. Official shadcn MessageScroller, Message, Bubble, Attachment, Marker, Resizable, and shimmer surfaces replace Sheet and generic tool Cards. Verification passed Node/web typecheck, production build, canonical Electron Vitest (92 files/409 tests), Biome across 320 files with only the existing generated shadcn cookie warning, all 12 built-app Electron Playwright scenarios, isolated runtime database integrity/schema checks, and `git diff --check`. The `pnpm` wrapper hung before command startup, so documented npm/local equivalents were used and no `pnpm` pass is claimed. Phase 9 remains complete; Checkpoint 24 remains unstarted.
- 2026-07-21: Completed the outline-proposal UUID correction. Runtime `agent_events` from the reported DeepSeek V4 Flash sessions showed repeated assistant attempts to repair UUIDs without any intervening `tool_call`/`tool_result`, followed by a user/provider abort, proving Pi rejected the model-generated create IDs before execution. The model-facing `createSection.sectionId` is now a bounded local reference with explicit no-UUID guidance; Pi's supported `prepareArguments` hook allocates application-owned UUIDs before schema validation and rewrites same-patch create/update/move/delete and parent references, while the worker-to-Main Zod contract continues to require UUIDs. Focused coverage proves nested and subsequent-operation reference rewriting, and the full Agent E2E now sends a non-UUID local reference through the real Pi loop. Verification passed Biome across 314 files with only the existing generated shadcn cookie warning, Node/web typecheck, canonical Electron Vitest (92 files/407 tests), production build, all 12 Electron Playwright scenarios, isolated real-app database integrity/schema verification, and `git diff --check`. Phase 9 remains complete; Checkpoint 24 remains unstarted.
- 2026-07-22: Started and completed a user-requested Agent timeout/stop correction within the completed Checkpoint 23 boundary. The Agent-wide timeout was removed; `ProviderConfig.timeoutMs` now applies independently to each logical provider call and its automatic retries, with fresh deadlines for steer/follow-up/tool continuations. A linked run cancellation signal now stops provider streams, retries, authorization waits, and all in-flight Agent tool handlers; Main drains the dedicated tool bridge before writing the terminal event and classifies provider timeout, user stop, project close, and generic interruption with safe reason codes. Renderer run/tool durations are derived from existing timestamps with a single live clock and stopped tools no longer remain Running. Worker, Main bridge/service, and renderer view-model tests cover retry deadlines, continuation reset, timeout classification, stop classification, bridge drain, and frozen durations. Canonical Electron Vitest passed 92 files/416 tests; Node/web typecheck passed; Biome passed 320 files with only the existing generated shadcn cookie warning. Phase 9 remains complete; Checkpoint 24 remains unstarted.
- 2026-07-22: Started a user-requested writing/Agent presentation correction within the completed Checkpoints 11 and 23 boundaries. Scope is limited to containing long outline rows and every Agent timeline surface within their panels, moving the Agent trigger from the workspace rail to the far right of the global menubar, and replacing fixed side-by-side proposal previews with a highlighted unified/split diff that defaults to a vertical unified layout. Agent authority, persistence, proposal semantics, and Checkpoint 24 remain unchanged.
- 2026-07-22: Completed the writing/Agent presentation correction. Outline indentation is visually bounded and each row now shrinks around its title/count/actions without expanding the sidebar. Agent messages, activity markers, bounded JSON, Markdown/code/tables, proposal metadata, and fixed-width citation attachments are contained by local scroll or wrap boundaries. The sole Agent trigger moved to the global menubar's far-right edge; its controlled state still supports `Command/Ctrl+J`, responsive panel sizing, workspace switching, and close actions. Proposal previews now use exactly pinned `react-diff-viewer-continued` 4.4.0 in a highlighted unified vertical layout by default with a user-selectable split layout, theme-aware colors, bounded scrolling, and truncation disclosure; the JSON-specific alternative was not added. Production build and Node/web typecheck passed; canonical Electron Vitest passed 92 files/416 tests; local Biome checked 321 files with only the existing generated shadcn cookie warning; and `git diff --check` passed. Focused Agent and Writing Workspace Electron scenarios passed with explicit trigger-position, diff-layout, attachment/panel-width, and long-outline assertions. The complete Electron E2E run passed 11/12; its unrelated MinerU normalized-body timing failure passed immediately on focused rerun. The final `pnpm check` wrapper hung without output, so the equivalent local Biome check was used and no final `pnpm check` pass is claimed. Checkpoint 24 remains unstarted.
- 2026-07-22: Started a follow-up Sidebar header overflow correction after a narrow-window field screenshot showed the `Edit outline` control and Active badge escaping the contextual sidebar. Scope is limited to making the composed secondary Sidebar, project/status row, and Brief/Outline action grid genuinely shrinkable and adding a narrow-window bounds regression assertion.
- 2026-07-22: Started a user-reported outline-proposal approval correction within the completed Checkpoint 22 boundary. Scope is limited to reproducing and fixing the foreign-key failure when approving an outline patch that deletes a section, preserving proposal/revision lineage, and adding focused transaction regression coverage. Checkpoint 24 remains unstarted.
- 2026-07-22: Completed the user-requested silent Electron E2E maintenance. Main now resolves an explicit `WRITELLM_E2E_WINDOW_MODE`, keeps silent BrowserWindows hidden and unfocused with renderer background throttling disabled, skips macOS Dock activation and silent maximization, and suppresses second-instance focus behavior. The default `test:e2e` wrapper and packaged hybrid smoke use silent mode; `test:e2e:visible` remains available for interactive debugging. The fixture asserts `visible:false`, `focused:false`, and `backgroundThrottling:false` for every silent launch. Biome, Node/web typecheck, production build, Electron-hosted Vitest (92 files/420 tests), complete silent Electron Playwright (12/12), packaged hybrid smoke (provider fallback and stale-session scenarios), and `git diff --check` passed. The initial in-sandbox E2E attempt was blocked by loopback `EPERM`/Electron SIGABRT and was rerun successfully outside the sandbox. The visible command was list-checked but not launched on the user's desktop to preserve the requested no-interruption workflow.
- 2026-07-22: Completed the user-reported outline-proposal approval correction. ADR 002 and migration 0018 replace physical section deletion with internal tombstones, preserving accepted Agent revisions and proposal/model lineage while excluding tombstones from every active outline/editor/Agent query and position constraint. Manual and Agent deletion remove materialization registrations, retain leaf/last-section guards, prevent ID reuse, flush an active deletion target before approval, refresh to a fallback section, and reject undo against a tombstoned target explicitly. Local Biome checked 324 files with only the existing generated shadcn cookie warning; Node/web typecheck and production build passed; canonical Electron Vitest passed 92 files/423 tests; all 12 silent Electron Playwright scenarios passed; isolated real-app database verification passed; and an online backup of the reported schema-17 project verified migration plus the formerly blocked protected-deletion transition without foreign-key failures. Checkpoint 24 remains unstarted.
- 2026-07-22: Completed the user-requested stale section-proposal correction. Migration 0019 adds `superseded`, `conflicted`, and `satisfied` terminal states plus a unique nullable replacement link. Main performs operation-aware three-way replay inside the approval transaction, preserves exact-revision final application, creates immutable replacement payloads for non-conflicting work, protects pending bases from revision-body pruning, and returns structured refresh/conflict/satisfied outcomes without generic remote-method failures. The renderer derives `Outdated` from revision truth, requires `Review update` followed by a second approval, projects only the latest chain leaf, and publishes `sectionChanged` only for final application. Local Biome checked 329 files with only the existing generated shadcn cookie warning; Node/web typecheck, canonical Electron Vitest (94 files/435 tests), production build, all 13 built-app Electron Playwright scenarios, migration backup/foreign-key coverage, isolated app-database integrity verification, and `git diff --check` passed. The offline `pnpm` wrapper could not verify its registry signature, so the installed Biome binary, documented direct test runner, and npm build equivalent were used. Checkpoint 24 remains unstarted.
- 2026-07-22: Completed the user-requested Outline row hover refinement. Invisible add/delete controls no longer consume flex width: each section button fills its available row and shows the word count at rest, while hover or keyboard focus-visible replaces that count with the two overlaid actions. Long titles remain contained and the existing section behavior is unchanged. Local focused Biome and an independent production Renderer build passed. A clean HEAD snapshot carrying only this refinement passed Node/web typecheck, the full production build, and the focused real Electron Writing Workspace scenario with explicit row-boundary, word-count, and action-visibility assertions. The active worktree's full typecheck/build remains temporarily blocked by unrelated in-progress Agent context/approval-policy edits and is not claimed as a pass.
- 2026-07-22: Started a user-reported section body title-deduplication correction within the completed Agent writing boundary. Scope is limited to clarifying in the bounded model prompt that section titles are outline metadata rendered outside the BlockNote body, prohibiting a repeated opening title while allowing genuine lower-level subheadings, and adding focused prompt regression coverage. Proposal authority, persistence, renderer behavior, and Checkpoint 24 remain unchanged.
- 2026-07-22: Completed the section body title-deduplication correction. The bounded system prompt now identifies section titles as separately rendered outline metadata, requires section proposals to begin with body content instead of a repeated or restated opening title, and still permits genuine lower-level heading blocks. The canonical Electron-hosted Vitest suite passed 96 files/448 tests; Biome checked 339 files with only the existing generated shadcn cookie warning; and `git diff --check` passed. The `pnpm check` wrapper hung without output, so the installed Biome binary was used and no `pnpm check` pass is claimed. Proposal authority, persistence, renderer behavior, and Checkpoint 24 remain unchanged.
- 2026-07-22: Started user-approved Checkpoint 23M before Checkpoint 24. Scope is limited to project-local BlockNote images, source-backed Mermaid and display-math blocks, safe manual image upload/preview, a global Gemini image provider, one bounded `generate_image` Agent effect/proposal tool, rich-block section insertion, asset/revision lineage, and the existing single-section import/export surfaces. ADR 006 preserves the renderer sandbox, typed proposal/revision checks, three fixed worker roles, request-scoped network work, and credential boundaries. Inline math, remote image fetching, image editing, asset galleries, whole-manuscript export, and remaining Checkpoint 24 portability work remain out of scope.
- 2026-07-23: Completed the user-requested verification-environment maintenance. The exact package-manager pin now matches the installed pnpm 11.11.0 so pnpm no longer silently attempts a blocked version download before every command. The canonical Electron Vitest runner forwards focused file and test-name arguments. `AGENTS.md` now distinguishes pnpm version-switch hangs, direct-tool fallbacks, non-fatal macOS Electron diagnostics, and the known Codex sandbox E2E signatures from code/test failures; it requires a fresh build and approved out-of-sandbox execution for Electron Playwright. The Gemini image gateway's outer cancellation/deadline now settles independently of SDK transport abort propagation while continuing to pass the signal into the exact-pinned SDK, with in-flight cancellation and timeout coverage. pnpm startup, full Biome, Node/Renderer typechecks, production build, canonical Electron Vitest (101 files/477 tests), all 14 Electron Playwright scenarios outside the sandbox, isolated real-app SQLite identity/integrity/schema verification, and `git diff --check` passed.
- 2026-07-23: Started the user-approved Gemini Interactions image-generation correction within completed Checkpoint 23M. Scope is limited to exact-pinning `@google/genai@2.13.0`, matching Google's current `response_format` request contract, model-aware 1K/2K normalization, accepting verified PNG/JPEG assets, removing the unused Gemini endpoint marker with legacy-read compatibility, preserving safe SDK diagnostics, and full focused/runtime verification. Agent authority, local asset publication, proposal/revision semantics, worker roles, and Checkpoint 24 remain unchanged.
- 2026-07-23: Started the user-requested verification-gate split within the completed verification-environment maintenance boundary. Scope is limited to making static, Electron, E2E, no-identity packaged-smoke, and signed-release checks explicit; routine development and package verification must not discover or use an Apple signing identity, while strict deep signature validation remains an opt-in release gate. Product behavior, packaging contents, native-runtime coverage, notarization policy, and Checkpoint 24 remain unchanged.
- 2026-07-23: Completed the user-reported project-recovery correction. The recovery action grid now occupies the Alert content column instead of collapsing into the icon column, and the renderer receives only a bounded recovery kind/reason so it shows actions valid for the failed transition. Lock contention explains the live-owner requirement and exposes an explicit stale-lock recovery after a conservative one-minute heartbeat window. Main alone re-reads the selected project lock, verifies the observed owner token and unchanged heartbeat, removes only a stale lock, and retries the open; no path or lock token crosses preload. Focused lock/manager/IPC/contracts coverage passed 65 tests, full Biome checked 351 files with only the existing generated shadcn cookie warning, Node/Renderer typechecks and the production build passed, canonical Electron Vitest passed 101 files/488 tests, all 16 built-app Electron Playwright scenarios passed including non-overlapping recovery controls and stale-lock reopen, isolated app-database identity/integrity/schema verification passed, and `git diff --check` passed. Checkpoint 24 remains unstarted.
- 2026-07-23: Completed the user-requested verification-gate split. Package scripts and the repository `verify` skill now route ordinary work through static, Electron, or E2E gates; package-sensitive changes use an explicit no-identity gate, and only an explicitly requested release uses Apple identity discovery plus strict deep signature validation. The package gate verified electron-builder's `skipped macOS application code signing` result and accepted only the resulting no-Team-ID ad-hoc/linker signature before packaged native search, provider-failure fallback, and stale-session smoke passed. Full Biome and Node/Renderer typechecks passed with only the existing generated shadcn cookie warning; both gate plans and `git diff --check` passed. Notarization remains disabled and Checkpoint 24 remains unstarted.
- 2026-07-25: Started the user-approved Agent manual-review wait-state correction within the completed Checkpoint 23H/23M boundary. Scope is limited to preventing a `pause_for_review` tool result from authorizing an unused continuation model request, completing the current immutable run with an explicit review-wait outcome, deriving session workflow state from authoritative runs/proposals, locking only the affected conversation until its blocking proposals are decided, preserving approval continuation as a new run, and adding real Pi/Electron regressions for text/outline/image proposal waits. No durable Agent job, resumable worker, new authority, or Checkpoint 24 work is introduced.
- 2026-07-25: Completed the Agent manual-review wait-state correction. The Pi worker now treats `pause_for_review` as a terminal review barrier before its next-turn authorization hook, clears queued Pi work, and returns an explicit `awaiting_review` outcome without creating an unused `model_requests` row. Main persists the immutable run as `completed` with proposal metadata, derives `idle`/`running`/`awaiting_review`/`generating` session workflow state from authoritative runs and proposals, aborts only raced queued requests with `review_pause`, and rejects new starts or queue messages only for the blocked conversation; approval continuation remains a new run. The Agent panel shows and replays Waiting for review, locks its composer and scope controls while pending/generating, exposes status in every session row, projects image proposals for pre-generation review, and interprets legacy false-failure review events without masking genuine failures. The stale-proposal E2E now uses a second conversation, proving unrelated conversations remain usable. `pnpm check:fast`, canonical Electron Vitest (101 files/492 tests), production build, all 16 real Electron Playwright scenarios, isolated runtime app.sqlite identity/version/integrity/foreign-key/schema verification, the no-identity package gate with packaged Agent worker/native smoke, and `git diff --check` pass; Biome reports only the existing generated shadcn cookie warning. No state-machine migration or durable suspended Agent job was required, and Checkpoint 24 remains unstarted.
- 2026-07-25: Started a user-approved Renderer-wide shadcn/UI correction within the completed writing, knowledge, and Agent presentation boundaries. Scope is limited to preserving the `new-york`/Radix shell while fixing Agent-panel width containment at every composed layer, replacing hand-rolled renderer forms, option sets, lists, empty/loading states, collapsibles, tabs, and destructive confirmations with official shadcn primitives, correcting registry aliases, and adding narrow-width regressions. IPC, Agent authority/state, persistence, proposal semantics, database schemas, and Checkpoint 24 remain unchanged.
- 2026-07-25: Completed the Renderer-wide shadcn/UI correction. The registry now resolves the real `@` TypeScript aliases from the solution config and the Renderer adds official Field/InputGroup, ToggleGroup, Empty, Item, Spinner, Tabs, Collapsible, and AlertDialog compositions without overwriting the locally hardened chat primitives. Semantic success/warning tokens and Badge variants replace raw status colors; forms, menus, loading/empty states, parsed-document tabs, recent/session lists, and destructive confirmations use their official shadcn structures. The Agent root now owns named 384/448px container breakpoints, explicit `min-w-0` containment through status/timeline/proposal/composer surfaces, local-only diff scrolling, human-readable operation summaries with hidden raw IDs, full-width narrow approval actions, and a Field/InputGroup composer with accessible compact controls. Component coverage proves Field invalid semantics, single-value ToggleGroup state, Spinner labels, and Collapsible content; the real Agent E2E resizes a live split proposal through 360/384/448/480/640/360px and asserts the panel, header, status, proposal Bubble, and composer never overflow while all approval actions remain visible. `pnpm check:fast`, canonical Electron Vitest (102 files/495 tests), production build, all 16 silent Electron Playwright scenarios outside the sandbox, and `git diff --check` passed; Biome reports only the existing generated Sidebar cookie warning. IPC, Agent state/persistence, schemas, databases, architecture ADRs, packaging, and Checkpoint 24 remain unchanged.
- 2026-07-30: Realigned the complete Phase 10 plan against the current source and completed
  23M/23V/verification-gate baseline without starting Checkpoint 24. Snapshot v2 UI/restore,
  managed-history transport, moved-root open, missing-index durable rebuild scheduling, Electron
  native preparation, three packaged worker entrypoints, no-identity packaging, and the current
  packaged hybrid smoke are now explicit reused baselines rather than duplicate future tasks.
  Checkpoint 24 is narrowed to Main-authoritative whole-manuscript native/Markdown export,
  referenced-asset portability, collision-safe publication, and portability E2E. Checkpoint 25
  completes target-native, source-independent packaging on Windows x64, macOS arm64/x64, and Linux
  x64. Checkpoint 26 adds the absent cross-platform GitHub Actions matrix, recovery/security/logging
  packaged coverage, artifact retention/provenance, and protected signing/notarization-aware
  release promotion. Clone/Save As, Snap, auto-update, and mandatory paid-provider CI remain
  deferred. No product code, dependency, schema, or checkpoint status changed.
- 2026-07-30: Started user-approved Checkpoint 23P. Scope is limited to replacing the singleton
  Agent endpoint with an application-global exact-Pi provider/preset catalog, encrypted Pi
  credentials and explicit cached discovery, per-conversation model selection in the Agent
  sidebar, and run-snapshotted multi-protocol dispatch. ADR 008 preserves Main credential
  authority, project portability, the three worker roles, Agent tool/proposal boundaries, and
  request-scoped execution. Embedding, reranking, MinerU, image generation, and Checkpoint 24
  remain unchanged.
- 2026-07-30: Completed Checkpoint 23P. Application migration 0002 stores bounded
  last-successful Agent model catalogs; project migration 0023 stores conversation selections and
  immutable run provider/model/API labels. Main now owns Pi built-in/custom providers, encrypted
  API-key/OAuth credentials, cancellable login interaction, explicit dynamic discovery, legacy
  singleton migration, and run authorization. The Agent sidebar switches only idle conversations,
  and the worker dispatches all ten pinned Pi APIs without changing active runs. Full Biome,
  Node/Renderer typechecks, production build, canonical Electron Vitest (104 files/508 tests with
  one opt-in benchmark skipped), all 17 silent Electron E2E scenarios, the no-identity packaged
  build plus packaged hybrid/provider-fallback/stale-session smoke, and `git diff --check` passed.
  The documented npm/direct equivalents were used because the installed pnpm 11.11.0 does not
  match the repository's exact 11.17.0 pin; no pnpm-wrapper pass is claimed.
- 2026-07-30: Started user-approved Checkpoint 23Q. Scope is limited to replacing the nested
  Settings command/provider dialogs with one responsive shadcn Command workspace, adding
  application-global Agent provider/model enablement and bounded manual models, editing custom
  preset names/endpoints without changing transports, filtering future Agent selections, and
  adding bounded semantic appearance accents. ADR 009 preserves Main credential authority,
  explicit catalog refresh, active-run snapshots, project portability, singleton non-Agent
  providers, and the unstarted Checkpoint 24 export boundary.
- 2026-07-30: Completed Checkpoint 23Q. Settings is now one responsive Cherry Studio-style shadcn
  workspace with General and five provider categories, narrow-width category/provider drill-down,
  embedded singleton non-Agent forms, and an Agent provider list/detail surface. Agent providers
  support bounded custom creation and endpoint/name edits, write-only authentication, explicit
  discovery with stale-cache retention, provider/model enablement, defaults, and manual model
  overlays with advanced metadata. Main persists application-global preferences in app migration
  0003, keeps credentials and availability enforcement authoritative, clears invalid defaults,
  and preserves immutable active-run snapshots; the Agent sidebar exposes only authenticated,
  enabled choices and marks invalid stored selections. Six bounded semantic accent presets are
  persisted alongside theme, approval, security, and diagnostics settings. Full Biome checked 374
  files; Node/Renderer typechecks, canonical Electron Vitest (104 files passed, one benchmark
  skipped; 512 tests passed), production build, all 17 Electron Playwright scenarios, runtime
  app.sqlite identity/schema/integrity/foreign-key checks, and `git diff --check` passed. The
  documented npm/direct equivalents were used because installed pnpm 11.11.0 does not match the
  exact repository 11.17.0 pin; no pnpm-wrapper pass is claimed. Checkpoint 24 remains unstarted.
- 2026-07-30: Started a user-reported Checkpoint 23Q custom-provider rename correction. Scope is
  limited to making edited names visible in the provider list before save, keeping an explicit
  always-visible unsaved/save action, and proving that a name-only save persists across restart
  without clearing the discovered model catalog. Provider transport, credential authority,
  availability semantics, and Checkpoint 24 remain unchanged.
- 2026-07-30: Completed the Checkpoint 23Q custom-provider rename correction. The selected custom
  provider's draft name now updates its list row immediately, and the detail header exposes an
  always-visible unsaved indicator plus explicit save action. Name-only saves retain the current
  discovered catalog and persist through application restart. Focused catalog coverage passed 3
  canonical Electron tests; Node/Renderer typechecks, production build, the focused real Electron
  provider workflow (including narrow drill-down and restart), Biome, and `git diff --check`
  passed. Checkpoint 24 remains unstarted.
- 2026-07-30: Started the user-approved Checkpoint 23Q Provider identity refinement. Scope is
  limited to packaging a validated models.dev Provider-logo snapshot, exposing bounded logo
  metadata and custom overrides, adding those logos to Agent Settings, and replacing the flat
  Agent model Select with one sequential Provider-to-model shadcn Popover/Command picker. Runtime
  provider authority, credential handling, availability checks, active-run snapshots, automatic
  network refresh, and Checkpoint 24 remain unchanged.
- 2026-07-30: Completed the Checkpoint 23Q Provider identity refinement. An explicit synchronization
  command now validates models.dev catalog/logo response types, byte limits, SVG markup, external
  references, and hashes before committing 149 local Provider assets plus a generated manifest.
  Built-in aliases and bounded custom endpoint/name matching produce a Renderer-safe logo ID;
  custom providers may persist or clear one validated override without changing schema. Settings
  and the Agent picker render those local assets through theme-adaptive masks with an initial
  fallback. The Agent sidebar now uses one responsive shadcn Popover/Command with searchable
  Provider and Model levels, direct entry for an existing valid selection, back navigation, and
  keyboard selection. Full Biome checked 382 source files; Node/Renderer typechecks, production
  build, canonical Electron Vitest (105 files/517 tests with one opt-in benchmark skipped), all 17
  Electron Playwright scenarios, the no-identity package/signature gate, packaged hybrid/vector,
  provider-fallback and stale-session smoke, and `git diff --check` passed. The documented
  npm/direct equivalents were used because installed pnpm 11.11.0 does not match the repository's
  exact 11.17.0 pin; no pnpm-wrapper pass is claimed. Checkpoint 24 remains unstarted.
- 2026-07-30: Started and completed a user-reported Checkpoint 23Q Provider-logo rendering
  correction. Chromium rejected unquoted Vite-inlined SVG data URLs as CSS mask values, leaving
  only the square foreground layer visible. ProviderLogo now quotes and escapes the local URL and
  uses an explicit block glyph; a missing asset creates no glyph and renders the Provider's initial
  through AvatarFallback. No catalog, runtime-network, CSP, or persistence boundary changed. A
  focused real Electron assertion confirms that the packaged Together data URL computes to a
  non-empty mask, unmatched Providers contain one initial and no mask layer, and direct screenshot
  inspection shows the four-dot mark instead of a square. Biome, Node/Renderer typechecks,
  production build, the focused provider workflow, and `git diff --check` passed. Checkpoint 24
  remains unstarted.
- 2026-07-30: Started a user-requested Checkpoint 23Q Agent Settings ordering refinement. Scope is
  limited to showing enabled Agent providers before disabled providers with stable order inside
  each group, including provider search and initial/removal selection. Model ordering, Main catalog
  order, shared contracts, persistence, the Agent picker, and Checkpoint 24 remain unchanged.
- 2026-07-30: Completed the Checkpoint 23Q Agent Settings ordering refinement. Settings derives a
  stable enabled-first Provider list without mutating or reordering Main's catalog; search, initial
  selection, removal fallback, and live availability changes share that ordering while the selected
  detail remains active. Focused canonical Electron unit coverage passed 2 tests, full Biome checked
  384 files, Node/Renderer typechecks and the production build passed, the focused real Electron
  Provider workflow passed, and `git diff --check` passed. The documented npm/direct equivalents
  were used because installed pnpm 11.11.0 does not match the repository's exact 11.17.0 pin; no
  pnpm-wrapper pass is claimed. Checkpoint 24 remains unstarted.
- 2026-07-30: Started a user-reported Checkpoint 23Q legacy Agent removal correction. Scope is
  limited to making explicit removal of the migrated `custom:legacy-agent` preset also consume its
  retained singleton migration source, so subsequent catalog snapshots cannot recreate the
  deleted Provider. Initial upgrade migration compatibility, Renderer/IPC contracts, immutable
  Agent run history, and Checkpoint 24 remain unchanged.
- 2026-07-30: Completed the Checkpoint 23Q legacy Agent removal correction. Main now removes
  `agent:custom:legacy-agent` and its retained `agent` migration source in one transaction, letting
  existing foreign keys delete both credentials plus the migrated catalog and preferences before
  the response snapshot runs. Regression coverage performs migrate, disable, remove, and repeated
  snapshot operations, proves the Provider does not reappear, and verifies every related
  application row is gone while the existing initial-migration compatibility assertion remains.
  Full Biome checked 384 files; the focused canonical Electron catalog suite passed 5 tests;
  Node/Renderer typechecks and canonical Electron Vitest passed 106 files/520 tests with one
  opt-in benchmark skipped; and `git diff --check` passed. The documented npm/direct equivalents
  were used because installed pnpm 11.11.0 does not match the repository's exact 11.17.0 pin; no
  pnpm-wrapper pass is claimed. Checkpoint 24 remains unstarted.
- 2026-07-30: Started a user-reported Checkpoint 23Q Settings-header correction. Scope is limited
  to making the Settings close action participate in each workspace header, separating its click
  target from Agent Provider availability controls, aligning the close and Enabled controls, and
  adding a focused bounds regression. Provider availability semantics, persistence, credentials,
  Agent run snapshots, and Checkpoint 24 remain unchanged.
- 2026-07-30: Completed the Checkpoint 23Q Settings-header correction. Settings suppresses the
  Dialog's absolute overlay close control and composes one ghost icon Button with DialogClose into
  the active General/provider header. Agent Provider detail centers that independent 32px close
  target beside the Enabled Field/Switch with a flex gap; narrow Provider-list and empty states
  retain a visible close action. Full Biome checked 384 files; Node/Renderer typechecks and the
  production build passed; the focused real Electron Provider workflow passed with direct
  non-overlap, minimum-gap, and center-alignment assertions; and `git diff --check` passed. The
  installed pnpm 11.9.0 does not match the repository's exact 11.17.0 pin, so documented npm/local
  binary equivalents were used and no pnpm-wrapper pass is claimed. Provider behavior and
  Checkpoint 24 remain unchanged.
- 2026-07-30: Started a user-reported Checkpoint 23Q Agent OAuth bundle correction. Scope is
  limited to registering Pi's five Node-only OAuth flows in the Electron Main production bundle
  and proving the built OpenAI Codex login interaction no longer fails during lazy module loading.
  Provider credentials, IPC contracts, system-browser authorization, worker roles, and Checkpoint
  24 remain unchanged.
- 2026-07-30: Completed the Checkpoint 23Q Agent OAuth bundle correction. Electron Main now calls
  Pi's public static OAuth registration hook before Provider login is available, so the production
  bundle contains Anthropic, GitHub Copilot, OpenAI Codex, Radius, and xAI flows instead of
  resolving missing files relative to `out/main/index.js`. The focused canonical Electron catalog
  test exercises xAI device-code issuance and cancellation; the built Provider workflow reaches
  the OpenAI Codex login-method prompt and remains usable after cancellation. Exact pnpm 11.17.0
  `check:fast` passed; canonical Electron Vitest passed 106 files/521 tests with one opt-in
  benchmark skipped; production build and all 17 Electron Playwright scenarios passed. The
  no-identity package gate verified the macOS app has no Team ID and passed packaged hybrid/vector,
  Provider-failure fallback, and stale-session smoke. `git diff --check` passed. The first
  sandboxed package attempt failed on restricted GitHub DNS; the approved out-of-sandbox rerun
  passed. No Provider credential, IPC, browser, worker, schema, or Checkpoint 24 boundary changed.
- 2026-07-30: Started a user-requested Checkpoint 23Q global error-notification correction. Scope
  is limited to replacing the editor-bound action-failure Alert with one application-root shadcn
  Sonner toaster, retaining persistent local Alerts and field errors, deduplicating repeated
  transient failures, and removing duplicate Agent feedback. Main, IPC, database, shared-contract,
  provider-authority, and Checkpoint 24 boundaries remain unchanged.
- 2026-07-30: Completed the Checkpoint 23Q global error-notification correction. The Renderer now
  mounts one theme-aware shadcn Sonner toaster inside its ThemeProvider and routes transient
  project, Settings, knowledge, version-history, and background failures through one
  message-deduplicating `notifyActionError` helper. Toasts use the bottom-right position, an
  eight-second lifetime, close controls, rich error colors, a three-entry visible limit, and an
  accessible Notifications live region. A Radix dismissable-layer branch keeps toast controls
  interactive above Settings without closing the modal. The former App error state, editor and
  knowledge alert slots, and duplicate Agent toast reports are gone; persistent recovery,
  Settings/workspace/Agent, provider, credential, editor-save, and field feedback remains local.
  Exact pnpm 11.17.0 `check:fast` passed; canonical Electron Vitest passed 107 files/523 tests with
  one opt-in benchmark skipped; production build, the focused seven-scenario project/provider
  workflow, all 17 Electron Playwright scenarios, and `git diff --check` passed. Main, IPC,
  database, shared contracts, and Checkpoint 24 remain unchanged.
