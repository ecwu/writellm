---
id: ADR-0006
title: Select the supported Electron and Pi runtime path
date: 2026-07-11
initiative: PIA
scope: initiative
project_prd: ../project-prd.md
initiative_prd: ../pi-agent-harness-prd.md
task_tracker: ../task-tracker.md
prd_decisions: [PIA-D-006]
related_tasks: [PIA-001, PIA-002, PIA-003, PIA-016]
depends_on: []
supersedes: []
superseded_by: ADR-0010
decision_status: SUPERSEDED
implementation_status: ABANDONED
last_updated: 2026-07-11
---

# ADR-0006: Select the supported Electron and Pi runtime path

## Context

The currently resolved Electron runtime is 35.7.5 with embedded Node 22.16.0. Current @earendil-works/pi-agent-core declares Node 22.19.0 or newer. The application also relies on the native better-sqlite3 module, which must be rebuilt and smoke-tested after an Electron upgrade.

## Decision

Superseded by [ADR-0010](0010-use-a-supported-patched-electron-runtime-for-pi.md). Electron `37.6.0` proved the Node compatibility path and native rebuild, but a subsequent `bun audit` reports high-severity Electron advisories for all versions below `38.8.6`; Electron 38 is also out of support. It is not an acceptable release runtime.

PIA-003 will add exact `@earendil-works/pi-agent-core` `0.80.3` after PIA-002 proves the new Electron runtime. This is the reviewed, non-CLI embedding package: it is MIT licensed and declares four runtime dependencies—`yaml@2.9.0`, `ignore@7.0.5`, `typebox@1.1.38`, and `@earendil-works/pi-ai@^0.80.3`. PIA-003 must review the generated lockfile and every resolved direct/transitive production dependency before accepting it; it must not add `@earendil-works/pi-coding-agent`, a Pi resource loader, extensions, skills, or default Pi tools.

### Decision evidence

- Electron [v37.6.0 release metadata](https://releases.electronjs.org/release/v37.6.0), checked 2026-07-11: Node `22.19.0`.
- Pi Core [package metadata](https://www.npmjs.com/package/%40earendil-works/pi-agent-core/v/0.80.3), checked 2026-07-11: version `0.80.3`, Node engine `>=22.19.0`, MIT, and the declared direct-dependency baseline above.

The deliberate minimum-compatible Electron step limits native-module migration risk. A newer Pi release must not be substituted without a new dependency review and an ADR/status-history update.

### Upgrade and verification sequence

1. PIA-002 changes the Electron dependency to exact `37.6.0`, installs it, and runs `bun run rebuild:native` for `better-sqlite3`.
2. PIA-002 records `bun run typecheck`, `bun run build`, and `bun run test:smoke` evidence on the rebuilt Electron runtime, including a direct embedded-Node version check.
3. Only after that evidence passes may PIA-003 add exact Pi Core `0.80.3` and perform the dedicated dependency review.
4. PIA-004 selects the model-stream adapter; it does not migrate or remove the existing quick-generation path.

### Rollout and rollback plan

Agent mode remains unavailable by default. Its later implementation stores `agent.enabled: false` in the existing local `writellm-settings.json` user-data file. The main process is the authority: it must reject every new agent-run request while this value is false. A renderer-visible capability/disabled state is informational only. The field is local-only, contains no credential, and is not a remote control plane.

Rollout is staged: ship the compatible runtime with the flag false; enable it only for an explicit local opt-in after agent lifecycle, tool-policy, persistence, IPC, and review tests pass; then rehearse disabling it. Disabling the flag stops new runs while preserving legacy quick generation and readable historical agent records.

Before persistent agent records exist, runtime rollback is: set `agent.enabled` to false, restart, revert the exact Electron/Pi lockfile changes, reinstall, rebuild `better-sqlite3`, and re-run the smoke test. After PIA-005 adds persisted records, rollback must be forward-compatible: disable new runs and retain the records for reading rather than attempt a destructive database downgrade. PIA-016 owns the live rollback rehearsal.

## Alternatives considered

| Alternative | Why it was not selected or what must be proven |
| --- | --- |
| Upgrade Electron and use current Pi Agent Core | Superseded: ADR-0010 selects a supported patched line after audit evidence invalidated 37.6.0 for release. |
| Use an older deprecated Pi package in production | Rejected because migration and ongoing support risk are unacceptable. |
| Defer Pi integration without upgrading Electron | Valid abandonment/deferment option if compatibility or upgrade risk is not acceptable. |

## Consequences and constraints

- This record is retained as compatibility evidence only; new runtime work follows ADR-0010.
- The selected Pi version must be exact, reviewed, and recorded with its license and relevant transitive dependencies.
- Rollback must preserve legacy generation and leave historical agent traces readable.
- The successful 37.6.0 rebuild/typecheck/build/smoke evidence is not release approval and must not be reused to waive ADR-0010 verification.

## Linked implementation work

| PIA task | Contribution to this decision |
| --- | --- |
| PIA-001 | Selected the now-superseded minimum-compatible line and recorded the original rollout plan. |
| PIA-002 | Proved the now-superseded 37.6.0 runtime path, providing migration evidence for ADR-0010. |
| PIA-003 | Found the audit evidence that requires the superseding runtime decision. |
| PIA-016 | Uses ADR-0010's runtime when it eventually rehearses feature-flag rollback. |

### Completion conditions

- [x] Electron `37.6.0` / Node `22.19.0` compatibility, native rebuild, typecheck, build, and smoke were proven.
- [x] The decision was invalidated for release by current Electron audit and support evidence; ADR-0010 governs the replacement.

## Status history

| Date | Decision status | Implementation status | Change and evidence |
| --- | --- | --- | --- |
| 2026-07-11 | PROPOSED | NOT_STARTED | Migrated pending PRD decision PIA-D-006 into the ADR register; PIA-001 owns final selection. |
| 2026-07-11 | ACCEPTED | NOT_STARTED | PIA-001 selected Electron 37.6.0 (Node 22.19.0) and exact Pi Core 0.80.3. Electron release metadata and Pi package metadata verify the Node compatibility; PIA-002 still owns rebuild/typecheck/build/smoke proof. |
| 2026-07-11 | ACCEPTED | IN_PROGRESS | PIA-002 claimed the exact Electron 37.6.0 upgrade and better-sqlite3 rebuild; Pi remains uninstalled pending runtime verification. |
| 2026-07-11 | ACCEPTED | IN_PROGRESS | PIA-002 passed: Electron reports 37.6.0 / Node 22.19.0 under `ELECTRON_RUN_AS_NODE=1`; better-sqlite3 rebuild, typecheck, build, and Electron smoke passed. PIA-003 is the remaining dependency-installation work. |
| 2026-07-11 | ACCEPTED | IN_PROGRESS | PIA-003 started the exact Pi Core 0.80.3 dependency and resolved-lockfile review. |
| 2026-07-11 | SUPERSEDED | ABANDONED | PIA-003's `bun audit` found high-severity Electron advisories for versions below 38.8.6 and Electron 38 is end-of-support. ADR-0010 replaces the minimum-compatible 37.6.0 choice with a supported patched line. |
