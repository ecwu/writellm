# WriteLLM Current Plan

Status: Phase 28 Checkpoint 79 is complete under ADR 070.
Checkpoint 77 remains independently paused; CP78 is authorized to run ahead. Immutable tag-only candidates
`.28`–`.35` exposed portable fixture, hosted timing,
recovery-manifest, CRLF, Windows Renderer/selection, and Linux credential-process boundaries.
Candidate `.37` proved both independent macOS pipelines through artifact upload, while Windows and
Linux exposed one repeated-reference loop, one duplicate final-response locator, and two Linux
90-second scenario budgets. Candidate `.38` proved those fixes reached all hosts, then identified
the underlying virtual position-reference update loop plus three hosted UI timing races. Candidate
`.39` proved the virtual-reference fix and all 47 scenarios on Windows, Linux, and macOS arm64;
macOS x64 exposed a streaming-to-persisted message overlap, Windows exposed a packaged-smoke
editor-initialization race, and Linux exposed a context-selection settlement race in packaged E2E
after its full suite passed. Candidate `.40` proved those remediations, then exposed one dropped
model-picker opening on macOS x64 and one transient KaTeX-internal assertion on Windows; Linux and
macOS arm64 completed their independent package pipelines. Candidate `.41` contains both
test-boundary remediations, then exposed three further hosted interaction races plus a slow Windows
packaged-shell startup. Candidate `.42` then completed both macOS rows and Linux through artifact
upload; Windows alone retried one section-title scenario after the test wrote before initial
project state finished hydrating. Candidate `.43` waits for that initial title state before editing
and is locally verified pending hosted confirmation.
Recorded: 2026-09-01

This file records only active delivery state. Long-lived system rules live in
[`architecture.md`](architecture.md) and the ADRs; detailed checkpoint evidence lives in the
matching Phase file under [`implementation-todo/`](implementation-todo/); completed chronology
lives in [`history/implementation-log.md`](history/implementation-log.md).

## Current state

- Candidate `v0.2026.8.49` is fully built, locally verified, committed, tagged, and pushed for the
  completed Reference citekey migration maintenance. The no-Team-ID macOS arm64 gate verified 31
  recovery fixtures from 29 sources, 53,318 ASAR entries, 12 packaged smoke scenarios, and 34/34
  packaged Electron scenarios. It produced the unpacked App, DMG, and ZIP under
  `dist/macos-arm64`. Commit `39e9a84` and annotated tag `v0.2026.8.49` were atomically pushed to
  GitHub. Signing, notarization, GitHub Release creation, promotion, and publication remain outside
  scope.

- Reference citekey migration maintenance is complete. Citation Coverage now resolves canonical
  manuscript citations by exact project citekey and presents Reference title/citekey ahead of the
  attachment filename. Draft checks map canonical citations back to their evidence Knowledge
  items, Agent Knowledge reads fail closed when no registered Reference exists, and citation-click
  resolution prefers exact citekey. Unique Reference title and exact Knowledge display-name
  matching remain only as explicit legacy-token compatibility. Focused tests, `check:fast`, the
  complete Electron suite plus production build, the scoped Impeccable detector, and
  `git diff --check` passed. No schema, RAG/index, package, release, commit, tag, or push action was
  performed.

- The current dirty Agent Reference citation-fix source passed the complete no-Team-ID macOS
  arm64 package gate. It verified 31 recovery fixtures, 53,318 ASAR entries, 12 packaged runtime
  smoke scenarios, and all 34 packaged Electron scenarios, then produced a trial App, DMG, and
  ZIP under `dist/macos-arm64`. No signing identity, notarization, release, commit, tag, push,
  promotion, or publication action was performed.

- Agent Reference citation projection maintenance is complete. Production `MainAgentReadTools`
  now receives the project Reference authority, so `search_knowledge` and `read_citations` return
  the linked project citekey and bibliographic metadata instead of masking a missing dependency
  with a `doc-*` compatibility key. Previously generated compatibility tokens resolve through
  their exact encoded Knowledge UUID when that item is linked to a Reference; no title, DOI, or
  filename matching is introduced. Focused tests, `check:fast`, all 1,234 canonical tests with
  three benchmark skips, and the production build passed.

- Checkpoint 79 is complete. It unifies the split Zotero metadata/PDF dialogs into one
  Reference-first prepare/confirm workflow, adds explicit completion and relink targets, and
  prevents bibliography attachment imports from leaving orphan incomplete References. It retains
  ADR 070's connector, citekey, Reference/Knowledge, RAG, and index boundaries. The canonical suite
  passed 1,232 tests with three benchmark skips, the production build and `check:fast` passed, and
  all 48 fresh Electron E2E scenarios passed. Detailed evidence lives in
  [`implementation-todo/phase-28.md`](implementation-todo/phase-28.md).

- Checkpoint 78 is complete. WriteLLM now has project-authoritative Reference metadata with stable
  citekeys, a bounded single-file Zotero/Better BibTeX connector, explicit PDF attachment review,
  bilingual citation clusters, evidence-bound Agent citation policy, opt-in CSL formatting, and
  deterministic bibliography/Pandoc export without changing the existing RAG index authority.
  The final gates passed 1,228 Electron-hosted tests with three benchmark skips, all 47 fresh
  Electron E2E scenarios, 31 recovery fixtures, 12 packaged smoke scenarios, and all 34 packaged
  Electron scenarios. Production and full dependency audits reported zero known vulnerabilities;
  frozen installation and the scoped Impeccable detector passed. The local watcher evidence is
  macOS plus cross-platform pure logic only; Windows/Linux runtime behavior remains unclaimed.

- Candidate `v0.2026.8.48` is fully built, verified, committed, tagged, and pushed for the
  completed Checkpoint 78 Reference and citation workflow. The no-Team-ID macOS arm64 gate
  verified 31 recovery fixtures from 29 sources, 53,318 ASAR entries, 12 packaged smoke scenarios,
  and 34/34 packaged Electron scenarios. It produced the unpacked App, DMG, and ZIP under
  `dist/macos-arm64`. Signing, notarization, GitHub Release creation, promotion, and publication
  remain outside this authorization.

