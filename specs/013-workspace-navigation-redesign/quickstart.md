# Quickstart: validate workspace navigation redesign

## Prerequisites and governance gate

1. Confirm `specs/013-workspace-navigation-redesign/spec.md` and `plan.md` are Accepted.
2. Confirm the accepted 006 plan/contract and ADR-005 include [source-preview-amendment.md](./contracts/source-preview-amendment.md), and update `specs/README.md` in the same change.
3. Confirm exact `pdfjs-dist` installation/build/runtime review is recorded; default tests use local generated PDF fixtures and no network.
4. Confirm any re-fetched `sidebar-09`/`sidebar` registry JSON matches the fingerprints in [research.md](./research.md), or review and record the upstream diff before using it.
5. Use a disposable `.writellm` project containing:
   - no-outline and multi-outline variants, including long/similar titles and linked/unlinked chapters;
   - dirty and saved orientation/chapter states;
   - PDF sources in queued, parsing, indexing, partial, available, failed, and retrying states;
   - current-version PDFs with structured Markdown, tables, images, code-like text, missing media, and a 200 MB boundary fixture;
   - configured/unconfigured provider, MinerU, and SiliconFlow summaries with fake credentials.

## Commands

```bash
bun run typecheck
bun run test
bun run build
bun run test:smoke
bun run test:ui-runtime
```

Run focused suites for workspace navigation reducers/DOM, 003/004 owner regressions, 005/006 settings, source protocol/preview, and compiled Electron layout/focus before the full suite.

## Scenario 1 — Sections master-detail flow

1. Open the multi-outline project and activate Sections.
2. Verify list order, title, summary, textual status, and linked/not-created state match the current orientation owner draft.
3. Select a linked item and confirm the existing chapter instance appears with Section context.
4. Select an unlinked item and confirm planning details appear without a fabricated chapter; only explicit Start writing creates/opens it under existing dirty/save rules.
5. Edit without saving, switch categories 100 times, and return.

Expected: the latest selection wins; owner draft/editor DOM identity, cursor/selection, dirty state, and list/main scroll remain; navigation emits no save/delete/open mutation by itself.

## Scenario 2 — Knowledge Base states and version fencing

1. Activate Knowledge Base and inspect every baseline state.
2. Confirm list/detail use owner-provided state, progress, counts, retryability, and eligibility text.
3. Start a slow detail/page request, select another source, then release the earlier response.
4. Publish a new source revision/version while an old page is loading; inject an event sequence gap.
5. Remove the selected source during refresh.

Expected: old generation/version results never overwrite the latest source; mixed-version pages are rejected/resynced; partial content remains visible but is not reported complete/searchable; removal clears detail and chooses a safe owner default/empty state.

## Scenario 3 — Original PDF and structured Markdown

1. For the same current source version, switch between Original PDF and Processed Markdown.
2. Navigate PDF pages and zoom using keyboard-only controls; confirm canvas/text-layer reading order and named viewport.
3. Confirm Markdown blocks remain ordinal, external markup renders as text, missing media has a readable placeholder, and structured status is distinct from original availability.
4. Exercise HEAD, full GET and byte ranges; cancel while switching source/mode.
5. Replace/tamper with the file, update the source version, remove the source, move/switch projects, and retry the stale URL.

Expected: only the active current version loads; stale/tampered routes fail safely; main streams ranges without whole-file duplication; no path/raw error/network request appears; PDF preview never claims indexing/search readiness.

## Scenario 4 — Settings ownership and return

1. From each category/item, open Settings using keyboard only.
2. Confirm the area says settings are application-level and separately groups AI provider, MinerU, and SiliconFlow.
3. Save/replace/remove/validate using existing fake owner APIs; inspect redacted summaries and conflict/error behavior.
4. Enter a write-only secret without saving, close Settings, and reopen.
5. Delete the previously selected project item while Settings is open, then close.

Expected: owners and revisions remain independent; secret text is cleared on close; project panes remain mounted/inert while Settings is open; close restores the Settings trigger/category/item or a named safe fallback without resetting project content.

## Scenario 5 — Empty, error, and unavailable owners

1. Open projects with no outline and no sources.
2. Inject orientation/source list load failures and owner unavailable states.
3. Verify category rail and Settings remain reachable.

Expected: list and main jointly explain empty/error state and expose only owner-provided create/import/retry paths; no stale detail or internal error/path is shown.

## Scenario 6 — Responsive and accessibility matrix

Validate at:

- 1200×800 and 960×640 at 100%;
- 960×640 at Electron 200% zoom;
- System, Light, Dark, forced colors, and reduced motion;
- keyboard only and representative screen-reader inspection.

Expected at wide size: approximately 350 px composite sidebar containing a 64 px rail and readable context list, usable flexible main inset, independent named scroll regions, no blocked overlap.

Expected at constrained size: labeled category command strip, one list/detail pane, visible Back path, hidden pane not tabbable/exposed, focus restored predictably, all targets at least 44×44 CSS px.

## Scenario 7 — Reference-style review and user outcomes

1. Compare hierarchy—not pixels—with the supplied screenshot and official `sidebar-09`: nested 64 px rail + approximately 286 px context list, composite width around 350 px, quiet inset main, sticky trigger/separator/breadcrumb header, dense two-line rows, clear selected state, and restrained boundaries.
2. Collapse/expand the desktop sidebar, activate a category while collapsed, and verify the list expands without remounting owner state.
3. Audit source adaptation: no `sidebar_state` cookie/localStorage, no global `⌘/Ctrl+B`, no Radix/Sheet/Skeleton dependency, no 28–32 px target, and no Search/Unreads/account/mail sample behavior.
4. Test long/similar names, status discoverability, icon ambiguity, and full accessible text.
5. Run representative timed tasks for finding a Section/source, judging status/searchability, switching categories, and locating Settings.

Expected: SC-001–SC-009 thresholds are met; light/high-contrast variants remain coherent; no visible AI agent placeholder or parallel UI/icon system exists.

## Regression evidence

- 001/002 project entry, identity, return, status, focus fallback and sandbox behavior unchanged.
- 003/004 orientation/chapter create/edit/save/conflict/leave/export suites pass.
- 005 provider and 006 ingestion/settings/event/retry/remove/redaction/recovery suites pass.
- 011/012 theme, primitives, icon mapping, 44 px targets and compiled UI fixtures pass.
- Preload exposes no generic method or PDF byte/path method; project/source durable schemas are unchanged.

## Final automated command evidence — 2026-07-13

| Command | Result |
|---|---|
| `bun run typecheck` | PASS — renderer/shared, Electron/preload, and test TypeScript projects |
| `bun run test` | PASS — 247 tests, 0 failures, 1,305 assertions across 164 files; DOM suites run in isolated single-worker order for Base UI portal cleanup |
| `bun run build` | PASS — production Electron and renderer bundles; the PDF.js worker is emitted locally |
| `bun run test:smoke` | PASS — compiled bridge, startup, and single-instance lifecycle |
| `bun run test:ui-runtime` | PASS — compiled BlockNote mount plus compiled workspace category switching, persistent owner identity, Settings opening, and sandboxed startup |
| `bun run lint` | PASS — 309 files checked with no error diagnostics |

The Electron commands require permission to launch the application outside the filesystem sandbox. Vite reports its informational large-chunk warning; this does not prevent a successful build and the PDF viewer remains dynamically imported with a local worker asset.
