# Phase 10: Export, Packaging, And Release Confidence

## Phase overview

- Purpose: deliver a portable whole-manuscript export, finish reproducible native packaging on
  every supported target, and establish cross-platform CI and controlled release promotion.
- Checkpoints: 24–26.
- Current status: Blocked at Checkpoint 26.9 pending real GitHub-hosted runner evidence.
- Implementation state: plan realigned with the verified 2026-07-31 codebase; Checkpoint 24 passed
  its acceptance gate, Checkpoint 25 passed its acceptance gate, and Checkpoint 26.1–26.8 are
  implemented and locally verified under the user's approval to implement Phase 10.
- Order: Checkpoint 24 must pass before Checkpoint 25 starts, and Checkpoint 25 must pass before
  Checkpoint 26 starts.

The implementation baseline is newer than the original Phase 10 plan:

- Phase 9, Checkpoint 23M, and Checkpoint 23V are complete.
- Verified Snapshot v2 create/restore, conflict-safe destination publication, snapshot UI, moved-root
  open, managed project history transport, and restore-without-index behavior already exist. Phase
  10 reuses them; it does not rebuild snapshot or history features.
- Project open already treats a missing/incompatible `index.sqlite` as rebuildable, keeps manuscript
  access available, and `ProjectIndexService.initialize()` queues the current generation. Checkpoint
  24 adds end-to-end portability evidence rather than a second rebuild mechanism.
- Electron 43 native preparation, three bundled worker entrypoints, a no-identity package gate, an
  opt-in macOS signature gate, and packaged hybrid/provider-fallback/stale-session smoke already
  exist. Checkpoint 25 hardens and completes this baseline instead of reintroducing it.
- The repository has no cross-platform CI workflow yet. Cross-platform build promotion and release
  governance remain Checkpoint 26 work.

## Checkpoint 24: Whole-Manuscript Export And Portability Completion

### Scope and decisions

- [x] 24.1 Define a versioned, bounded whole-manuscript export contract and deterministic package
  layout. The native export contains the active manuscript brief, outline/version, active sections
  in canonical outline order, each current revision ID/hash/source/schema metadata, lossless
  BlockNote schema-v2 content, aggregate counts, and a hashed referenced-asset inventory. It is an
  export of the current manuscript, not a project backup: tombstones, old revision bodies,
  knowledge data, Agent sessions, provider configuration, credentials, logs, and managed Git
  history are excluded.
- [x] 24.2 Create the export from Main-owned authoritative state behind the existing project
  operation/editor-flush barrier. Revalidate the active `projectSessionId`, finish the current
  editor flush, capture one consistent brief/outline/revision/asset view, stage all output, verify
  the manifest and hashes, and atomically publish without overwriting an existing destination.
  Renderer-supplied Markdown or JSON is not export authority.
- [x] 24.3 Implement canonical native JSON serialization plus strict read-back validation and
  deterministic fixtures. Equal canonical manuscript state must produce equal content files and
  inventory hashes; volatile creation metadata, if retained, stays outside the deterministic
  content hash.
- [x] 24.4 Move whole-manuscript Markdown conversion into a shared credential-free domain boundary
  used from Main. Render outline titles at their real hierarchy depth, then convert each canonical
  BlockNote body without repeating section titles. Preserve GFM structures, Mermaid fences,
  display math, links, tables, lists, code, and supported inline styles according to the current
  schema. Produce a bounded machine-readable loss report and a user-readable warning whenever a
  structure cannot be represented exactly; never silently drop or flatten unsupported content.
- [x] 24.5 Copy only assets referenced by the captured active revisions into the export package,
  verify database metadata, bytes, MIME, size, and SHA-256, and rewrite Markdown references to
  normalized relative `assets/<sha256>.<ext>` paths. Native JSON retains logical
  `writellm-asset:<assetId>` values backed by its asset inventory. A missing, changed, duplicate,
  case-colliding, symbolic-link, absolute, or escaping asset fails publication.
- [x] 24.6 Add a global shadcn Menubar export flow with a Main-owned destination picker, explicit
  Native and Markdown package choices, a pre-export final flush state, completion location
  metadata that does not expose a reusable path capability, and visible loss warnings. Cancellation
  is a no-op, existing destinations are never merged or overwritten, and the existing
  single-section import/export compatibility surface remains available.
- [x] 24.7 Extend portability verification around the completed Snapshot v2/23V baseline: move or
  rename a project and restore Snapshot v1/v2 with and without managed history; use Unicode,
  spaces, long-but-valid names, case-collision fixtures, and Windows/macOS/Linux-compatible
  relative paths; remove `index.sqlite`, reopen immediately into manuscript access, and prove one
  deduplicated durable rebuild reaches the current generation. No project record, export manifest,
  or exported content may contain a private absolute path.