- Candidate `v0.2026.8.47` is fully built, verified, committed, tagged, and pushed for the completed
  Checkpoint 76.1 trace work. Annotated tag `v0.2026.8.47` points to clean source commit `7bb8552`;
  tag-only GitHub Actions run `33345029753` is in progress. Signing, notarization, GitHub Release
  creation, promotion, and publication remain outside this authorization.
- Checkpoint 76.1 is complete. Project-local content-addressed Agent traces, SQL reconstruction
  views, fail-closed Worker/Main persistence acknowledgements, physical retry evidence, and tool,
  Skill, compaction, title, and image correlations are implemented without putting private bodies
  in Pino. The canonical suite passed 1,204 tests with three benchmark skips; `check:fast`, the
  Electron build gate, all 47 fresh Electron E2E scenarios, and the complete no-Team-ID package
  gate with 34 packaged scenarios passed. A 7,936,308-byte repeated-history sample occupied
  330,580 payload bytes after deduplication (95.83% reduction) and reconstructed 12 requests in
  about 1.73 seconds on the local Electron runtime.

- Local no-Team-ID candidate `v0.2026.8.46` is fully built, verified, and pushed from source commit
  `1f53c5c`; tag-only GitHub Actions run `33341907788` completed successfully. The gate verified 31 recovery fixtures from 29 sources,
  53,288 ASAR entries, Electron 43.4.1 / ABI 148 arm64 native resources, all 12 packaged smoke
  scenarios, and all 34 packaged Electron scenarios without flakes, skips, or failures. It
  produced the unpacked App, DMG, and ZIP under `dist/macos-arm64`; tag CI is aligned with the
  accepted pnpm 11.17.0 pin. No Developer ID signing, notarization, GitHub Release, promotion, or
  publication was performed.
- Agent staged-tool preflight and citation recovery maintenance is complete. Each model request now
  retains the exact visible tool envelope and the first applicable policy failure, so an activated
  writing tool cannot be mislabeled `unknown_tool`; repeated same-response diagnostics are
  collapsed without changing the underlying one-mutation policy. Citation failures now continue
  from request-scoped `none`, `searched`, or `expanded` evidence state instead of restarting a
  completed search. The two focused suites passed 37 tests; `check:fast`, all 1,194
  Electron-hosted tests with three benchmark skips, the production build, and diff checks passed.
- Agent context-compaction status presentation maintenance is complete. A durable final checkpoint
  or failure now settles the matching historical start marker, so the timeline cannot show a stale
  `Summarizing earlier conversation…` spinner beside its outcome. Non-final rolling checkpoints
  retain the live marker until the same compaction reaches a terminal outcome. The focused Agent
  Renderer suites passed 49 tests; Renderer typechecking, Biome, and diff checks passed. The
  combined `check:fast` gate remains blocked in an unrelated dirty
  `session-service.tools.test.ts` fixture that omits its required `blockType`.
- The current Gemini/Vertex read-section maintenance source passed the complete no-identity macOS
  arm64 package gate. It verified 31 recovery fixtures from 29 sources, 53,288 ASAR entries,
  Electron ABI 148 native resources, all 12 packaged smoke scenarios, and all 34 packaged Electron
  scenarios without flakes, skips, or failures. The gate produced a no-Team-ID unpacked App, DMG,
  and ZIP; no Developer ID signing, notarization, release, commit, tag, push, promotion, or
  publication was performed.
- Agent read-section activity presentation maintenance is complete. Completed activity groups
  remain collapsed by default; expanding them now labels each successful read with the section
  title parsed from Main's validated `read_section` result. Model-authored arguments and narration
  are not used as title authority, and section/block identifiers are not rendered. Running,
  failed, stopped, or legacy malformed reads retain generic labels. Focused Renderer coverage,
  `check:fast`, all 1,189 Electron-hosted tests with three benchmark skips, the production build,
  and the Impeccable UI detector passed.
- Gemini/Vertex `read_section` compatibility maintenance is complete. Durable diagnostics proved
  ten pre-dispatch failures across three runs all came from the same blockless
  `{ sectionId, view: "canonical" }` shape; one representative run spent an avoidable 18,275 input
  and 374 output tokens on recovery before four corrected reads succeeded. The model-visible
  description now distinguishes whole-section summary reads from block-scoped canonical reads,
  and the Worker narrowly normalizes only the observed blockless canonical form to summary before
  Pi validation. Exact canonical block reads and every Main authorization/domain check remain
  unchanged. Focused Pi/Worker coverage, `check:fast`, all 1,187 Electron-hosted tests with three
  benchmark skips, and the production build passed.
- The post-fix macOS arm64 test App passed the complete no-identity package gate from the current
  dirty source state. The gate verified 31 recovery fixtures from 29 sources, 53,288 ASAR entries,
  all 12 packaged smoke scenarios, and all 34 packaged Electron scenarios without flakes, skips,
  or failures, then produced the unpacked App, DMG, and ZIP. No Apple Team ID signing,
  notarization, release, commit, tag, push, promotion, or publication was performed.
- Image-generation lifecycle maintenance is complete. Generated assets whose later validation,
  editor barrier, manuscript insertion, or candidate publication fails now leave the durable
  `generating` state, and project-session startup terminalizes request-scoped generations
  interrupted by a prior app lifetime. The full 2,000-character alternative-text contract is
  preserved while the derived BlockNote image name is bounded to its separate 500-character
  limit, preventing the reported post-generation metadata rejection.
- Agent model-selection recovery maintenance is complete. Provider changes now refresh an open
  Agent panel from Main's bounded catalog snapshot, New conversation refreshes before reuse, and
  conversations whose stored model no longer exists expose an explicit replacement picker rather
  than a misleading setup-only dead end. Historical selections are never silently redirected.
- GitHub Release `WriteLLM 0.2026.8` is publicly available from immutable candidate tag
  `v0.2026.8.45` as the repository's Latest release. It contains seven unsigned Windows, macOS,
  and Linux packages plus `SHA256SUMS`, four platform evidence files, and an explicit public
  unsigned manifest. The release notes warn that the artifacts are unsigned and not notarized.
