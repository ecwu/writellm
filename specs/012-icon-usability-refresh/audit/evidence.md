# Feature 012 evidence index

Evidence is reproducible unless explicitly identified as manual or participant
validation. Command dates and exact outcomes are recorded during final validation.

| ID | Kind | Scope | Artifact / command | Result |
|---|---|---|---|---|
| E-SHARED-DOM | DOM | shared button and tooltip contract | `test/unit/ui/action-icon-contract.test.tsx`, `interactive-primitives.test.tsx` | pass, 2026-07-13 |
| E-US1-DOM | DOM/integration | canonical mapping and unchanged business flows | focused project/workspace/orientation/editor tests | pass, included in 157-test suite |
| E-US2-DOM | DOM/integration | names, decorative SVGs, ARIA states | `test/integration/ui/icon-action-accessibility.test.tsx` | pass |
| E-US2-MATRIX | Electron/manual | keyboard, tooltip, 44px, theme/media modes | feature 012 runtime tests + live macOS AX audit | pass, 2026-07-13 |
| E-US3-DOM | DOM/integration | hierarchy and contextual state guidance | `test/integration/ui/action-hierarchy.test.tsx` plus feature tests | pass |
| E-US3-RUNTIME | Electron | wrapping, ordering, label visibility | `action-hierarchy-responsive.test.ts` + compiled runtime | pass |
| E-INTEGRITY | source/bundle | one local icon source; no pseudo-icons/fonts/remote URLs | source and `dist/` searches | pass; BlockNote's bundled content emoji dictionary is not an action source |
| E-BOUNDARY | diff/contracts | unchanged IPC, storage, dependencies, security flags | final diff audit + regression suite | pass; no 012 diff in main/preload/shared/package/lock |
| E-QUICKSTART | mixed | quickstart scenarios 1–7 | linked results below | pass; scenarios 1–6 automated/manual, scenario 7 user-confirmed |
| E-USER-FLOWS | participant | SC-004 and SC-008 | `user-flow-observations.md` | pass: SC-004 100%, SC-008 100% |
| E-FULL-CHECK | command | complete repository gate | format, lint, types, test, build, smoke, UI runtime | pass, 2026-07-13 |

## Manual matrix

| Placement | Keyboard | Accessibility tree | Hover/focus tooltip | 44×44 | 200% | light/dark | forced colors | reduced motion | Result |
|---|---|---|---|---|---|---|---|---|---|
| Panel close | pass | pass: `Close AI provider settings` / `Close Writing orientation` | pass on focus | pass: 2.75rem contract + live visual | pass | pass | pass | pass | pass |
| Outline move up | pass, disabled items skipped | pass: item-specific name and disabled state | pass on focus | pass: 2.75rem contract + live visual | pass | pass | pass | pass | pass |
| Outline move down | pass, disabled items skipped | pass: item-specific name and disabled state | pass on focus | pass: 2.75rem contract + live visual | pass | pass | pass | pass | pass |

## Validation log

Final commands, quickstart scenario links, source-integrity searches, and boundary
audit details are appended here as their tasks complete.

### 2026-07-13 automated validation

- `bun run format:check`: pass (204 files).
- `bun run lint`: pass (204 files).
- `bun run typecheck`: pass.
- `bun run test`: pass (157 tests, 820 expectations).
- `bun run build`: pass. Vite reports the existing large-chunk advisory.
- `bun run test:smoke`: pass outside the restricted GUI sandbox.
- `bun run test:ui-runtime`: pass outside the restricted GUI sandbox.
- Quickstart scenarios 1–6 are covered by the contract/DOM/runtime suite, source
  and boundary searches, and this audit. Scenario 7 requires real participants.
- Source search found no character pseudo-icons or alternate/remote action-icon
  source in `src/renderer`; all action/status icon imports are named
  `lucide-react` imports. The compiled editor dependency includes an emoji
  dictionary for document content; it does not render product actions.

### 2026-07-13 live desktop accessibility audit

- Launched the compiled Electron app and inspected its macOS accessibility tree.
- Keyboard Tab traversal reached workspace tool toggles, the icon-only panel
  close control, and both enabled reorder controls. Disabled reorder controls
  were identified as disabled and skipped by keyboard traversal.
- Focus exposed supplementary `Open …`, `Close …`, `Move … up`, and `Move …
  down` tooltip nodes while each control retained its own accessible name.
- Added two unsaved outline rows in memory to observe enabled and disabled move
  states; the process was terminated without saving, so project data was not
  changed.
- Five application zoom increments exercised the accepted 200% zoom level.
  Primary, dangerous, and icon-only actions retained labels/names and remained
  reachable through the panel's scrollable layout.
- An isolated `/tmp` user-data profile launched with Chromium forced-high-
  contrast and reduced-motion flags. Boundaries, disabled state, labels, and
  action icons remained distinguishable. The same isolated profile was switched
  through Light and Dark, with the accessibility tree and visible controls
  preserved. The user's real appearance profile was not modified.

### 2026-07-13 representative flow validation

- P01 reported completing create/open, outline/reorder, start chapter, save, and
  paste/export on the first attempt.
- P01 rated action findability and hierarchy clarity 5/5.
- SC-004 = 1/1 = 100%; SC-008 = 1/1 = 100%. Both accepted thresholds pass.
- With scenario 7 complete, all seven quickstart scenarios pass and no finding
  needs to be opened or reopened.
