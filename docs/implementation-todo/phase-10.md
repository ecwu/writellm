# Phase 10: Export, Packaging, And Release Confidence

## Phase overview

- Purpose: deliver a portable whole-manuscript export, finish reproducible native packaging on
  every supported target, and establish cross-platform CI and controlled release promotion.
- Checkpoints: 24–26.
- Current status: Checkpoint 26.9 has resumed with tag-only four-platform CI; hosted evidence is
  pending and the release-candidate workflow remains disabled.
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
- [~] 26.9 Pass the Windows x64, macOS arm64, macOS x64, and Linux x64 rows on their real target
  architectures, verify uploaded checksums and retention metadata, and record the exact commands,
  runner images, test counts, artifact names, hashes, and intentionally unsigned status in the
  completion evidence. Protected promotion and production publication remain outside the resumed
  build authorization.

  Authorization: on 2026-08-09 the user explicitly approved starting Checkpoint 26.9, including
  the required commit, push, tag, hosted workflow dispatch, and protected dry-run promotion.
  Production release publication remains out of scope. Local macOS arm64 evidence cannot
  substitute for either hosted macOS architecture.

Acceptance criteria: the tagged source is built and tested on the real Windows x64, macOS arm64,
macOS x64, and Linux x64 target rows; the current migration, recovery, export, native runtime,
Agent, security, and logging boundaries pass in packaged artifacts; and artifacts and diagnostics
have explicit retention and provenance. Signing and release promotion remain separately gated and
cannot reuse a missing, skipped, failed, mismatched, or intentionally unsigned production row.

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
`sourceState: dirty`; promotion requires `sourceState: clean` on every row in the selected target
set and rejects missing or extra rows and inconsistent recovery fixture hashes. The DMG is
249,397,727 bytes with SHA-256
`ff0f5f3d91d55ee96f37ac4515f528e41ab125f1b94a4c0a27bf2b6e3fe38a5b`; the ZIP is 249,753,413
bytes with SHA-256 `740a541cd9b706beecbc4d3b7314c229535a7c7d61e1d783bf15b5a949d48c63`.
Checkpoint 26.9 is in progress on the real macOS arm64/x64 workflow and protected dry-run
promotion; Windows/Linux distribution evidence is deferred, so Phase 10 is not yet marked
complete.

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
revision on both selected macOS targets.

Hosted candidate evidence (2026-08-10): immutable tag `v0.2026.8.4` at
`4299bf77e37e74049746ce99029cbcd5c6cd3919` started CI run `31369520249`. The static/fixture gate
and macOS arm64 row passed. macOS x64 passed 590 of 591 canonical tests before the I/O-heavy
application-ID-zero database test exceeded Vitest's default five-second limit. Windows passed the
same Electron tests/build and 13 of 20 complete E2E scenarios; one more scenario passed only on
retry and six long scenarios exceeded Playwright's 45-second test limit. Their cleanup then
truthfully reported still-open SQLite files as `EBUSY`, a consequence of timeout cancellation rather
than the original failure. Linux proved the `gnome-libsecret` switch preceded the application path,
but the fresh hosted session still lacked a usable login keyring: 12 scenarios passed while eight
credential-dependent scenarios failed, and several of those long paths also reached 45 seconds.
GNOME Keyring's documented fresh-session sequence is now centralized as `--login` followed by
`--start` inside the D-Bus session, and slow Windows/Linux hosted scenarios receive a bounded
90-second limit. Packaging and promotion were correctly skipped. Candidate `.4` remains failed
evidence and cannot be promoted or retagged.