- Hosted workflow maintenance removes the final Node 20 Action runtime: both tag CI and the
  disabled release-candidate definition pin `pnpm/action-setup` v6.0.10, whose JavaScript action
  runs on Node 24. Project commands remain pinned to Node 24.15.0, matching Electron 43's embedded
  Node major.
- Thermo-Nuclear P1 maintenance is complete. Writing Skill publication now tracks staging,
  prior-generation movement, and publication as one compensating transaction; Agent tool schema
  construction rejects unsupported roots instead of exposing empty grammar-sampler fields; and
  tag-only CI verifies the canonical release tag, version, revision, and clean checkout before
  dependency installation or platform builds.
- Thermo-Nuclear structural remediation is complete. Shared worker protocol/error projection,
  knowledge-filter SQL, BlockNote inline-text projection, and Agent model selection now have one
  implementation each. AgentPanel, WritingWorkspace, provider settings, preload, Agent
  session/mutation helpers, project history-restore recovery, and the two largest Agent test suites
  are decomposed behind typed boundaries without changing product behavior.
- Candidates `.31`–`.33` show that a standalone Linux Electron safeStorage probe is not evidence
  for the later application process: the probe selected `gnome_libsecret`, while every provider
  scenario later observed `basic_text`. The wrapper now reserves standalone Electron probing for
  the isolated preflight job. E2E and package commands start no sacrificial Electron process, and
  each real Playwright application verifies its requested switch, selected backend, availability,
  and encrypted round trip before exposing a renderer.
- Candidate `.32` passed static, Linux credential preflight, and macOS x64. Its Windows Electron
  gate ran 1,160 tests for 299 seconds and exposed eight hosted-runner timeouts rather than failed
  assertions; its macOS arm64 row exposed one BlockNote select-all interaction that left a collapsed
  cursor. Hosted Windows now receives a bounded 30-second Vitest budget, the retention-heavy test
  matches it, and quick actions create an explicit keyboard range. The prior `.31` Windows citation
  failure is also corrected by moving focus to the stable section-title input before workspace
  navigation instead of asking the remounting editor locator to blur.
- Candidate `.33` passed static, credential preflight, macOS x64, and macOS arm64. Windows reduced
  from eight timeouts to three: two tests still carried explicit 15-second overrides and one
  revision-retention stress test reached its 30-second override; all three now have explicit
  60-second budgets. Linux passed 30 credential-free scenarios but failed all 17 credential-backed
  scenarios because the pre-E2E Electron probe and actual application did not share the selected
  secure backend. Candidate `.34` removes that cross-process assumption.
- Candidate `.34` passed static, Linux credential preflight, and macOS arm64. Windows passed all
  1,160 Electron tests, then its E2E passed 44 of 47 scenarios, retried one strict-locator scenario,
  and failed selection portability plus a BlockNote/Floating UI reference loop. macOS x64 passed
  1,159 of 1,160 tests before one compaction stress case reached Vitest's five-second default.
  Linux's real-process backend guard rejected every application launch; repeated 90-second worker
  teardowns exhausted the 45-minute job before Playwright could print its deferred summary.
- Candidate `.35` gives the macOS stress case a 60-second budget, uses Playwright's cross-platform
  text selection, patches BlockNote 0.54.0 to depend on Floating UI's stable setters instead of its
  changing aggregate refs object, advertises the supported GNOME desktop identity in the hosted
  Secret Service session, and emits immediate backend metadata with bounded failed-launch cleanup.
- Candidate `.35` passed static, Linux credential preflight, and both macOS rows. Windows stopped
  during frozen installation because its checkout converted the pnpm patch to CRLF. Linux passed
  all 1,160 tests and the production build, then every E2E launch reported
  `requested=basic`, `selected=basic_text`: Playwright 1.62.1's Electron loader appended its own
  `--password-store=basic` after the requested `gnome-libsecret` switch. Candidate `.36` enforces
  LF for repository patches and suppresses that Playwright default only for the explicit hosted
  `gnome-libsecret` E2E session.
- Candidate `.36` passed static, Linux credential preflight, macOS x64, Windows frozen install plus
  all 1,160 Electron tests, and Linux's Electron/build gate. Linux proceeded through normal E2E
  launches with the real secure backend instead of being rejected at startup. Windows E2E passed
  46 of 47 scenarios before the citation-coverage editor reproduced React error 185: BlockNote's
  effect no longer depended on the aggregate refs object, but the captured Floating UI setter
  callbacks themselves were still unstable. macOS arm64 passed its complete Electron gate and all
  scenarios after one retry, but the evidence policy correctly rejected the outline-conflict
  scenario as flaky.
- Candidate `.37` stores the latest Floating UI setters in stable React refs, orders the outline
  test's local draft before its external mutation, and replaces the globally coupled validation and
  package matrices with four independent platform pipelines. Each platform now performs its own
  Electron gate, E2E, and native package gate; one failure stops only that platform. Linux's real
  credential preflight is part of the Linux pipeline, while the shared static/fixture gate still
  runs once before all four.
- Candidate `.37` completed successfully through native packaging and artifact upload on macOS
  arm64 and macOS x64. Windows and Linux both reproduced React error 185 because the stable setter
  still received the same DOM reference on every effect turn; Windows also found an ambiguous
  repeated final-response locator. Linux additionally showed that two credential-backed scenarios
  reached their final action at about 88 seconds and hit the 90-second total budget rather than
  hanging inside Secret Service. Candidate `.38` deduplicates reference application, selects the
  final response explicitly, and gives only those two proven long scenarios 180-second budgets.
- Candidate `.38` passed the shared static gate and every platform's 1,160-test Electron/build gate.
  All four E2E rows then reproduced the same React error 185 at Floating UI's
  `setPositionReference`, proving the remaining loop came from a newly allocated virtual reference
  rather than its DOM reference. Hosted timing also exposed one arm64 narrow-layout sampling race,
  one arm64 dropdown-close race, two x64 first-attempt setup/materialization races, and one Windows
  menu detachment; Linux had no additional failure. Candidate `.39` keeps one delegated virtual
  reference object until its element or geometry changes, while refreshing its live callbacks, and
  waits for the specific UI/backend state before the affected assertions.
