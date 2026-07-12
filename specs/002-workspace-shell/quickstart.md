# Quickstart Validation: 写作工作台外壳

## Prerequisites

- 001 accepted implementation and full regression suite pass.
- 011 implementation complete, including 001 presentation migration and compiled UI fixture.
- 002 spec and plan accepted.
- No external service, provider credential, project content fixture or new IPC is required.

## Commands

```text
bun run typecheck
bun run test
bun run build
bun run test:smoke
bun run dev:electron
```

## Fixture setup

Use the existing fake `WriteLLMIpc` and 001 project fixtures. Add:

- an observable workspace slot with input/text content, selection, `scrollTop`, mount counter and focusable fallback;
- two registered tool panels plus empty/error/long-content variants;
- owner status sources covering every state, monotonic and out-of-order sequences, and optional callbacks;
- a non-destructive Dialog consumer and icon Button + Tooltip consumer using 011 public APIs.

## Scenario 1 — Project handoff and return

1. Enter through create, open dialog, available recent and moved-project relink success.
2. Confirm each workspace shows the exact returned `projectId`/`displayName` and does not create a duplicate project/recent record.
3. Exercise cancel, invalid and error results; confirm the launch surface remains.
4. Return from workspace; confirm existing new/open/recent/relink/remove actions remain available and unchanged.

**Expected**: SC-001 passes; project/recent side effects remain owned by 001.

## Scenario 2 — Stable workspace and panels

1. Set observable slot content, selection, scroll and focus context.
2. Open panel A, switch to B, toggle B closed, reopen, close with Escape and explicit close.
3. Hover A to preview, move pointer safely into its panel, leave both and verify grace-period close; then click/keyboard activate A and verify pointer leave/blur/timeout do not close the pinned panel.
4. Repeat a mixed sequence 100 times, including rapid A/B triggers and preview-to-pinned transitions.
5. Remove/disable the trigger before one close to exercise fallback focus.

**Expected**: at most one panel; same workspace root node and values throughout; one close transition; focus returns to trigger or workspace fallback, never body.

## Scenario 3 — Dialog, tooltip and keyboard

1. Traverse project navigation, every tool trigger, panel content/close and status action by keyboard.
2. Open the Dialog and validate contextual initial focus, Tab/Shift+Tab containment, inert background, Escape/explicit/outside policy, long-content scrolling and focus return/fallback.
3. Focus an icon trigger and validate accessible name plus supplementary Tooltip; dismiss with Escape/blur.

**Expected**: 011 overlay contract passes in DOM tests and compiled Electron UI fixture.

## Scenario 4 — Status ordering and safety

1. Submit in-progress, complete, error, needs-action, unknown and owner-unavailable from multiple sources.
2. Submit duplicate and decreasing sequence values.
3. Test action absent/present, panel/Dialog open, and an urgent error.

**Expected**: stale updates are no-op; fixed priority is deterministic; visible non-color text remains discoverable; action appears only when supplied; no failure becomes success; no path, secret, raw exception or content is shown.

## Scenario 5 — Responsive appearance

1. Run at 1200×800, 960×640 and 960×640 with 200% text scale.
2. Exercise System/Light/Dark, runtime system theme changes, reduced motion and forced colors where supported by the 011 fixture.
3. Keep a project, active panel and populated workspace slot during each transition.

**Expected**: project, workspace, tools, panel close and important status stay reachable; state and workspace node identity do not change; no blocking clipping.

## Scenario 6 — Boundary regression

1. Assert `window.writellm` still exposes exactly the six 001 methods.
2. Assert `window.writellmAppearance` still exposes exactly the two 011 methods after 011 implementation.
3. Assert no workspace channel, preload namespace, localStorage or durable shell file exists.
4. Run 001 read-only open/relink tree-hash and compiled Electron regression suites.

**Expected**: security, project storage and appearance boundaries are unchanged.

## Acceptance mapping

| Spec outcomes | Scenarios |
|---|---|
| SC-001 | 1, 6 |
| SC-002 | 2 |
| SC-003–SC-004 | 2, 3 |
| SC-005–SC-006 | 5 |
| SC-007 | 3, 5, 6 |
| SC-008 | 4 |

## Validation notes — 2026-07-12

- `bun run typecheck`: PASS.
- `bun run test`: PASS, 56 tests across 43 files.
- `bun run build`: PASS, renderer and Electron/preload compilation complete.
- Scenario 1: PASS through the four explicit successful `ProjectSnapshot` handoff call sites and unchanged launch error/cancel handling.
- Scenario 2: PASS through reducer invariants, single-host composition, preview grace, pinned mode, stable slot sibling, and trigger/workspace focus fallback coverage.
- Scenario 3: PASS through named semantic regions, public 011 component imports, compiled fixture workspace/Dialog composition, and Escape/focus source checks.
- Scenario 4: PASS through monotonic sequence rejection, fixed cross-owner priority, semantic status rendering, and owner-only action callback coverage.
- Scenario 5: PASS through semantic-token CSS at wide/constrained layouts, high-resolution text-scale proxy, and reduced-motion media handling without conditional slot mounting.
- Scenario 6: PASS through exact preload namespace regression, forbidden workspace persistence/IPC/import checks, and the full inherited 001/011 test suite.
