# Tasks: 写作工作台外壳

**Input**: Design documents from `/specs/002-workspace-shell/`

**Prerequisites**: Accepted `spec.md` and `plan.md`; completed 001 and 011 implementations; `research.md`, `data-model.md`, `contracts/`, and `quickstart.md`

**Tests**: Tests are required because this feature changes documented project-opening journeys, keyboard/focus behavior, responsive layout, and compiled Electron UI behavior. Test tasks precede their corresponding implementation tasks.

**Organization**: Tasks are grouped by user story so each story can be implemented and validated as an independent increment. All workspace behavior remains renderer-only.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel because it touches different files and has no dependency on another incomplete task in the phase
- **[Story]**: Maps the task to its specification user story
- Every task names the exact file or files it changes or validates

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the accepted 001/011 baseline and prepare reusable workspace test inputs without changing production behavior.

- [X] T001 Run and record the clean pre-change 001 and 011 regression baseline via `package.json` scripts (`bun run typecheck`, `bun run test`, `bun run build`, and `bun run test:smoke`) before modifying source; reserve T034 for validating the completed 002 delta
- [X] T002 Add safe project snapshots, observable slot content, two available panel descriptors, unavailable panel data, and owner-status builders in `test/fixtures/workspace/workspace-fixtures.tsx`

**Checkpoint**: The inherited project and UI foundation are green, and later story tests can share deterministic renderer-only fixtures.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Define and verify the non-persistent session model shared by every workspace story.

**⚠️ CRITICAL**: No user story implementation begins until this phase is complete.

- [X] T003 Write failing reducer tests for workspace enter/leave cleanup, single-panel invariants, preview/pinned transitions, focus return keys, and monotonic per-owner status acceptance in `test/unit/workspace/workspace-session.test.ts`
- [X] T004 Implement the public workspace types, initial session, pure reducer transitions, status validation, and primary-status priority selector in `src/renderer/workspace/workspaceSession.ts`
- [X] T005 Add compile-time renderer contract coverage for `WorkspaceShellProps`, `ToolPanelDescriptor`, and `OwnerStatusSummary` without adding preload globals or IPC in `test/contract/workspace/workspace-renderer-contract.test.tsx`

**Checkpoint**: Session state is typed, deterministic, renderer-only, and ready for UI composition.

---

## Phase 3: User Story 1 — 从已打开项目进入稳定工作台 (Priority: P1) 🎯 MVP

**Goal**: Hand each successful 001 project result into a named workspace surface, preserve the exact project identity, and return directly to the unchanged launch experience.

**Independent Test**: Create, open-dialog, recent-open, and relink success each show the returned project name and workspace regions; canceled/error/invalid outcomes remain on launch; leaving returns to all existing 001 actions without extra project or recent-record calls.

### Tests for User Story 1

- [X] T006 [P] [US1] Write failing component tests for project name, accessible workspace regions, return action, and exact `ProjectSnapshot` rendering in `test/integration/workspace/workspace-shell-entry.test.tsx`
- [X] T007 [P] [US1] Write failing journey tests for create/open/recent/relink success, canceled/error non-entry, and side-effect-free return to launch in `test/integration/project/workspace-handoff.test.tsx`

### Implementation for User Story 1

- [X] T008 [US1] Refactor successful project results to call an `onProjectOpened(ProjectSnapshot)` handoff while preserving launch loading, error, recent, and appearance behavior in `src/renderer/launch/LaunchPage.tsx`
- [X] T009 [P] [US1] Implement current-project labeling and the accessible direct-return action in `src/renderer/workspace/components/ProjectNavigation.tsx`
- [X] T010 [P] [US1] Implement the named, focusable, persistently mounted main content region in `src/renderer/workspace/components/WorkspaceSlot.tsx`
- [X] T011 [P] [US1] Implement the registered-and-available-only tool navigation region with no future-tool placeholders in `src/renderer/workspace/components/ToolRail.tsx`
- [X] T012 [US1] Compose project navigation, tool navigation, workspace slot, optional panel host location, and status location around the exact project snapshot in `src/renderer/workspace/WorkspaceShell.tsx`
- [X] T013 [US1] Own the `launch | workspace(ProjectSnapshot)` surface, clear the shell session on leave, and reuse `LaunchPage` without revalidation in `src/renderer/App.tsx`

**Checkpoint**: All four valid 001 entry routes reach the workspace, invalid routes do not, and returning restores the original launch feature unchanged.

---

## Phase 4: User Story 2 — 在工具切换中保持主要工作上下文 (Priority: P1)

**Goal**: Preview, pin, switch, and close at most one tool panel while preserving the workspace root, its content/selection/scroll, and deterministic focus return.

**Independent Test**: Across hover preview, click/keyboard pin, rapid switching, toggle, Escape, explicit close, and 100 mixed cycles, only one panel exists and the original workspace DOM node, content, selection, scroll, and focus context remain intact.

### Tests for User Story 2

