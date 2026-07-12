# Data Model: AI Provider 设置与密钥状态

所有 durable entity 都由 main 创建、strict parse 和保存。renderer 只接收下述 read model，
不接收文件路径、密文、secret hint 或 provider response body。

## ProviderSettingsDocument (durable, non-secret)

文件：app `userData/provider-settings.json`

| 字段 | 类型 | 规则 |
|---|---|---|
| `kind` | `"writellm.provider-settings"` | exact |
| `schemaVersion` | `1` | 未知版本不自动迁移 |
| `revision` | opaque string | main 每次 config/secret mutation 后生成 |
| `config` | `ProviderConfig \| null` | null 表示尚无完整 harness profile |
| `secretConfigured` | boolean | 只表示当前 revision 有受保护密文，不证明可解密或可用 |
| `validation` | `PersistedValidation \| null` | 最近一次完成、脱敏的结果；无 response body |
| `updatedAt` | RFC 3339 UTC string | main 生成 |

### ProviderConfig

| 字段 | 类型 | 验证 |
|---|---|---|
| `providerKind` | `"openai-compatible"` | v1 唯一值 |
| `baseUrl` | string | 1–2048；absolute；无 credentials/query/fragment；remote HTTPS；HTTP 仅 loopback；canonical trailing slash |
| `modelId` | string | trim 后 1–256；无控制字符 |
| `contextWindow` | integer | 1024–2,000,000 |
| `maxOutputTokens` | integer | 1–contextWindow |
| `reasoning` | boolean | 是否允许 Pi thinking level；不代表验证已成功 |

`baseUrl` 是 API base，例如 `https://api.example.com/v1/`。配置摘要可显示 base URL、model id
与容量信息，它们按 spec 属于非敏感设置。

### HarnessModelProfileV1 (derived plain data)

main 从 `ProviderConfig` 确定性派生，不接受 renderer 直接提交：

| 字段 | 值 / 规则 |
|---|---|
| `profileVersion` | `1` |
| `providerId` | application-owned stable custom provider id |
| `api` | `"openai-completions"` |
| `id` / `name` | 从已校验 `modelId` 派生 |
| `baseUrl` | canonical ProviderConfig baseUrl |
| `reasoning` | ProviderConfig reasoning |
| `input` | `["text"]` |
| `contextWindow` / `maxTokens` | ProviderConfig capacity fields |
| `cost` | all-zero unknown-cost placeholder；不用于费用承诺 |
| `compat` | application-owned conservative OpenAI Completions policy；schema/version 固定，renderer 不可覆写 |

该对象满足 Pi `Model<"openai-completions">` 的 plain-data 形状。provider implementation、auth
resolver、credential store 和 stream functions 是运行时依赖，不持久化进设置或项目。

### PersistedValidation

| 字段 | 类型 | 规则 |
|---|---|---|
| `status` | `"succeeded" \| "failed" \| "unknown" \| "stale"` | `validating` 不持久化 |
| `configRevision` | opaque string | 与验证开始时保存的 revision 绑定 |
| `completedAt` | RFC 3339 UTC string | 只有完成状态有值 |
| `diagnosticCode` | `ValidationDiagnosticCode` | 稳定、脱敏枚举 |
| `safeMessage` | string | 从 app-owned code 映射，不来自 provider body |

`succeeded` 不按时间过期。任何 config、replace secret 或 remove secret 成功后，旧结果若
保留则改为 `stale`；UI 不把 stale 当可用。失败、超时或 response 无法安全分类时分别持久
为 `failed` 或 `unknown`。应用重启只恢复完成状态。

## ProviderSecretDocument (durable ciphertext)

文件：app `userData/provider-secret.json`

| 字段 | 类型 | 规则 |
|---|---|---|
| `kind` | `"writellm.provider-secret"` | exact |
| `schemaVersion` | `1` | exact |
| `configRevision` | opaque string | 必须与 settings 当前 revision 一致 |
| `ciphertext` | base64 string | 只接受 safeStorage 输出；有上限 |
| `updatedAt` | RFC 3339 UTC string | main 生成 |

明文 API key 仅存在于 renderer password input、一次 IPC structured-clone 参数以及 main
调用 safeStorage/provider adapter 的短生命周期变量中。成功/取消/关闭后 renderer 清空
input；main 不缓存明文超过单次操作或验证。

## ProviderSummary (IPC read model)

- `revision`: 当前 opaque revision，供 compare-and-swap。
- `config`: 保存的 `providerKind/baseUrl/modelId/contextWindow/maxOutputTokens/reasoning` 或 null。
- `harnessProfile`: 保存配置派生的 profile version、API 方言、model id、context/max output、reasoning 与 text input 摘要；不含底层 compat flags。
- `secretState`: `not-configured | configured | unavailable | invalid`。
- `validation`: `not-run | validating | succeeded | failed | unknown | stale` 加适用的
  `completedAt/diagnosticCode/safeMessage`。
- `warning`: 可选 durable-corrupt/unsupported/backend-unavailable 安全文案。

`configured` 只表示 durable ciphertext 与 revision 一致；启动时 decrypt probe 失败映射为
`unavailable`（临时平台失败）或 `invalid`（损坏/不可解密），并使 provider availability
为 false。

## State transitions

```text
unconfigured --save config+secret--> configured/unvalidated
configured --save changed config--> new revision + validation stale
configured --replace secret-------> new revision + validation stale
configured --remove secret--------> new revision + not-configured + validation stale
current revision --validate-------> validating (memory)
validating --success--------------> succeeded (durable, same revision)
validating --safe failure---------> failed/unknown (durable, same revision)
validating --revision changed-----> stale result, never overwrites current revision
```

首个保存是一个 domain operation：必须先保护 secret，并把两个临时文件准备完成；发布失败
时回滚临时文件且不得报告成功。已有配置的 replace/remove 也必须保留旧 durable pair，直到
新 pair 全部发布。若进程在两次 rename 之间崩溃，startup reconciliation 只接受 revision
匹配的 pair；不匹配时保持 secret unavailable、validation non-current，并提供重新保存路径，
绝不把不匹配 secret 用于请求。

## ValidationDiagnosticCode

- `VALIDATION_OK`
- `VALIDATION_AUTH_REJECTED`
- `VALIDATION_MODEL_REJECTED`
- `VALIDATION_RATE_LIMITED`
- `VALIDATION_SERVICE_REJECTED`
- `VALIDATION_UNREACHABLE`
- `VALIDATION_TIMEOUT`
- `VALIDATION_RESPONSE_INVALID`
- `VALIDATION_TOOLS_UNSUPPORTED`
- `VALIDATION_TOOL_ARGUMENTS_INVALID`
- `VALIDATION_TOOL_RESULT_UNUSABLE`
- `VALIDATION_LOOP_INCOMPLETE`
- `VALIDATION_CANCELED`
- `VALIDATION_STALE`
- `VALIDATION_UNKNOWN`

HTTP status 可以参与 main-side 分类（401/403 auth、404/422 model/endpoint、429 rate
limit、其余 provider rejection），但 raw status text/body/header 不进入 durable 或 IPC DTO。
