# Tasks: 可移动项目与启动工作区基础

**Input**: Design documents from `/specs/001-project-foundation/`

**Prerequisites**: Accepted `spec.md`, `plan.md`, `docs/adr/002-project-foundation.md`,
`data-model.md`, `contracts/contract.md`, `research.md`, and `quickstart.md`.

**Implementation gate**: The planning gate is accepted. Work MUST follow the frozen
manifest-only schema and six-method IPC contract. `docs/adr/001-project-storage.md` is not a
001 prerequisite. Dependency-upgrade tasks T001–T003 are blocking and MUST pass before any
product-feature task begins.

**Tests**: Required because this feature changes Electron startup, preload/shared IPC,
filesystem safety, security boundaries, and documented user journeys.

**Organization**: Tasks are grouped by user story. Tests precede the implementation they
verify, and every story has an independent runtime or end-to-end checkpoint.

## Phase 1: Setup — Frozen toolchain baseline

**Purpose**: Upgrade and verify the accepted stable dependency baseline before product work.

- [ ] T001 Upgrade and exactly pin Bun 1.3.14, TypeScript 7.0.2, Electron 43.1.0, React/React DOM 19.2.7, Vite 8.1.4, `@vitejs/plugin-react` 6.0.3, `@types/node` 26.1.1, `@types/react` 19.2.17, and `@types/react-dom` 19.2.3 in `package.json` and `bun.lock` without adding runtime libraries.
- [ ] T002 Resolve TypeScript 7 and Vite 8 compatibility in `tsconfig.json`, `tsconfig.electron.json`, `vite.config.ts`, `scripts/dev-electron.mjs`, and `scripts/electron-smoke.mjs` while preserving the Electron security baseline.
- [ ] T003 Run `bun run typecheck`, `bun run test`, `bun run build`, and `bun run test:smoke` against `package.json` and `bun.lock`; stop before T004 if any upgraded-baseline regression remains.

**Checkpoint**: The frozen toolchain passes all four repository commands with no product changes.

---

## Phase 2: Foundational — Shared domain and safe storage primitives

**Purpose**: Build the typed, main-owned primitives required by every user story.

**⚠️ CRITICAL**: No user-story phase may begin until this phase is complete.

- [ ] T004 [P] Create deterministic valid, invalid, moved, collision, and cleanup-receipt fixtures with tree-hash helpers in `test/fixtures/project/project-fixtures.ts`.
- [ ] T005 [P] Define `ProjectManifest`, `RecentIndex`, `RecentRecord`, cleanup receipt types, renderer-safe DTOs, result unions, and stable error codes in `src/shared/project.ts`.
- [ ] T006 Define exactly six project IPC channel constants and `WriteLLMIpc` signatures in `src/shared/ipc.ts`, removing the legacy runtime-info contract and excluding paths, generic IPC, workspace save, default-location configuration, and project deletion.
- [ ] T007 [P] Write atomic JSON and cleanup authorization failure tests in `test/unit/project/atomic-json.test.ts` and `test/unit/project/cleanup-receipts.test.ts`.
- [ ] T008 [P] Write manifest, current-platform leaf-name, UUID, timestamp, schema-version, and required-directory validation tests in `test/unit/project/project-validation.test.ts`.
- [ ] T009 [P] Write recent-index tests for corrupt/missing input, atomic replacement, projectId upsert, stable recentId, newest-first ordering, and the five-record limit in `test/unit/project/recent-index.test.ts`.
- [ ] T010 Implement same-directory tokenized JSON writes and rename publication with failure injection in `src/main/project/atomic-json.ts`.
- [ ] T011 Implement main-only non-resumable cleanup receipt persistence and conservative startup cleanup in `src/main/project/cleanup-receipts.ts`.
- [ ] T012 Implement explicit v1 manifest, name, UUID, timestamp, and required-directory validators without repair or migration in `src/main/project/project-validation.ts`.
- [ ] T013 Implement atomic recent-index loading, safe warning projection, availability refresh, projectId upsert, sorting, eviction, and removal in `src/main/project/recent-index.ts`.
- [ ] T014 Implement shared project repository seams for native dialog results, filesystem failure injection, serialized writes, and redacted errors in `src/main/project/project-repository.ts`.
- [ ] T015 Add shared renderer declarations for the six-method bridge and safe DTOs in `src/vite-env.d.ts`.

**Checkpoint**: Shared types and main-only storage primitives enforce the frozen schema without exposing filesystem authority.

---

## Phase 3: User Story 1 — 创建或打开项目 (Priority: P1) 🎯 MVP

**Goal**: Let an author create or open a valid portable project, enter an empty workspace,
and keep only one active application instance.

**Independent Test**: With isolated temporary `userData`, create a project through the native
parent-directory dialog, restart, open it through the native project-directory dialog, and
verify a secondary Electron process exits while the primary restores its single window.

### Tests for User Story 1