- [X] T014 [P] [US2] Write failing timer and interaction tests for 200ms preview grace, safe trigger-to-panel pointer movement, preview-to-pinned conversion, pinned persistence, unavailable descriptors, and empty/loading/error panel content preserving the workspace and close path in `test/unit/workspace/tool-panel-orchestration.test.tsx`
- [X] T015 [P] [US2] Write failing stable-slot tests covering switch/toggle/Escape/explicit/rapid events, 100 cycles, DOM identity, input selection, scroll position, and a single close transition in `test/integration/workspace/stable-workspace.test.tsx`
- [X] T016 [P] [US2] Write failing focus tests for trigger retention on open, normal Tab entry, connected/enabled trigger return, removed/disabled trigger fallback, and never returning focus to `body` in `test/integration/workspace/workspace-focus.test.tsx`

### Implementation for User Story 2

- [X] T017 [US2] Add registered trigger refs, preview grace-timer cancellation, last-event-wins activation, idempotent close, and focus restoration orchestration in `src/renderer/workspace/WorkspaceShell.tsx`
- [X] T018 [US2] Add accessible active semantics plus pointer preview and click/keyboard pin event wiring in `src/renderer/workspace/components/ToolRail.tsx`
- [X] T019 [US2] Render at most one preview-or-pinned panel with a heading, bounded `ScrollArea`, pointer region, and explicit close path in `src/renderer/workspace/components/ToolPanelHost.tsx`
- [X] T020 [US2] Preserve the workspace root as a panel-host sibling with stable identity and fallback focus behavior in `src/renderer/workspace/components/WorkspaceSlot.tsx`

**Checkpoint**: Panel orchestration is deterministic and cannot remount or overwrite owner-controlled workspace context.

---

## Phase 5: User Story 3 — 使用一致、可访问的工作台交互 (Priority: P1)

**Goal**: Consume the 011 theme, typography, primitives, overlay rules, and test harness so workspace controls remain keyboard- and zoom-accessible at supported window sizes.

**Independent Test**: Keyboard-only operation, shared Dialog/Tooltip behavior, runtime theme and reduced-motion changes, 960×640 sizing, and 200% text scale keep the project, tools, workspace, panel close path, and important status reachable without remounting the workspace.

### Tests for User Story 3

- [X] T021 [P] [US3] Write failing DOM accessibility tests for region/control names, visible focus paths, tooltip supplementation, shared Dialog focus containment/return including removal of its trigger before close, workspace fallback focus, and long panel content in `test/integration/workspace/workspace-accessibility.test.tsx`
- [X] T022 [P] [US3] Extend the compiled fixture with an observable workspace, panel, Dialog, Tooltip, and status controls in `test/runtime/ui-foundation/fixture.tsx`
- [X] T023 [US3] Add failing native Electron assertions for Tab/Shift+Tab/Escape, modal inertness/focus return including trigger removal before close and workspace fallback, workspace node identity, and panel close reachability in `test/runtime/ui-foundation/workspace-focus.test.ts`
- [X] T024 [US3] Add failing runtime assertions for 1200×800, 960×640, 200% text scale, System/Light/Dark, runtime system-theme change, and reduced motion while preserving the current project, active panel, and workspace DOM identity in `test/runtime/ui-foundation/workspace-responsive.test.ts`

### Implementation for User Story 3

- [X] T025 [US3] Add semantic-token-only wide and constrained workspace grid/toolbar/stacked layouts, shrinkable children, local scrolling, wrapping status/header, and reduced-motion handling in `src/renderer/styles.css`
- [X] T026 [US3] Replace any raw workspace controls with 011 public `Button`, `Tooltip`, `ScrollArea`, `StatusNotice`/`Alert`, and Typeset entry points in `src/renderer/workspace/WorkspaceShell.tsx`, `src/renderer/workspace/components/ProjectNavigation.tsx`, `src/renderer/workspace/components/ToolRail.tsx`, `src/renderer/workspace/components/WorkspaceSlot.tsx`, `src/renderer/workspace/components/ToolPanelHost.tsx`, and `src/renderer/workspace/components/WorkspaceStatusRegion.tsx`

**Checkpoint**: The workspace uses one UI system and remains operable under every accepted keyboard, overlay, appearance, zoom, and minimum-window condition.

---

## Phase 6: User Story 4 — 理解各功能提供的工作状态 (Priority: P2)

**Goal**: Show exactly one safe owner-provided primary status and optional owner action without inventing persistence, success, retry, or recovery semantics.

**Independent Test**: All six states render visible semantic text; stale/duplicate updates are ignored; fixed cross-owner priority and tie-breaking are deterministic; actions appear only when supplied; unsafe internals never appear; panels and Dialogs do not hide urgent errors.

### Tests for User Story 4

- [X] T027 [P] [US4] Write failing component tests for all six states, severity consistency, polite versus urgent announcement, optional callback passthrough, and safe fallback copy in `test/unit/workspace/workspace-status-region.test.tsx`
- [X] T028 [P] [US4] Write failing multi-owner integration tests for fixed priority, latest accepted sequence, stable `sourceId` tie-break, duplicate/out-of-order rejection, removal, and discoverability during panel/Dialog use in `test/integration/workspace/workspace-status-ordering.test.tsx`

