# Tasks: 全界面图标与易用性改进

**Input**: Design documents from `/specs/012-icon-usability-refresh/`

**Prerequisites**: `spec.md` and `plan.md` are Accepted; ADR-003 is Accepted; a new ADR is not required.

**Tests**: Required because the accepted specification explicitly requires DOM semantics, compiled Electron runtime behavior, existing business regression, audit closure, and representative user-flow validation.

**Organization**: Tasks are grouped by user story so each story produces an independently verifiable usability increment. Repository audit records are design/test evidence, not runtime product data.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel because it changes different files and has no dependency on an incomplete task.
- **[Story]**: Maps the task to US1, US2, or US3 from `spec.md`.
- Every task names the exact file or directory it changes.

## Phase 1: Setup (Audit and source inventory)

**Purpose**: Establish reviewable coverage and evidence scaffolding before changing UI source.

- [X] T001 Inventory every visible control, state, character pseudo-icon, and current source locator across the five required surfaces in `specs/012-icon-usability-refresh/audit/action-inventory.md`
- [X] T002 [P] Create the structured finding register with severity, requirement, disposition, approval, and compensation fields in `specs/012-icon-usability-refresh/audit/findings.md`
- [X] T003 [P] Create the evidence index for source, DOM, Electron runtime, manual, and user-flow evidence in `specs/012-icon-usability-refresh/audit/evidence.md`
- [X] T004 Reconcile the T001 inventory against the canonical action rows and controlled `workspace-tool` extension point in `specs/012-icon-usability-refresh/contracts/action-usability-contract.md`

---

## Phase 2: Foundational (Shared control contract)

**Purpose**: Make shared icon sizing, control targets, focus, tooltip, and state behavior safe for every surface.

**⚠️ CRITICAL**: No user-story surface migration begins until this phase passes its focused DOM tests.

- [X] T005 [P] Add failing contract coverage for Lucide-only action sources, decorative SVG semantics, label-required actions, and icon-only admission metadata in `test/unit/ui/action-icon-contract.test.tsx`
- [X] T006 [P] Add failing shared-control tests for icon gaps, icon sizing, 44×44 targets, disabled/busy state semantics, focus-visible behavior, focus/hover tooltip discovery, and Escape dismissal in `test/unit/ui/interactive-primitives.test.tsx`
- [X] T007 Add reusable icon-and-label and icon-only sizing/state behavior without business action knowledge in `src/renderer/components/ui/button.tsx`
- [X] T008 Implement focus/hover/Escape tooltip behavior and stable description association for icon-only controls in `src/renderer/components/ui/tooltip.tsx`
- [X] T009 Add semantic icon sizing, control target, focus, forced-colors, reduced-motion, and wrapping rules in `src/renderer/styles.css`
- [X] T010 Make T005 and T006 pass while preserving existing primitive and pattern coverage in `test/unit/ui/action-icon-contract.test.tsx` and `test/unit/ui/interactive-primitives.test.tsx`

**Checkpoint**: Shared controls satisfy the action contract and are ready for feature composition.

---

## Phase 3: User Story 1 — 快速识别常用操作 (Priority: P1) 🎯 MVP

**Goal**: Give all implemented surfaces one consistent Lucide action language while preserving visible labels for primary and dangerous operations.

**Independent Test**: In launch, workspace, orientation/outline, and editor compositions, create, open, return, save, add, move, delete, close, paste, export, settings, and workspace-tool actions use the contract icon/name pair; no second icon source or character pseudo-icon remains; existing business journeys still pass.

### Tests for User Story 1

- [X] T011 [P] [US1] Add failing launch action-name, Lucide mapping, busy-state, recent-project, and fallback-text checks in `test/integration/project/launch-page.test.ts`
- [X] T012 [P] [US1] Add failing workspace navigation, tool-rail, panel-close, status-action, and leave-dialog mapping checks in `test/contract/workspace/workspace-renderer-contract.test.tsx`
- [X] T013 [P] [US1] Add failing save, add, move, delete, selection, and chapter-entry action mapping checks in `test/integration/writing-orientation/outline-flow.test.tsx`
- [X] T014 [P] [US1] Add failing paste, export, save, conflict, and dialog action mapping checks in `test/integration/editor/markdown-interchange.test.tsx` and `test/integration/editor/chapter-saving.test.tsx`

### Implementation for User Story 1