Local pre-tag evidence for `0.2026.8.5` (2026-08-10): `pnpm check:fast` passed; the canonical
Electron test runner passed 591 tests in 116 files with one benchmark skipped; and the complete
fresh-build Electron E2E suite passed all 20 scenarios without a flaky result. `pnpm check:package`
passed 12 packaged-smoke scenarios plus all 15 packaged E2E scenarios. The unsigned arm64
artifacts are `WriteLLM-0.2026.8.5-arm64.dmg` (249,407,853 bytes, SHA-256
`92bee77d9f4931d9ce3eae9906d1e0d5d4b8052969c4cc357623ab8ce0edd012`) and
`WriteLLM-0.2026.8.5-arm64.zip` (249,764,699 bytes, SHA-256
`6683350bf94c03ad4541ad57a3123d95982ae9cd9a2584769f1052ad0405299c`). The package evidence
truthfully records the pre-tag checkout as dirty; hosted promotion still requires a clean tagged
revision on all four targets.

Hosted candidate evidence (2026-08-10): immutable tag `v0.2026.8.5` at
`34b3b7077b16aab092145934b0cb106eacdd105b` started CI run `31371666872`. The static gate and both
macOS rows passed; the explicit 15-second database-test limit removed candidate `.4`'s macOS x64
failure. Windows passed the canonical tests/build and 17 of 20 E2E scenarios. Two longest scenarios
reached the 90-second total limit near completion, while the outline-conflict scenario had already
recovered to `Saved` before Playwright could click its transient Retry button. Linux passed the
canonical tests/build but again completed only 12 of 20 E2E scenarios: the two-stage daemon startup
still had no login collection because the runner lacked a usable `XDG_RUNTIME_DIR`, so Secret
Service attempted an unavailable graphical prompt. Packaging and promotion were correctly skipped.
Candidate `.5` remains failed evidence and cannot be promoted or retagged. Container reproduction
on Ubuntu 24.04 matched the hosted failure; a private mode-700 runtime directory plus the daemon's
single-stage `--unlock` flow then passed real `secret-tool` write, read, and cleanup probes.

Local pre-tag evidence for `0.2026.8.6` (2026-08-10): `pnpm check:fast` and the 22-case recovery
fixture verifier passed; the canonical Electron test runner passed 591 tests in 116 files with one
benchmark skipped; and the complete fresh-build Electron E2E suite passed all 20 scenarios without
a flaky result. `pnpm check:package` passed 12 packaged-smoke scenarios plus all 15 packaged E2E
scenarios and verified the no-Team-ID signature policy. The unsigned arm64 artifacts are
`WriteLLM-0.2026.8.6-arm64.dmg` (249,407,950 bytes, SHA-256
`3a8d224ebd2e860fdad30bdb14eec6354f15f536ba5b1e38143d3555485a607f`) and
`WriteLLM-0.2026.8.6-arm64.zip` (249,764,685 bytes, SHA-256
`e4dd05804ae7a2f55219739304ee1036ebb37835936c8529c07c98d0d1ee542a`). The package evidence
truthfully records the pre-tag checkout as dirty; hosted promotion still requires a clean tagged
revision on all four targets.

Hosted candidate evidence (2026-08-10): immutable tag `v0.2026.8.6` at
`71d3e54123ee39f5fdf0811a369289fd323cf422` started CI run `31374299460`. The static gate and both
macOS rows passed. Windows reached the canonical Electron suite, where three known I/O-heavy tests
exceeded Vitest's default five-second limit; later `EBUSY` cleanup reports were consequences of
those cancellations. Linux passed the real Secret Service write/read/clear probe and its canonical
tests/build, but Electron still selected `basic_text`: the workflow started `dbus-run-session`
before the wrapper created its private `XDG_RUNTIME_DIR`, so D-Bus activation retained the stale
runtime-directory environment. Thirteen of 20 E2E scenarios passed and the credential-dependent
flows failed closed. Packaging and promotion were correctly skipped. Candidate `.6` remains failed
evidence and cannot be promoted or retagged.

