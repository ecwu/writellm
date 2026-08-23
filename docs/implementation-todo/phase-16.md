# WriteLLM Phase 16 Implementation Plan

Status: Checkpoint 67 is complete.
Recorded: 2026-08-23

## Checkpoint 67: First-Run Onboarding

Decision: user-authorized implementation under ADR 059. Add a skippable first-run path through
the existing Agent, Embedding, Reranking, MinerU, and project-creation boundaries without changing
credential, provider, project, or Renderer authority.

- [x] Persist a versioned application-global onboarding step/completion marker through bounded,
  sender-authorized IPC.
- [x] Compose a responsive six-step onboarding surface beneath the global Menubar.
- [x] Reuse the existing Provider Settings workspaces and real project-creation workflow.
- [x] Make every step optional, resume interrupted progress, and stop showing completed onboarding.
- [x] Verify repository, IPC, Preload, Renderer, responsive, and Real-Electron behavior.

Local evidence:

- The strict shared contract, Main-owned app-settings repository, sender-authorized IPC, and
  narrow Preload API persist only the versioned step and completion marker in `app.sqlite`. The
  flow stores no credential, project path, document content, or provider response. Existing
  installs with prior application state bypass onboarding without requiring a schema migration.
- The Renderer presents Welcome, Agent, Embedding, Reranking, MinerU, and First Project beneath the
  persistent global Menubar. Provider pages reuse `ProviderSettingsWorkspace`; both the existing
  project dialog and onboarding reuse `ProjectCreationFields` and the same Main-owned native
  folder-selection/project-creation path.
- Every step exposes an optional path. Progress is saved after each transition, interrupted setup
  resumes at the saved step, and opening or creating a project completes onboarding. Agent readiness
  derives from the enabled authenticated catalog and an enabled model rather than the legacy
  singleton provider status.
- Seventeen focused repository, IPC, and Renderer tests passed. `pnpm check:fast` passed. The
  complete `pnpm check:electron` gate passed 199 files / 1102 tests with three intentional
  benchmark skips and completed the production build.
- The fresh `pnpm test:e2e` manifest passed 45/45 scenarios with no flaky, skipped, or failed
  scenario. The onboarding scenario covers first launch, optional provider navigation,
  restart/resume, real native-folder project creation, completion persistence, and restart
  suppression; the fixture default kept all pre-existing scenarios on their established shell.
- Wide desktop and 620 px narrow runtime screenshots passed visual review and the narrow project
  step passed horizontal-overflow assertions. Scoped Impeccable mechanical detection returned no
  findings, and `git diff --check` passed.
- No dependency, migration, package/release, hosted CI, commit, tag, push, signing, notarization,
  promotion, or publication action ran.
