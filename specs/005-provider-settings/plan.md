# Implementation Plan: Pi Agent Provider 设置与密钥状态

**Branch**: `005-provider-settings`

**Date**: 2026-07-12

**Spec**: [spec.md](./spec.md)

**Status**: Accepted

## Summary

提供一套 application-global Pi Agent harness provider/model profile。main 以 userData 原子保存
非敏感 profile、plain-data model descriptor 和脱敏验证结果，以 Electron `safeStorage` 异步
API 保护唯一 API key，并通过五个 named typed preload methods 管理读取、保存、替换、移除
和验证。main 使用 `@earendil-works/pi-ai` 构造 `Models`/custom provider，并用
`@earendil-works/pi-agent-core` 的 agent loop 运行 schema-valid tool call → tool result → final
response probe；普通 completion 成功不再视为 harness 可用。

配置与 secret mutation 使用 opaque revision compare-and-swap；验证结果绑定开始 revision，
因此晚到请求不能覆盖较新设置。当前 spec、plan 和 ADR-004 已接受，可进入任务生成阶段。

## Technical Context

**Language/Version**: TypeScript 7.0.2

**Primary Dependencies**: Electron 43.1.0 (`safeStorage`, IPC), React 19.2.7, Base UI 1.6.0;
`@earendil-works/pi-agent-core` 0.80.6, `@earendil-works/pi-ai` 0.80.6, `typebox` 1.1.38

**Storage**: main-owned `userData/provider-settings.json` and `provider-secret.json`, schema v1,
atomic temp-write/rename, secret file contains safeStorage ciphertext only

**Testing**: Bun test; compiled Electron smoke; compiled UI runtime harness; injected fake protector,
Pi Models/provider transport, filesystem, clock and ids

**Target Platform**: sandboxed Electron desktop on supported macOS/Windows/Linux; platform secret
protection must be available or secret mutation fails closed

**Project Type**: Electron main/preload/React renderer

**Performance Goals**: local summary read and form feedback feel immediate; local save/replace/remove
completing within 1 s excluding OS credential UI is a non-blocking experience target rather than an
implementation acceptance gate; harness validation hard timeout 30 s and maximum two provider turns
(tool call + final response)

**Constraints**: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; renderer has no
Node/Electron/network/file access; remote HTTPS only, loopback HTTP exception; no secret/raw provider
data in UI, logs, project, Git or export

**Scale/Scope**: one local author, one current `openai-completions` custom provider profile, one model,
one secret, one validation in flight per revision; no accounts, sync, provider catalog or AI writing task

There are no remaining `NEEDS CLARIFICATION` entries. Research decisions are recorded in
[research.md](./research.md); acceptance remains a governance gate, not a technical unknown.

## Constitution Check (pre-research)

| Principle | Result | Evidence / gate |
|---|---|---|
| I. Secure Desktop Boundary | PASS | Secret/storage/network remain in main; renderer gets bounded redacted DTOs. No plaintext fallback. |
| II. Typed, Minimal IPC | PASS | [IPC v1](./contracts/contract.md) defines exactly five provider methods in an isolated namespace, exact parsers and sender validation. |
| III. Specification-Driven, Minimal Evolution | PASS | Pi runtime 是后续 harness 的实际 consumer contract；005 不再维护一套平行 transport。`spec.md`、本文和 ADR-004 已接受。 |
| IV. Verification at the Failure Boundary | PASS IN DESIGN | [quickstart.md](./quickstart.md) requires injected failure tests plus compiled Electron IPC/storage/runtime evidence. |

**Gate result**: spec、plan 和 ADR-004 已接受；可生成 implementation tasks。没有 Constitution exception。

## Project Structure

### Design artifacts

```text
specs/005-provider-settings/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── contract.md
└── checklists/
    ├── requirements.md
    └── plan-decisions.md
```

### Planned source layout

```text
src/
├── shared/
│   └── provider-settings.ts       # channels, DTOs, exact parsers, domain transitions
├── main/
│   └── provider-settings/
│       ├── handlers.ts            # sender validation + five IPC handlers
│       ├── repository.ts          # paired durable documents, CAS, reconciliation
│       ├── secret-protector.ts    # async safeStorage adapter
│       ├── validator.ts           # Pi agent-loop probe, timeout, redaction
│       └── pi-provider.ts         # profile -> Models/provider/model/auth adapter
├── preload/
│   └── preload.cts                # writellmProviderSettings named bridge
└── renderer/
    └── features/provider-settings/
        ├── ProviderSettingsPanel.tsx
        ├── provider-settings-state.ts
        └── provider-settings.css

test/
├── unit/provider-settings/        # parsers, state, repository, redaction
├── integration/provider-settings/ # handlers, CAS, fake protector/transport
├── runtime/provider-settings/     # compiled Electron IPC/storage/restart
└── runtime/ui-foundation/         # dialog/focus/zoom/theme behavior
```

**Structure decision**: feature-local main and renderer modules preserve the existing Electron layout.
Shared contains only serializable contract/domain types. UI composes accepted 011 primitives/patterns;
it does not add provider policy to shared UI.

## Phase 0: Research

[research.md](./research.md) resolves:

1. Electron async safeStorage rather than keytar/platform-specific adapters;
2. two app userData documents rather than project, renderer or generic settings storage;
3. Pi `Models` + custom `openai-completions` provider/model adapter rather than a parallel transport;
4. repository-style exact runtime parsers rather than a new validation dependency;
5. revision CAS, mutation serialization and late-validation suppression.

## Phase 1: Design and contracts

- [data-model.md](./data-model.md) freezes schema v1, read models, invariants, status transitions,
  diagnostic codes and crash-reconciliation behavior.
- [contracts/contract.md](./contracts/contract.md) freezes the five-method IPC surface, channel names,
  exact inputs/results/errors, ordering, retry, cancellation and redaction.
- [quickstart.md](./quickstart.md) defines runnable fake-provider, secure-storage, atomicity, concurrency,
  restart, project-isolation and accessibility acceptance scenarios.
- [ADR-004](../../docs/adr/004-provider-settings-security.md) records the new durable/secret/network
  boundary. ADR-001 is not required because no project content or Git history is modified; ADR-003 is
  already Accepted and governs renderer composition.

## Boundary and implementation design

### Save and secret replacement

Renderer keeps a draft separate from `ProviderSummary`. Main strict-validates URL/model/context window/
max output/reasoning/secret and expected revision, then deterministically builds the versioned Pi model
descriptor. It encrypts the new secret before publishing a paired revision, prepares temp files,
and reports success only after the current pair reconciles. Existing committed state remains authoritative
on failure. Secret input is cleared after successful submit and whenever the panel closes/cancels.

Changing only non-sensitive config may explicitly reuse a decryptable saved secret. Initial save cannot.
Every successful config/secret mutation creates a revision and stales prior validation. Removing secret
requires the controlled 011 Dialog and leaves config visible but unavailable.

### Provider validation

Renderer first shows a token-usage consent message. On confirmation it sends only expected revision;
main loads/decrypts the saved secret and never asks renderer to resend it. The adapter creates an isolated
Pi `Models` collection, registers the application-owned provider/profile and runs an agent loop with one
TypeBox tool whose arguments contain a nonce. Validation succeeds only when the model emits the named tool
with schema-valid matching arguments, receives the matching tool result, and then emits a final non-tool
assistant response. The probe is capped at two provider turns and 30 seconds; transcript/generated text is
discarded and never crosses IPC or durable state.

Main maps auth/model/rate/service/network/timeout/malformed/canceled/unknown plus tool-unsupported,
tool-arguments-invalid, tool-result-unusable and loop-incomplete outcomes into stable safe codes. It
persists only if current revision still equals start revision; otherwise it returns stale. Success persists
across restart and has no age expiry.

### Renderer integration

The panel uses 011 `FormField`, `Input`, `Button`, `StatusNotice`, `Badge` and controlled `Dialog`.
Provider code owns dirty/saved/error/consent state. Password input has an accessible name and appropriate
autocomplete policy but no reveal/persist behavior. Errors are linked to fields, status is announced
without duplicate chatter, and remove/validation dialogs return focus. Layout remains usable at 960×640
and 200% text zoom in all accepted appearance modes.

## Verification strategy

- Pure domain tests: exact parsing, URL/loopback/model-capacity rules, deterministic Pi descriptor mapping,
  transitions, error classification, redaction and availability derivation.
- Repository tests: corrupt/unknown/missing documents, atomic failure at every step, CAS, revision-pair
  recovery and preservation of old state.
- Handler/contract tests: expected sender, unknown fields, five exact methods/channels, no secret echo,
  Pi tool-loop outcome mapping, validation serialization and late-result suppression.
- Compiled Electron: real preload/main bridge, Pi packages in the packaged main bundle, safeStorage
  success/unavailable/decrypt paths, restart, close-during-validation, sandbox flags and project isolation.
- Compiled UI runtime: keyboard, dialog focus/return, 200% zoom, theme/forced-colors/reduced-motion and
  non-color status semantics.

## Constitution Check (post-design)

| Principle | Result | Phase 1 evidence |
|---|---|---|
| I. Secure Desktop Boundary | PASS | ADR-004 + data model keep secret, files and transport in main; async safeStorage has no plaintext fallback; redirects/raw provider output are bounded. |
| II. Typed, Minimal IPC | PASS | Contract v1 has exactly five purpose-specific methods, exact shared DTOs/parsers and sender validation; validation input carries revision only. |
| III. Specification-Driven, Minimal Evolution | PASS | 仅引入后续 feature 共用的 Pi harness/runtime；未增加第二套 SDK/database/provider framework。Spec、plan 和 ADR-004 已接受。 |
| IV. Verification at the Failure Boundary | PASS IN DESIGN | Quickstart covers protector, filesystem, provider and concurrency faults and requires compiled Electron/UI checks where unit tests cannot prove behavior. |

**Post-design gate**: no design violations or unresolved technical decisions. Spec、plan、ADR-004 与
registry 已同步接受；生成并审查 `tasks.md` 后即可进入实现。

## Complexity Tracking

No Constitution exception. Adding Pi Agent/AI/TypeBox is required to validate the same provider/model/tool
contract consumed by later AI features; a handwritten completion probe would create a false compatibility
signal and a second transport stack. Two userData documents are the minimum needed to ensure the non-secret
summary can be read without decrypting or exposing secret material; their revision-pair reconciliation
is justified by fail-closed replacement. No native module, database, generic settings API, extra process or
renderer capability is added.
