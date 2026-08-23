# WriteLLM Phase 17 Implementation Plan

Status: Checkpoint 68 is complete under ADR 060.
Recorded: 2026-08-23

## Checkpoint 68: Native Block Math And Diagram Experience Convergence

- [x] Advance section content to schema v5, add versioned legacy projection, and implement the
  reviewed 0038 forward migration with recovery and integrity coverage.
- [x] Replace application-owned display Math with BlockNote native `mathBlock`, including bounded
  source handling, native input rules, slash-menu integration, and layout/safety checks.
- [x] Move the application-owned Mermaid block to `diagram` plain content and
  `SourceBlockWithPreview`, retaining safe rendering and adding shared caption/alt-text metadata.
- [x] Align prose semantics, Agent contracts/context, Markdown/LaTeX import, Markdown export, and
  DOCX/PDF/LaTeX publication with the v5 structures.
- [x] Pass focused coverage, frozen install and audits, `pnpm check`, `pnpm check:fast`,
  `pnpm check:electron`, recovery fixtures, and a fresh-build `pnpm check:e2e` without invoking
  signing, notarization, or `check:release`.

## Local evidence

- Schema-v5 contract, normalization, legacy decoder, migration 0038, prose isolation, Agent tool,
  import/export, publication, Renderer source-guard, and secure Math/Mermaid focused suites passed.
  Migration coverage preserves v1–v4 JSON and hashes, advances active heads through CAS, retains
  relationship integrity, converts legacy captions deterministically, and covers v37→v38 recovery.
- The editor uses BlockNote 0.54 native Inline/Block Math and native Math slash items. The
  application-owned Diagram uses plain content plus `SourceBlockWithPreview`, keeps the last legal
  preview, dynamic light/dark Mermaid rendering, sanitized isolated SVG, and shared caption/alt-text
  metadata. Runtime checks covered invalid source recovery, undo/redo, reload, no-caption layout,
  620 px width, keyboard flow, and metadata persistence.
- Frozen installation passed. Both `pnpm audit --prod` and `pnpm audit` completed outside the
  network-restricted sandbox with zero advisories. Scoped Impeccable inspection found no design
  violations.
- `pnpm check`, `pnpm check:fast`, and `pnpm check:electron` passed. The Electron-hosted gate
  reported 200 passing files / 1107 passing tests with three intentional benchmark skips and a
  successful production build.
- `node scripts/verify-recovery-fixtures.mjs` passed all 27 cases from 25 protected sources with
  manifest SHA-256 `b33cda1ecc72eae989deacf8ebb4c7fea1549d415aad0f46e566c87a08a1f329`.
- The fresh-build `pnpm check:e2e` gate passed all 45/45 required Real-Electron scenarios with no
  flaky, skipped, or failed scenario. It includes native Inline Math, native Block Math,
  application-owned Diagram, Agent contract v9, safe source rejection, dark-theme rerender,
  sanitized SVG, narrow-window layout, persistence, reopen, and Markdown export evidence.
- The local shell reported Node 26.7.0 outside the repository's declared Node 24 range; pnpm
  11.17.0, Electron 43.4.1 / ABI 148, native preparation, typechecks, tests, and builds all passed.
  No packaging, signing, notarization, `check:release`, candidate, commit, tag, push, hosted CI,
  promotion, or publication action ran.