- [X] T015 [US1] Apply `FolderPlus` and `FolderOpen` with stable visible labels and non-color busy feedback to launch and recent-project actions in `src/renderer/launch/LaunchPage.tsx`
- [X] T016 [P] [US1] Apply `ArrowLeft` while preserving the visible return label and leave protection in `src/renderer/workspace/components/ProjectNavigation.tsx`
- [X] T017 [P] [US1] Register stable icon/name/owner mappings for each actual workspace tool and render them as named Lucide imports in `src/renderer/App.tsx` and `src/renderer/workspace/components/ToolRail.tsx`
- [X] T018 [US1] Apply `X` to the panel-close action with an explicit accessible name and tooltip while preserving focus return in `src/renderer/workspace/components/ToolPanelHost.tsx`
- [X] T019 [US1] Apply the canonical action icon and visible label rules to status recovery and save/leave actions in `src/renderer/workspace/components/WorkspaceStatusRegion.tsx` and `src/renderer/workspace/WorkspaceShell.tsx`
- [X] T020 [US1] Replace outline arrow characters with `ArrowUp` and `ArrowDown`, and add `Save`, `Plus`, and `Trash2` without hiding required labels in `src/renderer/features/writing-orientation/WritingOrientationPanel.tsx`
- [X] T021 [US1] Apply `ClipboardPaste`, `Download`, and `Save` with stable labels and explicit busy/status feedback in `src/renderer/features/editor/components/ChapterEditor.tsx`
- [X] T022 [P] [US1] Apply canonical confirm/cancel/reload/export action presentation without weakening destructive or conflict wording in `src/renderer/features/editor/components/ChapterConflictDialog.tsx`, `src/renderer/features/editor/components/MarkdownPasteDialog.tsx`, and `src/renderer/features/editor/components/MarkdownExportDialog.tsx`
- [X] T023 [US1] Close all US1 mapping and character-icon inventory rows with source/DOM evidence in `specs/012-icon-usability-refresh/audit/action-inventory.md` and `specs/012-icon-usability-refresh/audit/evidence.md`
- [X] T024 [US1] Run and record the existing create/open, leave, outline/reorder, chapter, save, paste, and export regression results in `specs/012-icon-usability-refresh/audit/evidence.md`

**Checkpoint**: The common-action icon and name system is consistent and independently testable across all implemented surfaces.

---

## Phase 4: User Story 2 — 无障碍地理解和使用图标操作 (Priority: P1)

**Goal**: Ensure every icon-related action remains named, keyboard reachable, visibly focused, large enough, and understandable across assistive and system display modes.

**Independent Test**: Keyboard-only traversal and accessibility-tree inspection find one correct control name, no duplicate SVG announcement, a focus/hover tooltip for every icon-only control, at least 44×44 CSS px pointer targets, and distinguishable states at 960×640, 200% text scaling, light/dark, forced colors, and reduced motion.

### Tests for User Story 2

- [X] T025 [P] [US2] Add failing accessible-name, decorative-SVG, tooltip, keyboard, disabled, busy, and selected-state checks for all migrated surface controls in `test/integration/ui/icon-action-accessibility.test.tsx`
- [X] T026 [P] [US2] Extend the compiled UI fixture with launch, workspace, orientation, outline, and representative editor icon-action states in `test/runtime/ui-foundation/fixture.tsx`
- [X] T027 [US2] Add failing Electron geometry and keyboard checks for 44×44 targets, focus order, tooltip discovery, and Escape dismissal in `test/runtime/ui-foundation/icon-action-accessibility.test.ts`
- [X] T028 [P] [US2] Add failing Electron checks for light, dark, forced-colors, reduced-motion, 960×640, and 200% text scaling in `test/runtime/ui-foundation/icon-action-media.test.ts`

### Implementation for User Story 2

- [X] T029 [US2] Correct accessible names, tooltip coverage, SVG hiding, keyboard activation, and state semantics found by T025 across `src/renderer/launch/LaunchPage.tsx`, `src/renderer/workspace/components/ToolRail.tsx`, `src/renderer/workspace/components/ToolPanelHost.tsx`, `src/renderer/features/writing-orientation/WritingOrientationPanel.tsx`, and `src/renderer/features/editor/components/ChapterEditor.tsx`
- [X] T030 [US2] Correct target geometry, responsive focus reachability, forced-colors boundaries, and reduced-motion behavior found by T027–T028 in `src/renderer/styles.css`
- [X] T031 [US2] Make the DOM and compiled Electron accessibility matrices pass in `test/integration/ui/icon-action-accessibility.test.tsx`, `test/runtime/ui-foundation/icon-action-accessibility.test.ts`, and `test/runtime/ui-foundation/icon-action-media.test.ts`
- [X] T032 [US2] Perform and record manual keyboard, screen-reader/accessibility-tree, 200% scaling, theme, forced-colors, and reduced-motion evidence for every icon-only placement in `specs/012-icon-usability-refresh/audit/evidence.md`
- [X] T033 [US2] Resolve or formally retain every US2 finding, requiring independent product and accessibility approval plus compensation for any retained high finding, in `specs/012-icon-usability-refresh/audit/findings.md`

