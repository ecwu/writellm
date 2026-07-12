# Tasks: Pi Agent Provider 设置与密钥状态

**Input**: Design documents from `specs/005-provider-settings/`

**Prerequisites**: Accepted `spec.md`, `plan.md`, ADR-004, `research.md`, `data-model.md`, `contracts/contract.md`, `quickstart.md`

**Tests**: Required because this feature changes Electron main/preload IPC, protected secret storage, external provider behavior and documented user journeys.

**Organization**: Tasks are grouped by user story. Remaining tests are mandatory regression and acceptance gates that must pass before their story or the feature is considered complete.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Pin the Pi runtime and prepare feature-local modules without changing existing project security settings.

- [X] T001 Add pinned `@earendil-works/pi-agent-core` 0.80.6, `@earendil-works/pi-ai` 0.80.6 and `typebox` 1.1.38 runtime dependencies in `package.json` and `bun.lock`
- [X] T002 Create provider-settings main, renderer and test directories described by the plan under `src/main/provider-settings/`, `src/renderer/features/provider-settings/`, and `test/{unit,integration,runtime}/provider-settings/`
- [X] T003 [P] Add provider-settings compiled-runtime fixture entry points to `scripts/electron-ui-runtime.mjs`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Freeze the typed profile, Pi adapter boundary, persistence primitives and five-method IPC surface used by every story.

**⚠️ CRITICAL**: No user story may be considered complete until this phase and its remaining regression tests are complete.

- [X] T004 [P] Add failing exact-parser and Pi descriptor mapping tests for config/profile inputs, capacity limits, URL rules and unknown fields in `test/unit/provider-settings/provider-profile.test.ts`
- [X] T005 [P] Add failing provider summary, validation transition, availability and redaction tests in `test/unit/provider-settings/provider-domain.test.ts`
- [X] T006 Define versioned config/profile DTOs, Pi model descriptor mapping, validation diagnostics, channels and exact parsers in `src/shared/provider-settings.ts`
- [X] T007 [P] Add custom Pi provider/auth/Models adapter regression tests covering model metadata, API identity and secret non-retention in `test/integration/provider-settings/pi-provider.test.ts`
- [X] T008 Implement the application-owned `openai-completions` provider/profile adapter and isolated Pi `Models` factory in `src/main/provider-settings/pi-provider.ts`
- [X] T009 [P] Add atomic paired-document, corrupt-data, unknown-profile-version, CAS and crash-reconciliation regression tests in `test/integration/provider-settings/repository.test.ts`
- [X] T010 Implement settings/secret document parsing, atomic pair publication, revision CAS and startup reconciliation in `src/main/provider-settings/repository.ts`
- [X] T011 [P] Add failing async `safeStorage` available/unavailable/encrypt/decrypt tests with no plaintext fallback in `test/integration/provider-settings/secret-protector.test.ts`
- [X] T012 Implement the injectable Electron async `safeStorage` adapter in `src/main/provider-settings/secret-protector.ts`
- [X] T013 [P] Add exact five-channel, sender-validation and DTO redaction contract tests in `test/integration/provider-settings/handlers.test.ts`
- [X] T014 Implement expected-sender validation and five typed IPC handlers in `src/main/provider-settings/handlers.ts`
- [X] T015 Expose only the five named provider-settings methods from `src/preload/preload.cts` and declare the isolated renderer bridge in `src/vite-env.d.ts`
- [X] T016 Register provider-settings handlers after app readiness without weakening sandbox flags in `src/main/main.ts`

**Checkpoint**: The main process can parse, derive, protect, persist and expose a redacted Pi harness profile through the frozen IPC contract.

---

## Phase 3: User Story 1 - 配置 Pi Agent 服务 (Priority: P1) 🎯 MVP

**Goal**: Save and restore a Pi harness-consumable endpoint/model profile without touching project content.

**Independent Test**: Save endpoint, model id, context window, maximum output, reasoning flag and initial key; restart and recover the same redacted Pi profile while the active project remains byte-identical.

### Tests for User Story 1

- [X] T017 [P] [US1] Add failing renderer state tests for draft/saved separation, capacity errors, conflicts and secret clearing in `test/unit/provider-settings/provider-settings-state.test.ts`
- [X] T018 [P] [US1] Add save/edit/restart/project-isolation integration acceptance tests in `test/integration/provider-settings/settings-flow.test.ts`
- [X] T019 [P] [US1] Add keyboard, field-error association, 200% zoom and theme runtime acceptance tests in `test/runtime/provider-settings/settings-form.test.tsx`