- [x] 24.8 Add native/Markdown golden fixtures, malformed export and asset adversarial tests,
  interrupted-publication cleanup, stale-session/final-flush races, deterministic reruns, and a
  real Electron workflow covering export, external inspection, project move/snapshot restore,
  missing-index rebuild, and reopen. Pass `pnpm check:fast`, canonical Electron Vitest, a fresh
  production build, the complete Electron E2E suite, and `git diff --check`.

### Explicitly reused or deferred

- Snapshot create/restore UI, Snapshot v2 history transport, version-history restore, and
  conflict-safe snapshot destination handling are completed baselines, not Checkpoint 24 tasks.
- Restore preserves `projectId`. Clone/Save As would mint a new `projectId` and remains a separate
  future product decision; Checkpoint 24 does not disguise restore as clone.
- Whole-project archival remains the verified snapshot format. The manuscript export package is
  intentionally smaller and must not become a second project database or recovery format.

Acceptance criteria: a user can export the complete current manuscript and all referenced assets
without trusting Renderer serialization; native output is lossless for every admitted content
schema-v2 block, Markdown ordering is deterministic and every loss is explicit, publication is
atomic and collision-safe, and moved/restored/no-index projects remain immediately readable and
rebuild search from project-relative authority.

Completion evidence (2026-07-30): Main now owns a versioned native/Markdown manuscript package,
consistent final-flush capture, canonical hashes, strict read-back, verified referenced assets,
atomic collision-safe publication, and path-bounded IPC. The global shadcn Menubar exposes both
formats and reports Markdown losses without removing the existing single-section interchange
surface. Golden, adversarial, cleanup, manager, IPC, and real Electron export coverage passed.
Exact pnpm 11.17.0 `check:fast` passed; canonical Electron Vitest passed 110 files/544 tests with
one opt-in file/test skipped; a fresh production build and all 18 Electron Playwright scenarios
passed. Existing moved-root, Snapshot restore, missing-index rebuild, and reopen scenarios remain
green.

## Checkpoint 25: Reproducible Native Packaging Completion

### Existing baseline

The repository already targets Electron 43, prepares a host `sqlite-vec` resource, rebuilds
`better-sqlite3` for Electron, bundles `agent-worker`, `background-worker`, `index-worker`, and the
logging fixture, separates no-identity `check:package` from opt-in `check:release`, and runs a real
packaged hybrid/provider-fallback/stale-session smoke. The work below closes the remaining
cross-platform and source-independence gaps.

### Scope and decisions

- [x] 25.1 Characterize the exact Electron 43/electron-builder/native-addon state on Windows x64,
  macOS arm64, macOS x64, and Linux x64 using the frozen lockfile. Audit `pnpm-workspace.yaml`
  build-script allowlists and optional `sqlite-vec` platform packages. Record the Electron ABI,
  native binary architecture, builder version, target format, and supported host for every row
  before changing the build.
- [x] 25.2 Replace template packaging metadata (`com.electron.app`, example author/homepage,
  Electron maintainer text, unused camera/microphone permissions, and placeholder publish URL)
  with approved product metadata. Initial artifacts are Windows x64 NSIS, macOS arm64/x64 DMG plus
  ZIP, and Linux x64 AppImage plus deb. Snap and an auto-updater/update feed remain deferred until
  they have an explicit distribution and verification requirement.
- [x] 25.3 Establish one fail-closed Electron-native preparation sequence per target. Assert the
  executing Electron ABI after `install-app-deps`, force the approved `better-sqlite3` rebuild only
  when the installed addon is not Electron-compatible, copy exactly the target
  `sqlite-vec` binary into `resources/native/sqlite-vec/<platform>-<arch>/`, and reject missing,
  wrong-architecture, duplicate, or host-Node-only binaries. Avoid an implicit second rebuild;
  keep or revise `npmRebuild: false` only as an explicit consequence of the verified sequence.
- [x] 25.4 Make the ASAR/resource inventory executable evidence. Verify the Main/preload/Renderer
  bundles, PDF.js worker, BlockNote and rich-media runtime, the three utility entrypoints and their
  shared chunks, `better-sqlite3`, target `sqlite-vec`, Pino transport/thread-stream assets, Pi,
  AI SDK OpenAI/Cohere adapters, and the Gemini SDK lazy import. Missing or source-tree-resolved
  content fails the package gate.