Local pre-tag evidence for `0.2026.8.7` (2026-08-10): `pnpm check:fast`, the 22-case recovery
fixture verifier, and the five focused release-evidence tests passed; the canonical Electron test
runner passed 591 tests in 116 files with one benchmark skipped. The three Windows-sensitive
I/O-heavy tests now have explicit 15-second limits. `pnpm check:package` passed 12 packaged-smoke
scenarios plus all 15 packaged E2E scenarios and verified the no-Team-ID signature policy. The
unsigned arm64 artifacts are `WriteLLM-0.2026.8.7-arm64.dmg` (249,407,856 bytes, SHA-256
`3e88e0374dafa4b558a486e97ee542abe5904a55b60cc62f60de000729126ee6`) and
`WriteLLM-0.2026.8.7-arm64.zip` (249,764,836 bytes, SHA-256
`fc87712ac628ee6f0194efa14f31364a1848a752f4412fd1f3ccbd2bdf5e8a30`). A real Electron 43 probe
on Ubuntu 24.04 selected `gnome_libsecret` and passed encrypted write/read round-trip verification
after the wrapper created its private runtime directory before starting D-Bus. The package evidence
truthfully records the pre-tag checkout as dirty; hosted promotion still requires a clean tagged
revision on all four targets.

Hosted candidate evidence (2026-08-10): immutable tag `v0.2026.8.7` at
`746da6c09ea8fe7d28bedd143a1a29ec143ee532` started CI run `31377192686`. The static gate passed
in 1m1s; macOS arm64 passed in 6m13s, macOS x64 in 7m14s, and Windows x64 in 13m20s. Linux passed
the Secret Service write/read/clear probe plus its canonical Electron tests/build, but the real
application still reported `basic_text`. Thirteen of 20 E2E scenarios passed; the seven failures
all followed fail-closed credential saves, and the Linux row ended after 18m23s. Packaging was
correctly skipped and no promotion workflow was dispatched. Candidate `.7` remains failed evidence
and cannot be promoted or retagged.

Budget-aware remediation in progress (2026-08-10): the Linux wrapper now provisions the private
runtime directory before D-Bus, uses GNOME Keyring's login/start lifecycle, verifies Secret Service,
and launches Electron 43 itself to require `gnome_libsecret` plus an encrypted round trip before it
runs E2E or packaging. The tag workflow also has a separately dispatchable Linux credential
preflight that gates all four expensive Electron rows, and the promotion workflow gates its four
candidate rows on the same preflight. No next immutable tag is created until that low-cost hosted
probe succeeds.

Local remediation evidence (2026-08-10): the real Electron preflight passed as an unprivileged user
in an Ubuntu 24.04 container and reported `available=true`, `backend=gnome_libsecret`, and a
successful encrypted round trip. The same wrapper then passed a Playwright Electron launch, while a
deliberate `--password-store=basic` launch failed in about four seconds before any suite could run.
`check:write`, `check:fast`, the 22-case recovery-fixture verifier, and the canonical Electron test
runner passed with 116 files and 591 tests; one opt-in benchmark remained skipped. The local
macOS arm64 package gate also passed its unpacked smoke, all 15 packaged E2E scenarios without
flakes or skips, and DMG/ZIP inspection. This local evidence authorizes only one low-cost hosted
preflight on `main`; it does not authorize a new tag or four-platform matrix unless that preflight
also reports `gnome_libsecret`.

The first low-cost hosted preflight, CI run `31380305789`, stopped after 2m26s before the
credential assertion because direct Electron startup rejected GitHub's non-setuid
`chrome-sandbox`; the static job passed in 53s and every matrix/package job was skipped. This is an
infrastructure-launch failure rather than credential evidence. Playwright's Electron launcher
already supplies `--no-sandbox` by default on this runner, so the standalone probe now supplies the
same CI-only switch. This does not change product launch arguments or packaged application policy.

