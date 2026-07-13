# Tasks: 分栏式工作区导航重构

**Input**: Design documents from `/specs/013-workspace-navigation-redesign/`

**Prerequisites**: Accepted `spec.md`, accepted `plan.md`, accepted 006 plan/contract v1.1, accepted ADR-005 v1.1, `research.md`, `data-model.md`, `contracts/`, and `quickstart.md`

**Tests**: Required because this feature changes documented user journeys, renderer owner lifecycle, the existing source protocol security boundary, compiled Electron layout/focus behavior, and source DTO contracts.

**Organization**: Tasks are grouped by user story. Shared navigation composition is foundational; each story then owns its projections, behavior, and failure-boundary evidence.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel because it changes different files and has no dependency on another incomplete task in the same phase.
- **[Story]**: Maps the task to the user story in `spec.md`.
- Every task names the exact file path or paths it changes.

---

## Phase 1: Setup (Shared Test Infrastructure)

**Purpose**: Establish reusable fixtures and a compiled Electron harness before product code changes.

- [X] T001 Add Sections, Knowledge Base, long-name, empty-owner, and stale-selection builders in `test/fixtures/workspace/workspace-navigation-fixtures.tsx`
- [X] T002 [P] Add deterministic small, ranged, tampered, and 200 MB boundary PDF fixture helpers in `test/fixtures/sources/pdf-fixtures.ts`
- [X] T003 [P] Create the compiled navigation fixture shell in `test/runtime/workspace-navigation/fixture.html`, `test/runtime/workspace-navigation/fixture.tsx`, and `test/runtime/workspace-navigation/electron-entry.mjs`

**Checkpoint**: Navigation, source-preview, and runtime scenarios have deterministic fixtures without product implementation shortcuts.

---

## Phase 2: Foundational Navigation Composition (Blocking Prerequisites)

**Purpose**: Build identity-only session state and the shared three-region composition required by every story.

**⚠️ CRITICAL**: No user-story implementation begins until this phase is complete.

- [X] T004 Write failing reducer tests for one active category, per-category last valid item, sidebar expansion, compact pane, Settings return, project reset, and invalidation in `test/unit/workspace/workspace-navigation-session.test.ts`
- [X] T005 Implement the identity-only `WorkspaceNavigationSession` reducer and selectors in `src/renderer/workspace/workspaceNavigationSession.ts`
- [X] T006 [P] Write failing DOM contract tests for landmarks, owner slots, inert inactive panes, independent scroll regions, and the absence of router/cookie/global-shortcut behavior in `test/contract/workspace/workspace-navigation-frame.test.tsx`
- [X] T007 Implement the controlled nested sidebar/main frame without owner business state in `src/renderer/workspace/components/WorkspaceNavigationFrame.tsx`
- [X] T008 [P] Add the composite grid, 64 px rail, context sidebar, main inset, sticky header, independent overflow, and semantic-token styles in `src/renderer/workspace/workspace-navigation.css`
- [X] T009 [P] Extend icon contract tests for `ListTree`, `LibraryBig`, `Settings`, and `PanelLeft`, decorative SVGs, tooltips, names, and 44 px targets in `test/unit/ui/action-icon-contract.test.tsx` and `test/integration/ui/icon-action-accessibility.test.tsx`
- [X] T010 Implement the native-button category rail, distinct Settings footer, and compact labeled command strip in `src/renderer/workspace/components/WorkspaceCategoryRail.tsx`
- [X] T011 Implement the generic semantic list, location breadcrumb/header, and detail slot compositions in `src/renderer/workspace/components/ContextNavigationList.tsx`, `src/renderer/workspace/components/WorkspaceLocationHeader.tsx`, and `src/renderer/workspace/components/WorkspaceDetail.tsx`
- [X] T012 Replace the temporary tool-panel orchestration with the navigation frame and owner-slot wiring while preserving project identity, leave guards, and status ownership in `src/renderer/workspace/WorkspaceShell.tsx` and `src/renderer/App.tsx`

**Checkpoint**: The project opens into a typed, accessible three-region shell with placeholder owner slots and no business mutation side effects.

---

## Phase 3: User Story 1 — 从统一侧栏浏览 Sections (Priority: P1) 🎯 MVP

**Goal**: Show every current orientation item in owner order and open either its existing chapter or its planning context without inventing or mutating content.

**Independent Test**: Open a project with linked and unlinked outline items, verify title/summary/status/chapter state in order, open each item, preserve dirty editor/orientation state across selections, and verify the empty-project entry path.

### Tests for User Story 1

