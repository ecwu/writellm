---
id: ADR-0013
title: Harden Electron renderer and IPC boundaries
date: 2026-07-11
initiative: SEC
scope: project
project_prd: ../project-prd.md
initiative_prd: null
task_tracker: ../task-tracker.md
prd_decisions: []
related_tasks: [SEC-001, SEC-002, SEC-003, PIA-007, PIA-009, PIA-012]
depends_on: []
external_task_gates: []
supersedes: []
superseded_by: null
decision_status: ACCEPTED
implementation_status: IMPLEMENTED
last_updated: 2026-07-11
---

# ADR-0013: Harden Electron renderer and IPC boundaries

## Context

WriteLLM's renderer presents locally authored Markdown, imported source text, model output, and data derived from configurable endpoints. These inputs must be considered untrusted even though the desktop app is local-first. A renderer compromise must not become access to the SQLite workspace, workspace filesystem, Git history, provider credentials, Electron APIs, or the future Pi runtime.

The current baseline already enables `contextIsolation` and disables `nodeIntegration`, and its preload exposes named methods rather than a generic IPC send function. It does not yet establish a single trusted-renderer policy for navigation, window creation, permissions, or IPC senders; all IPC handlers also rely on TypeScript rather than runtime validation. Renderer console forwarding and plaintext provider settings are additional data-disclosure risks.

## Decision

Treat the primary renderer as an untrusted presentation process and retain all authority in Electron main. The application has exactly one trusted renderer origin at runtime: the configured local Vite origin in development or the packaged application's local file origin in production. No remote page, subframe, child window, or navigation target may use WriteLLM's preload capability or invoke privileged IPC.

SEC-002 implements the following project-wide boundary:

1. Every `BrowserWindow` uses `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`, a fixed local preload, and no remote module or `<webview>` capability.
2. The app denies unexpected navigation, new windows, permission requests, and permission checks. No untrusted URL is sent to `shell.openExternal` by this application.
3. Every `ipcMain.handle` entry verifies that its sender is the registered main frame of the current trusted primary window before it reads data or performs a privileged action. Event broadcasts target only that window.
4. The preload exposes only one narrowly named method per declared IPC channel, validates event payload shape before delivering it to the renderer, and never leaks `ipcRenderer` or an Electron event object.
5. Renderer-originated payloads use runtime schemas at the IPC boundary. Main-process code validates IDs, paths, primitives, and constrained records before dispatching to workspace, database, filesystem, provider, or Git services.
6. User-visible error messages are classified and redacted. Raw renderer console messages, provider settings, credentials, prompts, source text, and hidden reasoning are not written to normal diagnostics.

The same policy is a prerequisite for any Pi channel. It does not authorize an agent to access a raw database, filesystem, Git, shell, network, settings, document apply operation, or dynamic extension loader.

## Threat model

| Asset / boundary | Threat | Required control | Verification |
| --- | --- | --- | --- |
| Renderer → main IPC | A malicious page, iframe, or child window invokes a privileged channel. | Trusted-main-frame sender guard on every handle; no generic bridge. | Unit tests reject unregistered, subframe, and wrong-origin sender fixtures. |
| Navigation / window creation | Content causes the app to navigate to or open an attacker-controlled page carrying preload authority. | Trusted-origin navigation allowlist; deny `window.open`; deny permissions. | BrowserWindow policy tests and Electron smoke check. |
| Preload bridge | Renderer obtains generic IPC, Electron objects, callbacks with raw events, or ambient APIs. | Frozen, named methods plus channel/payload validation; event callbacks receive data only. | Preload/API contract typecheck and regression checks. |
| Workspace / filesystem / Git | Path traversal or unvalidated payload reaches privileged storage. | Runtime schemas, canonical workspace-relative path checks, and main-only services. | Invalid payload and path traversal tests. |
| Provider credentials | Keys are exposed through public settings, logs, crashes, or plaintext config. | SEC-003 encrypted secret store, public projections, redaction, and rotation. | Settings persistence/redaction tests. |
| Local manuscript/source text | Untrusted source text is treated as tool instruction or logged without bounds. | Main-only allowlisted tools, scoped outputs, injection guidance, trace redaction. | PIA-007/012 policy tests. |
| Run lifecycle | A stale renderer, workspace switch, or shutdown leaves work able to write into a closed/replaced workspace. | REL-001 ownership/cancellation policy, terminalization, and generation guards. | Lifecycle race/closure tests. |
| Third-party dependencies / Electron runtime | Known Electron or dependency defect undermines the boundary. | Supported Electron line, dependency review, CI release gate. | ADR-0010 evidence and QAL-001 release checks. |

## Alternatives considered

| Alternative | Why it was not selected |
| --- | --- |
| Trust all local renderer frames because the app is local-first | Imported Markdown and source material can still exploit renderer bugs; Electron IPC is privileged. |
| Validate only new Pi channels | Existing workspace and settings channels have the same privilege boundary. |
| Rely on TypeScript payload types | Renderers and preload messages cross a runtime trust boundary and can bypass compile-time typing. |
| Expose a generic `invoke`/`on` bridge | It permits arbitrary channel access and/or Electron event leakage. |
| Allow a remote renderer for configurable providers | Provider endpoints are data destinations, not application UI origins. |

## Consequences and constraints

- `file://` remains limited to the app's packaged local renderer during the current build architecture; it is never a general navigation allowance. Any future custom protocol or remote renderer requires an ADR update and explicit origin policy.
- Dev origin is derived from `VITE_DEV_SERVER_URL`; it is accepted only for the dev primary window, not as a general host pattern.
- Sender validation may make direct handler unit tests fail unless they use a trusted-window fixture. Tests must exercise the guard rather than bypass it.
- Runtime validation is intentionally introduced at the IPC edge; internal main-process types remain useful but cannot substitute for it.
- SEC-003 owns secret storage/outbound consent and must use this main-only boundary.
- PIA events and diagnostics must use the same sender, redaction, and bounded-projection rules.

## Linked implementation work

| Task | Contribution to this decision |
| --- | --- |
| SEC-001 | Establish the threat model, decision, rollout, and test requirements. |
| SEC-002 | Implement the BrowserWindow, navigation, permission, IPC sender, preload, runtime-schema, and diagnostic controls. |
| SEC-003 | Keep secret and outbound-data controls behind the hardened main-process boundary. |
| PIA-007 | Implement the allowlisted tool facade under this policy. |
| PIA-009 | Add Pi IPC only through the hardened contract. |
| PIA-012 | Add no-bypass security and projection regression coverage. |

### Completion conditions

- [ ] BrowserWindow, navigation, window-creation, and permission policies are enforced and tested.
- [ ] Every privileged IPC handler validates a trusted main-frame sender and public inputs at runtime.
- [ ] Preload exposes no generic Electron/IPC capability and event delivery is data-only.
- [ ] Security diagnostics redact content and credentials.
- [ ] SEC-003 and Pi channels consume the same main-only policy without exceptions.

## Status history

| Date | Decision status | Implementation status | Change and evidence |
| --- | --- | --- | --- |
| 2026-07-11 | ACCEPTED | NOT_STARTED | SEC-001 established the project-wide Electron renderer, IPC, navigation, and capability-boundary policy. SEC-002 owns implementation. |
| 2026-07-11 | ACCEPTED | IMPLEMENTED | SEC-002 implemented hardened BrowserWindow, navigation/window/permission policy, trusted sender guard, runtime ingress validation, sandbox-compatible named preload channels, and trusted event delivery. Unit tests, typecheck, build, and Electron smoke passed. |
