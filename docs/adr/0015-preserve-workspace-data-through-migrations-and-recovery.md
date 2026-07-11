---
id: ADR-0015
title: Preserve workspace data through migrations and recovery
date: 2026-07-11
initiative: DAT
scope: project
project_prd: ../project-prd.md
initiative_prd: null
task_tracker: ../task-tracker.md
prd_decisions: []
related_tasks: [DAT-001, DAT-002, PIA-005, PIA-016]
depends_on: []
external_task_gates: []
supersedes: []
superseded_by: null
decision_status: ACCEPTED
implementation_status: NOT_STARTED
last_updated: 2026-07-11
---

# ADR-0015: Preserve workspace data through migrations and recovery

## Context

A `.writellm` workspace contains SQLite metadata, canonical section Markdown files, a workspace Git repository, assets, background job records, and generation/review history. Current schema initialization can add and remove columns/tables directly, while generation cutover needs new Pi tables without losing readable legacy history. A failed migration, interrupted job, corrupted database, or disagreement between SQLite and a Markdown section needs predictable recovery behavior.

## Decision

Before any destructive schema operation, create a timestamped, integrity-checked workspace snapshot containing `project.sqlite`, SQLite WAL/SHM files when present, the workspace manifest, section Markdown, and Git state metadata. Record migration version and outcome durably; migration must be idempotent, transactional where SQLite supports it, and leave a failed workspace unopened rather than silently rebuilding it.

Canonical content is section Markdown plus its stored hash after a successful atomic section write. SQLite is authoritative for structure, section metadata, review records, source/index metadata, and job/audit records. On open, mismatched Markdown/hash is reported as a recoverable integrity state: do not silently overwrite either side. The recovery UI/workflow must offer restore from snapshot, restore a Git checkpoint, or explicit author-confirmed reconciliation; it must not invent a merge.

Interrupted ingest and agent work is not resumed automatically. Its durable job/run record becomes terminal with a typed recovery reason; the author can retry only through the normal bounded workflow. Legacy generation tables stay read-only through the Pi migration/archive period and cannot be dropped until a fixture proves historical session, round, patch, and citation history survives the approved archive path.

## Alternatives considered

| Alternative | Why it was not selected |
| --- | --- |
| Drop/recreate database on migration failure | It loses author work and historical evidence. |
| Treat SQLite as canonical section text | The workspace's Git-backed Markdown is the portable author artifact. |
| Automatically merge DB and Markdown | It can silently fabricate or discard author content. |
| Resume in-flight agent/ingest work after restart | Credentials, provider state, and source/workspace state may have changed; terminalize and retry instead. |

## Consequences and constraints

- DAT-002 owns snapshot execution, integrity checks, recovery UI, and fixtures; this ADR does not authorize destructive migrations now.
- Existing direct schema cleanup that could affect historical records must be reviewed and guarded by DAT-002 before further destructive use.
- PIA-005 adds distinct agent records; it must preserve legacy records and write no unredacted provider/prompt data.
- PIA-016 cannot delete active legacy data/schema until backup, migration, read-only archive, and rollback fixtures pass.

## Linked implementation work

| Task | Contribution to this decision |
| --- | --- |
| DAT-001 | Establish canonical-source, backup, migration, corruption, interruption, and reconciliation policy. |
| DAT-002 | Implement and verify snapshots, integrity/recovery flow, and fixtures. |
| PIA-005 | Apply the policy to agent tables and legacy history. |
| PIA-016 | Apply the archive/removal gate at one-way cutover. |

## DAT-002 validation fixture plan

| Fixture | Setup | Required assertion |
| --- | --- | --- |
| Pre-migration snapshot | Workspace with sections, assets, Git history, pending review patch, legacy generation history, and SQLite WAL. | Snapshot restores an integrity-checked, readable workspace without dropping history. |
| Migration interruption | Inject failure after snapshot and before/within a schema transaction. | Open reports recoverable migration failure and offers snapshot restore; it never recreates an empty database. |
| SQLite corruption | Corrupt a copy of `project.sqlite` while Markdown/Git remain intact. | Integrity check fails clearly and recovery preserves the originals for author-selected restore/reconciliation. |
| Markdown/hash mismatch | Change a section Markdown file independently of SQLite metadata. | Open flags the mismatch and does not overwrite either value without author confirmation. |
| Interrupted job/run | Persist active ingest and future Pi run records, then simulate switch/restart. | Records terminalize with recovery reason; retry begins a new bounded operation. |
| Legacy-to-Pi archive | Seed legacy sessions, rounds, patches, citations, and `llmOperations`. | New Pi records are separate and legacy history stays read-only/listable after migration/cutover. |

### Completion conditions

- [ ] DAT-002 has snapshot, migration-failure, corruption, and Markdown/SQLite mismatch fixtures.
- [ ] No destructive migration runs without a verified recovery snapshot.
- [ ] Legacy generation history is proven readable through Pi migration/archive.
- [ ] Interrupted work terminalizes with inspectable recovery state.

## Status history

| Date | Decision status | Implementation status | Change and evidence |
| --- | --- | --- |
| 2026-07-11 | ACCEPTED | NOT_STARTED | DAT-001 established backup, canonical-source, migration, corruption, interruption, and reconciliation policy. DAT-002 owns implementation. |
