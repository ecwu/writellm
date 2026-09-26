# WriteLLM Current Plan

Status: Phase 33 Checkpoint 84 is locally verified under accepted ADRs 078–079. Phase 32 Checkpoint 83 is complete under accepted ADR 074. Phase 31 Checkpoint 82 is complete under accepted ADR 073. Phase 30 Checkpoint 81 is
complete under accepted ADR 072. Phase 29 Checkpoint 80 is
complete under ADR 071. Phase 28 Checkpoint 79 is
complete under ADR 070. Checkpoint 77 remains independently paused; CP78 is
authorized to run ahead. Immutable tag-only candidates
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
Recorded: 2026-09-25

This file records only active delivery state. Long-lived system rules live in
[`architecture.md`](architecture.md) and the ADRs; detailed checkpoint evidence lives in the
matching Phase file under [`implementation-todo/`](implementation-todo/); completed chronology
lives in [`history/implementation-log.md`](history/implementation-log.md).

## Current state

- Tool closing now preserves surviving sidebar widths and gives released horizontal space to
  the retained content area, including its empty state. Pointer/keyboard resizing and bottom
  docking remain available under the [ADR 083 sizing clarification](adrs/083-tabbed-docking-workbench.md#2026-09-26-tool-close-sizing-clarification).
  Static checks and three distinct real Electron scenarios passed on macOS arm64 with zero
  retries. The final source build passed again in 11.8s for the user-authorized local-main
  integration; the packaged App has not been rebuilt.
  Evidence: [tool-close sizing](history/implementation-log.md#2026-09-26-tool-close-sizing).

- The curated Writing Skill catalog now includes the Chinese and English Anti-Defensive Writing
  entrypoints from [Adkid-Zephyr/anti-defensive-writing-Skill](https://github.com/Adkid-Zephyr/anti-defensive-writing-Skill),
  both pinned to `102c8b2` with verified Git blob hashes. The catalog now has nine entries;
  third-party bodies remain unbundled and require installation in the app. Folded YAML
  descriptions now load through Pi without changing the exposed normalized metadata. Final
  static checks and 14 focused Electron tests passed on macOS arm64; both exact upstream
  entrypoints passed a local content/hash/loader probe. The rebuilt App at
  `dist/macos-arm64/mac-arm64/WriteLLM.app` passed the six-stage package smoke gate in 86.2s,
  including 12/12 packaged scenarios. Its ASAR contains both entries and the reviewed pin.
  Evidence: [catalog implementation](history/implementation-log.md#2026-09-25-anti-defensive-writing-catalog)
  and [App build](history/implementation-log.md#2026-09-25-anti-defensive-writing-app-build).

- macOS now uses the native `WriteLLM / Project / Edit / Layout / Tools / Window` menu under
  [ADR 084](adrs/084-macos-native-menu.md). The in-window Menubar is removed only on macOS;
  the native title shows the project name and the Agent toggle is available in the activity rail.
  Windows/Linux retain their existing Menubar. Bounded menu state, sender/session checks, modal
  gating, native shortcut dispatch and window recreation reuse the existing action/flush paths.
  Final macOS arm64 package smoke passed (83.6s, 12 smoke scenarios), and seven focused scenarios
  passed against that same App (20.8s, zero retries). Focused Electron unit coverage totals 37
  passing tests, reusing unchanged boundary results. Windows/Linux were not run on this host.
  The local App uses release metadata 0.2026.9.9 and includes this uncommitted maintenance;
  no tag was moved and nothing was published.
  Evidence: [macOS native menu](history/implementation-log.md#2026-09-21-macos-native-menu).

- Section editor titles now retain the intended 30px semibold typography at desktop widths,
  overriding the shared Textarea's default 14px desktop size. Static verification passed;
  no build or packaged runtime verification was needed for this style-only correction.
  Current `out/` and the local App include this change through the macOS menu rebuild above.
  Evidence: [section title typography](history/implementation-log.md#2026-09-19-section-title-typography).

- Source candidate `v0.2026.9.9` records the verified sidebar layout and empty-workbench navigation
  changes as a local annotated tag. Release metadata is 0.2026.9.9; no remote push or GitHub Release
  is part of this tag-only checkpoint. The local App has since been rebuilt with 0.2026.9.9 metadata for the macOS menu maintenance
  above; the tag remains the earlier source checkpoint.
  Evidence: [tag-only candidate](history/implementation-log.md#2026-09-19-tag-only-0202699).

- Docked tool chrome is unified: close buttons live in tool tabs, project context appears only
  in Outline, and the redundant Active badge and per-tool completion footers are removed.
  Section completion appears once in the global status bar. Static checks and three distinct
  real Electron scenarios passed after fixture corrections; light/dark screenshots were inspected.
  Current `out/` and the local macOS arm64 App include this change. The requested unpacked
  build passed all four build-only stages in 32.5s after a sandbox DNS retry; packaged runtime
  tests were not repeated. Runtime evidence remains the source macOS arm64 scenarios above.
  Evidence: [tool sidebar layout](history/implementation-log.md#2026-09-19-tool-sidebar-layout).

- Empty-workbench manuscript navigation now opens Outline without an action error when no
  section tab is available. Reference insertion separately requires successful section activation
  and clears abandoned insertion state. Static checks and three distinct real Electron scenarios
  passed with one build and one test-expectation correction rerun; runtime evidence is macOS arm64.
  Current `out/` and the rebuilt local App include the fix; the published 0.2026.9.8 App does not. Evidence:
  [empty-workbench navigation](history/implementation-log.md#2026-09-19-empty-workbench-navigation).

- [Release `0.2026.9.8`](https://github.com/ecwu/writellm/releases/tag/v0.2026.9.8)
  is published as Latest from immutable tag `v0.2026.9.8`, source
  `65a380b7c406ef633c7bc5e2a858ee4b1d9f49d2`. It includes the recent workbench, status bar,
  Notebook source-capacity, layout-menu, scrollbar, shortcut and HTTP endpoint changes.
  Release acceptance repaired retained-editor save-barrier routing and duplicate activity
  delivery when the status bar and Agent panel subscribe simultaneously.
  The complete Electron test run passed 1,615 tests with three intentional benchmark skips;
  subsequent repairs passed 13 focused editor tests and 33 focused activity/IPC tests.
  Final clean-source macOS arm64 package acceptance passed all ten stages in 241.8s,
  including runtime smoke and 41/41 packaged scenarios with zero retries/skips, then made
  DMG/ZIP from that same App. Earlier failures and their focused fixes remain in the history.
  [CI run 35440017115](https://github.com/ecwu/writellm/actions/runs/35440017115) passed
  static/fixtures and all four platform builds. Seven installers and four evidence JSONs are
  public; all 11 asset sizes and SHA-256 digests were verified before and after publication.
  Current App: `dist/macos-arm64/mac-arm64/WriteLLM.app`, native build `2026.9.8`.
  Distribution remains unsigned/unnotarized. Hosted CI is build-only; runtime evidence is
  local macOS arm64, and physical system-IME candidate selection remains unverified.
  Evidence: [release publication](history/implementation-log.md#2026-09-19-release-0202698-publication).

- Notebook source capacity is locally verified under the [ADR 058 source capacity amendment](adrs/058-transient-notebook-knowledge-chat.md#2026-09-19-source-capacity-amendment).
  All indexed Knowledge sources are selectable without a source-count cap; per-turn frozen scopes
  and retrieval/evidence budgets remain enforced. Source filters use one bound JSON array, and
  unavailable indexes no longer display as unindexed sources. Forty-seven distinct focused
  Electron-hosted tests and three distinct real Electron scenarios have passing evidence with
  one build, including 301-source selection, full-scope search and citation expansion. The final
  large-source scenario passed in 45.0s with zero retries/skips after two fixture corrections.
  Current `out/` and the 0.2026.9.8 packaged App include the change; the release gate also
  passed the 301-source scenario. Runtime evidence is macOS arm64 only. Evidence: [Notebook source capacity](history/implementation-log.md#2026-09-19-notebook-source-capacity).

- The fixed workbench status bar is locally verified. It combines index readiness, live Agent
  and Notebook navigation, saved chapter/manuscript counts, and Autocomplete controls. Closing
  the Agent tool does not stop status observation; project teardown clears subscriptions.
  Static checks, 45 distinct focused Electron-hosted tests and four distinct real Electron
  scenarios passed using one build, with one unit correction and one E2E fixture correction
  rerun. Runtime evidence is macOS arm64 only. The initial rebuild passed native smoke,
  while broader runtime smoke stopped at the comment-write save barrier. Release 0.2026.9.8
  repaired that routing and duplicate activity delivery, then passed complete package acceptance. Evidence:
  [workbench status bar](history/implementation-log.md#2026-09-19-workbench-status-bar).

- Workbench native scrollbar colors now follow the application light/dark theme, overriding
  Dockview's nested default dark shell rather than only its outer wrapper. The rebuilt macOS
  App includes this correction. Evidence:
  [workbench scrollbar theme](history/implementation-log.md#2026-09-19-workbench-scrollbar-theme).

- Layout controls live in the global `Project / Edit / Layout / Tools` menu (native on macOS,
  shadcn Menubar on Windows/Linux); the separate
  reset toolbar is removed. Checked items derive from actual dock panels and content tabs;
  content actions retain save barriers and project-session scoping. Static checks and three
  affected real Electron scenarios have passing evidence, using one build. One fixture-only
  rerun replaced an overlooked old reset-button locator. Evidence:
  [Layout menu](history/implementation-log.md#2026-09-19-layout-menu).

- The tabbed docking workbench is locally verified under [ADR 083](adrs/083-tabbed-docking-workbench.md).
  Dockview React 8.3.1 provides a single retained content group and movable tool groups;
  up to ten independent ephemeral Notebooks share three Agent/Notebook run slots.
  Versioned app.sqlite layout preferences restore safe content tabs and tool geometry without
  restoring Notebook state. Save barriers and project-session revocation remain enforced.
  Static checks, 58 distinct focused Electron-hosted tests, and 11 distinct real Electron
  scenarios have passing final-source evidence. One final focused rerun replaced a DOM-only
  selection fixture with keyboard selection; runtime coverage is macOS arm64 only.
  Evidence: [tabbed docking workbench](history/implementation-log.md#2026-09-19-tabbed-docking-workbench).

- Keyboard shortcut separation is locally verified. Sidebar and Agent panel toggles now use
  their accessible buttons only; text-formatting keys no longer toggle panels. Application
  commands share exact modifier matching and display definitions, ignore consumed/composing
  events, and permit key repeat only for section navigation. Settings documents application,
  editor, autocomplete, and Agent input commands. Thirty focused tests and seven distinct real
  Electron scenarios passed, reusing one source build; two focused reruns corrected test
  selection/setup assumptions. Runtime evidence is macOS arm64, with synthetic IME guards
  only; the 0.2026.9.8 packaged App includes the change. Evidence:
  [keyboard shortcut separation](history/implementation-log.md#2026-09-19-keyboard-shortcut-separation).

- [Release `0.2026.9.7`](https://github.com/ecwu/writellm/releases/tag/v0.2026.9.7)
  remains a previous published release from immutable tag `v0.2026.9.7`, source
  `553511063698ca2afb847af40c76f9af9943e8e9`. It includes DeepSeek autocomplete,
  application defaults/temporary overrides and Brief/Outline previews. 1,530 distinct
  Electron tests have passing evidence; three benchmark tests are intentionally skipped.
  One 5-second reporting-subprocess timeout in the full run passed on focused rerun.
  Local macOS arm64 full package acceptance passed all ten stages in 225.0s, including
  runtime smoke and 39/39 packaged E2E scenarios with zero retries/skips. The same App
  produced DMG/ZIP. [CI run 34851835641](https://github.com/ecwu/writellm/actions/runs/34851835641)
  passed static/fixtures and all four build/upload targets. Seven installers and four
  original platform evidence files are public; all 11 asset sizes and SHA-256 digests
  were verified before and after publication. That acceptance used native build `2026.9.7`;
  the current local App uses 0.2026.9.9 metadata after the macOS menu rebuild above.
  Builds remain unsigned/unnotarized; hosted CI is build-only, runtime coverage is local
  macOS arm64, and physical IME candidate selection remains unverified.
  Evidence: [release publication](history/implementation-log.md#2026-09-14-release-0202697-publication).

- Autocomplete application defaults and temporary overrides are locally verified under
  [ADR 082](adrs/082-deepseek-autocomplete.md). Default Models saves auto-enable and
  word/sentence/paragraph length in app.sqlite; editor overrides survive project switches,
  reset at application exit and never write saved preferences. Restore defaults clears both
  overrides. 63 focused tests passed in 1.7s. Static checks, one build and the expanded real
  Electron scenario passed in 44.6s; a final UI checked-state assertion passed against the
  same build in 18.2s. A final computed-style/animation-free screenshot check also passed
  in 18.2s using that build. All three E2E invocations had zero retries/skips. Runtime evidence is macOS
  arm64; the host Node 26.8.2 is outside the declared 24.x range, while native tests target
  Electron 43.4.1 ABI 148. Both current out/ and the packaged App now include this change,
  published in 0.2026.9.7 above.
  Evidence: [application defaults](history/implementation-log.md#2026-09-14-autocomplete-application-defaults-and-temporary-overrides).

- Brief and Outline previews are locally verified. The existing Preview workspace now offers
  all ten Brief form fields and the complete numbered outline with objectives/statuses, plus
  plain-text Copy all, refresh and clipboard failure recovery. They reuse the saved manuscript
  assembly and existing lifecycle diagnostics without new IPC or persistence. Long metadata
  wraps within the desktop workspace after constraining its ancestor flex containers.
  Eight focused tests passed; static checks and one affected real Electron scenario passed.
  The final scenario ran in an 8.1-second gate with zero retries/skips after the viewport-width
  regression was repaired. Current `out/` and `dist/macos-arm64/mac-arm64/WriteLLM.app` include
  this change. The user-requested unpacked macOS arm64 build passed all four build-only stages
  in 33.5s after one sandbox DNS failure and elevated retry. Package runtime tests were not
  repeated in that build-only invocation; the later 0.2026.9.7 package gate above now
  covers the preview scenario against the packaged App.
  Evidence: [Brief / Outline preview](history/implementation-log.md#2026-09-13-brief-and-outline-preview).

- Candidate `v0.2026.9.6` records the completed DeepSeek autocomplete work in a local
  annotated source tag, retained locally without its own remote publication. Its release
  metadata was `0.2026.9.6`; the September 13 App also included subsequent Brief/Outline
  preview changes. Current release metadata and App are now `0.2026.9.8` as recorded above.

- DeepSeek editor autocomplete, its style dropdown and continuous completion are locally
  verified under [ADR 082](adrs/082-deepseek-autocomplete.md). Tab schedules another request
  after 200ms; matching typing retains remaining ghost text, while composition waits for
  final committed text. Esc/undo suppression survives focus and menu changes. The original
  project-session enablement and toolbar style persistence are superseded by the application
  defaults and temporary overrides above.
  Continuous-completion coverage has 65 distinct tests across five files and four affected
  Electron scenarios passing (41.3-second static/build/E2E gate; zero retries/skips). A final
  menu-restoration refinement passed 31 focused editor tests and was built into the macOS
  arm64 App: package smoke passed all 12 checks in 84.2s, then the autocomplete scenario
  passed against that exact App in 16.5s without another build or retry.
  Current `out/` and `dist/macos-arm64/mac-arm64/WriteLLM.app` include this implementation
  plus the application-default changes, now published in 0.2026.9.7. Runtime coverage is
  macOS arm64. Composition commit/cancel is automated;
  a native system-input-source attempt produced literal letters without a candidate window,
  so physical system-IME candidate selection remains unverified, as do other platforms.
  Earlier style live-provider evidence remains applicable: 12 flash requests across styles,
  languages and protocols succeeded in 558–1,554ms; sentence results can still be incomplete.
  Evidence: [initial autocomplete](history/implementation-log.md#2026-09-10-deepseek-editor-autocomplete),
  [styles](history/implementation-log.md#2026-09-10-autocomplete-style-dropdown),
  [continuous completion](history/implementation-log.md#2026-09-10-continuous-autocomplete-and-composition).

- [Release `0.2026.9.5`](https://github.com/ecwu/writellm/releases/tag/v0.2026.9.5)
  remains a previous published release from immutable tag `v0.2026.9.5`, source
  `65a663f0013ee3efb5e1934139bf442241aa014b`, including the editor save continuity repair.
  Full Electron tests passed: 1,440 tests with three intentional benchmark skips in 25.9s.
  Local macOS arm64 full package acceptance passed in 209.3s, including 12 runtime checks and
  all 38 packaged E2E scenarios with zero retries/skips. The same tested App produced DMG/ZIP.
  [Actions run 34413270209](https://github.com/ecwu/writellm/actions/runs/34413270209) passed
  static/fixtures and all four native build/upload jobs. Seven installers and four original
  platform evidence files are published; all uploaded sizes and SHA-256 digests were verified.
  The local App is `dist/macos-arm64/mac-arm64/WriteLLM.app`. Builds remain unsigned and
  unnotarized; hosted CI is build-only, runtime acceptance is local macOS arm64, and physical
  system-input-method switching/candidate selection remains unverified. Evidence:
  [release history](history/implementation-log.md#2026-09-09-release-0202695-publication).

- Editor save continuity maintenance is implemented and locally verified. Ordinary autosave and
  checkpoint acknowledgements retain the active BlockNote instance, selection, scroll position,
  and undo/redo history. External revisions use guarded session replacement; late local replies
  cannot clear conflicts or overwrite newer authority. Composition defers autosave and rejects
  premature final flush, and editable-state-only updates no longer mark the document dirty.
  Verification passed 20 focused Electron-hosted tests and nine affected real Electron scenarios;
  the final static/build/E2E gate passed in 40.3s with zero E2E retries or skips. Runtime evidence
  is macOS arm64, with synthetic composition coverage only: actual system-input-method switching
  and candidate selection remain unverified. Source `out/` and the packaged macOS arm64 App
  include this repair, now published in release `0.2026.9.5`. Evidence:
  [editor continuity maintenance](history/implementation-log.md#2026-09-09-editor-save-continuity-and-composition).

- [Release `0.2026.9.4`](https://github.com/ecwu/writellm/releases/tag/v0.2026.9.4)
  was published from immutable tag `v0.2026.9.4`, source `7bc4ff69bbd7d115241173bcccd9c2a4db984642`.
  Complete Electron tests passed: 1,440 passed and 3 benchmark skips in 27.4s. The local macOS
  arm64 package gate passed in 212.2s, including 12 runtime checks, 35 packaged E2E scenarios
  (zero retries/skips), migration recovery inventory, and DMG/ZIP creation from the tested App.
  [Actions run 34171296372](https://github.com/ecwu/writellm/actions/runs/34171296372) passed
  static checks and all four platform builds. Seven CI installers and four original evidence files
  are published; all uploaded sizes and SHA-256 digests were verified. Builds remain unsigned and
  not notarized; hosted CI is build-only, with runtime acceptance on local macOS arm64.
  Windows and Intel Mac evidence retain their generated-native-resource dirty-worktree markers.
  Detailed evidence: [release history](history/implementation-log.md#2026-09-08-release-0202694-publication).

- Conversation fork is implemented and locally verified under accepted
  [ADR 081](adrs/081-conversation-fork.md). Migration 0047 freezes effective history references;
  child conversations retain their own execution authority, drafts and usage. Completed replies
  expose fork, a boundary marker and source navigation, including archived/replaced sources.
  Reused and final-source focused coverage totals 141 tests across 12 files. Static checks, one
  final-source build and both affected Electron scenarios passed in 29.2s with zero E2E retries.
  Recovery inventory, verified migration backups/rollback and desktop screenshot inspection passed.
  macOS arm64 only; host Node 26.8.1 is outside the declared Node 24 range, while pnpm 11.17.0
  matches the project pin and native tests used Electron 43.4.1 (ABI 148). Included in release
  `0.2026.9.4` with packaged verification above.
  Evidence: [implementation history](history/implementation-log.md#2026-09-08-conversation-fork).

- Agent message copy and edit/restart is implemented under accepted
  [ADR 080](adrs/080-agent-message-edit-and-restart.md). Controls appear on message hover or
  keyboard focus. Migration 0046 preserves raw evidence and atomically replaces effective history;
  actual Agent business writes block editing. Focused Electron coverage passed 227 current tests
  across 35 files (reused boundary results); final message E2E passed in 5.3s with zero retries,
  including clipboard, stop/edit, proposal invalidation, write prohibition, hover/focus, and resize.
  The final source passed static checks and one fresh build via `check:e2e`; its E2E locator was
  corrected and rerun against that same build. Runtime verification is macOS arm64; included in
  release `0.2026.9.4` with packaged verification above.
  Detailed timings and rerun evidence are in the maintenance history log.

- The seven previously curated Writing Skills use reviewed September 6 upstream pins: Nature
  `28150f3` and CCFA `217f687`. The catalog verifies 61 text files, including seven newly
  allowlisted references. Static checks, 26 existing focused tests, and a real-upstream-content
  installation/read/integrity probe passed. The macOS arm64 App now includes this catalog;
  the four-stage unpacked package gate passed in 34.1s after one sandbox DNS retry, and both
  upstream pins were verified inside the App's ASAR. Installed Skills still require an explicit
  update. Evidence: [catalog review](history/implementation-log.md#2026-09-06-curated-writing-skill-refresh)
  and [App build](history/implementation-log.md#2026-09-06-writing-skill-app-build).

- Pi AI and Agent Core are pinned to 0.85.1. GPT-6 Astra appears in both OpenAI API and
  Codex subscription catalogs through the existing provider adapter. All 93 focused tests and
  static checks passed; the macOS arm64 App was rebuilt and passed 12 packaged smoke scenarios
  in an 84.6-second gate without retries. Live Astra requests remain unverified. Evidence:
  [`history/implementation-log.md`](history/implementation-log.md#2026-09-06-pi-0851-astra-update).

- The requested macOS arm64 App rebuild includes the Reference / Knowledge sidebar redesign
  and Notebook citation fixes at `dist/macos-arm64/mac-arm64/WriteLLM.app`.
  `pnpm package:unpack` passed all four build-only stages in 31.7 seconds after one sandbox
  DNS failure and an elevated retry. Evidence:
  [`history/implementation-log.md`](history/implementation-log.md#2026-09-05-sidebar-app-build).

- Reference / Knowledge sidebar redesign is locally verified: Reference-first rows, expandable
  attachments, stable search/selection, capability-based status, scoped background activity and
  paginated history replace mixed file/reference rows and anonymous task logs. File drop targets
  appear only during a file drag into the sidebar. Static checks, 17 focused Electron-hosted
  tests, and three relevant Electron scenarios passed; the final composite gate took 30.8 seconds
  without retries. Source output and the macOS arm64 App now include this change. Evidence:
  [`history/implementation-log.md`](history/implementation-log.md#2026-09-05-reference-knowledge-sidebar-redesign).

- Notebook repeated-citation rendering maintenance is locally verified: every registered
  occurrence renders as a citation control without duplicate-marker warnings. Unregistered-marker
  protection remains. Static checks and 15 focused Electron-hosted tests passed without retries.
  The macOS arm64 App now includes this change. Evidence:
  [`history/implementation-log.md`](history/implementation-log.md#2026-09-05-notebook-repeated-citations).

- Ponytail UTF-8 cleanup is locally verified: Agent title context, image prompts, and proposal
  previews reuse the existing complete-code-point truncator, removing 19 production lines and
  preventing split-character preview output. Static checks and 35 focused Electron-hosted tests
  passed without retries. Evidence:
  [`history/implementation-log.md`](history/implementation-log.md#2026-09-05-ponytail-utf8-cleanup).

- Gemini stream truncation maintenance is locally verified: the exact Google SDK incomplete-frame
  error now uses existing bounded pre-content retries, preserving no-replay guards. All 50 focused
  Electron-hosted tests and static checks passed. The macOS arm64 App was rebuilt and inventoried
  at `dist/macos-arm64/mac-arm64/WriteLLM.app` in 32.9 seconds after a sandbox-network retry;
  live custom-provider recovery remains unverified. Evidence:
  [`history/implementation-log.md`](history/implementation-log.md#2026-09-05-gemini-stream-truncation).

- Checkpoint 84 acceptance remediation is implemented and locally verified under ADRs 078–079.
  Replacement/duplicate anchors, delegated Write authority, fresh complete-read verification,
  applied-proposal/deletion evidence, and comment UI refresh/history/navigation are corrected.
  Verification passed 72 focused Electron-hosted tests, three affected Electron scenarios, and
  all 12 packaged runtime smoke scenarios. The current macOS arm64 App includes these fixes.
  Live-provider end-to-end approval continuation and other platforms remain unverified. Evidence:
  [`implementation-todo/phase-33.md`](implementation-todo/phase-33.md).

- The user-requested macOS arm64 App rebuild with Pi 0.85.0 is complete at
  `dist/macos-arm64/mac-arm64/WriteLLM.app`. `package:unpack` passed all four build-only stages
  in 32.3 seconds without retries. Existing Pi functional coverage remains applicable. Evidence:
  [`history/implementation-log.md`](history/implementation-log.md#2026-09-04-pi-0850-app-build).

- The earlier Pi AI and Agent Core 0.85.0 maintenance is superseded by 0.85.1 above, including
  runtime metadata and the new explicit context argument for the read-only Skill loader.
  Verification covers 189 distinct focused tests, static checks, and all 12 packaged runtime
  smoke scenarios. The macOS arm64 App now contains this update; the package smoke gate passed
  in 81.9 seconds. Evidence:
  [`history/implementation-log.md`](history/implementation-log.md#2026-09-04-pi-0850-dependency-update).

- A current macOS arm64 App is available for manual feature trials at
  `dist/macos-arm64/mac-arm64/WriteLLM.app`, built with `pnpm package:unpack` after command
  consolidation. All four build-only stages passed in 31.2 seconds, including native preparation,
  package inventory, and no-Team-ID signature policy. Evidence:
  [`history/implementation-log.md`](history/implementation-log.md#2026-09-04-manual-feature-trial-app).

- pnpm command consolidation is complete: 51 scripts are reduced to 30 distinct entry points,
  native targets use one parameterized package command in development and CI, and local tests
  remain filterable without implicit builds. Static checks, 26 focused command/CI/reporting tests,
  and ten package CLI plans passed. The README and agent guidance describe scope selection and
  migration from removed aliases. Evidence:
  [`history/implementation-log.md`](history/implementation-log.md#2026-09-04-pnpm-command-consolidation).

- Redundant-defense cleanup is complete across the five user-approved areas: editor content
  preparation, Agent section reads, Worker protocol defaults, run-record Skill snapshots, and
  Electron theme resolution. Production code is reduced by 29 lines while retaining authority,
  validation, concurrency, and recovery boundaries. Final-source verification covers 102 focused
  tests, static checks, one production build, and two real Electron scenarios without E2E retries.
  Evidence:
  [`history/implementation-log.md`](history/implementation-log.md#2026-09-04-redundant-defense-cleanup).

- Project sidebar resizing maintenance is complete. Every expanded desktop project workspace now
  exposes the same bounded pointer and keyboard resize handle while retaining the fixed icon rail,
  collapse button, and each workspace's established default width. Focused component coverage,
  static checks, a final production build, and the real Electron resize scenario passed. A
  replacement macOS arm64 App then passed the four-stage build-only package gate in 31.8 seconds.
  Evidence:
  [`history/implementation-log.md`](history/implementation-log.md#2026-09-04-project-sidebar-resizing).

- Reference/PDF import review distillation is complete. Ambiguous multi-page attachment choices
  appear first, while single-PDF and citation-only defaults render as compact continuous rows with
  progressive per-item settings. The dialog now grows with the desktop viewport up to 72rem,
  keeps its footer fixed, and uses sections and separators rather than Cards. Focused Renderer
  coverage passed 3 tests; final-source static checks, one production build, the focused Electron
  import scenario, two-width screenshot review, and the scoped Impeccable detector passed. A
  replacement macOS arm64 App was then built and inventoried successfully in 32.5 seconds.
  Evidence:
  [`history/implementation-log.md`](history/implementation-log.md#2026-09-04-reference-import-review-distillation).

- Silent count-limit maintenance is complete across Knowledge batches, Reference attachments, and
  readable-citation occurrence resolution. Knowledge accepts every selected path within its 4 MiB
  IPC, 250 MiB file, and 1 GiB batch boundaries and runs four cancellable imports at once.
  Reference review pages every valid attachment in groups of 20 without a global attachment cap,
  binds opaque cursors to the project session and preview, and atomically enforces a 1 GiB selected
  PDF boundary. Citation previews scan every occurrence in ordered four-request groups. Focused
  verification passed 7 files / 39 tests; the fresh-build Electron gate passed both the 51-file
  Knowledge and attachment-load-more scenarios without retries. A replacement macOS arm64 App was
  built and inventoried successfully in 30.2 seconds. Evidence:
  [`history/implementation-log.md`](history/implementation-log.md#2026-09-03-silent-count-limit-removal).

- Candidate `0.2026.9.3` is built and pushed from release commit
  `f53feb462b2140460ecf9fadc9ee6cf8b92046aa` under annotated tag `v0.2026.9.3`. The clean-source
  macOS arm64 unpacked App gate passed all four build-only stages in 29.9 seconds, including native
  preparation, production compilation, App assembly, no-Team-ID signature policy, and a 33,569-entry
  resource inventory. The tag does not by itself claim installer, signed-release, notarization, or
  GitHub Release publication. Evidence:
  [`history/implementation-log.md`](history/implementation-log.md#2026-09-03-candidate-0202693-build-and-tag).

- Review fixture and annotation removal is complete under ADR 077. The Review Center, manuscript
  Annotations, deterministic `check_draft`, persistent Review Issues, proposal-to-issue
  reconciliation, and their Renderer/Main/Worker contracts are absent from the live product.
  Agent Protocol v15 exposes no removed tools; project migration 0043 destroys their events,
  linkage JSON, and tables while preserving ordinary conversation and parseable proposals.
  Writing Rules now use their own desktop namespace, while proposal approval, rejection, undo,
  `awaiting_review`, `review_feedback`, and `inspect_change` remain. Final verification passed 36
  focused tests, the fixture inventory, and `check:full`: 236 Vitest files / 1339 tests passed with
  3 benchmark skips, followed by 48/48 Electron E2E scenarios with no retries or skips. Evidence:
  [`history/implementation-log.md`](history/implementation-log.md#2026-09-03-review-fixture-and-annotation-removal).

- User-authorized `/cite` insertion maintenance is complete: the Slash Menu opens a caret-local
  shadcn search popover with three single-line citekey/title candidates, while Main performs the
  bounded project Reference match and stable ranking. Exact insertion, cancellation, stale-scope
  closure, independent undo/redo, saving, citation display, and existing export paths are retained.
  Final-source verification passed 52 focused tests, a standalone `check:fast`, and a fresh-build
  focused Electron gate with one macOS arm64 E2E scenario without retries or skips. No migration,
  dependency, Agent policy, installer, or release changes. Evidence:
  [`history/implementation-log.md`](history/implementation-log.md#2026-09-03-cite-reference-search-maintenance).

- Release `0.2026.9.2` is published from the dependency-refresh commit
  `975d88b0f4e5497770ee4ea79b7320bc51a852fe` under annotated tag `v0.2026.9.2`. The local
  no-Team-ID macOS arm64 full package gate passed in 187.7 seconds across 10 stages, including
  12 packaged runtime smoke scenarios and all 34 packaged E2E scenarios. The tag Actions run
  [33761788245](https://github.com/ecwu/writellm/actions/runs/33761788245) passed the shared
  static/fixture gate and all four native platform build/upload jobs. The published
  [GitHub Release](https://github.com/ecwu/writellm/releases/tag/v0.2026.9.2) contains the seven
  Actions-built installers and four platform evidence files; packages are unsigned and not
  notarized.

- A fresh macOS arm64 App containing the `/cite` Reference search is complete at the user's
  request. `pnpm build:unpack` passed all four stages in 31.7 seconds, including native preparation,
  production compilation, App assembly, no-Team-ID signature policy, and a 33,569-entry resource
  inventory. `dist/macos-arm64` now contains the App and build-only evidence; functional coverage
  is supplied by the `/cite` verification above. Evidence:
  [`history/implementation-log.md`](history/implementation-log.md#2026-09-03-cite-reference-search-maintenance).

- The earlier Pi runtime upgrade completed under the approved 2026-09-03 plan at Agent/Core and
  AI 0.84.4, superseded by the 0.85.0 maintenance above; existing conversations remain usable according to WriteLLM event
  contracts, with no Pi-version allowlist or database migration. Lifecycle, stream-terminal,
  catalog/credential cancellation, and read-only Skill adapters are updated. Final-source
  coverage comprises 1,333 passing Electron-hosted tests with three existing benchmark skips
  (the full run plus the affected 59-test rerun), static checks, 12 packaged smoke scenarios,
  and all 34 packaged E2E scenarios. The single macOS arm64 package gate passed in 210.4 seconds
  without retries or flakes. `dist/macos-arm64` now contains this upgraded working-tree build
  under unchanged release metadata; the earlier local tag remains unchanged. Evidence:
  [`history/implementation-log.md`](history/implementation-log.md#2026-09-03-pi-runtime-upgrade).

- Dependency security and maintenance refresh is complete under the approved 2026-09-03 plan.
  Direct provider, Renderer, formatting, data, PDF, Mermaid, TypeBox, and test patch/minor lines
  are updated; the vulnerable `@tiptap/*`, `browserslist`, `@xmldom/xmldom`, and `fast-uri`
  resolutions are now `3.31.2`, `4.28.8`, `0.8.15`, and `3.1.7` within parent-declared ranges.
  Complete dependency audit, `check:fast`, targeted TypeBox coverage, affected publication
  coverage, and `check:electron` passed. Deferred toolchain, Electron, native, and 0.x migrations
  remain unchanged. Evidence:
  [`history/implementation-log.md`](history/implementation-log.md#2026-09-03-dependency-security-and-maintenance-refresh).

- Earlier candidate `0.2026.9.1` was locally built and verified under the user's build, commit, and tag
  request. The no-Team-ID macOS arm64 package gate passed in 188.0 seconds: 12 runtime smoke
  scenarios and all 34 packaged E2E scenarios, with no failures, retries, flakes, or skips.
  The original artifact evidence is retained in the history; `dist/macos-arm64` has since been
  rebuilt by Pi maintenance. Version metadata and the local annotated
  tag use the repository's canonical `v0.2026.9.1` convention. It is superseded for publication
  by the `0.2026.9.2` release above. Evidence:
  [`history/implementation-log.md`](history/implementation-log.md#2026-09-03-local-build-0202691).

- Agent model configuration maintenance is complete under ADR 076: new runs use current catalog
  limits/reasoning, truncated output is reported as incomplete, and model selectors refresh after
  configuration changes. Existing selections use updated metadata on the next run. Verification
  passed with 115 distinct focused tests, five real Electron scenarios, and static checks; evidence
  and development reruns are recorded in the maintenance history.

- Agent Panel presentation maintenance is complete under ADR 075: six typed content objects,
  one projection for timeline/header/Details, an exhaustive tool table, atomic live-text settlement,
  and stable lifecycle-aware disclosure. Focused coverage totals 78 passing Renderer tests and
  six passing Electron scenarios on macOS arm64. One composite E2E invocation supplied static
  checks and the only build; a clarification text assertion was updated and that scenario alone
  rerun against the same build. Desktop keyboard, sidebar resizing, light/dark screenshots, and
  scoped Impeccable checks passed. Persistence, protocols, dependencies, and Pi pins are unchanged.
  Evidence: [`history/implementation-log.md`](history/implementation-log.md#2026-09-02-agent-panel-presentation-maintenance).

- Build and verification maintenance is complete under the approved 2026-09-02 plan. Focused
  tooling/Trace tests and the complete no-Team-ID macOS arm64 package gate passed, including static
  checks, 12 runtime smoke scenarios, all 34 packaged E2E scenarios, and DMG/ZIP creation from the
  single assembled App. The gate took 187.9 seconds with no E2E retries or flakes. ASAR size fell
  48.3% against the retained package baseline; DMG/ZIP sizes fell 18.6%/18.8%. Ordinary builds are
  test-free; layered gates and timing reports are documented. Other platforms have static/argument
  coverage; hosted timing confirmation waits for the next normally authorized tag. Evidence lives
  in [`history/implementation-log.md`](history/implementation-log.md).

- Desktop-only test/documentation maintenance is complete: dedicated narrow-window checks and
  requirements are removed; desktop sidebar usability and all 28 affected functional scenarios
  are retained. `pnpm check:fast`, the production build, and the six-file focused Electron E2E
  run passed without failures, retries, flakes, or skips. Evidence lives in
  [`history/implementation-log.md`](history/implementation-log.md).

- Project chooser maintenance is complete. Recent-project rows can be removed without touching
  project files and return after a manual reopen. The menu replaces Switch project with explicit
  return-to-chooser close and Quit WriteLLM actions. Exit closes the project before shutdown and
  remains recoverable if close fails. `check:fast`, 45 focused Electron-hosted tests, the production
  build, the focused lifecycle/restart E2E scenario, and screenshot inspection passed. Evidence
  lives in [`history/implementation-log.md`](history/implementation-log.md).

- Checkpoint 83 is complete under ADR 074: structural Agent policy ablation, token-derived
  single-summary context, progressive Skills, best-effort traces, and concrete safe diagnostics.
  Production code is reduced by 778 lines, with authority/no-replay invariants and legacy readers
  retained. Focused coverage, `check:fast`, 1,275 Electron-hosted tests with three benchmark skips,
  the production build, all 49 fresh Electron E2E scenarios, and the complete no-Team-ID macOS
  arm64 package gate passed. The package gate verified 31 recovery fixtures, 53,318 ASAR entries,
  12 runtime smoke scenarios, and all 34 packaged Electron scenarios without failures, flakes,
  or skips; the App, DMG, and ZIP are under `dist/macos-arm64`. No live-provider experiment,
  migration, new setting/dependency, release, commit, tag, push, Developer ID signing, notarization,
  promotion, or publication was performed. Evidence and upstream diagnostic limitations live in
  [`implementation-todo/phase-32.md`](implementation-todo/phase-32.md).

- Checkpoint 82 is complete historical evidence under ADR 073. Its dependency-complete explicit
  injection is superseded by CP83 root-only injection and progressive reads. CP82 removed the
  system-level incomplete-preparation failure gate and rerouted runs from current registry state. Focused
  CP82 coverage, `check:fast`, 1,253 Electron-hosted tests with three benchmark skips, a production
  build, all 49 fresh Electron E2E scenarios, the scoped Impeccable detector, and diff checks
  passed. Detailed evidence lives in
  [`implementation-todo/phase-31.md`](implementation-todo/phase-31.md).

- The completed Checkpoint 82 source has passed the complete no-Team-ID macOS arm64 package gate.
  It verified 31 recovery fixtures from 29 sources, 53,318 ASAR entries, all 12 packaged runtime
  smoke scenarios, and all 34 packaged Electron scenarios without failures, flakes, or skips. The
  gate produced an unpacked App, DMG, and ZIP under `dist/macos-arm64`. No Developer ID signing,
  notarization, release, commit, tag, push, promotion, or publication action was performed.

- The completed Checkpoint 81 source has passed the complete no-Team-ID macOS arm64 package gate.
  It verified 31 recovery fixtures from 29 sources, 53,318 ASAR entries, all 12 packaged runtime
  smoke scenarios, and all 34 packaged Electron scenarios without failures, flakes, or skips. The
  gate produced an unpacked App, DMG, and ZIP under `dist/macos-arm64`. No Developer ID signing,
  notarization, tag, release, promotion, or publication action was performed.

- Checkpoint 81 is complete historical evidence under ADR 072; its rolling checkpoint budgets are
  superseded by CP83 single-summary compaction. CP81 made automatic compaction depend on final
  model-visible token pressure, required checkpoints to defer to
  the latest real user request, and `/compact` invokes the existing manual path immediately. No
  migration, new IPC, provider fork, second summary call, or persistent memory authority is added.
  Focused coverage passed 59 tests, `check:fast` and the complete Electron/build gate passed, and
  all 49 fresh Electron E2E scenarios passed without failures, flakes, or skips. Detailed evidence
  lives in [`implementation-todo/phase-30.md`](implementation-todo/phase-30.md).

- The completed Checkpoint 80 source has passed the complete no-Team-ID macOS arm64 package gate.
  It verified 31 recovery fixtures from 29 sources, 53,318 ASAR entries, all 12 packaged runtime
  smoke scenarios, and all 34 packaged Electron scenarios without flakes, skips, or failures. The
  gate produced an unpacked App, DMG, and ZIP under `dist/macos-arm64`. No Developer ID signing,
  notarization, release, commit, tag, push, promotion, or publication action was performed.

- Checkpoint 80 is complete historical evidence under ADR 071. Its live Worker retry anchors and
  retry UI are removed by CP83; old retry lineage and interrupted partial output remain readable.
  The historical implementation restored request-before Pi state without replaying completed
  tools or adding user messages. The complete Electron
  gate passed 1,240 tests with three benchmark skips, the production build succeeded, and all 49
  fresh Electron E2E scenarios passed without flakes, skips, or failures. Release, commit, tag,
  push, signing, and publication remain unauthorized.
  Detailed scope and acceptance gates live in
  [`implementation-todo/phase-29.md`](implementation-todo/phase-29.md).

- Agent non-blocking tool-failure presentation maintenance is complete. Pre-dispatch failures now
  remain a quiet one-line timeline item by default, while expanding the item reveals the bounded
  tool, code, message, validation paths, and duration. Terminal run failures remain visible as
  recovery state. Focused Renderer tests and `check:fast` passed; no protocol, persistence, or
  authority boundary changed.

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
  rather than its DOM reference. Hosted timing also exposed
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
- Agent, Embedding, and Rerank Base URLs accept HTTP or HTTPS for any valid host, including
  domains, IPv4, and IPv6. Model discovery and connection probes now use the matching explicit
  model-service request policy. MinerU retains its existing Base URL validation, stricter
  loopback-only HTTP request policy, and public-HTTPS artifact policy. URL credentials,
  query parameters, and fragments remain prohibited in configured Base URLs; authenticated
  requests still reject redirects.
  Initial configuration coverage passed 66 tests and a source Electron save/restart scenario;
  the subsequent request-policy correction passed 48 focused tests and static checks. The local
  macOS arm64 App includes that correction and passed all 12 packaged runtime smoke categories.
  Evidence: [HTTP endpoint maintenance](history/implementation-log.md#2026-09-17-model-service-http-endpoints)
  and [request policy correction](history/implementation-log.md#2026-09-17-model-service-http-request-policy-correction).
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
  composer context, desktop sidebar layout, and accessibility.
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
- Checkpoint 67 is complete. A true first launch now opens a fully optional Welcome →
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
build, all 25 recovery fixtures from 23 sources, the fresh 41/41 Real-Electron suite, desktop UI
inspection, scoped Impeccable, and `git diff --check`.

Checkpoint 62 passed focused Renderer and Real-Electron coverage, `check:fast`, the complete
Electron-hosted gate (188 files / 1048 tests with three intentional benchmark skips), the
production build, the fresh 41/41 Real-Electron suite, desktop visual inspection, scoped
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
persistence, and restart suppression. Desktop runtime inspection,
scoped Impeccable, and `git diff --check` also passed.

Checkpoint 68 passed frozen installation and zero-advisory production/full audits; focused
schema, migration, editor, Agent, interchange, publication, and safety coverage; `check`,
`check:fast`, the complete Electron-hosted gate (200 passing files / 1107 passing tests with three
intentional benchmark skips) and production build; all 27 recovery fixtures from 25 protected
sources; and the fresh 45/45 Real-Electron manifest with no flaky, skipped, or failed scenario.
Runtime verification covered native Inline/Block Math, application-owned plain-content Diagram,
source safety and recovery, metadata, dynamic theme rendering, sanitized isolated SVG,
persistence, reopen, Agent contract v9, and Markdown export. No package/release action,
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
Runtime visual QA covered the 640 px desktop Agent sidebar and completed the bounded
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

Checkpoint 81 is complete under ADR 072. It removed event/byte auto-compaction thresholds,
strengthened the existing payload-v3 rolling handoff prompt and wrapper, and added the slash-only
immediate manual compaction action. The existing source scan ceiling, tool-loop finalization,
provider-overflow no-replay rule, IPC/preload boundary, and raw-event authority remain unchanged.
Dependencies, migrations, release/package work, commits, tags, pushes, signing, notarization,
promotion, and publication remain outside authorization.

Checkpoint 80 is authorized under ADR 071. It may add the live Worker retry anchor, capability-
bound Main/Worker protocol, schema-v4 `model_retry` lineage, request-scoped retry-waiting activity,
dedicated IPC/preload method, truthful Renderer actions, migration/recovery coverage, and the
approved non-release verification gates. Durable Agent jobs, restart recovery, token-offset stream
resume, provider-specific SDK paths, Pi forks, tool replay, package/release work, commits, tags,
pushes, signing, notarization, promotion, and publication remain outside this authorization.

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