- [ ] T016 [P] [US1] Write collision-safe create, manifest-last publication, cancellation, invalid-name, unsupported-schema, and no-half-project repository tests in `test/unit/project/project-repository.test.ts`.
- [ ] T017 [P] [US1] Write six-method preload exposure, sender/input validation, cancellation, stable-error, and redaction contract tests in `test/contract/project/project-ipc.test.ts`.
- [ ] T018 [P] [US1] Write first-launch, loading, empty, create, open, cancellation, invalid-project, and safe-error state tests in `test/integration/project/launch-page.test.ts`.
- [ ] T019 [P] [US1] Write compiled Electron create/open/restart and real dual-process single-instance scenarios in `test/runtime/project/project-runtime.test.ts`.

### Implementation for User Story 1

- [ ] T020 [US1] Implement collision-safe create and read-only open with main-owned native directory dialogs in `src/main/project/project-repository.ts`.
- [ ] T021 [US1] Acquire the single-instance lock before bootstrap, implement idempotent restore/show/focus, and register validated create/open handlers once in `src/main/main.ts`.
- [ ] T022 [US1] Expose explicit `listRecentProjects`, `createProject`, and `openProjectFromDialog` wrappers without paths or generic IPC in `src/preload/preload.cts`.
- [ ] T023 [P] [US1] Implement launch loading, empty, create/open, canceled, failure, and opened-workspace transitions in `src/renderer/launch/launchState.ts`.
- [ ] T024 [US1] Implement semantic create/open controls, visible status/error output, and the empty workspace view in `src/renderer/launch/LaunchPage.tsx` and `src/renderer/App.tsx`.
- [ ] T025 [P] [US1] Add responsive launch layout, visible keyboard focus, and accessible status styling in `src/renderer/styles.css`.
- [ ] T026 [US1] Extend the compiled runtime harness for isolated `userData`, dialog fixtures, lifecycle markers, and dual-process assertions in `scripts/electron-smoke.mjs`.
- [ ] T027 [US1] Run the US1 unit, contract, integration, and compiled runtime checks from `test/unit/project/project-repository.test.ts`, `test/contract/project/project-ipc.test.ts`, `test/integration/project/launch-page.test.ts`, and `test/runtime/project/project-runtime.test.ts`.

**Checkpoint**: User Story 1 independently creates, restarts, opens, and enters an empty workspace with one active app instance.

---

## Phase 4: User Story 2 — 移动后重新发现项目 (Priority: P1)

**Goal**: Recover stable project identity after a move or rename without modifying any project file.

**Independent Test**: Hash an existing project tree, move it, open it from the new location and
relink its old recent record; confirm identity recovery, mismatch rejection, and byte-for-byte
project-tree preservation.

### Tests for User Story 2

- [ ] T028 [P] [US2] Write moved-project identity, direct-open upsert, strict read-only tree hash, immutable timestamp, unknown-file preservation, and relink mismatch tests in `test/unit/project/project-move.test.ts`.
- [ ] T029 [P] [US2] Write relink request, sender validation, `PROJECT_ID_MISMATCH`, unchanged-record, and path-redaction contract tests in `test/contract/project/project-relink-ipc.test.ts`.
- [ ] T030 [P] [US2] Write moved, missing, invalid, inaccessible, relink success, relink mismatch, and retry state tests in `test/integration/project/project-relink.test.ts`.

### Implementation for User Story 2

- [ ] T031 [US2] Implement direct-open projectId upsert and strict read-only relink validation in `src/main/project/project-repository.ts` and `src/main/project/recent-index.ts`.
- [ ] T032 [US2] Register validated `openRecentProject` and `relinkRecentProject` handlers in `src/main/main.ts` and explicit preload wrappers in `src/preload/preload.cts`.
- [ ] T033 [US2] Add missing/invalid/inaccessible diagnostics, relink actions, mismatch preservation, and retry transitions in `src/renderer/launch/launchState.ts` and `src/renderer/launch/LaunchPage.tsx`.
- [ ] T034 [US2] Add compiled move/direct-open/relink scenarios with before/after tree hashes and manifest bytes in `test/runtime/project/project-runtime.test.ts` and `scripts/electron-smoke.mjs`.

**Checkpoint**: User Story 2 independently recognizes a moved project and proves open/relink never writes its tree.

---

## Phase 5: User Story 3 — 管理最近项目和移除最近记录 (Priority: P2)

**Goal**: Show at most five recent projects, retain invalid entries, and remove only app-owned pointers.

**Independent Test**: Open six projects, restart, verify ordering and eviction, invalidate one
record externally, then remove or relink the record while proving no project directory is deleted.

### Tests for User Story 3

- [ ] T035 [P] [US3] Write list/open/remove recent contract tests for bounded DTOs, stable errors, redaction, and no project deletion in `test/contract/project/project-recent-ipc.test.ts`.
- [ ] T036 [P] [US3] Write recent-card ordering, five-record limit, availability states, remove, relink, and no-delete UI state tests in `test/integration/project/recent-projects.test.ts`.