The authorized corrected preflight, CI run `31380991013` at
`3aacf76ec3300741c18ee9313d01d471a72db12e`, passed the static gate in 1m0s and the Linux
credential preflight in 2m26s. The real Electron 43 process selected `gnome_libsecret` and passed
its encrypted round trip; every Electron matrix and package job was skipped. This satisfies the
budget guard for one new immutable `v0.2026.8.8` candidate and is not itself cross-platform or
promotion evidence.

Local pre-tag evidence for `0.2026.8.8` (2026-08-10): `check:write`, `check:fast`, the 22-case
recovery-fixture verifier, and all five focused release-evidence tests passed. The no-identity
macOS arm64 package gate then passed all 12 packaged smoke scenarios and all 15 manifest-selected
packaged E2E scenarios without failures, flakes, or skips. Its unsigned artifacts are
`WriteLLM-0.2026.8.8-arm64.dmg` (249,407,946 bytes, SHA-256
`b5d00e34bd87e8087cb453d341ba8603905efb867e5e239014c5b5890d9b8aea`) and
`WriteLLM-0.2026.8.8-arm64.zip` (249,764,681 bytes, SHA-256
`a881eb6174660d21aaa7163fff245af1be6bac49f37df8f5c1268000ca91c7fb`). The package evidence
truthfully records the pre-tag checkout as dirty; hosted promotion still requires a clean tagged
revision on all four targets.

Hosted candidate evidence for `v0.2026.8.8` (2026-08-10): CI run `31381711382` at
`7312f01e0230a0fe8e4fd4c8ec34887a366d4b9a` passed the static gate, macOS arm64 Electron row in
3m14s, and macOS x64 Electron row in 6m32s. Windows and Linux failed their complete E2E steps; the
dependent package matrix was therefore skipped and no dry-run was dispatched. The candidate is
retained as audit evidence.

Local pre-tag evidence for `0.2026.8.9` (2026-08-10): `check:write`, `check:fast`, the 22-case
recovery-fixture verifier, 593 canonical Electron tests in 116 files, and all seven focused
release-evidence tests passed; one opt-in benchmark remained skipped. The no-identity macOS arm64
package gate passed all 12 packaged-smoke scenarios and all 15 manifest-selected packaged E2E
scenarios without failures, flakes, or skips. Its unsigned artifacts are
`WriteLLM-0.2026.8.9-arm64.dmg` (249,407,988 bytes, SHA-256
`1303ce912224a1a3430dd5197fcc6b3442f756ab061d3e9e81fcda76bbd493cf`) and
`WriteLLM-0.2026.8.9-arm64.zip` (249,764,679 bytes, SHA-256
`02a99e70ebfa737aff3d0aa47e55d1569aea9b2204eb27bae4cfbef763a34442`). The package evidence
truthfully records the pre-tag checkout as dirty. Exactly one `v0.2026.8.9` follow-up is authorized
to encode and run the explicit two-row macOS target set; Windows/Linux and any further candidate
tags remain deferred.

Hosted candidate evidence for immutable `v0.2026.8.9` (2026-08-10): tag CI run `31385773729` at
`39c9b40b48f9b3367c8d82f118607bc89210a03b` passed the static gate in 54s, macOS arm64 Electron
row in 5m22s, and macOS x64 Electron row in 6m54s. Linux was skipped and no Windows row was
generated. Both package rows passed 12 packaged-smoke scenarios and all 15 packaged E2E scenarios,
then built their DMG/ZIP files. electron-builder 26.15.3 subsequently inferred publishing from the
tag and failed closed because `GH_TOKEN` was intentionally absent, so package evidence was not
uploaded. Protected macOS-only dry-run `31387596825` verified the exact tag and two-row target set,
passed the same application and packaged checks on both architectures, and failed at the same
implicit-publish boundary. Its promotion job was skipped, its artifact list is empty, and no
GitHub Release exists for the tag.