- [X] T013 [P] [US1] Write failing projection and selection-validity tests for persisted and client-draft outline identities in `test/unit/writing-orientation/section-navigation-projection.test.ts`
- [X] T014 [P] [US1] Write failing Sections list/detail journey tests for linked, unlinked, dirty, long-name, deleted-selection, load-error, and empty states in `test/integration/workspace/sections-workspace.test.tsx`

### Implementation for User Story 1

- [X] T015 [US1] Implement `SectionNavigationItem` projection, owner-order preservation, revision fencing, and safe default selection in `src/renderer/features/writing-orientation/orientation-state.ts`
- [X] T016 [P] [US1] Implement the full-width native-button Sections list with accessible complete names, textual status, summary, and chapter association in `src/renderer/features/writing-orientation/SectionNavigationList.tsx`
- [X] T017 [US1] Implement linked-chapter and unlinked-planning detail composition without implicit chapter creation in `src/renderer/features/writing-orientation/SectionWorkspace.tsx`
- [X] T018 [US1] Refactor the orientation and chapter owner wiring so one mounted owner instance supplies both navigation projection and main detail in `src/renderer/features/writing-orientation/WritingOrientationPanel.tsx` and `src/renderer/features/editor/components/ChapterEditor.tsx`
- [X] T019 [US1] Wire Sections list/detail, owner-provided create/start-writing/retry actions, and safe invalid-selection fallback into `src/renderer/workspace/WorkspaceShell.tsx`
- [X] T020 [US1] Extend 003/004 regression coverage to prove navigation selection does not save, delete, reorder, create, discard, or replace owner state in `test/integration/writing-orientation/leave-guard.test.tsx` and `test/integration/editor/chapter-saving.test.tsx`
- [X] T021 [US1] Add compiled Electron coverage for Sections ordering, keyboard selection, long text, empty state, persistent editor identity, and dirty-state restoration in `test/runtime/workspace-navigation/sections-runtime.test.ts`

**Checkpoint**: User Story 1 is independently functional and testable using only Sections navigation and existing 003/004 owner actions.

---

## Phase 4: User Story 2 — 浏览知识库资料与处理状态 (Priority: P1)

**Goal**: Show all 006-owned source states and version-consistent details, processed Markdown, and a securely fenced original-PDF preview.

**Independent Test**: Open queued, parsing, indexing, partial, available, failed, and retryable PDFs; verify owner-provided state/count/eligibility, switch original/processed modes, reject stale results, and use existing import/retry/remove actions.

### Tests for User Story 2

- [X] T022 [P] [US2] Write failing contract tests for `sourceVersionId`, reconciled counts, preview availability, version-conflict resync, bounded DTOs, and redaction in `test/contract/sources/source-detail-ipc.test.ts`
- [X] T023 [P] [US2] Write failing exact-route, traversal, sender/session/version, signature/hash/size, `HEAD`, full/single-range, 404/416, cancellation, and no-leak tests in `test/contract/sources/source-original-preview-protocol.test.ts`
- [X] T024 [P] [US2] Write failing generation/version fence and mixed-page rejection tests in `test/unit/sources/source-detail-view-state.test.ts`
- [X] T025 [P] [US2] Write failing Knowledge Base list/detail tests for every baseline state, empty/error paths, Markdown order, missing media, retry, remove, and stale events in `test/integration/workspace/knowledge-base-workspace.test.tsx`
- [X] T026 [P] [US2] Write failing PDF.js viewer DOM tests for local worker configuration, page/zoom controls, text-layer naming, safe errors, late-render cancellation, and disabled unsupported capabilities in `test/integration/sources/source-pdf-preview.test.tsx`

### Implementation for User Story 2

