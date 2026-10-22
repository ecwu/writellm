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

Verification evidence: [archived record](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/implementation-todo/phase-17.md#local-evidence).