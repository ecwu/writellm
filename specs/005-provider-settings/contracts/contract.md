# Contract: Provider Settings IPC v1

## Boundary

preload 新增独立 `window.writellmProviderSettings` namespace。它只暴露以下五个 named,
typed methods；不扩展 `window.writellm` project bridge，不提供 generic settings/IPC、路径、
文件、network、Electron 或 secret read API。

```ts
type ProviderSettingsIpc = {
  getProviderSummary(): Promise<GetProviderSummaryResult>
  saveProviderSettings(input: SaveProviderSettingsInput): Promise<ProviderMutationResult>
  replaceProviderSecret(input: ReplaceProviderSecretInput): Promise<ProviderMutationResult>
  removeProviderSecret(input: RemoveProviderSecretInput): Promise<ProviderMutationResult>
  validateProvider(input: ValidateProviderInput): Promise<ValidateProviderResult>
}
```

所有 handler 首先校验 expected sender，再 strict parse unknown input。provider settings 是
application-global；handler 不接受 project id/path，也不要求 active project。unauthorized
sender 获得通用 error，main 不执行 storage、decrypt 或 network side effect。

## Channels

| Method | Channel | Request |
|---|---|---|
| get | `writellm:provider-settings:get` | none |
| initial/config save | `writellm:provider-settings:save` | config + secret + expectedRevision |
| secret replace | `writellm:provider-settings:replace-secret` | secret + expectedRevision |
| secret remove | `writellm:provider-settings:remove-secret` | expectedRevision |
| validate | `writellm:provider-settings:validate` | expectedRevision |

## Inputs

```ts
type ProviderConfigInput = {
  providerKind: 'openai-compatible'
  baseUrl: string
  modelId: string
  contextWindow: number
  maxOutputTokens: number
  reasoning: boolean
}

type SaveProviderSettingsInput = {
  expectedRevision: string | null // null only when no saved document exists
  config: ProviderConfigInput
} & (
  | { secret: string; reuseSavedSecret?: never }
  | { secret?: never; reuseSavedSecret: true }
)
type ReplaceProviderSecretInput = { expectedRevision: string; secret: string }
type RemoveProviderSecretInput = { expectedRevision: string }
type ValidateProviderInput = { expectedRevision: string }
```

`secret` is 1–4096 after rejecting all-whitespace, NUL and control characters; main does not trim or
normalize a valid key. Config uses the constraints in data-model.md. Renderer cannot submit provider id,
API id, model name, input modalities, cost, headers or Pi compatibility flags; main derives the versioned
harness profile. Exact-key parsing rejects unknown fields, forged status/revision and oversized values
before any side effect. `reuseSavedSecret` is only valid for an existing revision whose current secret is
configured and decryptable; initial save must use the `secret` branch.

## Results

```ts
type GetProviderSummaryResult =
  | { status: 'ok'; summary: ProviderSummary }
  | { status: 'error'; error: ProviderError }

type ProviderMutationResult =
  | { status: 'saved'; summary: ProviderSummary }
  | { status: 'removed'; summary: ProviderSummary }
  | { status: 'error'; error: ProviderError; currentSummary?: ProviderSummary }

type ValidateProviderResult =
  | { status: 'completed'; summary: ProviderSummary }
  | { status: 'stale'; summary: ProviderSummary }
  | { status: 'error'; error: ProviderError; currentSummary?: ProviderSummary }
```

No result contains API key, ciphertext, secret length/prefix/suffix, Authorization header, request
body, generated text, probe transcript/tool arguments/tool result, raw provider body, stack, absolute path
or platform exception. UI derives availability only when config is complete, a supported harness profile
can be derived, secretState is `configured`, and Pi tool-loop validation status is `succeeded` for the same revision.

## Stable errors

| Code | Meaning / recovery |
|---|---|
| `PROVIDER_INVALID_INPUT` | field-specific safe issues; correct form |
| `PROVIDER_INSECURE_ENDPOINT` | use HTTPS or a literal/hostname loopback HTTP URL |
| `PROVIDER_CONFLICT` | state changed; reload summary and review before retry |
| `PROVIDER_SECRET_REQUIRED` | enter or preserve a configured secret |
| `PROVIDER_SECRET_STORAGE_UNAVAILABLE` | platform protection unavailable; retry after unlocking/configuring OS secret service |
| `PROVIDER_SECRET_INVALID` | durable secret cannot be decrypted; replace/remove it |
| `PROVIDER_STORAGE_UNAVAILABLE` | settings could not be durably saved; old state remains current |
| `PROVIDER_NOT_READY` | complete config/secret before validation |
| `PROVIDER_VALIDATION_IN_PROGRESS` | one validation already owns current revision |
| `PROVIDER_UNAUTHORIZED_SENDER` | rejected IPC caller; no recovery in renderer |
| `PROVIDER_INTERNAL` | safe unknown failure; retry/restart without diagnostics |

`PROVIDER_INVALID_INPUT` may include `{ field: 'baseUrl'|'model'|'secret', issue: enum }`; it never
echoes the rejected value. Provider validation failures are domain results in `summary.validation`, not
IPC exceptions. Promise rejection is reserved for process loss; normal failures resolve typed unions.

## Ordering, cancellation and retry

- Main serializes mutations and uses `expectedRevision` CAS; duplicate/late submissions conflict.
- Only one validation per revision runs. Renderer disables duplicate action while awaiting it.
- Closing the settings UI does not cancel the main request. The result may persist if revision remains
  current, but no in-progress result is restored after restart.
- App shutdown aborts the request; canceled/timeout/unknown can never become success.
- Validation uses a 30-second AbortController timeout and at most two provider turns. Retry creates a new attempt for the same revision.
- A late validation result checks revision immediately before durable write; mismatch returns stale and
  cannot replace current validation.

## Redaction and logging

Main maps external errors to stable codes before logging or crossing IPC. Production logs may contain
operation name, stable code, duration bucket and revision correlation id; they must not contain config
URL, model, secret, headers, body, generated content, raw errors or filesystem path. Tests install a
sentinel secret and assert absence from renderer DOM, IPC results, durable non-secret files, project
tree, export fixtures, logs and diagnostics.