- [X] T027 [US2] Extend the accepted v1.1 `SourceDetail` result and exact validation schemas without adding preload methods in `src/shared/sources.ts`
- [X] T028 [US2] Reconcile source-version identity, block/index/failure counts, and preview availability in authoritative reads in `src/main/sources/source-repository.ts` and `src/main/sources/handlers.ts`
- [X] T029 [US2] Implement the fixed active-session/current-version original-PDF resolver with safe headers and bounded stream/range handling in `src/main/sources/source-preview-protocol.ts`
- [X] T030 [US2] Register and invalidate the reserved preview route without expanding scheme privileges or sandbox flags in `src/main/main.ts` and `src/main/sources/source-runtime.ts`
- [X] T031 [US2] Implement `SourceNavigationItem`, `SourceDetailViewState`, generation/version fences, event-gap resync, and invalid-selection cleanup in `src/renderer/features/sources/source-state.ts`
- [X] T032 [P] [US2] Implement the owner-projected Knowledge Base navigation list and all textual processing/eligibility states in `src/renderer/features/sources/KnowledgeBaseNavigationList.tsx`
- [X] T033 [US2] Refactor source loading/subscription/actions into one persistently mounted Knowledge Base owner in `src/renderer/features/sources/KnowledgeBaseWorkspace.tsx` and `src/renderer/features/sources/SourceLibrary.tsx`
- [X] T034 [US2] Render reconciled counts, safe failure summaries, partial readiness, ordered Markdown blocks, missing-media placeholders, and original/processed mode controls in `src/renderer/features/sources/SourceDetail.tsx`
- [X] T035 [US2] Implement display-only PDF.js canvas/text-layer rendering with local worker URL, bounded page/zoom controls, and cancellation in `src/renderer/features/sources/SourcePdfPreview.tsx`
- [X] T036 [US2] Add Knowledge Base row, detail, mode control, Markdown, bounded PDF viewport, text layer, and responsive styles in `src/renderer/features/sources/source-library.css`
- [X] T037 [US2] Wire Knowledge Base list/detail and owner-provided import/retry/remove actions into `src/renderer/workspace/WorkspaceShell.tsx`
- [X] T038 [US2] Add compiled Electron offline worker/CSP, active-project invalidation, range streaming, tamper rejection, 200 MB boundary, no-network, no-path, and no-plugin evidence in `test/runtime/workspace-navigation/source-preview-runtime.test.ts` and `test/runtime/sources/security-baseline.test.ts`

**Checkpoint**: User Story 2 is independently functional, all displayed facts come from 006, and the original-PDF path is verified at the real protocol/runtime boundary.

---

## Phase 5: User Story 3 — 在主工作区间稳定切换 (Priority: P1)

**Goal**: Make category/list/detail navigation latest-intent-wins, preserve mounted owner state, and remain keyboard/focus/layout safe at wide and constrained sizes.

**Independent Test**: Switch Sections and Knowledge Base selections 100 times with dirty content, active requests, scroll, deletion, 960×640, and 200% zoom; verify one coherent final context, persistent owner identity, and no navigation mutation.

### Tests for User Story 3

- [X] T039 [P] [US3] Write failing 100-switch, latest-event-wins, per-category restoration, owner DOM identity, scroll, and stale-result integration tests in `test/integration/workspace/workspace-navigation-switching.test.tsx`
- [X] T040 [P] [US3] Write failing constrained list/detail, explicit Back, hidden/inert Tab exclusion, fallback focus, collapse/expand, and category-auto-expand tests in `test/integration/workspace/workspace-navigation-responsive.test.tsx`
- [X] T041 [P] [US3] Write failing landmark/name/current-state/44 px/keyboard-only accessibility tests in `test/integration/workspace/workspace-navigation-accessibility.test.tsx`

### Implementation for User Story 3

- [X] T042 [US3] Keep first-visited project category panes mounted and apply controlled hidden/inert visibility without transferring business state into the shell in `src/renderer/workspace/WorkspaceShell.tsx`
- [X] T043 [US3] Implement latest-intent generation changes, owner selection revalidation, per-category return, and project-session reset orchestration in `src/renderer/workspace/workspaceNavigationSession.ts`
- [X] T044 [US3] Implement desktop collapse/trigger/category expansion and constrained command-strip list/detail disclosure in `src/renderer/workspace/components/WorkspaceNavigationFrame.tsx` and `src/renderer/workspace/components/WorkspaceCategoryRail.tsx`
- [X] T045 [US3] Implement focus migration before hiding panes, item/heading fallback, Settings-safe focus keys, semantic breadcrumbs, and independent scroll restoration in `src/renderer/workspace/components/WorkspaceLocationHeader.tsx` and `src/renderer/workspace/components/ContextNavigationList.tsx`
- [X] T046 [US3] Complete 1200×800, 960×640, 200% zoom, forced-colors, reduced-motion, long-text, and constrained progressive-disclosure CSS in `src/renderer/workspace/workspace-navigation.css`
- [X] T047 [US3] Add compiled Electron keyboard/focus/layout/scroll/100-switch coverage across themes and zoom modes in `test/runtime/workspace-navigation/navigation-runtime.test.ts`
- [X] T048 [US3] Prove category, item, Back, collapse, and Settings navigation emit no save/delete/retry/import/chapter-create side effects in `test/integration/workspace/workspace-navigation-owner-boundaries.test.tsx`