**Checkpoint**: Icon actions meet the accepted accessible-name, keyboard, target-size, and media-mode contract.

---

## Phase 5: User Story 3 — 在清晰的信息层级中完成写作任务 (Priority: P2)

**Goal**: Present one clear contextual next step, distinguish secondary and dangerous actions, and keep actionable state feedback usable under narrow or enlarged layouts.

**Independent Test**: The five representative flows show no more than one primary action per current context; empty, failure, unsaved, conflict, success, and destructive states explain the situation and next step; action groups wrap without hiding or truncating primary/dangerous labels.

### Tests for User Story 3

- [X] T034 [P] [US3] Add failing primary/secondary/dangerous hierarchy and contextual empty/error/action checks for launch and workspace in `test/integration/ui/action-hierarchy.test.tsx`
- [X] T035 [P] [US3] Add failing empty-outline, unsaved, saving, saved, delete, linked-item, and chapter-entry hierarchy checks in `test/integration/writing-orientation/motivation-flow.test.tsx` and `test/integration/writing-orientation/outline-flow.test.tsx`
- [X] T036 [P] [US3] Add failing editor action-group, save-state, conflict, paste, export, failure, and success hierarchy checks in `test/integration/editor/chapter-saving.test.tsx` and `test/integration/editor/markdown-interchange.test.tsx`
- [X] T037 [US3] Add failing compiled Electron wrapping, ordering, non-overlap, and primary/dangerous label visibility checks at 1200×800, 960×640, and 200% scaling in `test/runtime/ui-foundation/action-hierarchy-responsive.test.ts`

### Implementation for User Story 3

- [X] T038 [US3] Clarify launch and workspace primary/secondary/dangerous grouping plus contextual empty, failure, and recovery actions in `src/renderer/launch/LaunchPage.tsx`, `src/renderer/workspace/WorkspaceShell.tsx`, and `src/renderer/workspace/components/WorkspaceStatusRegion.tsx`
- [X] T039 [US3] Clarify orientation/outline primary action selection, empty state, unsaved feedback, reorder grouping, and destructive separation in `src/renderer/features/writing-orientation/WritingOrientationPanel.tsx`
- [X] T040 [US3] Clarify editor save/paste/export hierarchy and conflict/failure/success next steps in `src/renderer/features/editor/components/ChapterEditor.tsx`, `src/renderer/features/editor/components/ChapterConflictDialog.tsx`, `src/renderer/features/editor/components/MarkdownPasteDialog.tsx`, and `src/renderer/features/editor/components/MarkdownExportDialog.tsx`
- [X] T041 [US3] Implement action-group wrapping, stable semantic order, label preservation, and narrow/enlarged layout rules in `src/renderer/styles.css`
- [X] T042 [US3] Make the hierarchy DOM tests and compiled Electron responsive matrix pass in `test/integration/ui/action-hierarchy.test.tsx` and `test/runtime/ui-foundation/action-hierarchy-responsive.test.ts`
- [X] T043 [US3] Close the five-surface hierarchy, state, density, and responsive audit rows with linked evidence in `specs/012-icon-usability-refresh/audit/action-inventory.md`, `specs/012-icon-usability-refresh/audit/findings.md`, and `specs/012-icon-usability-refresh/audit/evidence.md`

**Checkpoint**: All three stories are independently testable, and the complete UI has a coherent action hierarchy.

---

## Phase 6: Polish & Cross-Cutting Validation

**Purpose**: Prove full coverage, unchanged product boundaries, user outcomes, and release readiness.