- [x] 25.5 Add explicit host-native package commands and deterministic output directories for the
  four target rows. Functional verification runs against an unpacked application; the corresponding
  installer/archive is then created and structurally inspected. Do not claim cross-OS packaging
  from one host as a substitute for building on the target runner.
- [x] 25.6 Expand packaged smoke so the packaged application, with a fresh `userData`, opens and
  migrates `app.sqlite`, creates/opens/closes/reopens a project, persists and reloads BlockNote
  schema-v2 content and an asset, loads sqlite-vec, runs index and background-worker loopback
  workflows, starts a loopback Pi Agent run through `agent-worker`, aggregates a safe log record
  from every worker, flushes on shutdown, and rejects stale sessions. Remove the current packaged
  module fallback to the source workspace; test harness dependencies may live outside the package,
  but application runtime dependencies and files may not.
- [x] 25.7 Cover native/resource/worker/protocol failure modes: wrong ABI or architecture, missing
  ASAR chunk, missing provider lazy dependency, unavailable vector extension, worker start/crash,
  packaged application protocol/CSP failure, path-with-spaces/Unicode resources, and shutdown with
  in-flight request-scoped work. Preserve original errors in local structured logs without leaking
  paths, credentials, prompts, or document bodies.
- [x] 25.8 Pass `pnpm check:fast`, canonical Electron Vitest, production build, complete Electron
  E2E, the host row's no-identity `pnpm check:package`, package inventory verification, packaged
  runtime/database checks, and `git diff --check`. `check:release` stays opt-in and is not used to
  make ordinary package verification depend on signing credentials.

Acceptance criteria: each supported target can be built reproducibly on its native host from the
frozen repository, contains the correct Electron-ABI native modules and every runtime asset, starts
all three worker roles, exercises editor/index/provider/logging paths in the packaged application,
and passes without resolving an application dependency or resource from the source tree.

Completion evidence (2026-07-30): the four native-host target commands now share a fail-closed
Electron 43 preparation, architecture parser, target-only sqlite-vec resource, deterministic output
directory, executable ASAR/resource inventory, unsigned/signing policy split, artifact checksums,
and source-independent packaged smoke. On macOS arm64 the no-identity gate verified Electron ABI
148, arm64 better-sqlite3/sqlite-vec binaries, 44,776 ASAR entries, all worker/runtime/provider
dependencies, schema-v2 content and asset reopen, vector/index/background/Agent loopback work,
four process-role logs, provider fallback, stale sessions, CSP file denial, and app.sqlite
application ID/schema/integrity. It produced inspected DMG and ZIP artifacts with SHA-256 evidence.
Exact pnpm 11.17.0 `check:fast`, canonical Electron Vitest (112 files/548 tests with one opt-in
file/test skipped), a fresh production build, all 18 Electron Playwright scenarios, the host
`check:package`, and `git diff --check` passed. The remaining three native rows are delegated to
the Checkpoint 26 real-runner matrix rather than cross-built on this host.

## Checkpoint 26: Cross-Platform CI, Recovery Matrix, And Release Promotion

### Scope and decisions

- [x] 26.1 Add least-privilege GitHub Actions workflows with concurrency cancellation, frozen pnpm
  installation, dependency caching that never replaces lockfile verification, timeouts, and
  `contents: read` by default. At implementation start, resolve and pin exact current GA runner
  image labels for Windows x64, macOS arm64, macOS x64, and Linux x64; do not rely on moving
  `*-latest` labels, paid larger runners, or preview architectures without a recorded decision.
  Pin external actions to reviewed commit SHAs.
- [x] 26.2 Separate workflow layers: a fast static gate; canonical Electron-hosted tests and
  production build on every target row; silent Electron E2E on every release row; and native-host
  package/inventory/packaged-smoke jobs for all four rows. Pull requests and `main` pushes run the
  static gate, while only a tag ref may start the complete cross-platform matrix; scheduled runs
  are disabled. A release cannot reuse a skipped or failed row.
- [x] 26.3 Build and retain versioned migration/recovery fixtures for supported app/project schema
  histories, WAL-resident backup/restore, Snapshot v1/v2 with and without managed history,
  interrupted history restore, stale/live locks, stale sessions, moved roots, Unicode and
  case-colliding paths, missing/corrupt materializations, missing/incompatible indexes, durable
  MinerU/normalization/index interruption, and asset-backed whole-manuscript export. Fixtures
  contain no credentials, signed URLs, private paths, or user content and are verified before use.
