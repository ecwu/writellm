---
id: ADR-0020
title: Limit provider secrets to the privileged backend
date: 2026-07-11
initiative: SEC
scope: project
project_prd: ../project-prd.md
initiative_prd: ../pi-agent-harness-prd.md
task_tracker: ../task-tracker.md
prd_decisions: []
related_tasks: [SEC-003, SEC-004, PIA-004, PIA-007, PIA-012]
depends_on: [ADR-0013, ADR-0014, ADR-0016]
external_task_gates: []
supersedes: [ADR-0014]
superseded_by: null
decision_status: ACCEPTED
implementation_status: IN_PROGRESS
last_updated: 2026-07-11
---

# ADR-0020: Limit provider secrets to the privileged backend

## Context

ADR-0014 established encrypted-at-rest provider credentials, explicit outbound-data consent, fail-closed storage, and renderer-safe public settings. It also stated that secrets are “main-process only.” The first clean Pi `source` implementation kept retrieval in Electron main, satisfying that literal boundary but allowing sqlite-vec/FTS work to block all main-process IPC.

ADR-0019 corrects the responsiveness failure by moving the complete source operation, including embedding and optional reranking, to a dedicated Node Worker. Those provider calls require credentials. Keeping the literal ADR-0014 runtime boundary would require splitting one source operation across main and Worker or inventing a credential-proxy protocol, increasing cancellation, timeout, and data-copy complexity without reducing renderer exposure. Passing settings to workers was also already an implicit behavior of the legacy retrieval worker, but the durable security rule did not describe it honestly.

The security boundary must therefore be expressed as the privileged backend, not as one JavaScript event loop.

## Decision

Retain all ADR-0014 storage and consent behavior, but replace its runtime-secret boundary:

- Provider credentials are encrypted at rest through Electron `safeStorage`; ordinary settings and workspace data never persist plaintext keys.
- Electron main is the sole component allowed to decrypt or select credentials and evaluate outbound-data policy.
- Main may pass a minimum-necessary, start-of-operation provider snapshot to a statically defined, main-owned Worker that must execute the authorized provider operation. The snapshot may contain endpoint, model identifier, and credential together with a non-secret consent decision.
- Such a Worker is part of the privileged backend trust zone, not a renderer capability. It has no preload/IPC surface, dynamic module or tool loading, Pi authority, shell access, arbitrary path input, or permission to persist/log credentials.
- A Worker receives credentials only for its bounded operation and is terminated on completion, cancellation, deadline, error, or abnormal exit. Credential values must not return in Worker messages, tool results, diagnostics, events, or exceptions.
- Renderer/public settings continue to expose only capability state such as `hasApiKey`. No renderer code, DOM state, browser storage, generated content, or model-visible tool result receives a key.

## Alternatives considered

| Alternative | Why it was not selected |
| --- | --- |
| Keep all provider calls in Electron main and move only SQLite to a Worker | Possible, but splits one cancelable source operation across two owners and duplicates intermediate embeddings/candidates across the boundary. It may be reconsidered if Worker credential isolation cannot meet release tests. |
| Proxy every Worker provider request through main | Rejected for the current implementation: it creates a custom streaming/auth protocol and makes main a data relay without preventing secrets from existing in privileged backend memory. |
| Let Workers read `safeStorage` directly | Rejected: Electron application storage is unavailable there and credential selection/consent authority must remain in main. |
| Allow credentials in renderer or ordinary settings | Rejected; it violates the established untrusted-renderer and encrypted-at-rest boundaries. |

## Consequences and constraints

- “Backend-only” is broader than ADR-0014's literal “main-process-only” wording but remains strictly narrower than renderer or plugin access.
- Worker construction sites become security-sensitive and must use fixed local modules, bounded structured-clone payloads, redacted errors, and hard lifecycle termination.
- A future shared Worker pool must not retain credentials or provider state between unrelated runs unless a new ADR defines isolation and rotation.
- Crash dumps and process-memory inspection remain platform risks; no application-level design can claim credentials never exist in memory during an authorized request.
- ADR-0019's Source Worker is the first consumer of this boundary. Other workers require an explicit task/ADR mapping rather than treating this as ambient permission.

## Linked implementation work

| Task | Contribution to this decision |
| --- | --- |
| SEC-003 | Retain safeStorage, migration, public projections, rotation, and fail-closed behavior. |
| SEC-004 | Retain and enforce the non-secret consent snapshot in retrieval workers. |
| PIA-004 | Keep chat-provider credentials inside main-owned Pi model execution. |
| PIA-007 | Pass only the bounded embedding/rerank snapshot to the disposable Source Worker. |
| PIA-012 | Prove credential redaction, Worker lifecycle, cancellation, and no-renderer/no-log disclosure. |

### Completion conditions

- [x] Plaintext keys remain absent from ordinary settings and renderer/public IPC.
- [x] Only main selects/decrypts credentials; the Source Worker receives a bounded operation snapshot and has no renderer or Pi authority.
- [x] Source Worker messages and typed failures exclude provider credential values.
- [ ] Deterministic tests inject sentinel credentials and prove they never appear in Worker results, errors, events, logs, or renderer projections.
- [ ] Packaged Electron verification covers safeStorage availability plus Worker completion/cancellation without plaintext persistence.

## Status history

| Date | Decision status | Implementation status | Change and evidence |
| --- | --- | --- | --- |
| 2026-07-11 | ACCEPTED | IN_PROGRESS | Superseded ADR-0014's literal main-event-loop secret boundary after ADR-0019 isolated Pi retrieval. SafeStorage, consent, fail-closed storage, and renderer redaction remain binding; only statically defined main-owned Workers may receive minimum-necessary ephemeral provider snapshots. Implementation exists for Source Worker, while sentinel-redaction and packaged lifecycle evidence remain PIA-012/release work. |