- Candidate `.39` passed the shared static gate, all four 1,160-test Electron/build gates, and all
  47 E2E scenarios on Windows, Linux, and macOS arm64 without a retry. macOS arm64 also completed
  native packaging and artifact upload. macOS x64 reached the final Agent response while its
  streaming and persisted renderings briefly overlapped; Windows completed all 47 scenarios and
  unpacked native packaging, then its packaged smoke raced an IPC-created section against the
  editor's initial section load. Linux passed its real-Secret-Service E2E, then failed the
  packaged-E2E portion of its native package gate after 31 minutes; artifact upload was skipped and
  failure diagnostics were retained. Candidate `.40` waits for the Agent response rendering to
  converge to one persisted message, waits for proposal review before inspecting older activity
  groups, waits for the selected section context and Add-context control to become enabled, and
  enters Knowledge before the packaged smoke mutates the manuscript through IPC.
- Candidate `.40` passed the shared gate and all four Electron/build gates. macOS arm64 completed
  all 47 scenarios, native packaging, and artifact upload. macOS x64 passed its grounded Agent
  scenario on retry after the model/effort trigger failed to open once; Windows likewise passed
  its native-inline-math scenario on retry after all four formulas were visibly rendered but a
  transient internal `<math>` element was absent. The strict evidence policy correctly rejected
  both flaky rows. Linux passed all 47 real-Secret-Service scenarios, its native package gate, and
  artifact upload. Candidate `.41` retries the model-picker trigger until the popover is visibly
  open and verifies the user-visible formula preview rather than KaTeX's transient internal node.
- Candidate `.41` passed the shared gate and every platform's 1,160-test Electron/build gate.
  macOS arm64 completed all 47 scenarios, native packaging, and artifact upload. macOS x64 retried
  two scenarios after a page-level Space missed the focused clarification radio and a remounting
  Whole manuscript option detached during click. Windows passed all 47 scenarios without retries,
  then its packaged smoke reached project creation before the Knowledge navigation became visible.
  Linux retried the grounded Agent scenario after `/section` did not open its slash menu. The
  no-flake policy rejected both affected E2E rows; Windows and Linux skipped their remaining
  package work after their own failures. Candidate `.42` sends keyboard input through the radio
  locator, retries remounting Agent menus until their selected state is visible, and polls the
  packaged shell until Knowledge is both navigable and loaded.
- Candidate `.42` passed the shared static/fixture gate and every platform's complete 1,160-test
  Electron/build gate. Both macOS rows and Linux passed all 47 E2E scenarios without retries,
  completed native packaging, and uploaded their platform artifacts. Windows retried only the
  section-title wrapping scenario after the test filled its title before the asynchronous initial
  `Untitled Section` state finished hydrating; the retry passed, but the no-flake policy correctly
  rejected the platform. Candidate `.43` waits for the initial title value before testing newline
  normalization and long-title layout. That scenario passed three independent no-retry runs; the
  complete local gate then passed `check:fast`, 1,160 Electron tests, all 47 E2E scenarios without
  retries, and the full no-identity package gate with 27 recovery fixtures, 12 packaged-smoke
  categories, 34 packaged E2E scenarios without retries, and structural DMG/ZIP checks.

- User-authorized Checkpoint 75 compatibility maintenance is complete. Model-visible root unions
  now expose their complete property vocabulary and common required fields at the object root while
  retaining exact branch constraints under `allOf`; this fixes the schema shape that led a real LM
  Studio run to generate 370 empty `read_section` calls.
- The current dirty macOS arm64 maintenance build passed the complete no-identity package gate and
  produced a verified App, DMG, and ZIP under `dist/macos-arm64`.
- Provider Base URLs now permit explicit HTTP access to localhost and numeric IPv4 endpoints whose
  first octet is `10`, `100`, `127`, or `192`; HTTPS remains required for all other remote hosts.
- Checkpoint 75 is complete. It adds Protocol v12 short layered descriptions, explicit
  run-local writing capability groups, exact active-envelope budgeting, and provider-neutral
  object-root tool schemas without changing outer profile authority or persistence.
- Checkpoint 74 is complete. It adds Protocol v11 hash-bound table inspection and typed table
  proposals, bounded review presentation, native header editing, and portable Markdown/PDF/LaTeX
  projections without changing section schema v5 or adding a dependency, migration, worker, or
  authority boundary.
- Checkpoint 73 is complete. It applies summary-first AI interaction patterns to the existing
  Agent sidebar while preserving the shadcn/new-york visual language and every Agent authority
  boundary. Work is Renderer-only: header status, activity disclosure, task and attention docks,
  composer context, responsive behavior, and accessibility.
- Checkpoint 72 is complete. It replaces generic tool-result projection with exhaustive
  writing-specific continuation facts, excludes re-readable content, and sizes the final escaped
  compaction request before provider work without changing payload-v3 or raw event authority.
- Checkpoint 71 is complete. It replaces the fixed compaction event ceiling with bounded
  complete-run scanning, adds tool-loop finalization and continuation recovery, and preserves raw
  event authority without a migration.
- Checkpoint 70 is complete. It moves transient Notebook turns onto the shared Pi session runtime,
  adds selected-source-only Knowledge tool authority, and reuses Agent model/Thinking controls without
  persisting chat content or granting writing authority.
- Checkpoint 69 is complete. It adds a bounded Protocol v10 `ask_user` tool whose original Pi
  run waits for an exact user answer, plus a project-session-scoped answer IPC and an inline
  shadcn Questionnaire interaction. It adds no database table, event type, durable job, generic
  permission surface, or cross-restart active-run recovery.
- Phase 11 is complete under ADRs 021–037. Its full Checkpoint 29–47B roadmap and acceptance
  evidence live in [`implementation-todo/phase-11.md`](implementation-todo/phase-11.md).