Local post-candidate remediation evidence (2026-08-10): every package-gate electron-builder
invocation now supplies `--publish=never`; promotion remains the separate protected workflow's
responsibility. `check:fast` passed, and a local run with `CI=true`, `GITHUB_ACTIONS=true`, a tag
ref, and no `GH_TOKEN` passed the macOS arm64 package gate: 12 packaged-smoke scenarios, all 15
packaged E2E scenarios with no failures/flakes/skips, and inspected DMG/ZIP output. The DMG is
249,407,933 bytes with SHA-256
`253d0d70541b041c76e7d6f6a6808884c17248eb8f3dbca00a5e5120f15e8db2`; the ZIP is 249,764,679
bytes with SHA-256 `e47701fdf7e6b432f8fb8eaa9495feaba33506660ec4751e1931eef2e97b22be`.
This proves the observed implicit-publish failure is fixed locally, but it cannot change immutable
`.9`. On 2026-08-10 the user authorized exactly one immutable `v0.2026.8.10` macOS arm64/x64 tag
CI and, only if that run succeeds, exactly one macOS-only dry-run. Windows/Linux, reruns, and
production remain unauthorized.

Local pre-tag evidence for `0.2026.8.10` (2026-08-10): `check:write`, `check:fast`, the 22-case
recovery-fixture verifier, all seven focused release-evidence tests, and workflow YAML parsing
passed. A simulated tag-CI macOS arm64 package gate explicitly removed GitHub tokens and passed all
12 packaged-smoke scenarios plus all 15 packaged E2E scenarios without failures, flakes, or skips.
It did not infer publishing. The unsigned DMG is 249,407,827 bytes with SHA-256
`709a2005ddfcf3fcd0bd150405cd50d47312376cb8ff5a423bf9228a6b40a987`; the ZIP is 249,764,704
bytes with SHA-256 `cd663ac82eeebd70036c997ad9913d993635c19262a0aa32bd48b1cb16eeac3a`.
The evidence truthfully records the pre-tag checkout as dirty; the hosted verifier still requires
the final committed tag revision to be clean.

Hosted pause evidence for `v0.2026.8.10` (2026-08-10): CI run `31390617065` at
`4221da838afbbc41b02eb1c29a15914d89a07bf8` passed the static gate, macOS arm64 and macOS x64
Electron rows, and the macOS arm64 package row. After the account exhausted its included Actions
minutes, the user manually cancelled the macOS x64 package row while electron-builder was
constructing its DMG/ZIP artifacts. The candidate uploaded no x64 package evidence, and no `.10`
dry-run or production promotion was started. The user then directed that CI never run under any
condition. Both GitHub workflows were manually disabled, and their definitions were retained only
with `.yml.disabled` suffixes so GitHub cannot recognize them as executable workflows. Checkpoint
26.9 remains incomplete and may resume only after new explicit approval.

Resumption authorization (2026-08-29): the repository is now public and the user explicitly
authorized restoring the complete cross-platform build. `ci.yml` is executable again and accepts
only pushed tag refs; it has no pull-request, branch-push, schedule, or manual-dispatch trigger.
The static/fixture gate precedes native Electron/E2E and unsigned packaging rows on Windows x64,
macOS arm64, macOS x64, and Linux x64. `release-candidate.yml.disabled` remains non-executable, so
this resumption grants no signing, promotion, or GitHub Release authority. No hosted result is
claimed until a new tag is pushed and the matrix completes.

Hosted candidate evidence (2026-08-29): immutable `v0.2026.8.27` at
`f594575b99bde500352c5cc32dada6aad302cfda` started tag-only run `33247388140`. Checkout, pnpm 12,
and Node setup passed, then the frozen install failed because the upgraded package-manager pin had
not yet been represented in pnpm 12's package-manager dependency lock metadata. All dependent rows
were correctly skipped. The tag remains immutable failed evidence; the generated lock metadata and
new `v0.2026.8.28` candidate address this exact failure without rerunning or moving `.27`.