### Implementation for User Story 3

- [ ] T037 [US3] Complete recent availability refresh and pointer-only removal behavior in `src/main/project/recent-index.ts` and `src/main/project/project-repository.ts`.
- [ ] T038 [US3] Register validated `listRecentProjects` and `removeRecentProject` handlers in `src/main/main.ts` and explicit wrappers in `src/preload/preload.cts`.
- [ ] T039 [US3] Render at most five recent cards with available/missing/invalid/inaccessible states and open/relink/remove actions in `src/renderer/launch/LaunchPage.tsx` and `src/renderer/launch/launchState.ts`.
- [ ] T040 [P] [US3] Add recent-card focus, action grouping, diagnostic, and empty-state styles in `src/renderer/styles.css`.
- [ ] T041 [US3] Add compiled six-project ordering, restart, invalidation, relink, and pointer-only removal scenarios in `test/runtime/project/project-runtime.test.ts` and `scripts/electron-smoke.mjs`.

**Checkpoint**: User Story 3 independently manages recent pointers without modifying or deleting project files.

---

## Phase 6: Polish & Cross-Cutting Verification

**Purpose**: Exercise failure boundaries across all stories and complete the accepted quickstart.

- [ ] T042 [P] Add crash-stage, corrupt-index, cleanup-receipt, atomic-write, and safe-warning regression coverage in `test/unit/project/project-failure-boundaries.test.ts`.
- [ ] T043 [P] Assert the final bridge exposes exactly six methods and no runtime-info, default-location configuration, workspace save, `deleteProject`, generic IPC, paths, raw exceptions, or file contents in `test/smoke/ipc-contract.test.ts`.
- [ ] T044 Execute every scenario in `specs/001-project-foundation/quickstart.md`, including 20 move/reopen iterations for SC-003, against the compiled Electron build from `scripts/electron-smoke.mjs`.
- [ ] T045 Run final `bun run typecheck`, `bun run test`, `bun run build`, and `bun run test:smoke` verification against `package.json`, `bun.lock`, `src/`, `test/`, and `scripts/electron-smoke.mjs`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (T001–T003)**: Starts immediately and blocks every product-feature task.
- **Phase 2 (T004–T015)**: Depends on Phase 1 and blocks every user story.
- **US1 (T016–T027)**: Depends on Phase 2 and is the MVP.
- **US2 (T028–T034)**: Depends on Phase 2; its renderer integration uses the launch shell completed by US1, while domain/read-only tests can start independently.
- **US3 (T035–T041)**: Depends on Phase 2; its renderer integration uses the launch shell completed by US1, while contract and recent-index work can start independently.
- **Phase 6 (T042–T045)**: Depends on all selected user stories.

### User Story Completion Order

```text
Toolchain → Foundation → US1 (MVP)
                       ├─→ US2
                       └─→ US3
US1 + US2 + US3 → Cross-cutting verification
```

### Within Each User Story

- Write the listed tests first and confirm they fail for the intended missing behavior.
- Complete domain/main behavior before preload and renderer integration.
- Complete contract/integration checks before the compiled runtime checkpoint.
- Do not silently change accepted schema, IPC, ADR, or security decisions inside a task.

### Parallel Opportunities

- T004 and T005 can proceed in parallel after the toolchain gate.
- T007, T008, and T009 target separate test files and can proceed in parallel.
- US1 test tasks T016–T019 can proceed in parallel after Phase 2.
- US2 test tasks T028–T030 can proceed in parallel; US3 test tasks T035–T036 can proceed in parallel.
- After US1 establishes the launch shell, US2 and US3 domain/contract work can proceed concurrently.
- Polish regressions T042 and T043 can proceed in parallel.

## Parallel Examples

### User Story 1

```text
T016 repository create/open tests
T017 IPC contract tests
T018 launch state tests
T019 compiled runtime scenarios
```

### User Story 2

```text
T028 read-only move/relink tests
T029 relink contract tests
T030 relink renderer-state tests
```

### User Story 3

```text
T035 recent IPC contract tests
T036 recent renderer-state tests
```

## Implementation Strategy

### MVP First

1. Complete the frozen toolchain gate T001–T003.
2. Complete the shared foundation T004–T015.
3. Complete US1 T016–T027.
4. Stop and validate create → restart → open plus the real dual-process single-instance path.

### Incremental Delivery

1. Add US2 and prove moved-project identity plus byte-for-byte read-only behavior.
2. Add US3 and prove bounded recent management plus pointer-only removal.
3. Complete T042–T045 and the full quickstart.

## Notes

- `[P]` marks tasks that use separate files and do not depend on incomplete work in the same phase.
- `[US1]`, `[US2]`, and `[US3]` map directly to the accepted specification stories.
- No task authorizes Git initialization, SQLite, a default project location, workspace-state persistence, project deletion, generic IPC, or an additional runtime library.
- Stop and return to design review if implementation requires changing an accepted durable or cross-process boundary.