- Phase 12 is an evidence-driven Use And Fix phase and is complete through Checkpoint 62. CP48–56
  refine the Agent composer, run flow, tool contracts, context recovery, checks, image relocation,
  compaction, usage visibility, and plan presentation. CP57–59 add the fixed image-provider
  catalog, Preview workspace, Vertex AI source, and the large-inline-image repair. CP60–61 make
  Writing Skills observable per-run tool activity with ordinary textual `$skill-name` mentions.
  CP62 reorganizes the flat Settings workspace and adds read-only Keyboard Shortcuts and About &
  Diagnostics peers. Detailed scope and evidence live in
  [`implementation-todo/phase-12.md`](implementation-todo/phase-12.md).
- Checkpoint 62 is complete. Settings remains the existing flat application-global Command
  workspace; General is reorganized, and peer Keyboard Shortcuts and About & Diagnostics surfaces
  expose existing commands and support information without new persistence, IPC, or project
  authority.
- Checkpoint 63 is complete. Agent work now uses bounded state-specific thinking motion and a
  short review-attention beam, while Brief, Outline, Writing Rules, section, and generated-image
  proposals share one kind-specific semantic presentation dispatcher in the timeline and Writing
  Task change set. Optional presentation remains derived review data and never mutation authority.
- Checkpoint 64 is complete. It refreshes the fixed Electron 43, BlockNote,
  PDF.js, Mermaid, database/query, provider, Renderer, and verification dependencies needed to
  remove current production advisories while preserving IPC, persistence, worker, and product
  authority boundaries under ADR 056.
- Checkpoint 65 is complete. BlockNote native inline Math now coexists with application-owned
  display Math and Mermaid through schema-v4 persistence, bounded atomic editing, Agent context,
  prose-operation isolation, import/export, and safe publication under ADR 057.
- Checkpoint 66 is complete. Knowledge remains an independent management and exact-search
  workspace, while Notebook adds project-session-scoped selected-source chat with bounded
  retrieval, streamed source-only answers, validated per-message citations, and no durable chat
  content under ADR 058.
- Checkpoint 67 is complete. A true first launch now opens a responsive, fully optional Welcome →
  Agent → Embedding → Reranking → MinerU → Create Project flow beneath the global Menubar. The
  versioned application-global step resumes after interruption, completed or upgraded installs do
  not reopen it, and provider configuration plus project creation continue through their existing
  authority boundaries under ADR 059.
- Checkpoint 68 is complete. It replaces application-owned display Math with BlockNote native
  `mathBlock`, moves the application-owned Mermaid block to a plain-content `diagram` contract,
  advances active section content to schema v5, and preserves application-owned Diagram metadata,
  safety, Agent, interchange, and publication semantics under ADR 060.
- Checkpoint 69 is complete. It adds exact Protocol v10 clarification contracts, Main-owned
  indefinite in-run waiting and answer authority, bounded compaction, trusted user-decision
  delivery, and an accessible inline shadcn Questionnaire without new durable schema or Renderer
  authority.

Checkpoint 61 passed focused shared/Main/Renderer/Real-Electron coverage, `check:fast`, the complete
Electron-hosted gate (187 files / 1043 tests with three intentional benchmark skips), the production
build, all 25 recovery fixtures from 23 sources, the fresh 41/41 Real-Electron suite, responsive UI
inspection, scoped Impeccable, and `git diff --check`.

Checkpoint 62 passed focused Renderer and Real-Electron coverage, `check:fast`, the complete
Electron-hosted gate (188 files / 1048 tests with three intentional benchmark skips), the
production build, the fresh 41/41 Real-Electron suite, desktop/narrow visual inspection, scoped
Impeccable, and `git diff --check`.

Checkpoint 63 passed 61 focused shared/Main/Renderer tests, `check:fast`, the complete
Electron-hosted gate (189 files / 1054 tests with three intentional benchmark skips), the
production build, and the fresh 41/41 Real-Electron suite. Full-width and 640 px runtime
screenshots, dependency and reduced-motion inspection, scoped Impeccable, frozen dependency
installation, and `git diff --check` also passed.

The separately authorized Checkpoint 63 hands-on macOS arm64 package gate passed from the current
dirty worktree. It verified Electron 43.1.0 / ABI 148, arm64 native modules, ASAR/resources, all
12 packaged smoke scenarios, and 28/28 packaged E2E scenarios, then produced the no-Team-ID App,
DMG, and ZIP under `dist/macos-arm64`. No candidate, commit, tag, push, hosted CI, Apple Developer
ID signing, notarization, release, promotion, or publication ran.

Checkpoint 64 passed frozen installation; production and complete audits with zero advisories;
58 focused tests across BlockNote persistence, canonical content, Mermaid, PDF, and Google
provider coverage; `check:fast`; the complete Electron-hosted gate (192 files / 1062 passing tests
with three intentional benchmark skips) and production build; all 25 recovery fixtures from 23
sources; and the fresh 42/42 Real-Electron suite. The no-identity macOS arm64 package gate then
verified Electron 43.4.1 / ABI 148, arm64 native modules, 53,145 ASAR entries, all 12 packaged
smoke scenarios, and 29/29 packaged E2E scenarios before structurally inspecting the local DMG and
ZIP. No candidate, release gate, commit, tag, push, hosted CI, Apple Developer ID signing,
notarization, promotion, or publication ran.

Checkpoint 65 passed frozen installation and zero-advisory production/full audits; 112 focused
contract, migration, editor, interchange, publication, Agent, and safety tests; `check:fast`; the
complete Electron-hosted gate (198 files / 1097 passing tests with three intentional benchmark
skips) and production build; all 26 recovery fixtures from 24 sources; and the complete 44/44
Real-Electron manifest on the fresh build. The default parallel E2E runner exposed two unrelated
one-off resource/startup races in different legacy scenarios; both passed immediately in focused
runs, and the unchanged full manifest passed serially with no flaky, skipped, or failed scenario.
No package/release action, hosted CI, commit, tag, push, signing, notarization, promotion, or
publication ran.

The separately authorized Checkpoint 64 hands-on macOS arm64 App build passed from the current
dirty worktree. The unpacked-only no-identity package gate rebuilt Electron 43.4.1 / ABI 148,
verified arm64 native modules and 53,145 ASAR entries, passed all 12 packaged smoke and 29/29
packaged E2E scenarios, and produced `dist/macos-arm64/mac-arm64/WriteLLM.app` for local use. It
did not produce a DMG or ZIP and did not create a candidate, commit, tag, push, hosted CI run,
Apple Developer ID signature, notarization, release, promotion, or publication.