- [X] T044 [P] Search renderer source and bundled output for emoji/Unicode pseudo-icons, icon fonts, remote icon URLs, and non-Lucide action icon sources; record the source-integrity result in `specs/012-icon-usability-refresh/audit/evidence.md`
- [X] T045 [P] Audit the final diff for unchanged project/document results, storage formats, preload/main IPC, security flags, and dependencies; record the boundary result in `specs/012-icon-usability-refresh/audit/evidence.md`
- [X] T046 Run `bun run format:check`, `bun run lint`, `bun run typecheck`, `bun run test`, `bun run build`, `bun run test:smoke`, and `bun run test:ui-runtime`, then record command results in `specs/012-icon-usability-refresh/audit/evidence.md`
- [X] T047 Execute all seven scenarios in `specs/012-icon-usability-refresh/quickstart.md` and link reproducible artifacts from `specs/012-icon-usability-refresh/audit/evidence.md`
- [X] T048 Conduct the five representative flows with representative participants, record pseudonymous per-participant observations and first-attempt completion of all five flows, and calculate SC-004/SC-008 outcomes in `specs/012-icon-usability-refresh/audit/user-flow-observations.md`
- [X] T049 Verify 100% placement/state coverage and close every finding; require product plus accessibility approval and compensation for any retained high finding in `specs/012-icon-usability-refresh/audit/action-inventory.md` and `specs/012-icon-usability-refresh/audit/findings.md`
- [X] T050 Update the 012 task count and implementation status only after T044–T049 pass in `specs/README.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Starts immediately and creates the coverage baseline.
- **Foundational (Phase 2)**: Depends on T001 and T004; blocks all surface migrations.
- **US1 (Phase 3)**: Depends on Phase 2 and delivers the MVP icon/name consistency increment.
- **US2 (Phase 4)**: Depends on Phase 2; its tests may start alongside US1 tests, but T029 must follow the relevant US1 surface migration to avoid conflicting edits.
- **US3 (Phase 5)**: Depends on Phase 2; its tests may start independently, but composition changes should follow the relevant US1 migration and US2 semantic corrections in the same files.
- **Polish (Phase 6)**: Depends on all selected user stories; T050 is the final task.

### User Story Dependencies

- **US1 (P1)**: No dependency on another story after the shared foundation; recommended MVP.
- **US2 (P1)**: Independently testable after the shared foundation, with implementation sequenced after US1 where both touch the same control.
- **US3 (P2)**: Independently testable after the shared foundation, with final composition work sequenced after US1/US2 on overlapping files.

### Within Each User Story

- Add the story's failing tests before its implementation tasks.
- Migrate feature composition before closing its audit rows.
- Run focused regression after each surface instead of deferring all verification to Phase 6.
- Do not mark a finding resolved without linked evidence.

### Parallel Opportunities

- T002 and T003 can run in parallel after T001 begins.
- T005 and T006 can run in parallel.
- T011–T014 cover different feature tests and can run in parallel.
- T016 and T017 can run in parallel; T022 is independent of outline work.
- T025, T026, and T028 can run in parallel after the shared foundation.
- T034–T036 cover different compositions and can run in parallel.
- T044 and T045 can run in parallel after feature implementation is complete.

---

## Parallel Example: User Story 1

```text
Task T011: Launch mapping tests in test/integration/project/launch-page.test.ts
Task T012: Workspace mapping tests in test/contract/workspace/workspace-renderer-contract.test.tsx
Task T013: Outline mapping tests in test/integration/writing-orientation/outline-flow.test.tsx
Task T014: Editor mapping tests in test/integration/editor/markdown-interchange.test.tsx and chapter-saving.test.tsx
```

## Parallel Example: User Story 2

```text
Task T025: Accessible DOM coverage in test/integration/ui/icon-action-accessibility.test.tsx
Task T026: Compiled fixture states in test/runtime/ui-foundation/fixture.tsx
Task T028: Theme/media runtime coverage in test/runtime/ui-foundation/icon-action-media.test.ts
```

## Parallel Example: User Story 3

```text
Task T034: Launch/workspace hierarchy tests in test/integration/ui/action-hierarchy.test.tsx
Task T035: Orientation/outline hierarchy tests in test/integration/writing-orientation/
Task T036: Editor hierarchy tests in test/integration/editor/
```

---

## Implementation Strategy

### MVP First — User Story 1

1. Complete the inventory and shared control foundation.
2. Add failing mapping tests for all five surfaces.
3. Migrate actions surface by surface, running focused regressions after each.
4. Stop at the US1 checkpoint and verify icon/name consistency plus unchanged business behavior.

### Incremental Delivery

1. **Setup + Foundation** → auditable, tested control contract.
2. **US1** → consistent and recognizable action language.
3. **US2** → accessible names, keyboard behavior, target geometry, and display-mode resilience.
4. **US3** → clear hierarchy, state guidance, and responsive composition.
5. **Polish** → full regression, user validation, audit closure, and registry completion.

### Parallel Team Strategy

After Phase 2, tests and audit evidence for separate surfaces can proceed in parallel. Source changes that touch the same composition files must remain ordered US1 → US2 → US3 to avoid conflicting interpretations of action semantics.

## Notes

- `[P]` means different files or non-conflicting evidence work, not merely “could be attempted simultaneously.”
- The Lucide mapping contract remains repository documentation; do not introduce a runtime registry or put business semantics into `components/ui`.
- Preserve `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, existing IPC, storage, data, confirmation, and leave-guard behavior.
- Approximately five participants is an execution expectation, not a hard sample-size gate; SC-004 is evaluated per participant completing all five representative flows on the first attempt.
- Commit after each task or coherent task group, and reopen any resolved finding if later mapping or layout work invalidates its evidence.
