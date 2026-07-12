# Quickstart: 共享 UI Foundation validation

本文件是 feature 实现后的验证指南，不是实现脚本。当前 planning turn 不执行依赖安装或这些未来检查。

## Prerequisites

1. `spec.md`, `plan.md` and [ADR-003](../../docs/adr/003-ui-foundation.md) are Accepted.
2. Implementation tasks have explicitly pinned and installed the approved dependencies; `package.json` and `bun.lock` match.
3. 001 accepted tests, fixtures and [quickstart](../001-project-foundation/quickstart.md) remain available unchanged.
4. A compiled Electron display environment is available for system theme, focus, zoom and minimum-window checks.

## Baseline commands

Before running them, `bun --version` must report the repository-declared `1.3.14`; a different local Bun cannot provide compatibility evidence.

```text
bun run typecheck
bun run test
bun run build
bun run test:smoke
```

Expected: all existing 001 tests pass; new UI, Typeset and appearance storage/IPC tests pass; production build resolves local aliases and CSS; compiled Electron retains the exact six-method project bridge, exposes exactly two appearance methods and preserves security settings.

The UI runtime check additionally builds the dedicated component fixture and launches its Electron test entry; the existing lifecycle smoke remains responsible for startup/single-instance behavior.

## Scenario 1: foundation inventory and dependency boundary

1. Inspect `components.json`, `src/renderer/components/ui`, `components/patterns`, `theme` and the lockfile.
2. Confirm only the approved 11 primitives, 4 patterns and three Typeset presets were added.
3. Search shared components for imports from `launch`, `workspace`, `window.writellm`, Electron, Node or main/preload/shared project code.
4. Confirm the reviewed preset/init/add/eject sequence left local component/theme CSS and no production `shadcn` package dependency.
5. Build with network unavailable.

Expected:

- Components are local source and build offline.
- Dependency direction matches the contract; no UI code expands renderer privileges.
- No remote registry, font, icon or theme resource is required at runtime.
- CLI/source and runtime packages are exact and reviewable.

## Scenario 2: System, Light, Dark and restart persistence

1. Launch with no appearance file while the OS is light; confirm System/default before first paint.
2. Select Dark from the launch-page AppearanceControls, keep text in the project-name field, and restart.
3. Change OS appearance while explicit Dark is selected, then select System and change OS appearance again.
4. Select Light, restart, and inspect computed tokens, surfaces, text, borders, actions, warnings, errors and focus.

Expected:

- Missing preferences use System; successful selection is atomically persisted and restored without a wrong-theme first frame.
- Explicit Light/Dark ignores OS changes; System follows them at runtime.
- Input, recent items and launch operation state are preserved.
- Text/status/focus remain distinguishable and do not rely on color alone.
- No preference is written to localStorage or project files; main owns the versioned userData file and renderer sees no path.

## Scenario 3: appearance validation and failure boundary

1. Exercise `window.writellmAppearance` and assert it contains exactly `getAppearancePreferences` and `updateAppearancePreferences`.
2. Submit unknown enums, arbitrary font names, NaN/infinite values and values outside the accepted bounds.
3. Start with missing, malformed, unknown-version and unwritable preference storage.
4. Confirm `window.writellm` still contains exactly the accepted six project methods.

Expected:

- Main rejects invalid renderer input and returns stable safe errors; no raw JSON, exception or path crosses preload.
- Missing storage uses defaults. Corrupt/unknown data returns defaults plus a safe warning and is not overwritten until a valid update succeeds.
- A storage failure retains the last normalized preference and does not report success.
- Appearance and project IPC/repositories/files remain separate.

## Scenario 4: Typeset presets and font safety

1. Render representative headings, paragraphs, lists, blockquotes, tables, inline/block code and streaming-appended blocks inside each Typeset preset.
2. Switch body/headings between the accepted system-serif and system-sans IDs; verify code remains system-mono.
3. Exercise light/dark, forced colors, 200% zoom and narrow containers.

Expected:

- Editor uses the accepted 16px/1.75/1.25em default; reading is roomier and compact is denser through centralized variables.
- Theme colors/radius follow foundation tokens; layout owns measure and wide tables remain reachable.
- Appending a block does not restyle earlier blocks, and presentation changes do not mutate source content.
- No font enumeration, arbitrary family, upload or network request occurs; unavailable fonts fall back safely.

## Scenario 5: keyboard and overlay accessibility

1. Traverse every initial interactive primitive, AppearanceControls/Select and migrated launch action using keyboard only.
2. Open Dialog from a fixture trigger; cycle Tab/Shift+Tab, press Escape and close explicitly.
3. Focus a Tooltip trigger without a pointer.
4. Remove a dialog trigger while open and close to exercise fallback focus.

Expected:

- Focus is always visible and activation follows native/contract behavior.
- Dialog focus enters, remains inside, background is inert and close restores a documented target.
- Tooltip is keyboard discoverable but icon controls retain independent accessible names.
- No keyboard trap remains after overlay closes.

## Scenario 6: reduced motion, forced colors, zoom and minimum window

1. Enable reduced motion and exercise hover, focus, status and dialog transitions.
2. Enable system high contrast/forced colors and inspect text, boundaries, status and focus without disabling browser adjustment globally.
3. Set Electron zoom to 200% at 1200×800 and 960×640.
4. Use long recent project names and the longest current warning/error strings.

Expected:

- Non-essential animation is removed or minimized; state remains understandable.
- Forced-colors mode retains readable text, visible boundaries/focus and non-color status meaning.
- New/open/recent/relink/remove, status and error content remain reachable.
- Content can wrap/scroll without blocking an action or clipping the focused element.

## Scenario 7: complete 001 behavior regression

Repeat the existing 001 quickstart scenarios for:

1. first launch and create;
2. open, move and relink;
3. recent list and safe removal;
4. cancellation, collision and invalid project;
5. storage/failure boundaries;
6. single active instance.

Expected:

- All existing expected outcomes remain unchanged.
- `window.writellm` still exposes exactly the accepted six project methods.
- `window.writellmAppearance` is additive and never changes project/recent results or storage.
- No project/recent manifest, schema, error code, path redaction or disk side effect changed because of UI migration.

## Scenario 8: extension workflow for 002

1. Recheck the 10-item common-UI coverage table in `plan.md` against 002's accepted shell design; shell layout/business orchestration remain excluded.
2. For any gap, create a FoundationExtensionRequest with consumer, state matrix, accessibility, theme and verification evidence.
3. Attempt the contract's composition/variant sequence before adding a primitive.

Expected:

- At least 9 of the fixed 10 known common UI needs map directly to an existing primitive/pattern; the planning baseline is 10/10.
- Any remaining addition follows the shared owner/review path and does not introduce a parallel UI system.
- No 002 business state or layout is implemented as part of 011.

## Upgrade rehearsal

Using a temporary review branch only after implementation:

1. run the exact approved shadcn command for one component;
2. inspect generated source, dependency, token and DOM changes;
3. run component, launch and Electron checks;
4. discard or revise any change that overwrites local contract behavior.

Expected: the upgrade path produces a bounded, understandable diff and never silently replaces project-owned source.