The separately authorized Checkpoint 62 hands-on build passed the no-identity macOS arm64 package
gate from the current dirty worktree. It verified Electron 43.1.0 / ABI 148, arm64 native modules,
ASAR/resources, 12/12 packaged smoke scenarios, and 28/28 packaged E2E scenarios, then produced an
unpacked App, DMG, and ZIP under `dist/macos-arm64`. It did not create a candidate, commit, tag,
push, hosted CI run, Apple Developer ID signature, notarization, release, promotion, or
publication.

Checkpoint 66 passed focused shared, Main, worker, Renderer, and Real-Electron coverage;
`check:fast`; the complete Electron-hosted gate (198 files / 1097 passing tests with three
intentional benchmark skips) and production build; and the fresh 44/44 Real-Electron suite with no
flaky or skipped scenario. The verification also proved natural-language selected-source
retrieval, no-evidence model-call suppression, citation preview, page-switch recovery,
project-session cleanup, and the absence of questions, answers, evidence, external response IDs,
or content-derived fingerprints from project databases and diagnostics.

Checkpoint 67 passed 17 focused repository, IPC, and Renderer tests; `check:fast`; the complete
Electron-hosted gate (199 passing files / 1102 passing tests with three intentional benchmark
skips) and production build; and the fresh 45/45 Real-Electron manifest with no flaky, skipped, or
failed scenario. The dedicated scenario proved first-launch entry, optional provider steps,
interrupted-step resume, real project creation through the native folder boundary, completion
persistence, and restart suppression. Wide and 620 px runtime inspection, zero-overflow checks,
scoped Impeccable, and `git diff --check` also passed.

Checkpoint 68 passed frozen installation and zero-advisory production/full audits; focused
schema, migration, editor, Agent, interchange, publication, and safety coverage; `check`,
`check:fast`, the complete Electron-hosted gate (200 passing files / 1107 passing tests with three
intentional benchmark skips) and production build; all 27 recovery fixtures from 25 protected
sources; and the fresh 45/45 Real-Electron manifest with no flaky, skipped, or failed scenario.
Runtime verification covered native Inline/Block Math, application-owned plain-content Diagram,
source safety and recovery, metadata, dynamic theme rendering, sanitized isolated SVG, 620 px
layout, persistence, reopen, Agent contract v9, and Markdown export. No package/release action,
hosted CI, commit, tag, push, signing, notarization, promotion, or publication ran.

Checkpoint 69 passed exact frozen dependency installation; 168 focused shared, Worker, Main, IPC,
Renderer, and Questionnaire tests plus the explicit two-test prompt-budget baseline; scoped
Impeccable with no findings; `check:fast`; the complete Electron-hosted gate (200 passing files /
1118 passing tests with three intentional benchmark skips) and production build; and the fresh
46/46 Real-Electron manifest with no flaky, skipped, or failed scenario. The dedicated E2E proved
multi-step option and custom answers, same-run continuation, conversation attention, read-only
history after restart, and Stop interruption. No package/release action, hosted CI, commit, tag,
push, signing, notarization, promotion, or publication ran.

Checkpoint 73 passed 46 focused Renderer tests, `check:fast`, the complete Electron-hosted gate
(200 passing files / 1,140 passing tests with three intentional benchmark skips) and production
build, and the fresh 46/46 Real-Electron manifest with no flaky, skipped, or failed scenario.
Runtime visual QA covered 360, 480, and 640 px light-theme layouts plus 480 px dark theme, kept the
composer and primary action visible with no horizontal overflow, and completed the bounded
Impeccable review with no findings. No dependency, database, IPC, shared Agent protocol, tool
permission, persistence, package, release, commit, tag, push, signing, or publication action ran.

The separately authorized Checkpoint 73 hands-on macOS arm64 App build passed from the current
dirty worktree. The unpacked-only no-identity package gate refreshed and verified the intentionally
changed protected Agent recovery fixture, passed all 27 recovery cases from 25 sources, verified
Electron 43.4.1 / ABI 148, arm64 native modules, 53,287 ASAR entries, all 12 packaged smoke
scenarios, and 33/33 packaged E2E scenarios, then produced
`dist/macos-arm64/mac-arm64/WriteLLM.app`. It did not produce a DMG or ZIP and did not create a
candidate, commit, tag, push, hosted CI run, Apple Developer ID signature, notarization, release,
promotion, or publication.

Checkpoint 75 passed 153 focused shared-contract, Worker, Main, and provider tests plus the
two-test prompt-budget baseline; `check:fast`; the complete Electron-hosted gate (201 passing files
/ 1,158 passing tests with three intentional benchmark skips) and production build; and the fresh
47/47 Real-Electron manifest with no flaky, skipped, or failed scenario. Verification covered the
nine-tool core, all seven demand groups, Worker/Main double authorization, run-local reset and
monotonic activation, exact active-envelope budgets, capacity rejection, description and envelope
guards, and strict object-root OpenAI-compatible parameters including union schemas. No dependency,
migration, UI mode, package/release action, commit, tag, push, hosted CI, signing, notarization,
promotion, or publication ran.

The separately authorized Checkpoint 75 local macOS arm64 package build passed from the current
dirty worktree. The no-identity gate refreshed and verified the intentionally changed Agent
recovery-source digest, verified all 27 recovery cases from 25 sources, Electron 43.4.1 / ABI 148,
arm64 native modules, 53,287 ASAR entries, all 12 packaged smoke scenarios, and 34/34 packaged E2E
scenarios. It produced `dist/macos-arm64/mac-arm64/WriteLLM.app` plus the local
`WriteLLM-0.2026.8.26-arm64.dmg` and ZIP. No candidate, commit, tag, push, hosted CI, Apple Developer
ID signing, notarization, release, promotion, or publication ran.

