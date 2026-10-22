# WriteLLM Phase 16 Implementation Plan

Status: Checkpoint 67 is complete.
Recorded: 2026-08-23

## Checkpoint 67: First-Run Onboarding

Decision: user-authorized implementation under ADR 059. Add a skippable first-run path through
the existing Agent, Embedding, Reranking, MinerU, and project-creation boundaries without changing
credential, provider, project, or Renderer authority.

- [x] Persist a versioned application-global onboarding step/completion marker through bounded,
  sender-authorized IPC.
- [x] Compose a six-step onboarding surface beneath the global Menubar.
- [x] Reuse the existing Provider Settings workspaces and real project-creation workflow.
- [x] Make every step optional, resume interrupted progress, and stop showing completed onboarding.
- [x] Verify repository, IPC, Preload, Renderer, and Real-Electron behavior.

Verification evidence: [archived record](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/implementation-todo/phase-16.md#checkpoint-67-first-run-onboarding).