### Implementation for User Story 1

- [X] T020 [US1] Implement profile draft, submit, conflict reload and saved-summary transitions in `src/renderer/features/provider-settings/provider-settings-state.ts`
- [X] T021 [US1] Build the endpoint/model/context/max-output/reasoning form and redacted profile summary in `src/renderer/features/provider-settings/ProviderSettingsPanel.tsx`
- [X] T022 [US1] Add responsive semantic-token styling for 960×640 and 200% zoom in `src/renderer/features/provider-settings/provider-settings.css`
- [X] T023 [US1] Mount provider settings from the accepted workspace settings entry without coupling it to active project state in `src/renderer/workspace/WorkspaceShell.tsx`
- [X] T024 [US1] Verify save/edit/restart and project-isolation behavior through the compiled Electron bridge in `test/runtime/provider-settings/settings-persistence.test.ts`

**Checkpoint**: User Story 1 independently delivers a persistent, redacted Pi model profile and initial protected key.

---

## Phase 4: User Story 2 - 安全地保存、替换和移除密钥 (Priority: P1)

**Goal**: Replace or remove the provider credential without exposing it or weakening storage.

**Independent Test**: Save, replace, cancel and remove a sentinel key across restarts; no DOM, IPC result, log, project, export or non-secret document contains the sentinel.

### Tests for User Story 2

- [X] T025 [P] [US2] Add replace/remove/cancel/CAS/failure-preserves-old-state regression tests in `test/integration/provider-settings/secret-lifecycle.test.ts`
- [X] T026 [P] [US2] Add sentinel leak acceptance scans across DOM, IPC, logs, durable files, project and export fixtures in `test/runtime/provider-settings/secret-redaction.test.ts`
- [X] T027 [P] [US2] Add remove-confirmation focus-return and canceled-password-clearing runtime acceptance tests in `test/runtime/provider-settings/secret-dialog.test.tsx`

### Implementation for User Story 2

- [X] T028 [US2] Implement fail-closed replace/remove pair publication and previous-state preservation in `src/main/provider-settings/repository.ts`
- [X] T029 [US2] Implement secret replace/remove/cancel UI state and controlled confirmation dialog in `src/renderer/features/provider-settings/ProviderSettingsPanel.tsx`
- [X] T030 [US2] Add stable safe-storage recovery messages without secret-derived hints in `src/shared/provider-settings.ts`
- [X] T031 [US2] Verify real async `safeStorage` restart, unavailable and decrypt-failure behavior in `test/runtime/provider-settings/safe-storage.test.ts`

**Checkpoint**: User Story 2 independently proves protected credential lifecycle and zero plaintext fallback.

---

## Phase 5: User Story 3 - 验证当前配置的 Harness 可用性 (Priority: P2)

**Goal**: Prove the saved profile can complete the Pi tool loop required by later AI features.

**Independent Test**: Only a schema-valid required tool call followed by the matching tool result and a final assistant response succeeds; text-only, invalid-arguments, unusable-result and incomplete-loop fixtures remain unavailable.

### Tests for User Story 3

- [X] T032 [P] [US3] Add Pi faux-provider regression tests for successful tool call/result/final-response sequencing and transcript disposal in `test/unit/provider-settings/harness-validator.test.ts`
- [X] T033 [P] [US3] Add tool-unsupported, invalid-arguments, unusable-result, repeated-tool and incomplete-loop classification regression tests in `test/unit/provider-settings/harness-validator.test.ts`
- [X] T034 [P] [US3] Add auth/model/rate/network/timeout/abort/raw-error redaction regression tests in `test/integration/provider-settings/validation-failures.test.ts`
- [X] T035 [P] [US3] Add validation consent, duplicate suppression, close-during-run, stale revision and restart persistence integration acceptance tests in `test/integration/provider-settings/validation-flow.test.ts`
- [X] T036 [P] [US3] Add compiled Electron acceptance tests proving packaged Pi runtime, two-turn/30-second caps and project isolation in `test/runtime/provider-settings/harness-validation.test.ts`

### Implementation for User Story 3