The Checkpoint 75 LM Studio compatibility maintenance passed 44 focused schema, Worker, session,
and budget tests; `check:fast`; the complete Electron-hosted gate (201 passing files / 1,160
passing tests with three intentional benchmark skips) and production build; and the fresh 47/47
Real-Electron manifest with no flaky, skipped, or failed scenario. The final no-identity macOS
arm64 package gate verified all 27 recovery cases from 25 sources, Electron 43.4.1 / ABI 148,
arm64 native modules, 53,287 ASAR entries, all 12 packaged smoke scenarios, and 34/34 packaged E2E
scenarios. It produced the trial App, DMG, and ZIP under `dist/macos-arm64`. No commit, tag, push,
hosted CI, Apple Developer ID signing, notarization, release, promotion, or publication ran.

Checkpoint 70 passed 44 focused shared-contract, Worker, Main, IPC, prompt, and Notebook service
tests; `check:fast`; the complete Electron-hosted gate (200 passing files / 1123 passing tests with
three intentional benchmark skips) and production build; and the fresh 46/46 Real-Electron
manifest with no flaky, skipped, or failed scenario. Verification covered strict writing and
Notebook tool profiles, Worker/Main double authorization, multiple tool continuations, frozen
selected-source scope, citation registration and twelve-citation capping, transient model/Thinking
selection, source-epoch history cleanup, metadata-only requests without external response IDs, and
the real `search_knowledge` → `read_citations` → cited-answer flow without `temperature`. No
migration, dependency, package/release action, hosted CI, commit, tag, push, signing, notarization,
promotion, or publication ran.

The separately authorized local `0.2026.8.20` candidate advanced release metadata, created the
clean local release commit and annotated `v0.2026.8.20` tag, and passed the no-identity macOS arm64
unpacked package gate. The gate verified Electron 43.1.0 / ABI 148, arm64 native modules,
ASAR/resources, 12/12 packaged smoke scenarios, and 28/28 packaged E2E scenarios. No DMG, ZIP,
push, hosted CI, Apple Developer ID signing, notarization, GitHub Release, promotion, or
publication ran.

The separately authorized `0.2026.8.21` candidate snapshots the current baseline, including the
completed Checkpoints 62–64 and 66 plus Checkpoint 65's explicitly incomplete current state. The
no-identity macOS arm64 unpacked package gate verified Electron 43.4.1 / ABI 148, arm64 native
modules, 53,287 ASAR entries, all 26 recovery fixtures from 24 sources, 12/12 packaged smoke
scenarios, and 31/31 packaged E2E scenarios, then produced
`dist/macos-arm64/mac-arm64/WriteLLM.app`. The clean candidate commit receives the annotated
`v0.2026.8.21` tag and is pushed with `main` under the user's explicit authorization. No DMG, ZIP,
hosted CI run, Apple Developer ID signing, notarization, GitHub Release, promotion, or publication
ran.

The separately authorized local `0.2026.8.22` candidate snapshots the completed Checkpoints 67–68
on top of the existing baseline. Its no-identity macOS arm64 package gate verified Electron 43.4.1
/ ABI 148, arm64 native modules, 53,287 ASAR entries, all 27 recovery fixtures from 25 sources, all
12 packaged smoke scenarios, and 32/32 packaged E2E scenarios. It produced the unpacked App plus
the structurally verified `WriteLLM-0.2026.8.22-arm64.dmg` and
`WriteLLM-0.2026.8.22-arm64.zip` from the clean annotated `v0.2026.8.22` source commit. No push,
hosted CI run, Apple Developer ID signing, notarization, GitHub Release, promotion, or publication
ran.

The separately authorized local `0.2026.8.23` candidate snapshots the completed Checkpoint 69 on
top of the existing baseline. Its no-identity macOS arm64 unpacked package gate verified Electron
43.4.1 / ABI 148, arm64 native modules, 53,287 ASAR entries, all 27 recovery fixtures from 25
sources, all 12 packaged smoke scenarios, and 33/33 packaged E2E scenarios with no flaky, skipped,
or failed scenario. It produced `dist/macos-arm64/mac-arm64/WriteLLM.app` from the clean annotated
`v0.2026.8.23` source commit `ecfca0b`. No DMG, ZIP, push, hosted CI run, Apple Developer ID
signing, notarization, GitHub Release, promotion, or publication ran.

The separately authorized local `0.2026.8.24` candidate snapshots the completed Checkpoint 70 on
top of the existing baseline. Its no-identity macOS arm64 unpacked package gate verified Electron
43.4.1 / ABI 148, arm64 native modules, 53,287 ASAR entries, all 27 recovery fixtures from 25
sources, all 12 packaged smoke scenarios, and 33/33 packaged E2E scenarios with no flaky, skipped,
or failed scenario. It produced `dist/macos-arm64/mac-arm64/WriteLLM.app` from the clean annotated
`v0.2026.8.24` source commit `bc6227a`. No DMG, ZIP, hosted CI run, Apple Developer ID signing,
notarization, GitHub Release, promotion, or publication ran.

The separately authorized local `0.2026.8.25` candidate snapshots the completed Checkpoint 71 on
top of the existing baseline. Its no-identity macOS arm64 unpacked package gate verified Electron
43.4.1 / ABI 148, arm64 native modules, 53,287 ASAR entries, all 27 recovery fixtures from 25
sources, all 12 packaged smoke scenarios, and 33/33 packaged E2E scenarios with no flaky, skipped,
or failed scenario. It produced `dist/macos-arm64/mac-arm64/WriteLLM.app` from the clean annotated
`v0.2026.8.25` source commit `456e837`. No DMG, ZIP, hosted CI run, Apple Developer ID signing,
notarization, GitHub Release, promotion, or publication ran.

## Current authorized work

Checkpoints 78.0–78.3 are complete under ADR 070. The delivered work adds
stable Reference metadata, one user-selected Zotero/Better BibTeX export connector, bilingual
citekey syntax, evidence validation, an opt-in CSL formatter, and bibliography-aware export while
leaving the Knowledge RAG pipeline and `index.sqlite` unchanged. CP77 remains paused and no CP77
schema or Plan-to-Write handoff work is included. Exact-pinned Citation.js CSL/citeproc production
dependencies, forward migrations, one narrow external-file picker/watch capability, required
local/package verification, and third-party notices are complete. Commit, tag, push, hosted CI,
signing, notarization, release promotion, and publication are not authorized.

