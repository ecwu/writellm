---
title: WriteLLM Desktop Threat Model
owner: Security and Engineering
status: Active
related_adr: ADR-0013
related_tasks: [SEC-001, SEC-002, SEC-003, REL-001]
last_updated: 2026-07-11
---

# WriteLLM desktop threat model

This operational threat model supports [ADR-0013](adr/0013-harden-electron-renderer-and-ipc-boundaries.md). It governs the existing application as well as Pi agent work; it is not a security guarantee for arbitrary user-provided model endpoints.

## Trust zones

```text
Author / local workspace / OS secret store
          │ typed, user-initiated requests
          ▼
Renderer (untrusted presentation)
          │ named preload methods only
          ▼
Electron main (authority boundary)
  ├─ workspace SQLite / Markdown / Git
  ├─ secure provider credentials
  ├─ bounded retrieval and future AgentManager
  └─ outbound provider adapters (only with policy/consent)
```

The renderer is untrusted because it renders user-controlled Markdown, imported sources, model output, and configurable remote-provider responses. It has no Node, filesystem, database, provider credential, Git, shell, agent, or arbitrary IPC authority.

## Security requirements and implementation order

1. SEC-002: harden the renderer, navigation, permissions, IPC sender validation, payload validation, and diagnostic redaction.
2. SEC-003: move credentials out of plaintext settings, classify outbound requests, and make consent/rotation/local-only state explicit.
3. REL-001: make active work belong to a workspace generation and make cancellation/closure terminal.
4. PIA tasks: add only bounded tools and redacted event projections through the resulting controls.

## Rejected capabilities

The MVP must not expose shell access, arbitrary filesystem paths, arbitrary Git, arbitrary network, dynamic Pi extensions, raw database objects, direct document mutation, `ipcRenderer`, Electron events, or a generic preload invocation function.

## Rollout and rollback

Hardening is enabled for every primary window; there is no security flag that restores unsafe IPC or renderer privileges. A regression blocks the affected release while a narrow compatibility fix is developed. Provider calls can be disabled through SEC-003 policy; generation can later be disabled through ADR-0012's main-process kill switch, neither of which restores the legacy generator.

## Test matrix

| Control | Test evidence |
| --- | --- |
| Trusted renderer | Sender guard rejects non-primary, subframe, and wrong-origin IPC. |
| Navigation / popups / permissions | Electron tests demonstrate blocked unknown URLs, child windows, and permission requests. |
| IPC runtime validation | Invalid IDs, payload shapes, and asset paths fail before privileged services run. |
| Preload | API has named methods only; listeners receive data-only payloads. |
| Redaction | API keys and source/prompt text do not reach public settings or normal diagnostic output. |
| Lifecycle | Workspace switch/shutdown cancels active work before database close. |