- [x] 26.4 Run the current Agent/security boundaries in packaged artifacts: request interruption,
  manual-review wait, tool capability rejection, stale proposal refresh/rejection, accepted
  mutation/revision/citation lineage, project-close revocation, CSP and navigation denial, IPC
  sender rejection, and safeStorage backend reporting. Linux must truthfully report and refuse
  credential persistence when the selected backend is `basic_text`.
- [x] 26.5 Verify centralized packaged logging on each OS: Main plus all three worker roles,
  AsyncLocalStorage/process-boundary correlation, original `Error` stack/cause preservation,
  redaction, rotation, retention cleanup, fatal/shutdown flush, and bounded diagnostic export.
  Workflow artifacts may include only synthetic sanitized logs.
- [x] 26.6 Define artifact governance. Keep PR/test reports and sanitized failure diagnostics for
  14 days, successful tagged unsigned packages for 30 days, and version-controlled migration
  fixtures for the full supported migration window. Release artifacts live on the immutable
  GitHub Release rather than depending on expiring Actions artifacts and include SHA-256 checksums,
  target/architecture/build metadata, and the exact source revision. Failed or partial matrix
  outputs are never promoted.
- [x] 26.7 Add a protected release environment and manual promotion job that consumes only the
  successful matrix outputs from the tagged clean revision. Fork and pull-request workflows never
  receive signing or provider secrets. Distribution readiness requires an explicit signing policy:
  Developer ID signing plus notarization for macOS and Authenticode signing for Windows when the
  approved identities are configured; Linux artifacts receive checksums and reproducible build
  metadata. Until those credentials and approvals exist, CI may publish test-only unsigned
  artifacts but must not label them production releases.
- [x] 26.8 Extend `check:release` into the target-aware promotion verifier: validate version/tag and
  clean lockfile, migration compatibility window, package checksums/inventory, platform signature
  and notarization status where required, installer/archive sanity, packaged smoke evidence, and
  release notes. Live billable provider checks remain separately authorized manual probes against
  non-production fixtures; deterministic loopback providers are the release gate and no provider
  secret is embedded in an artifact.
- [~] 26.9 Pass the complete four-row CI matrix on real target architectures, install or launch
  every produced artifact in its supported form, verify uploaded checksums and retention metadata,
  perform one protected dry-run promotion without publishing a production release, and record the
  exact commands, runner images, test counts, artifact names, hashes, signatures, and any
  intentionally unsigned status in the completion evidence.

  Authorization: on 2026-08-09 the user explicitly approved starting Checkpoint 26.9, including
  the required commit, push, tag, hosted workflow dispatch, and protected dry-run promotion.
  Production release publication remains out of scope. Local macOS arm64 evidence cannot
  substitute for Windows x64, macOS x64, or Linux x64 native runs.

Acceptance criteria: the protected release candidate is built and tested on all four real target
rows; the current migration, recovery, export, native runtime, Agent, security, and logging
boundaries pass in packaged artifacts; artifacts and diagnostics have explicit retention and
provenance; secrets are confined to approved promotion jobs; and no production release can be
created from an incomplete, unsigned-when-required, unnotarized-when-required, or mismatched matrix.

Implementation evidence (2026-07-31): pinned least-privilege CI and release-candidate workflows
now use `windows-2022`, `macos-15`, `macos-15-intel`, and `ubuntu-24.04`, immutable action SHAs,
exact pnpm/Node versions, frozen installs, bounded retention, complete-row promotion, and a
protected `release` environment. A versioned synthetic recovery manifest covers 22 executable
fixtures across 14 recovery, Agent, security, and logging categories. Each fixture is bound to
specific test names and the SHA-256 of its source file, so changed or removed recovery evidence
fails closed. Package evidence now
contains verified packaged-smoke scenarios for native hybrid search, secure credential backend,
all four process roles, untrusted IPC/navigation/CSP denial, provider fallback, correlated and
redacted Error diagnostics, bounded diagnostic export, log rotation/retention, normal/fatal flush,
stale-session revocation, reopen, and database integrity. The same gate runs all 18 Electron E2E
scenarios directly against the unpacked packaged executable. Linux also requires a real Secret
Service for the positive paths and performs a second packaged launch that proves `basic_text` is
reported and rejected. Promotion verifies the exact tag/source SHA, four-row artifact formats,
source revision, inventory, packaged-smoke and packaged-E2E evidence, checksums, duplicate names,
and required macOS notarization/Windows Authenticode evidence before production.

Trigger-policy maintenance (2026-08-04): PR and `main` events retain the static/fixture gate, but
the Electron and native-package four-runner matrices now require a tag ref. The prior cron trigger
was removed; an explicit workflow dispatch runs the matrices only when dispatched against a tag.