The separately authorized no-Team-ID macOS arm64 App rebuild, source commit, annotated
`v0.2026.8.48` tag, and atomic push of `main` plus that tag are complete for the completed
Checkpoint 78 snapshot. Apple Developer ID signing, notarization, GitHub Release creation,
promotion, and publication remain outside this authorization. The earlier `v0.2026.8.47`
candidate remains the immutable Checkpoint 76.1 snapshot.

Checkpoint 76 is complete under ADR 068. Sticky writing interaction modes, migration 0039,
immutable run snapshots, Protocol v13 exact tool ceilings, the mode prompt layer, and the Agent
composer selector beside Send are locally verified. Checkpoint 77 Writing Task v2 and execution
handoff remain paused. No dependency, new worker, generic permission framework, signed release,
promotion, or publication is authorized.

Checkpoint 75 Agent tool layering, demand profiles, and the authorized LM Studio union-schema
compatibility maintenance are complete under ADR 067. The separately authorized Gemini/Vertex
blockless-canonical read compatibility maintenance is also complete under ADR 042's bounded
`prepareArguments` allowance. No further Checkpoint 75 implementation is authorized. A
user-visible profile selector, classifier request, durable activation preference, provider-specific
fork, database migration, and release work remain outside this checkpoint.

Checkpoint 74 Agent table authoring and publication is complete under ADR 066. No further
Checkpoint 74 implementation is authorized. The separately authorized `v0.2026.8.28` tag ran the
unsigned four-platform CI matrix and remains immutable failed evidence. The later `.30` failures
are locally remediated and the user authorized continuing with corrected immutable `.31`. Apple
Developer ID signing, notarization, GitHub Release creation, promotion, and publication remain
unauthorized.

Checkpoint 73 Agent sidebar focus hierarchy is complete under ADR 065. No further Checkpoint 73
implementation is authorized. Migrations, IPC, Agent protocol or tool changes, dependency
installation, package/release work, commit, tag, push, hosted CI, signing, notarization, promotion,
and publication remain outside this checkpoint.

Checkpoint 72 Writing Harness semantic compaction is complete under ADR 064. No further
Checkpoint 72 implementation is authorized.
BlockNote native Diagram, BlockNote XL publication,
ODT/email export, other new IPC or Agent tools, signing, notarization, and release work remain
outside the accepted checkpoint.

The `v0.2026.8.27` candidate is retained as failed frozen-install evidence, and `v0.2026.8.28` is
retained as failed cross-platform test evidence. The `.28` remediation is locally verified and the
user authorized continuing with corrected immutable tags. Candidate `.29` failed before the matrix
because its recovery manifest retained pre-timeout-change source digests. Candidate `.30` passed
the corrected static gate but exposed two slow macOS tests, a CRLF-sensitive Writing Skill parser
comparison, Windows floating-control interaction instability, one Windows textarea metric
tolerance, and two hosted E2E timing/focus races; `.31` contains their focused remediation.
Apple Developer ID signing, notarization, GitHub Release creation, promotion, and publication
remain unauthorized.

## Completed delivery gate

Checkpoint 26.9 completed under the user's narrowed 2026-08-30 authorization. Immutable
`v0.2026.8.45` run `33299058552` passed the shared static/recovery-fixture gate, then independently
built Windows x64, macOS arm64, macOS x64, and Linux x64 unsigned packages and uploaded four
platform artifacts with 30-day retention. Pull requests, branch pushes, schedules, and manual
dispatches cannot trigger this workflow. Hosted Electron database tests, complete E2E, packaged
smoke, signing, and promotion are excluded; the full Electron/E2E/package gates passed locally as
pre-tag evidence. Exact hosted evidence is recorded in
[`implementation-todo/phase-10.md`](implementation-todo/phase-10.md#checkpoint-26-cross-platform-ci-recovery-matrix-and-release-promotion).
Apple Developer ID signing, notarization, GitHub Release creation, release promotion, and
publication remain outside the authorization.

## Completed baseline

- Phases 0–9 and Checkpoints 23M/23V are complete.
- Phase 10 Checkpoints 24–26.9 are complete.
- Checkpoints 27–28.x are complete under ADRs 012–020.
- Phase 11 is complete under ADRs 021–037.
- Phase 12 is implemented and verified through Checkpoint 62 under ADRs 038–044 and 046–055.
- Phase 13 Checkpoints 63–64 are implemented and verified; Checkpoint 64 is governed by ADR 056.
- Phase 14 Checkpoint 65 is implemented and verified under ADR 057.
- Phase 15 Checkpoint 66 is implemented and verified under ADR 058.
- Phase 16 Checkpoint 67 is implemented and verified under ADR 059.
- Phase 17 Checkpoint 68 is implemented and verified under ADR 060.
- Phase 18 Checkpoint 69 is implemented and verified under ADR 061.
- Phase 19 Checkpoint 70 is implemented and verified under ADR 062.
- Phase 20 Checkpoint 71 is implemented and verified under ADR 063.
- Phase 21 Checkpoint 72 is implemented and verified under ADR 064.
- Phase 22 Checkpoint 73 is implemented and verified under ADR 065.

The compact completion index is [`implementation-todo.md`](implementation-todo.md); historical
transitions and local candidate chronology are in
[`history/implementation-log.md`](history/implementation-log.md).

## Deferred

- Multiple simultaneously open projects or multiple primary manuscripts.
- General external-edit synchronization, directory scans, and project-wide file watching. ADR 070
  narrowly authorizes only a user-selected single bibliography file connector.
- Multi-agent/subagent workflows, autonomous background writing, and long-term implicit memory.
- Generic plugins, executable Writing Skills, arbitrary filesystem/network/shell tools, and
  direct Agent writes.
- Realtime collaboration, Yjs, cloud sync, and alternative vector backends.
- DOCX and other non-LaTeX manuscript import formats.
- True image editing and provider-agnostic image plugins.
- Auto-updater, additional distribution targets, signing, notarization, release promotion, and
  publication.