### Implementation for User Story 4

- [X] T029 [US4] Render the selected primary status through 011 public status primitives and invoke only the supplied owner callback in `src/renderer/workspace/components/WorkspaceStatusRegion.tsx`
- [X] T030 [US4] Feed owner status receive/remove events through the session reducer while keeping the status region mounted beside workspace and panel content in `src/renderer/workspace/WorkspaceShell.tsx`

**Checkpoint**: Status presentation is deterministic, safe, non-color-only, and does not take ownership of any business transaction.

---

## Phase 7: Polish & Cross-Cutting Validation

**Purpose**: Prove the complete feature against its accepted boundaries and scenarios.

- [X] T031 [P] Add explicit zero-new-IPC assertions for the exact six-method `window.writellm`, exact two-method `window.writellmAppearance`, and absence of workspace preload keys/channels in `test/contract/workspace/workspace-ipc-regression.test.ts`
- [X] T032 [P] Add a source regression asserting no shell persistence, `localStorage`, project/recent mutation, direct Base UI import, raw palette, or new workspace IPC in `test/integration/workspace/workspace-boundaries.test.ts`
- [X] T033 Execute every scenario in `specs/002-workspace-shell/quickstart.md` and update its validation notes with the observed commands and results
- [X] T034 Run final `bun run typecheck`, `bun run test`, `bun run build`, `bun run test:smoke`, and `bun run test:ui-runtime` gates from `package.json`, fixing only 002 regressions in the files named by prior tasks

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Starts immediately.
- **Foundational (Phase 2)**: Depends on Setup and blocks all story implementation.
- **US1 (Phase 3)**: Depends on Foundational and establishes the workspace surface used by later interaction stories.
- **US2 (Phase 4)**: Depends on US1 shell regions and adds panel/focus orchestration without changing project handoff.
- **US3 (Phase 5)**: Depends on the US1/US2 composed controls so runtime accessibility and responsive behavior exercise the real shell.
- **US4 (Phase 6)**: Depends on the foundational status model and US1 status location; its unit work can begin after Foundational, while final integration follows US2/US3.
- **Polish (Phase 7)**: Depends on all selected stories.

### User Story Dependency Graph

```text
Setup → Foundational → US1 → US2 → US3 → Polish
                        └────────→ US4 ─────┘
```

- **US1 (P1)**: First independently deliverable increment and suggested MVP.
- **US2 (P1)**: Requires the US1 stable shell but is independently testable with fixture-owned slot and panels.
- **US3 (P1)**: Validates the concrete US1/US2 composition against 011 contracts and runtime boundaries.
- **US4 (P2)**: Status selection/rendering is independently testable after Foundational; only its final discoverability checks use the composed shell.

### Within Each User Story

- Write the listed tests first and confirm they fail for the intended missing behavior.
- Implement pure model behavior before components that consume it.
- Implement leaf components before final `WorkspaceShell`/`App` integration when dependencies require it.
- Complete the story checkpoint before moving to the next dependent phase.

---

## Parallel Opportunities

- T006 and T007 can run together after Foundational because they use separate test files.
- T009, T010, and T011 can run together before T012 because they create separate leaf components.
- T014, T015, and T016 can run together before panel implementation.
- T021 and T022 can run together; T023 and T024 follow the compiled fixture update but target separate runtime suites.
- T027 and T028 can run together, followed by T029 and T030 sequentially.
- T031 and T032 can run together before final quickstart and command validation.

## Parallel Example: User Story 2

```text
Task T014: timer/interaction tests in test/unit/workspace/tool-panel-orchestration.test.tsx
Task T015: stable-slot cycle tests in test/integration/workspace/stable-workspace.test.tsx
Task T016: focus-return tests in test/integration/workspace/workspace-focus.test.tsx
```

## Parallel Example: User Story 4

```text
Task T027: status rendering tests in test/unit/workspace/workspace-status-region.test.tsx
Task T028: multi-owner ordering tests in test/integration/workspace/workspace-status-ordering.test.tsx
```

---

## Implementation Strategy

### MVP First — User Story 1

1. Complete Setup and Foundational phases.
2. Complete US1 tests and implementation.
3. Validate all four successful handoffs, non-entry outcomes, and direct return to launch.
4. Stop here for an independently demonstrable project workspace MVP if desired.

### Incremental Delivery

1. **US1** establishes safe project handoff and stable named regions.
2. **US2** adds deterministic panels while proving workspace continuity.
3. **US3** validates shared UI, keyboard, overlays, responsive behavior, and runtime appearance.
4. **US4** adds safe owner-provided status projection without expanding shell ownership.
5. Polish confirms zero IPC/persistence drift and runs the full 001/011/002 regression suite.

## Notes

- No task adds dependencies, IPC, preload methods, persistence, project validation, routing, or a new UI primitive.
- `[P]` is used only for different files with no dependency on another incomplete task in that group.
- Workspace tests compare real DOM identity and owner-controlled values rather than snapshots alone.
- Runtime tests are retained for focus, inertness, native keyboard input, media/theme changes, and window-size failures that Happy DOM cannot prove.
