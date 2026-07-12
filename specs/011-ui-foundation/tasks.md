# Tasks: 共享 UI Foundation

**Input**: Design documents from `/specs/011-ui-foundation/`
**Prerequisites**: `spec.md`, `plan.md`, `contracts/ui-foundation.md`, and `docs/adr/003-ui-foundation.md` are Accepted.

**Tests**: Required by the accepted specification. DOM tests cover renderer semantics and interaction; repository/IPC tests cover the durable boundary; a compiled Electron harness covers first paint, native focus, portals, and system media behavior.

**Organization**: Tasks are grouped by user story so each story produces an independently verifiable increment. The existing 001 project behavior and six-method project bridge remain an immutable migration baseline.

## Phase 1: Setup (Reproducible UI Toolchain)

**Purpose**: Pin the accepted source-generation and renderer test toolchain before changing product code.

- [X] T001 Assert Bun 1.3.14 and resolve one exact compatible version set for Tailwind CSS v4, `@tailwindcss/vite`, shadcn CLI, `@base-ui/react`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, Happy DOM, React Testing Library, and `user-event`; record/install the approved set in `package.json` and `bun.lock`
- [X] T002 Run a no-product-code React 19.2.7/TypeScript 7.0.2/Vite 8.1.4/Bun 1.3.14 compatibility probe and record its command, versions, and result in `specs/011-ui-foundation/compatibility.md`
- [X] T003 Configure Tailwind CSS v4's Vite plugin and the `@` renderer alias without changing Electron/preload resolution in `vite.config.ts` and `tsconfig.json`
- [X] T004 Apply the pinned Rhea + Base UI + neutral preset, retain reviewed source-generation aliases in `components.json`, and eject shadcn CSS into repository-owned `src/renderer/theme/shadcn.css`
- [X] T005 Configure Happy DOM, Testing Library cleanup/matchers, and test TypeScript coverage in `test/setup/renderer-dom.ts`, `tsconfig.test.json`, and `package.json`
- [X] T006 Capture the pre-foundation production renderer bundle sizes and dependency inventory for later comparison in `specs/011-ui-foundation/bundle-baseline.md`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Establish the shared durable boundary, theme substrate, and approved source-owned component inventory required by every user story.

**⚠️ CRITICAL**: Complete this phase before starting any user story.

### Appearance boundary tests

- [X] T007 [P] Add schema default, enum, audited-font, finite-number, and numeric-bound tests in `test/unit/appearance/appearance-validation.test.ts`
- [X] T008 [P] Add missing/corrupt/unsupported/unwritable and atomic-replacement repository tests in `test/unit/appearance/appearance-preferences.test.ts`
- [X] T009 [P] Add contract tests for exactly two safe appearance methods, exact result codes, input revalidation, and the unchanged six-method project namespace in `test/contract/appearance/appearance-ipc.test.ts`

### Appearance boundary implementation

- [X] T010 Define appearance schema v1 DTOs, defaults, bounds, warning/error results, and the typed `Window.writellmAppearance` contract in `src/shared/appearance.ts` and `src/vite-env.d.ts`
- [X] T011 Implement main-owned validation, missing/corrupt/unsupported fallback, and complete-snapshot atomic persistence in `src/main/appearance/appearance-preferences.ts`
- [X] T012 Register named appearance IPC handlers, load preferences before BrowserWindow creation, and set `nativeTheme.themeSource` while preserving all security webPreferences in `src/main/main.ts`
- [X] T013 Expose only `getAppearancePreferences` and `updateAppearancePreferences` on the separate `window.writellmAppearance` namespace in `src/preload/preload.cts`

### Renderer foundation implementation

- [X] T014 [P] Add the `cn` class composition helper in `src/renderer/lib/cn.ts`
- [X] T015 [P] Define complete light/dark semantic color, surface, radius, elevation, focus, and motion tokens with forced-colors/reduced-motion rules in `src/renderer/theme/tokens.css`
- [X] T016 [P] Add audited system font stacks and source-owned `.typeset`, `.typeset-editor`, `.typeset-reading`, and `.typeset-compact` prose rules in `src/renderer/theme/typeset.css`
- [X] T017 [P] Generate, normalize, and retain only Button, Input, Label, Card, Alert, Badge, and Separator with the accepted variants in `src/renderer/components/ui/`
- [X] T018 [P] Generate and normalize Dialog and Tooltip with the accepted modal, dismissal, naming, focus, and return contracts in `src/renderer/components/ui/dialog.tsx` and `src/renderer/components/ui/tooltip.tsx`
- [X] T019 [P] Generate and normalize Select and ScrollArea with the accepted selection, keyboard, labeling, and native scrolling contracts in `src/renderer/components/ui/select.tsx` and `src/renderer/components/ui/scroll-area.tsx`
- [X] T020 Import Tailwind, ejected shadcn CSS, semantic tokens, and Typeset in the required order and reduce globals to reset/foundation responsibilities in `src/renderer/styles.css`
- [X] T021 Verify the generated source/dependency diff contains only the approved 11 primitives and minimal exact dependencies, and document the repeatable add/eject/diff-review procedure in `docs/ui-foundation.md`

