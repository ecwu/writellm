---
id: ADR-0010
title: Use a supported, patched Electron runtime for Pi
date: 2026-07-11
initiative: PIA
scope: initiative
project_prd: ../project-prd.md
initiative_prd: ../pi-agent-harness-prd.md
task_tracker: ../task-tracker.md
prd_decisions: [PIA-D-006]
related_tasks: [PIA-003, PIA-016, PIA-017]
depends_on: []
external_task_gates: []
supersedes: [ADR-0006]
superseded_by: null
decision_status: ACCEPTED
implementation_status: IMPLEMENTED
last_updated: 2026-07-11
---

# ADR-0010: Use a supported, patched Electron runtime for Pi

## Context

ADR-0006 selected Electron 37.6.0 solely as the minimum line that embeds a Node version compatible with Pi Agent Core. PIA-002 proved that path, but PIA-003's dependency review found that the current advisory data reports high-severity Electron findings for versions below 38.8.6. Electron 38.8.6 itself is end-of-support, so neither the old runtime nor the lowest advisory-safe patch line is suitable as the application release target.

The current Electron release metadata lists Electron 40.10.5 with Node 24.15.0. Pi Core 0.80.3 requires Node `>=22.19.0`, so this runtime remains compatible while moving to a supported maintenance line.

## Decision

Use exact Electron `40.10.5`, whose official release metadata reports Node `24.15.0`, as the supported Pi runtime. Keep `@earendil-works/pi-agent-core` exact at `0.80.3`; its `>=22.19.0` engine requirement is satisfied by Electron's embedded Node 24.15.0.

Use exact `better-sqlite3` `12.11.1` with this runtime. The prior resolved version, 11.10.0, fails to compile against Electron 40's Node 24 V8 headers. Package metadata for 12.11.1 declares support for Node 20 through 26, is MIT licensed, and has only `bindings` and `prebuild-install` as runtime dependencies. This is a native-binding compatibility update; it does not contain a WriteLLM schema migration or change the application's database ownership/recovery policy, which remains gated by DAT-001.

PIA-017 replaces the local Electron package, regenerates the native `better-sqlite3` binary, reruns the runtime checks, and repeats `bun audit`. PIA-003 may complete its dependency proof only after PIA-017 demonstrates that the direct Electron advisory no longer appears. Existing Pi Core lockfile and import evidence is retained, but it must be revalidated on the new runtime.

## Alternatives considered

| Alternative | Why it was not selected or what must be proven |
| --- | --- |
| Keep Electron 37.6.0 | Rejected: it is below the audited fixed range and is no longer an acceptable release target. |
| Use Electron 38.8.6 | Rejected: it meets the cited advisory threshold but the official release page marks the entire 38.x line end-of-support. |
| Use a newer supported Electron line | Selected: Electron 40.10.5 meets Pi's Node engine constraint and is a maintained line. |

## Consequences and constraints

- Electron and better-sqlite3 are pinned exactly in both `package.json` and `bun.lock`; a later update requires an audit/rebuild/smoke review.
- better-sqlite3 12.11.1 must be rebuilt for Electron 40.10.5 before smoke tests run.
- The Pi coding-agent CLI, default tools, resource loader, extensions, and skills remain prohibited; this decision changes only the runtime floor.
- Pi mode remains default-off under ADR-0007, so the runtime upgrade does not expose agent workflows by itself.
- Non-Electron audit findings, including provider-library paths shared with existing dependencies, remain tracked for SEC/QAL review and cannot be treated as release approval.

## Linked implementation work

| Task | Contribution to this decision |
| --- | --- |
| PIA-017 | Install Electron 40.10.5 and better-sqlite3 12.11.1, rebuild the native binding, run typecheck/build/smoke, and verify the Electron audit finding is gone. |
| PIA-003 | Re-run the Electron main-process Pi Core import after PIA-017 and record the reviewed lockfile/risk result. |
| PIA-016 | Rehearse the default-off agent flag and rollback path on the supported runtime. |

### Completion conditions

- [x] Electron 40.10.5 reports embedded Node 24.15.0 under `ELECTRON_RUN_AS_NODE=1`.
- [x] better-sqlite3 12.11.1 rebuild, typecheck, build, and Electron smoke pass on Electron 40.10.5.
- [x] A repeat `bun audit` no longer reports the direct Electron advisory; its remaining 30 findings (5 high) are assigned to QAL-001 for release-gate triage.
- [x] Pi Core 0.80.3 imports successfully in Electron's main-process Node runtime without adding the coding-agent CLI or a Pi resource loader.

## Status history

| Date | Decision status | Implementation status | Change and evidence |
| --- | --- | --- | --- |
| 2026-07-11 | ACCEPTED | NOT_STARTED | Superseded ADR-0006 after PIA-003's Bun audit found Electron <38.8.6 advisories and Electron 38 end-of-support. Selected Electron 40.10.5 / Node 24.15.0 from official release metadata. |
| 2026-07-11 | ACCEPTED | IN_PROGRESS | PIA-017 claimed the Electron 40.10.5 installation, native rebuild, and repeated runtime/audit verification. |
| 2026-07-11 | ACCEPTED | IN_PROGRESS | Electron 40.10.5 exposed better-sqlite3 11.10.0's removed-V8-API build failure. PIA-017 selected exact better-sqlite3 12.11.1 after confirming its Node 20–26 support; no WriteLLM data migration is part of this runtime task. |
| 2026-07-11 | ACCEPTED | IMPLEMENTED | Electron 40.10.5 / Node 24.15.0, better-sqlite3 12.11.1 rebuild, typecheck, build, Electron smoke, and Electron-main Pi import passed. A repeat audit removed the direct Electron finding; QAL-001 owns the remaining release-risk triage. |