- [X] T037 [US3] Implement the nonce-bearing TypeBox probe tool and two-turn Pi agent-loop validator in `src/main/provider-settings/validator.ts`
- [X] T038 [US3] Map Pi stream, tool validation, provider and abort outcomes to stable redacted diagnostic codes in `src/main/provider-settings/validator.ts`
- [X] T039 [US3] Persist only revision-bound validation status/completion time and suppress late results in `src/main/provider-settings/repository.ts`
- [X] T040 [US3] Add consent, in-progress, success, harness-incompatibility, stale and retry UI states in `src/renderer/features/provider-settings/ProviderSettingsPanel.tsx`
- [X] T041 [US3] Publish the redacted availability/profile read contract for later AI features from `src/shared/provider-settings.ts`

**Checkpoint**: User Story 3 distinguishes generic completion availability from actual Pi Agent harness compatibility.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Verify dependency packaging, security, accessibility and the full documented acceptance matrix.

- [X] T042 [P] Add a dependency/bundle regression test proving renderer bundles do not import Pi, Node or secret capabilities in `test/runtime/provider-settings/bundle-boundary.test.ts`
- [X] T043 [P] Add status semantics coverage for forced colors and reduced motion in `test/runtime/provider-settings/accessibility.test.tsx`
- [X] T044 Run all scenarios from `specs/005-provider-settings/quickstart.md` and record any fixture-specific constraints in that file
- [X] T045 Establish an interim baseline by running `bun run typecheck`, `bun run test`, `bun run build`, `bun run test:smoke`, and `bun run test:ui-runtime`, fixing only 005-related failures in the files named above
- [X] T046 Re-run sentinel scans; confirm `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, exact five-method preload exposure and no secret/project coupling in `test/runtime/provider-settings/security-baseline.test.ts`; then re-run `bun run typecheck`, `bun run test`, `bun run build`, `bun run test:smoke`, and `bun run test:ui-runtime` as the final feature gate

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies.
- **Foundational (Phase 2)**: Depends on Setup and blocks all stories.
- **US1 (Phase 3)**: Depends on Foundational; delivers the minimum saved profile.
- **US2 (Phase 4)**: Depends on Foundational and the saved-profile surface from US1.
- **US3 (Phase 5)**: Depends on Foundational plus a saved profile and protected secret from US1/US2.
- **Polish (Phase 6)**: Depends on all selected stories.

### Within Each User Story

- For behavior not yet implemented, write the listed tests first and confirm they fail for the intended missing behavior. For existing implementation, add regression or acceptance coverage and confirm it detects the targeted failure fixture before marking the story complete.
- Shared model/profile definitions precede repository, handlers and UI integration.
- Pi provider construction precedes the tool-loop validator.
- Main behavior and typed IPC precede renderer wiring.

### Parallel Opportunities

- T004/T005, T007, T009, T011 and T013 can be authored in parallel before their corresponding implementation tasks.
- US1 renderer-state, integration and runtime test fixtures (T017–T019) use different files and can proceed in parallel.
- US2 tests (T025–T027) and US3 tests (T032–T036) are parallelizable within their phases.
- Runtime boundary and accessibility polish tests (T042–T043) are independent.

---

## Parallel Example: User Story 3

```text
Task T032: success-path Pi faux-provider/tool-loop tests
Task T033: harness incompatibility classification tests
Task T034: provider/auth/network failure mapping tests
Task T035: consent/concurrency/restart integration tests
Task T036: compiled Electron Pi packaging/runtime tests
```

---

## Implementation Strategy

### MVP First

1. Complete Setup and Foundational phases.
2. Complete US1 to save and recover a Pi harness profile.
3. Complete US2 before treating any credential as production-ready.
4. Complete US3 before exposing provider availability to later AI features.

### Incremental Delivery

1. Profile persistence and redacted summary.
2. Protected credential lifecycle.
3. Actual Pi tool-loop compatibility validation.
4. Full runtime/security/accessibility matrix.

## Notes

- `[P]` means different files and no dependency on another unfinished task in the same batch.
- Pi model/profile metadata is plain serializable data; provider implementations, tools and credentials remain main-owned runtime dependencies.
- A text completion or standalone structured JSON response never satisfies US3.
- Do not import product code, persistence, IPC, tests or dependencies from `legacy/v1-freeze`.
