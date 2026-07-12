# Research: AI Provider 设置与密钥状态

## Decision 1: 使用 Electron `safeStorage` 的异步 API

**Decision**: main 进程在 `app.ready` 后通过 Electron 43 的
`safeStorage.isAsyncEncryptionAvailable()`、`encryptStringAsync()` 和
`decryptStringAsync()` 保护单个当前 API key。密文以 base64 编码保存在 app
`userData/provider-secret.json`；该文件只有密文、schema、配置 revision 与时间，不保存
明文或可恢复提示。任何 unavailable、temporary-unavailable、decrypt、write 或 replace
失败都 fail closed，并保留已提交的旧凭据。

**Rationale**: `safeStorage` 已随 Electron 提供，不引入 native addon、额外打包产物或
供应商 SDK。异步 API 不阻塞 main，并显式暴露临时不可用和 key rotation；它使用 macOS
Keychain、Windows DPAPI，以及 Linux Secret Service/portal 等平台能力。应用不调用
`setUsePlainTextEncryption`，也不提供明文 fallback。

**Alternatives considered**:

- `keytar`: 已归档且增加 native build/签名/打包边界，不适合作为新项目默认依赖。
- 直接调用 macOS Keychain、Windows Credential Manager 或 Linux Secret Service:
  保护语义可更细，但需要三个平台 adapter 与额外维护；当前单 secret 不需要。
- 同步 `safeStorage`: 可工作，但 Electron 推荐异步 API；同步调用还可能等待平台凭据 UI。

**Evidence**: Electron `safeStorage` 文档说明异步 API 的平台 key provider、temporary
unavailability、key rotation 与非阻塞行为：
https://www.electronjs.org/docs/latest/api/safe-storage/

## Decision 2: 非敏感配置与验证结果存放在 app `userData`

**Decision**: main-owned `provider-settings.json` 原子保存一套配置快照和最近一次完成的
脱敏验证结果；secret 密文单独保存。两者都属于应用设置，不进入 `.writellm` 项目、Git、
普通导出或 recent index。schema v1 采用 strict parse；缺失按未配置处理，损坏/未知版本只
在内存中降级并报告安全 warning，不在读取时覆盖。合法更新才以同目录临时文件 + rename
替换 durable 文件。

**Rationale**: 001 已把 main-owned application preferences/recent pointer 放在 userData，
011 的 appearance repository 证明了同一原子写入模式。独立文件避免把 provider 状态并入
generic settings API，也把 secret 与可安全展示的数据隔离。

**Alternatives considered**:

- 项目文件/Git: 违反 FR-011，并会让项目移动或分享携带应用凭据状态。
- renderer `localStorage`: 无法由 main 做 schema、原子写入和权限验证。
- SQLite/generic preference service: 一套小型配置不需要数据库或宽泛配置边界。

## Decision 3: 使用 Pi Models/provider 与 agent loop 做 harness compatibility probe

**Decision**: main 使用 pinned `@earendil-works/pi-ai` 构造 isolated `Models`、custom
`openai-completions` provider 与 plain-data model，并通过 pinned
`@earendil-works/pi-agent-core` agent loop 执行 TypeBox-schema tool call → tool result → final
response probe。profile 保存 context window、max output、reasoning 和应用拥有的 compat policy；
验证最多两次 provider turn、30 秒，所有 probe transcript/content 立即丢弃。

API base URL 仍必须是无 username/password/query/fragment 的绝对 URL。远程 host 仅允许
HTTPS；HTTP 仅允许 `localhost`、`127.0.0.0/8` 或 `[::1]`。

**Rationale**: Pi harness 要求 `Models`、provider-owned streaming、plain-data `Model<Api>`、
TypeBox/JSON Schema tool definitions、tool call/result correlation 和 final response event。普通
completion、JSON mode 或 `/models` 只能证明更弱的协议。复用真实 consumer path 能在 005
阶段发现“看似 OpenAI-compatible 但 agent loop 不可用”的端点。

**Alternatives considered**:

- 手写 `net.fetch` Chat Completions probe：无法覆盖 Pi stream event/tool mapping/compat policy。
- JSON structured output probe：Pi agent 的结构化原语是工具 schema 与 tool result loop，不是任意 JSON response。
- `/models` 或 TCP reachability：不能证明模型可执行 agent harness 所需的工具循环。
- Responses API：首版 profile 固定为 Pi `openai-completions`；新增 API 方言必须新增受控 profile version。

**Evidence**: Pi 官方 `models.md` 将 `Models`、provider、plain-data `Model<Api>` 和
`streamSimple()` 定义为 AgentHarness request path；agent/AI 类型将工具参数定义为 TypeBox
schema，并在 agent loop 中校验和回填 tool result：
https://github.com/earendil-works/pi/blob/main/packages/agent/docs/models.md

## Decision 4: IPC/durable parser 保持手写 exact validation，tool schema 使用 Pi 的 TypeBox

**Decision**: 延续现有 shared parser 模式，为 IPC inputs、durable JSON 和 provider
response 编写 exact-key、长度、枚举和类型检查。边界限制为：base URL 2048 code units、
model 256、API key 4096；拒绝空白值、NUL 与 C0/C1 控制字符。safe error 只使用稳定枚举
和应用自有文案，不透传 URL、headers、response body、平台异常或 secret。

**Rationale**: 仓库已有 `parseAppearancePreferences` 等 parser；当前设置 schema 很小。
Pi 自身使用 TypeBox 表达和校验 tool schema，因此 probe 直接使用同一原语；这不把 TypeBox
扩展为 renderer IPC 或 durable document 的通用 validator。

**Alternatives considered**: Zod、Valibot、Ajv 可用于设置边界，但会形成与 Pi tool schema
并行的 schema 系统；当后续共享 IPC schema 数量足够大时再单独评审。

## Decision 5: revision 与并发采用 compare-and-swap

**Decision**: 配置使用 main 生成的 opaque `revision`。save config、replace/remove secret
都带 renderer 最后读取的 `expectedRevision`；不匹配返回 `PROVIDER_CONFLICT` 并要求 reload。
成功的 config 或 secret mutation 生成新 revision，并把旧 validation 标为 stale。每类
mutation 在 main repository 内串行化；validation 捕获开始 revision，只有结束时仍匹配才
能写入结果，否则返回 stale 且不得覆盖较新状态。进行中状态仅在内存中，重启不恢复。

**Rationale**: 这直接覆盖快速重复提交和晚到结果；配置、secret 与 validation 不需要
通用事务引擎或 project Git revision。

**Alternatives considered**: last-write-wins 会让旧请求覆盖新输入；全局队列会隐藏 stale
intent；持久化 in-progress 会把崩溃后的未知操作误作当前状态。

## Resolved unknowns

候选库、durable owner、schema/revision、IPC/error、provider protocol、timeout、redaction、
failure/retry 与 runtime fixtures 均已在本 research、data model、contract 和 quickstart 中
冻结。spec、plan 与 ADR-004 已由 maintainer 接受；下一步 gate 是生成并审查 `tasks.md`。