**Checkpoint**: Appearance persistence/IPC, semantic styling, and the bounded primitive inventory are ready for story work.

---

## Phase 3: User Story 1 - 在统一界面中开始或打开项目 (Priority: P1) 🎯 MVP

**Goal**: Migrate the accepted launch page presentation to the shared foundation without changing any 001 project behavior, contract, message meaning, recent limit, or disk side effect.

**Independent Test**: Run the existing 001 automated suites and quickstart create/open/recent/relink/remove/cancel/failure flows; all results remain unchanged and every launch action remains keyboard reachable at 960×640 and 200% zoom.

### Tests for User Story 1

- [X] T022 [P] [US1] Extend launch DOM regression coverage for create/open/recent/relink/remove, loading/warning/error/empty outcomes, accessible names, visible focus, and keyboard activation in `test/integration/project/launch-page.test.ts`
- [X] T023 [P] [US1] Add a regression assertion that launch operations still call only the accepted project API and preserve recent/project outcomes in `test/integration/project/launch-foundation-migration.test.ts`
- [X] T024 [P] [US1] Add compiled runtime checks for 960×640, 1200×800, 200% zoom, long names/messages, focus visibility, and reachable launch actions in `test/runtime/ui-foundation/launch-layout.test.ts`

### Implementation for User Story 1

- [X] T025 [US1] Replace launch actions, field, surfaces, feedback, availability, and empty state markup with approved primitives/pattern slots while preserving `LaunchPage({ api: WriteLLMIpc })`, handlers, copy meanings, and branching in `src/renderer/launch/LaunchPage.tsx`
- [X] T026 [US1] Add responsive launch composition using semantic utilities/tokens and remove only proven-obsolete launch rules in `src/renderer/styles.css`
- [X] T027 [US1] Run all unchanged project unit/contract/integration/runtime tests and resolve presentation-only regressions without modifying `src/renderer/launch/launchState.ts`, project IPC, repositories, fixtures, or `specs/001-project-foundation/`

**Checkpoint**: The migrated launch page independently preserves 001 behavior and is usable by keyboard at supported sizes/zoom.

---

## Phase 4: User Story 2 - 在合适的主题和排版中获得一致且可访问的界面 (Priority: P1)

**Goal**: Apply persistent System/Light/Dark appearance, reduced-motion/high-contrast behavior, and three safe Typeset presets without remounting or mutating feature/document state.

**Independent Test**: Exercise System/Light/Dark at runtime and across restart, corrupt/unsupported storage, reduced motion, forced colors, and all Typeset fixtures; the effective theme is correct before first paint and current launch input/state survives theme changes.

### Tests for User Story 2

- [X] T028 [P] [US2] Add provider/state tests for load, optimistic/pending control, successful normalization, safe warning/error display, failed-update rollback, System media changes, and no `LaunchPage` remount in `test/unit/appearance/appearance-provider.test.tsx`
- [X] T029 [P] [US2] Add token and Typeset DOM/source tests for light/dark completeness, three presets, representative prose, audited font IDs, content immutability, and append-stable streaming in `test/unit/ui/theme-typeset.test.tsx`
- [X] T030 [P] [US2] Add compiled Electron tests for correct first paint, explicit/system runtime changes, restart persistence, corrupt/unsupported recovery, and exact appearance/project bridge inventories in `test/runtime/ui-foundation/appearance-runtime.test.ts`
- [X] T031 [P] [US2] Add compiled Electron tests for reduced motion, forced colors, native focus visibility, Typeset computed values, offline font/resource behavior, and streaming stability in `test/runtime/ui-foundation/theme-media-typeset.test.ts`

### Implementation for User Story 2

