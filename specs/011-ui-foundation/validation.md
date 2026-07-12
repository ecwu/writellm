# Validation evidence

Validated 2026-07-12 with Bun 1.3.14.

## Automated gates

- `bun run typecheck`: pass, including renderer/shared, Electron/preload, and UI test configurations.
- `bun run test`: pass; project regression plus appearance, theme, primitive, pattern, integration, and runtime-source assertions.
- `bun run build`: pass.
- `bun run test:smoke`: pass in the native Electron environment; compiled project bridge/startup/single-instance lifecycle preserved.
- `bun run test:ui-runtime`: pass in the native Electron environment; compiled two-namespace preload inventory and theme-aware renderer startup verified.

The quickstart's automated System/Light/Dark, persistence/corruption, Typeset, keyboard/overlay, forced-colors, reduced-motion, zoom/window-size, and 001 regression checks are represented by the named unit, contract, integration, and compiled-runtime gates. Manual visual observations remain appropriate release QA, not an unrecorded implementation decision.

## Audit

The initial inventory is exactly 11 primitives and four patterns. No feature or pattern imports Base UI directly; no localStorage, remote resource/font, arbitrary font string, extra primitive, production shadcn dependency, or second token system exists. `window.writellm` remains six named project methods and `window.writellmAppearance` is exactly two named methods. Security preferences remain context isolation on, Node integration off, sandbox on, and web security on.

The production bundle changed from 2.70 kB CSS / 195.75 kB JS (gzip 1.08 / 61.40 kB) to 16.74 kB CSS / 228.36 kB JS (gzip 4.46 / 71.68 kB): +14.04 kB CSS and +32.61 kB JS raw, +3.38/+10.28 kB gzip. This is justified by Tailwind's generated semantic utility layer, appearance provider, source-owned components, and exact UI helpers. The CLI was removed after ejection.

## 002 handoff

The fixed ten needs reconcile without a gap: actions (Button), icon discoverability (Button/Tooltip), labeled fields (FormField/Input), surfaces (Card), separation (Separator), constrained content (ScrollArea), modal focus (Dialog), feedback (StatusNotice/Alert), compact markers (Badge), and unavailable/empty slots (EmptyState). No FoundationExtensionRequest is required.