Hosted candidate evidence (2026-08-29): immutable `v0.2026.8.28` at
`f0b131e5b022fc13e1df6b4f63591cab70d2a6c0` started tag-only run `33247497461`. The static and
fixture gate, frozen pnpm 12 install, and Linux credential preflight passed. Native Electron rows
then exposed four portability classes before packaging: a Unicode fixture exceeded ext4's
per-component byte limit; two Windows tests removed projects while SQLite handles remained open;
two bounded Windows tests exceeded Vitest's default five-second budget; and the complete Agent and
provider-settings Electron scenarios exceeded the hosted macOS 45-second budget while still
making functional progress. No product assertion failed in those macOS traces, every package row
was correctly skipped, and the immutable tag remains failed evidence.

Local post-candidate remediation evidence (2026-08-29): the Unicode fixture remains deliberately
long but fits portable component limits; change-set batch fixtures close their tracked databases
before directory removal; the two intentionally heavy Vitest cases have explicit 15-second test
budgets; and hosted Electron runners receive 90 seconds while local macOS development remains at
45 seconds. Across focused canonical Electron runs, all 71 affected-file tests passed. A fresh
production build and `CI=true` focused Real-Electron run passed both previously timed-out scenarios
in 21.2 seconds total with no failures, flakes, or skips. `check:fast` also passed. This local
evidence does not complete Checkpoint 26.9; a new immutable tag must pass the complete hosted
matrix.

Hosted candidate evidence (2026-08-29): immutable `v0.2026.8.29` at
`7cba97223476f163b0adb0d361fcda764b5193ca` started run `33259789028`. Frozen installation
passed, then recovery-fixture verification correctly rejected the changed manuscript-export test
because its manifest still held the pre-timeout-change source digest. Electron and package rows
were skipped. Local verification then identified the same stale digest for the changed Agent
session test. The tag remains immutable failed evidence; both manifest digests and release
metadata are corrected for candidate `.30`.

Hosted candidate evidence (2026-08-29): immutable `v0.2026.8.30` at
`77c8d53675042c3781a4300f14c4985d45485545` started tag-only run `33259908430`. The corrected
static/fixture gate and Linux credential preflight passed. macOS x64 then exposed two intentionally
heavy tests still using Vitest's five-second default. macOS arm64 completed Electron tests and the
full E2E suite with one index-recovery retry, which the no-flake gate correctly rejected. Windows
completed Electron tests and exposed CRLF-sensitive Writing Skill body comparison, two floating
control clicks against remounting nodes, an eight-pixel native textarea metric difference, one
inline-math render delay, and a BlockNote floating-reference loop when leaving a focused editor.
Package rows were correctly blocked and the tag remains immutable failed evidence.

Local post-candidate remediation evidence (2026-08-29): the two heavy tests now carry explicit
15-second budgets; SKILL.md parsing normalizes CRLF before comparison with Pi's normalized body;
floating menu controls use their semantic click events without Playwright stability waits; title
overflow accepts the observed native eight-pixel rounding; math and recovery waits retain bounded
hosted budgets; and citation navigation first blurs the editor to close BlockNote's floating
reference. All 79 affected Electron tests passed. A fresh production build and `CI=true` focused
Real-Electron run passed all seven affected scenarios in 15.8 seconds with no failures, retries,
flakes, or skips. Candidate `.31` is required for complete hosted matrix evidence.

Hosted candidate evidence (2026-08-29): immutable `v0.2026.8.31` at
`fe9f21048560b1402c9871555178b8502b7baac7` started tag-only run `33261730182`. The static and
fixture gate, Linux credential preflight, macOS x64 row, and macOS arm64 row passed without an E2E
retry. While the Windows and Linux rows were still active, the complete `.30` Linux diagnostics
established that the shared wrapper launched the safeStorage probe in one temporary Xvfb server,
destroyed that server, and then delegated E2E to a second nested Xvfb server. The probe therefore
reported `gnome_libsecret`, but the actual application selected `basic_text`; 17 provider-dependent
failures were downstream consequences rather than independent UI defects. The same trace showed
the long workspace-reopen scenario satisfying its assertions until its final interaction reached
the suite-wide 90-second ceiling.