**Checkpoint**: User Story 3 satisfies the stable-workspace contract with coherent latest selection, mounted owners, accessible reflow, and no data side effects.

---

## Phase 6: User Story 4 — 从独立入口管理全局设置 (Priority: P2)

**Goal**: Open one clearly application-level Settings area that composes existing provider and source-service owners, clears write-only drafts on close, and restores project context/focus.

**Independent Test**: Open Settings from each category, exercise provider/MinerU/SiliconFlow redacted save/replace/remove/validate flows, close with an unsaved secret, delete the return item while open, and verify safe context and focus restoration across projects/restart.

### Tests for User Story 4

- [X] T049 [P] [US4] Write failing source-service form state tests for independent revisions, write-only inputs, conflicts, validation, removal, safe errors, and close cleanup in `test/unit/sources/source-service-settings-state.test.ts`
- [X] T050 [P] [US4] Write failing Settings composition and return tests for application ownership, inert project panes, invalidated item fallback, and focus restoration in `test/integration/workspace/settings-area.test.tsx`

### Implementation for User Story 4

- [X] T051 [US4] Implement independent MinerU/SiliconFlow form state over the accepted fixed owner namespace in `src/renderer/features/sources/source-service-settings-state.ts`
- [X] T052 [US4] Implement the redacted source-service settings forms and owner-defined save/replace/remove/validate flows in `src/renderer/features/sources/SourceServiceSettingsPanel.tsx`
- [X] T053 [US4] Compose provider settings and source-service settings under explicit application-level headings and unmount-on-close lifecycle in `src/renderer/workspace/components/SettingsArea.tsx`
- [X] T054 [US4] Wire Settings open/close return points, project-pane inertness, still-valid category/item restoration, and stable focus fallback in `src/renderer/workspace/WorkspaceShell.tsx` and `src/renderer/workspace/workspaceNavigationSession.ts`
- [X] T055 [US4] Extend 005/006 secret lifecycle and cross-project ownership regressions for the composed area in `test/integration/provider-settings/secret-lifecycle.test.ts` and `test/integration/sources/service-credentials.test.ts`
- [X] T056 [US4] Add compiled Electron Settings keyboard, 200% zoom, write-only cleanup, redaction, project-switch, and focus-return coverage in `test/runtime/workspace-navigation/settings-runtime.test.ts`

**Checkpoint**: User Story 4 is independently functional while each settings owner retains its accepted security, revision, validation, and persistence contract.

---

## Phase 7: Polish & Cross-Cutting Verification

**Purpose**: Close security, regression, usability, and documentation evidence spanning multiple stories.

- [X] T057 [P] Add bundle/source assertions for no router, cookie/localStorage layout, global `⌘/Ctrl+B`, Radix Sidebar/Sheet/Skeleton, remote PDF assets, generic IPC, PDF paths/bytes, plugin, or AI-agent placeholder in `test/runtime/workspace-navigation/bundle-boundary.test.ts`
- [X] T058 [P] Add icon-placement, long/similar-name, icon-failure, target geometry, forced-colors, and compact visible-label evidence in `test/runtime/workspace-navigation/icon-usability-runtime.test.ts`
- [X] T059 Run and fix all 001–006, 011, and 012 regressions affected by the new composition, recording any intentional fixture updates in `test/contract/workspace/workspace-ipc-regression.test.ts` and `test/integration/workspace/stable-workspace.test.tsx`
- [X] T060 Run `bun run typecheck`, `bun run test`, `bun run build`, `bun run test:smoke`, and `bun run test:ui-runtime`, and record the final command evidence in `specs/013-workspace-navigation-redesign/quickstart.md`
- [ ] T061 Execute the SC-001/SC-002 timed find-and-judge tasks and SC-008 usability rating protocol, recording participant counts, results, and caveats in `specs/013-workspace-navigation-redesign/audit/usability-evidence.md`
- [X] T062 Audit FR-001–FR-022 and SC-001–SC-009 against implementation/runtime evidence and record final traceability in `specs/013-workspace-navigation-redesign/audit/acceptance-evidence.md`
- [X] T063 Replace matching renderer controls with official source-owned shadcn Base UI Lyra primitives and switch the foundation to Neutral, Inter, Lucide, radius none while retaining the 44 px pointer-target contract
- [X] T064 Recompose the workspace and launch project picker with the Lyra primitives, `sidebar-09` topology, non-overlapping responsive headers, and pointer-transparent portal tooltips
- [X] T065 Run typecheck, full tests, lint, build and smoke verification for the Lyra revision and record the final evidence

