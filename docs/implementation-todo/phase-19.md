# WriteLLM Phase 19 Implementation Plan

Status: Checkpoint 70 is complete under ADR 062.
Recorded: 2026-08-24

## Checkpoint 70: Notebook Read-Only Agent Alignment

- [x] Add strict writing and selected-source Notebook tool profiles to the shared Pi session runtime.
- [x] Move Notebook to transient session runs with scoped Knowledge tools, bounded citation ordinals,
  metadata-only model requests, and source-epoch in-memory history.
- [x] Reuse Agent model/effort selection and capability clamping without changing global defaults.
- [x] Verify contracts, Worker/Main authority, lifecycle/privacy, Renderer behavior, and Real-Electron
  selected-source citation flow.

## Local evidence

- Focused shared-contract, Worker, Main, IPC, prompt, and Notebook service coverage passed 44 tests.
  It covers the two strict tool profiles; Worker and Main authorization; multiple tool
  continuations; selected-source and citation-registration boundaries; twelve-citation capping;
  model/Thinking clamping; stop, failure, source-boundary, and project-close cleanup; and
  metadata-only model requests with external response IDs removed.
- `pnpm check:fast` passed.
- `pnpm check:electron` passed 200 files / 1123 tests with three intentional benchmark skips,
  followed by a successful production build.
- A fresh `pnpm check:e2e` passed 46/46 scenarios with no flaky, skipped, or failed scenario. The
  real Notebook flow completed `search_knowledge` → `read_citations` → cited answer through two
  tool continuations, exposed only those two tools, sent no `temperature`, preserved selected-source
  isolation and citation preview, and cleared chat on project reopen.
- `git diff --check` passed. No database migration, dependency, package/release action, hosted CI,
  commit, tag, push, signing, notarization, promotion, or publication ran.