- [X] T032 [P] [US2] Implement normalized appearance loading, effective-theme derivation, update state, and safe warning/error transitions in `src/renderer/appearance/appearanceState.ts`
- [X] T033 [US2] Implement the sole renderer consumer of `window.writellmAppearance`, apply theme and Typeset variables without remounting children, and expose controlled context in `src/renderer/appearance/AppearanceProvider.tsx`
- [X] T034 [US2] Implement controlled System/Light/Dark selection with accessible pending/error status and no persistence/business ownership in `src/renderer/components/patterns/AppearanceControls.tsx`
- [X] T035 [US2] Compose `AppearanceProvider` at the existing single StrictMode root and keep launch state identity stable in `src/renderer/main.tsx` and `src/renderer/App.tsx`
- [X] T036 [US2] Add the lightweight theme selector to the launch page without exposing typography controls or coupling it to project actions in `src/renderer/launch/LaunchPage.tsx`

**Checkpoint**: Theme and Typeset behavior are independently correct across renderer, durable storage, and Electron runtime boundaries.

---

## Phase 5: User Story 3 - 后续功能复用同一组件语言 (Priority: P2)

**Goal**: Publish and verify the complete primitive/pattern contract needed by 002 so future features compose the foundation instead of forking it.

**Independent Test**: Assemble a business-free workspace-shell fixture from public entry paths and cover all 10 known common-UI needs without copying primitives, importing Base UI directly, or adding a parallel token/component system.

### Tests for User Story 3

- [X] T037 [P] [US3] Add per-primitive DOM tests for native roles/names, default/focus/disabled and applicable invalid/selected/open states across themes in `test/unit/ui/primitives.test.tsx`
- [X] T038 [P] [US3] Add Select keyboard navigation and Dialog/Tooltip focus-entry, containment, Escape, hover/focus disclosure, and trigger-loss fallback tests in `test/unit/ui/interactive-primitives.test.tsx`
- [X] T039 [P] [US3] Add FormField relationship, StatusNotice announcement/non-color meaning, EmptyState heading/action, and controlled AppearanceControls tests in `test/unit/ui/patterns.test.tsx`
- [X] T040 [P] [US3] Add a business-free fixture proving the 10-item 002 coverage mapping through public imports in `test/integration/ui/workspace-foundation-fixture.test.tsx`
- [X] T041 [P] [US3] Add compiled Electron native Tab/Shift+Tab/Escape, portal, inert-background, tooltip, and fallback-focus tests in `test/runtime/ui-foundation/overlay-focus.test.ts`

### Implementation for User Story 3

- [X] T042 [P] [US3] Implement stable label/description/error ID relationships and controlled slots in `src/renderer/components/patterns/FormField.tsx`
- [X] T043 [P] [US3] Implement visible info/success/warning/error meaning with polite/urgent announcement options in `src/renderer/components/patterns/StatusNotice.tsx`
- [X] T044 [P] [US3] Implement semantic heading, description, and optional action composition in `src/renderer/components/patterns/EmptyState.tsx`
- [X] T045 [US3] Create the dedicated compiled UI fixture renderer, preload-free test controls, and Electron entry outside product code in `test/runtime/ui-foundation/fixture.tsx`, `test/runtime/ui-foundation/fixture.html`, and `test/runtime/ui-foundation/electron-entry.mjs`
- [X] T046 [US3] Add a `test:ui-runtime` command that builds and runs the dedicated UI fixture without expanding product main/preload capabilities in `package.json` and `scripts/electron-ui-runtime.mjs`
- [X] T047 [US3] Document public entry paths, behavior matrix, dependency direction, semantic customization order, FoundationExtensionRequest fields, ownership, and pinned one-component upgrade workflow in `docs/ui-foundation.md`

**Checkpoint**: All initial components and patterns are independently consumable, verified, and governed for 002/later features.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Prove the integrated feature at every accepted failure boundary and hand off a bounded foundation.