**Checkpoint**: All accepted requirements have source-backed automated or manual evidence and the feature is ready for implementation completion review.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 — Setup**: No dependencies; T001–T003 can begin immediately.
- **Phase 2 — Foundational**: Depends on Phase 1 and blocks every user story.
- **Phase 3 — US1 Sections**: Depends on Phase 2; independently deliverable as the recommended MVP.
- **Phase 4 — US2 Knowledge Base**: Depends on Phase 2 and can proceed in parallel with US1 after shared shell stabilization.
- **Phase 5 — US3 Stable switching**: Depends on completed US1 and US2 owner panes because it verifies cross-category persistence and ordering.
- **Phase 6 — US4 Settings**: Depends on Phase 2; its owner panels can be built in parallel with US1/US2, but final shell return integration follows the stable navigation reducer.
- **Phase 7 — Polish**: Depends on all stories selected for release.

### User Story Dependency Graph

```text
Setup → Foundational ─┬→ US1 Sections ───────┐
                     ├→ US2 Knowledge Base ─┼→ US3 Stable switching → Polish
                     └→ US4 Settings ───────┘
```

- **US1** owns only the 003/004 projection and detail journey; it does not require Knowledge Base or Settings.
- **US2** owns only the 006 projection, source details, and PDF boundary; it does not require Sections or Settings.
- **US3** integrates the already independently testable US1/US2 panes and proves persistent cross-category behavior.
- **US4** owns Settings composition and can be tested with either project category; final focus-return evidence uses the shared session implemented for US3.

### Within Each Story

- Write the listed tests first and confirm they fail for the missing behavior.
- Implement owner projections/state before view composition.
- Implement main/shared contract changes before renderer consumers.
- Complete DOM/integration evidence before compiled Electron runtime evidence.
- Do not advance a story checkpoint while its owner regression or security boundary is failing.

---

## Parallel Execution Examples

### User Story 1

```text
T013 projection unit tests || T014 Sections journey tests
After T015: T016 Sections list can proceed while T017 detail composition begins
```

### User Story 2

```text
T022 DTO contract || T023 protocol contract || T024 fence unit tests || T025 workspace journey || T026 viewer DOM tests
After T027–T031: T032 list UI can proceed alongside preparation for T034 detail rendering
```

### User Story 3

```text
T039 switching tests || T040 responsive/focus tests || T041 accessibility tests
After T042–T046: T047 runtime matrix || T048 owner-boundary regression
```

### User Story 4

```text
T049 source-service state tests || T050 Settings composition tests
After T051–T054: T055 owner regressions can proceed before T056 compiled runtime validation
```

---

## Implementation Strategy

### MVP First — User Story 1

1. Complete Setup and Foundational phases.
2. Complete US1 Sections projection, list, detail, and 003/004 regression evidence.
3. Stop and validate the US1 independent test and compiled Sections runtime task.
4. Demonstrate the stable Sections navigation increment without enabling incomplete Knowledge Base or Settings surfaces.

### Incremental Delivery

1. **Foundation**: identity-only reducer and accessible three-region shell.
2. **US1**: Sections master/detail MVP.
3. **US2**: Knowledge Base states, Markdown, and original-PDF preview.
4. **US3**: Cross-category persistence, latest-intent ordering, and responsive/focus behavior.
5. **US4**: Application-level Settings composition and safe return.
6. **Polish**: full regression, runtime, usability, and acceptance evidence.

### Safe Parallel Team Strategy

1. Complete shared Setup/Foundation together.
2. Assign US1 renderer-owner work and US2 shared/main/protocol work to separate owners.
3. Build US4 source-service form state in parallel without editing shared shell files until its integration task.
4. Serialize changes to `WorkspaceShell.tsx`, `workspaceNavigationSession.ts`, and shared runtime fixture files.
5. Integrate US3 only after US1 and US2 pass their independent checkpoints.

---

## Notes

- `[P]` means different files and no dependency on an incomplete task, not merely “could be staffed separately.”
- Story labels appear only in story phases; Setup, Foundational, and Polish tasks intentionally have no story label.
- 006 and ADR-005 v1.1 are accepted producer sources; implementation must not broaden their fixed route into generic file access.
- `pdfjs-dist` 6.1.200 is already exact-pinned; no task may upgrade it implicitly or import full viewer/editor/Node canvas surfaces.
- The `sidebar-09` snapshot is a composition reference only; do not install or copy its parallel primitive/dependency stack.
- Commit after each task or coherent dependency group, and stop at every story checkpoint for independent validation.
