---
id: ADR-0014
title: Store provider secrets securely and gate outbound data
date: 2026-07-11
initiative: SEC
scope: project
project_prd: ../project-prd.md
initiative_prd: null
task_tracker: ../task-tracker.md
prd_decisions: []
related_tasks: [SEC-003, SEC-004, PIA-004, PIA-007, PIA-012]
depends_on: [ADR-0013]
external_task_gates: []
supersedes: []
superseded_by: null
decision_status: ACCEPTED
implementation_status: IMPLEMENTED
last_updated: 2026-07-11
---

# ADR-0014: Store provider secrets securely and gate outbound data

## Context

Chat, embedding, rerank, vision, and MinerU configuration includes provider credentials and can send author-controlled manuscript/source data outside the local workspace. The previous settings file stored API keys with ordinary configuration, while individual service calls had no shared consent check.

## Decision

Store provider API keys separately in Electron main using `safeStorage` encryption and a file containing only encrypted base64 payloads. Normal settings persist provider metadata, appearance, retrieval settings, and the public outbound-data policy, never a plaintext credential. Existing plaintext values are migrated to the secure store on read and the settings file is rewritten without them; if secure OS storage is unavailable, credential migration or creation fails closed.

External provider processing defaults off. A user must explicitly enable it in Settings; the setting records a consent timestamp. The main process checks this policy before remote chat, embedding, rerank, or MinerU PDF requests. Loopback endpoints are treated as local processing and remain available without remote consent. Public settings expose only `hasApiKey`, never key text.

## Alternatives considered

| Alternative | Why it was not selected |
| --- | --- |
| Plaintext JSON configuration | Credentials can leak through backups, logs, or local-file access. |
| Renderer-managed browser storage | It exposes keys to the renderer/XSS boundary and is not a cross-platform secret store. |
| Treat every provider endpoint as local | Configurable endpoints can be remote; explicit consent must cover their data egress. |
| Allow fallback Linux `basic_text` encryption | It does not provide an OS-backed secret service, so the application fails closed for credentials. |

## Consequences and constraints

- `safeStorage` platform security varies; the unsupported Linux fallback is rejected. The current synchronous API maintains compatibility with the existing synchronous settings API; future async/rotation support may replace it without exposing secrets.
- Secrets are main-process only. Errors, diagnostics, run histories, public settings, and renderer events must not include them.
- Re-entering an API key rotates the encrypted value. Clearing/credential-management UX beyond the existing replacement flow is tracked as a security follow-up before release.
- Each remote operation must identify its data class in an author-visible policy. A Pi adapter inherits this gate and cannot create an exception.
- Node workers that perform generation retrieval receive a non-secret, start-of-run consent snapshot from Electron main. They must enforce that snapshot locally because Electron application storage is not available in a worker thread.

## Linked implementation work

| Task | Contribution to this decision |
| --- | --- |
| SEC-003 | Implement secure storage, migration, public projections, consent, local-only behavior, and verification. |
| SEC-004 | Propagate and enforce a non-secret consent snapshot for retrieval-worker network calls. |
| PIA-004 | Use provider credentials and endpoint preflight only through this policy. |
| PIA-007 | Keep tool/network policy consistent with outbound consent. |
| PIA-012 | Add credential-free and redaction/consent regression coverage. |

### Completion conditions

- [ ] No API key is written to `writellm-settings.json` after save/migration.
- [ ] Secure-store unavailability blocks credential use instead of falling back to plaintext.
- [ ] Remote chat, embedding, rerank, and PDF calls require recorded consent; loopback endpoints remain local-only.
- [ ] Public IPC/settings/diagnostics exclude API-key values.

## Status history

| Date | Decision status | Implementation status | Change and evidence |
| --- | --- | --- |
| 2026-07-11 | ACCEPTED | IN_PROGRESS | SEC-003 selected main-process Electron `safeStorage`, consent-gated external processing, and fail-closed unsupported secret storage. |
| 2026-07-11 | ACCEPTED | IMPLEMENTED | Main-process secure credential store, plaintext-settings migration, public projections, consent UI/state, and remote service gates were implemented. Typecheck and targeted security/lifecycle tests passed; final full-suite smoke evidence is recorded in SEC-003. |