- [X] T048 [P] Audit `src/renderer/components/`, `src/renderer/theme/`, `src/renderer/appearance/`, `package.json`, and `bun.lock` for forbidden feature/Base UI direction, raw palette/z-index overrides, localStorage, remote resources, extra primitives, and production `shadcn` dependency; record results in `specs/011-ui-foundation/validation.md`
- [X] T049 [P] Compare the production renderer bundle and dependency delta against `specs/011-ui-foundation/bundle-baseline.md` and record justified results in `specs/011-ui-foundation/validation.md`
- [X] T050 Execute every automated scenario in `specs/011-ui-foundation/quickstart.md`, including System/Light/Dark, restart/corruption, Typeset, keyboard/overlay, forced colors, reduced motion, zoom/window sizes, and complete 001 regression; record evidence in `specs/011-ui-foundation/validation.md`
- [X] T051 Run Bun 1.3.14 `bun run typecheck`, `bun run test`, `bun run build`, `bun run test:smoke`, and `bun run test:ui-runtime`, then record pass/fail evidence in `specs/011-ui-foundation/validation.md`
- [X] T052 Reconcile the fixed 10-item 002 common-UI coverage table against the implemented public inventory and record any gap as a complete FoundationExtensionRequest in `specs/011-ui-foundation/validation.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Starts immediately; T001 gates dependency-consuming tasks, T003 gates generation/build integration, and T005 gates DOM tests.
- **Foundational (Phase 2)**: Depends on Setup and blocks all stories. Write T007-T009 before T010-T013; T014-T019 may proceed in parallel after setup, then T020-T021 integrate/review them.
- **US1 (Phase 3)**: Depends on Foundational. Its regression tests are written before the launch migration; it does not depend on US2 or US3 behavior.
- **US2 (Phase 4)**: Depends on Foundational. T032-T033 precede provider composition; T034 precedes T036. It can run alongside US1 except for coordinated edits to `LaunchPage.tsx`.
- **US3 (Phase 5)**: Depends on Foundational. Pattern implementations and most tests can run in parallel; runtime assertions depend on T045-T046.
- **Polish (Phase 6)**: Depends on every story selected for delivery.

### User Story Dependencies

- **US1 (P1)**: Independently preserves the accepted launch journey after Phase 2; coordinate its final `LaunchPage.tsx` slice with US2's selector insertion.
- **US2 (P1)**: Independently provides persistent accessible appearance after Phase 2; it uses the launch page only as a lightweight consumer and does not change project behavior.
- **US3 (P2)**: Independently proves reusable public contracts after Phase 2; it does not require launch or appearance business state beyond controlled fixture props.
- **MVP**: Phase 1 + Phase 2 + US1. Because US2 is also P1 and globally foundational user value, complete US2 before declaring the entire 011 feature accepted.

### Parallel Opportunities

- T007-T009 can run together before appearance implementation.
- T014-T019 touch separate renderer foundation files and can run together.
- T022-T024, T028-T031, and T037-T041 are parallel test slices within their stories.
- T032 and the US1 migration tests can proceed in parallel; serialize only shared edits to `LaunchPage.tsx`.
- T042-T044 implement separate patterns in parallel.
- T048 and T049 are independent audits after implementation.

---

## Parallel Examples

### User Story 1

```text
Task T022: Extend launch DOM behavior/accessibility regression coverage.
Task T023: Assert accepted project API and storage outcomes remain unchanged.
Task T024: Verify window-size, zoom, focus, and content reachability at runtime.
```

### User Story 2

```text
Task T028: Test provider state and no-remount behavior.
Task T029: Test semantic tokens and Typeset source/DOM behavior.
Task T030: Test first paint, runtime theme, persistence, and bridge inventories.
Task T031: Test system media, font/resource safety, and Typeset runtime behavior.
```

### User Story 3

```text
Task T037: Test primitive state matrices.
Task T038: Test Select/Dialog/Tooltip interactions.
Task T039: Test pattern semantics.
Task T040: Prove the 002 coverage fixture.
Task T041: Verify native Electron overlay/focus behavior.
```

---

## Implementation Strategy

### MVP First

1. Complete reproducible setup and all blocking foundation work.
2. Write US1 regression tests before changing launch presentation.
3. Migrate the launch page in reviewable slices while keeping `launchState` and project boundaries untouched.
4. Stop and run the complete 001 automated/quickstart baseline plus US1 layout/accessibility checks.

### Incremental Delivery

1. **Foundation ready**: exact toolchain, appearance boundary, tokens, Typeset, and 11 primitives.
2. **US1 / MVP**: accepted launch behavior on the shared visual language.
3. **US2 / P1 completion**: persistent accessible themes and typography foundation.
4. **US3 / reusable handoff**: four patterns, complete contracts, runtime harness, and 002 fixture.
5. **Acceptance**: cross-boundary audit, full quickstart, bundle review, and all command gates.

## Notes

- Every `[P]` task targets different files or an independent verification slice and has no dependency on an incomplete sibling task.
- Tests must be authored and observed failing for the intended missing behavior before their corresponding implementation task.
- Do not edit `specs/001-project-foundation/`, ADR-002, the six-method project contract, project/recent repositories, or historical fixture intent to make migration tests pass.
- Do not implement 002 workspace layout or business orchestration in this feature.
- Generated source is review input; exact versions, dependency deltas, DOM semantics, tokens, variants, and local modifications remain project-owned.