Local verification passed exact pnpm 11.17.0 `check:fast`, 113 canonical Electron Vitest files and
553 tests with one opt-in file/test skipped, the 22-case recovery manifest, focused release/native
evidence tests (7 tests), YAML parsing, both package/release plans, `git diff --check`, and the
macOS arm64 no-identity package gate. The package gate verified Electron ABI 148, 44,776 ASAR
entries, arm64 native binaries, 12 structured packaged-smoke scenarios, 18/18 packaged Electron
E2E scenarios, and unsigned DMG/ZIP artifacts. The local evidence truthfully records
`sourceState: dirty`; promotion requires `sourceState: clean` on all four rows and rejects
inconsistent recovery fixture hashes. The DMG is 249,397,727 bytes with SHA-256
`ff0f5f3d91d55ee96f37ac4515f528e41ab125f1b94a4c0a27bf2b6e3fe38a5b`; the ZIP is 249,753,413
bytes with SHA-256 `740a541cd9b706beecbc4d3b7314c229535a7c7d61e1d783bf15b5a949d48c63`.
Checkpoint 26.9 is in progress on the real four-row workflow and protected dry-run promotion, so
Phase 10 is not yet marked complete.

Hosted candidate evidence (2026-08-09): immutable tag `v0.2026.8.1` at
`31164142d628443254cf0f23f8ec93dcf2d4f03f` started CI run `31337066783`. The static/fixture gate
passed, while Windows x64 exposed filesystem URL misuse in the canonical Electron test launcher
(`D:\\D:\\...`) and macOS arm64 exposed a provider-settings E2E that depended on ambient enabled
provider state. Both macOS rows failed that same precondition. Linux x64 also exposed hosted-runner
resource contention from two concurrent Electron applications: unrelated scenarios slowed together
and timed out, so Linux CI now serializes the otherwise parallel E2E suite. Local package validation
also caught a Markdown-export assertion racing the expected atomic temporary-file rename; the test
now waits specifically for the final `.md` artifact. The candidate is intentionally retained as
failed evidence and is not eligible for promotion; the focused fixes advance the release build
sequence rather than moving the tag.

Hosted candidate evidence (2026-08-09): immutable tag `v0.2026.8.2` at
`cf0372cc772cabab37bedcb64adfa15ec1bb2bb9` started CI run `31338207654`. Both macOS rows passed
their Electron tests, production builds, and complete 20-scenario E2E suites. Linux passed its
Electron tests/build, then completed 12 of 20 serial E2E scenarios; eight credential-dependent
scenarios failed because headless Electron selected `basic_text` even though the workflow had
started a temporary Secret Service. Windows verified the canonical launcher path fix, then exposed
`EPERM` from directory fsync and from syncing a read-only file handle across atomic project writes
and verified database backups. The durability helper now opens files read-write for fsync and
treats only Windows directory `EPERM` as an unsupported directory-sync operation while retaining
strict handling elsewhere. Linux positive-path E2E and packaged-smoke launches explicitly select
Electron's documented `gnome-libsecret` password store and continue to fail closed unless the
workflow opts in and the Secret Service actually provides encryption. The candidate remains failed
evidence and cannot be promoted or retagged.

Local pre-tag evidence for `0.2026.8.3` (2026-08-09): `pnpm check:fast` passed; the canonical
Electron test runner passed 589 tests in 116 files with one benchmark skipped; and
`pnpm check:package` passed 12 packaged-smoke scenarios plus all 15 packaged E2E scenarios. The
unsigned arm64 artifacts are `WriteLLM-0.2026.8.3-arm64.dmg` (249,407,596 bytes, SHA-256
`03132e4ba1a0c98079429d301318264a1b939b9f3864a72390bff1e9da72d88e`) and
`WriteLLM-0.2026.8.3-arm64.zip` (249,764,871 bytes, SHA-256
`73e75722844ebfc2ac9eb05ad8e3b5b820aac72dfbf595c45b265441015e1f29`). The package evidence
truthfully records the pre-tag checkout as dirty; hosted promotion still requires a clean tagged
revision on all four targets.

## Phase 10 deferred work

- Clone/Save As with a new `projectId`, multiple manuscripts, external-edit synchronization, and
  project-wide file watching.
- Snap distribution and any auto-updater/update-feed subsystem.
- Provider reasoning controls, multi-agent/sub-agent workflows, and long-term Agent memory.
- Mandatory live paid-provider calls in CI. Live certification remains an explicitly authorized
  release checklist item and never replaces deterministic loopback coverage.