Local post-candidate remediation evidence (2026-08-29): the Linux wrapper now creates one DBus and
Xvfb lifetime before starting gnome-keyring, then runs the Secret Service read/write probe,
Electron safeStorage probe, and delegated E2E or package command inside that same display session.
Both active and disabled workflow definitions no longer add a nested Xvfb. The long
workspace-reopen scenario alone has a 180-second Playwright budget. `bash -n`, diff checks,
`check:fast`, all 27 recovery fixtures, the focused scenario under `CI=true`, and the complete
Electron gate passed locally: 201 test files and 1,160 tests passed with three intentional
benchmark skips, followed by a successful production build. Candidate `.32` is required for the
corrected complete hosted matrix.

Hosted candidate evidence (2026-08-29): immutable `v0.2026.8.32` at
`299d048546aed7362a8e7132f3eac2f534aec8b4` started tag-only run `33262923466`. Static, Linux
credential preflight, and macOS x64 passed. Windows completed 1,152 of 1,160 tests over 299 seconds;
eight database-heavy tests exceeded five- or fifteen-second budgets and their interrupted cleanup
produced secondary SQLite `EBUSY` messages. macOS arm64 completed its Electron gate and failed only
the selection quick-action E2E because `Control/Command+A` left a collapsed BlockNote cursor. Linux
continued through the single-session Secret Service E2E while the independently actionable
remediation was prepared; package rows remained blocked by the failed Electron matrix.

Local post-candidate remediation evidence (2026-08-29): hosted Windows Vitest receives a bounded
30-second default while other environments retain five seconds, and the retention-heavy mutation
test carries the matching explicit budget. The six affected Electron files passed all 159 tests.
Quick-action selection now uses `End` plus `Shift+Home`; its complete focused E2E passed without a
retry. The prior `.31` Windows citation scenario no longer calls `blur()` on a remounting BlockNote
locator and instead focuses the stable section-title input before navigation; its focused E2E also
passed. `check:fast`, all 27 recovery fixtures, and diff checks passed. Candidate `.33` is required
for hosted confirmation.

Hosted candidate evidence (2026-08-29): immutable `v0.2026.8.33` at
`408229c93e8c28c5a92a263fcd412ddbc557f3f3` completed tag-only run `33264429276`. Static, Linux
credential preflight, macOS x64, and macOS arm64 passed. Windows passed 1,157 of 1,160 tests; two
revision-retention tests still overrode the hosted default with 15 seconds, and the mutation
retention stress test reached its explicit 30-second limit. Linux passed 30 of 47 scenarios. Every
credential-free scenario passed, while all 17 credential-backed scenarios observed `basic_text`
after the standalone Electron probe had reported `gnome_libsecret`; package rows were correctly
blocked.

Local post-candidate remediation evidence (2026-08-29): the three proven Windows stress tests now
have explicit 60-second budgets, and their complete two-file run passed 39 tests. The Linux wrapper
uses standalone Electron only for the isolated `--verify-only` preflight. E2E and package paths
start the delegated command directly after the Secret Service probe; each real Playwright Electron
process validates the requested password-store switch, selected `gnome_libsecret` backend,
encryption availability, and round trip before returning its renderer. `bash -n`, `check:fast`, two
focused Real-Electron scenarios, and recovery-fixture verification passed locally. Candidate `.34`
is required for hosted confirmation of the Linux process boundary.

