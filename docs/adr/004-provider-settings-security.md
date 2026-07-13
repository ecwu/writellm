# ADR-004: Application-global provider settings, protected secret and validation boundary

- Status: Accepted
- Date: 2026-07-12
- Owners: WriteLLM v2 maintainers
- Scope: `005-provider-settings` durable application settings, secret protection, provider validation and IPC

## Context

005 lets a local author configure one Pi `openai-completions` harness profile and API key, then run a
minimal agent tool loop to determine whether that saved configuration works. The key must not enter
project files, Git, exports, renderer read models or logs. Configuration and validation survive restart,
while provider/network behavior crosses an untrusted external boundary.

This is a durable and security boundary not governed by ADR-001: it is application-global and never
modifies `.writellm` content/history. ADR-003 remains authoritative for renderer primitives and appearance.

## Decision

1. Main atomically owns schema-v1 `provider-settings.json` and `provider-secret.json` under Electron
   userData. The former stores non-secret config/revision/redacted completed validation; the latter stores
   only async `safeStorage` ciphertext bound to the same revision.
2. Secret protection uses Electron 43 async safeStorage after app ready. There is no plaintext fallback,
   keytar dependency or platform-specific credential adapter. Unavailable, decrypt, permission, write or
   replace failure is fail closed and cannot report success.
3. Configuration/secret mutations use opaque revision compare-and-swap and main-side serialization.
   Startup accepts only a matching settings/secret revision pair. Mutations stale prior validation.
4. A main-owned adapter converts the saved versioned profile into Pi `Models`, a custom
   `openai-completions` provider and a plain-data `Model`. Validation uses the same
   `@earendil-works/pi-ai` / `@earendil-works/pi-agent-core` stream and agent-loop path as later AI
   features, not a parallel handwritten HTTP probe.
5. Validation runs a bounded TypeBox-schema tool loop: matching valid tool call, matching tool result and
   final assistant response within two provider turns and 30 seconds. Text-only completion, standalone
   JSON, `/models` and reachability do not prove harness compatibility. Transcript and generated content
   are discarded.
6. Remote base URLs require HTTPS; HTTP is limited to localhost, IPv4 loopback and IPv6 loopback. URLs
   with credentials/query/fragment are rejected. The adapter never forwards Authorization across redirect.
7. Preload exposes an isolated five-method typed namespace: get, save, replace secret, remove secret and
   validate. Main validates expected sender and exact unknown input. Renderer can write a secret once but
   cannot read it; validation input carries only current revision.
8. External status/body/header/platform/Pi exceptions are mapped to app-owned stable diagnostic/error codes.
   Raw request/response/generated content and secret-derived hints do not cross IPC or enter durable state.

The exact schemas, DTOs, transitions and tests are defined by the implementation and its tests within this
ADR's security boundary.

## Consequences

- 005 adds pinned Pi Agent/AI and TypeBox runtime dependencies so compatibility is proven through the
  actual consumer contract; Electron/OS protection still owns secrets.
- Linux/desktop environments without usable secret protection cannot save a key; the UI must explain
  recovery and cannot silently weaken storage.
- The v1 compatible protocol is intentionally Chat Completions. Supporting Responses API, custom headers,
  alternate authentication or multiple providers requires a reviewed contract/adapter extension.
- Separate durable files require revision-pair reconciliation and injected crash/failure tests.
- A successful validation proves only that the configured endpoint/key/model completed the defined minimal
  Pi tool loop at the recorded time; it is not an ongoing availability or billing guarantee.

## Alternatives considered

- keytar or three platform credential adapters: rejected for native packaging/maintenance cost.
- project/Git storage or renderer localStorage: rejected for security, portability and ownership.
- Handwritten Electron/OpenAI transport: rejected because it can disagree with Pi's provider, model,
  streaming event, tool schema and tool-result behavior.
- `/models`, reachability, text completion or JSON-only validation: rejected because they do not prove the
  harness tool loop required by later AI features.
- generic settings IPC/database: rejected because one config does not justify a broad durable boundary.

## Acceptance checklist before implementation

- [x] Maintainer accepts async safeStorage with fail-closed unavailable behavior and no plaintext fallback.
- [x] Maintainer accepts the two-document schema/revision reconciliation and application-global owner.
- [x] Maintainer accepts the bounded Pi agent tool-loop validation protocol, timeout and redaction policy.
- [x] The five-method IPC contract, stable errors and compiled Electron failure fixtures are frozen.
