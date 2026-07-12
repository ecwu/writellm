# Quickstart: Provider Settings validation

This guide defines implementation acceptance scenarios. The feature spec, plan and ADR-004 are accepted;
implementation remains gated on generation and review of `tasks.md`.

## Prerequisites

- Bun 1.3.14 and repository dependencies installed.
- A compiled Electron 43 app with the existing sandbox baseline intact.
- Test-only injected `SecretProtector`, atomic file adapter, clock/id source and `ProviderTransport`.
- Pi-compatible faux/custom provider fixtures plus a local HTTP fixture bound to `127.0.0.1`; no real
  provider or paid token usage is required for automated acceptance.

## Commands

```sh
bun run typecheck
bun run test
bun run test:smoke
bun run test:ui-runtime
```

## Scenario 1: initial save and restart

1. Start with isolated empty Electron `userData` and a project containing a unique sentinel file.
2. Open provider settings without changing the active project.
3. Enter `http://127.0.0.1:<fixture>/v1`, model `fixture-model`, and sentinel secret; save.
4. Expect saved summary, cleared password input, `configured`, and no secret text/hint in DOM or IPC.
5. Restart and expect the same non-secret config/revision and configured status.
6. Assert project tree and sentinel file are byte-identical; provider files exist only under userData.

## Scenario 2: validation success and persistence

1. Trigger Validate and confirm the UI warns about a minimal request/token usage before dispatch.
2. Fixture asserts the saved Pi model descriptor, auth, TypeBox tool schema and bounded stream options.
3. Emit the required tool call with matching schema-valid nonce; accept the matching tool result; emit a
   final assistant response. Expect succeeded + completion time for current revision.
4. Assert tool arguments, result, transcript and final response content are absent from IPC, DOM and durable files.
5. Restart and expect succeeded/time restored; advance clock and confirm it does not become stale.

## Scenario 3: safe failures

Run table fixtures and assert every result uses app-owned text and remains non-success:

| Fixture | Expected |
|---|---|
| 401/403 with sentinel in body/header | auth rejected, redacted |
| 404/422 | model/endpoint rejected, redacted |
| 429 | rate limited, retry path |
| connection refused | unreachable |
| exceeds 30 seconds | timeout |
| malformed stream/event payload | invalid response |
| transport throws raw URL/secret | unknown/internal, redacted |
| text-only response without required tool call | tools unsupported |
| tool call arguments fail TypeBox schema | tool arguments invalid |
| provider rejects or cannot correlate tool result | tool result unusable |
| repeated tool call or no final response after result | loop incomplete |

Search DOM, IPC capture, provider/settings JSON, project tree, export fixture and logs for the sentinel;
all must have zero matches.

## Scenario 4: secure storage failure and atomicity

Inject unavailable/temporarily unavailable protector, encryption failure, permission failure, first/second
rename failure, decrypt failure and crash-recovery revision mismatch. For each:

- operation does not report saved/removed/succeeded;
- no plaintext fallback file is created;
- old committed config/secret pair remains usable or state explicitly becomes unavailable/invalid;
- no mismatched revision secret is sent to provider;
- retry/replacement action is reachable.

## Scenario 5: concurrency and stale validation

1. Hold validation A, then save a model change producing revision B.
2. Complete A. Expect stale and no overwrite of B.
3. Rapidly submit two saves with the same expected revision. Exactly one may commit; the other conflicts.
4. Repeat for replace/remove secret. Old credentials must never become current after the winning mutation.

## Scenario 6: form and accessibility matrix

At 960×640 and 200% text zoom, test keyboard-only traversal, errors, save, replace, remove confirmation,
validation consent, retry and focus return in System/Light/Dark, forced colors and reduced motion. Every
status has text/icon semantics, not color alone; secret input never repopulates after close/cancel.

## Expected completion evidence

### Automated fixture constraints and final run (2026-07-13)

- Provider network scenarios use injected/faux Pi transports and loopback fixtures; automated acceptance never calls a paid or remote provider.
- Secret-storage failure cases use the injectable asynchronous protector, while the compiled Electron gates verify startup with the platform `safeStorage` adapter.
- UI runtime assertions combine DOM/source contract gates with the compiled sandboxed Electron harness at 960×640-equivalent responsive rules; forced-colors and reduced-motion rules are asserted directly.
- Final gate passed: `bun run typecheck`, `bun run test` (147 tests), `bun run build`, `bun run test:smoke`, and `bun run test:ui-runtime`.

- Domain/unit: URL/model/capacity/secret strict parsing, deterministic Pi profile mapping, revision transitions, classification and redaction.
- Contract: exact five-method preload surface, sender/input validation, DTO exactness and CAS errors.
- Compiled Electron: packaged Pi runtime, safeStorage adapter behavior, persistence/restart, real IPC,
  tool-loop probe, close-during-validation, project isolation and sandbox settings.
- Runtime UI: focus/dialog/zoom/theme/reduced-motion scenarios above.