Hosted candidate evidence (2026-08-29): immutable `v0.2026.8.34` at
`b224704f9585fddbc49bc6956b91c8f7461c391f` completed tag-only run `33274815298`. Static, Linux
credential preflight, and macOS arm64 passed. Windows passed all 1,160 Electron tests, then passed
44 of 47 E2E scenarios; one duplicate-text locator retried successfully, while explicit selection
and a BlockNote/Floating UI reference loop failed. macOS x64 passed 1,159 of 1,160 tests before one
compaction stress case reached the default five-second budget. Linux's real-process credential
guard rejected launches from the first scenario; repeated worker teardown timeouts exhausted the
45-minute job before the deferred Playwright failure summary, and package rows were blocked.

Local post-candidate remediation evidence (2026-08-29): the compaction stress test now has a
60-second budget; quick actions use Playwright's explicit cross-platform text selection; a pnpm
patch makes BlockNote 0.54.0's popover effect depend on Floating UI's stable setters instead of the
changing refs aggregate; and the Linux wrapper supplies Electron's documented GNOME desktop
identity while invalid real-process probes emit immediate metadata and terminate within a bounded
cleanup. The complete Electron gate passed 201 files and 1,160 tests followed by a production
build. `check:fast` and both affected E2E scenarios passed without retries. Candidate `.35` is
required for hosted confirmation.

Hosted candidate evidence (2026-08-09): immutable tag `v0.2026.8.3` at
`53f4d84c266783f9256f015ec4dfae63aafbee92` started CI run `31339606693`. The static/fixture gate
and both macOS rows passed. Windows reached the complete test suite and exposed six portability or
fixture-lifecycle failures: Git's CRLF checkout changed the provider-logo digest; concurrent asset
publication attempted a replace-existing rename that Windows rejects; nested snapshot staging
crossed the legacy `MAX_PATH` boundary; and one test retained a read-only SQLite handle through
cleanup. Linux again completed 12 of 20 serial E2E scenarios because the `gnome-libsecret` switch
followed Electron's development application path and was parsed as an application argument instead
of a Chromium switch. Packaging and promotion were correctly skipped. The candidate remains failed
evidence and cannot be promoted or retagged.

Local pre-tag evidence for `0.2026.8.4` (2026-08-09): provider-logo SVGs now have repository-enforced
LF endings; content-addressed manuscript assets use atomic no-replacement publication and verify an
existing winner; snapshot staging names leave room for SQLite's nested backup suffix; and the
test-owned database handle is explicitly closed. Development E2E places the documented Linux
password-store switch before the application path. `pnpm check:fast` passed; the canonical Electron
test runner passed 591 tests in 116 files with one benchmark skipped; the recovery fixture verifier
passed 22 cases from 20 sources with SHA-256
`71ec06fefb15070c2e110c00f510c2820bf4fe64caa123deafe2089813885943`; and the complete local
Electron E2E suite passed all 20 scenarios. `pnpm check:package` passed 12 packaged-smoke scenarios
plus all 15 packaged E2E scenarios. The unsigned arm64 artifacts are
`WriteLLM-0.2026.8.4-arm64.dmg` (249,407,820 bytes, SHA-256
`dc71cc9ff619de0cc21cd660aa71254756abceba6c6f72c88934e63c50cda17c`) and
`WriteLLM-0.2026.8.4-arm64.zip` (249,764,661 bytes, SHA-256
`03309f6ce1dcd3ac5fb65cb61c3029b77f4b51570cf4aa63ddc8ed4d0cc883e6`). The package evidence
truthfully records the pre-tag checkout as dirty; hosted promotion still requires a clean tagged
revision on all four targets.

## Phase 10 deferred work

- Clone/Save As with a new `projectId`, multiple manuscripts, external-edit synchronization, and
  project-wide file watching.
- Snap distribution and any auto-updater/update-feed subsystem.
- Provider reasoning controls, multi-agent/sub-agent workflows, and long-term Agent memory.
- Mandatory live paid-provider calls in CI. Live certification remains an explicitly authorized
  release checklist item and never replaces deterministic loopback coverage.
