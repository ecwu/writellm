# 研究记录：AI 写作任务的候选能力

**研究日期**：2026-07-12  
**研究范围**：provider 调用抽象、流式/取消、任务执行载体、网络、重试/并发、runtime schema 校验和 secret 边界。  
**仓库基线**：Electron `40.10.5`、React `^19.0.0`、Bun `1.3.4`、TypeScript `5.8.2`；当前没有 AI/queue/schema/provider 依赖。

## 结论摘要

本 feature 可以先冻结稳定的内部 port，而把外部库和运行时能力留在 port 后面。所有候选都必须满足：provider 不进入 renderer；错误经过脱敏和规范化；取消必须贯穿等待、请求、重试和持久化；provider 输出必须先过 runtime validation；任务只生成独立 proposal，不写正文。

本记录的 `Decision` 均为 `NEEDS DECISION`。候选名称、版本和链接用于后续评审，不代表已经批准加入 `package.json`，也不代表允许在当前 foundation 中实现。

## 研究方法与适配前提

- 优先查阅维护者/官方文档和仓库，而不是二手教程；链接集中在本文末尾的参考资料表。
- 以 Electron main/utility 的运行时为安全边界；React renderer 只能通过已有的 typed preload 形状调用任务 API。
- Bun 目前是仓库的包管理器和脚本执行工具；`bun run build` 最终编译 Electron main/preload，生产行为仍要以打包后的 Electron Node runtime smoke 为准。
- 任何候选都需要在 Electron 40、strict TypeScript、ESM/CJS 混合的当前构建链上做兼容性 probe；“能在 Node/Bun 工作”不自动等于“能在 packaged Electron 工作”。

## 候选一：provider 调用和统一结果

内部 port 不暴露 vendor 类型，建议仅抽象这些能力：`runWritingTask(input, { signal, onProgress })`、provider metadata/capabilities、normalized result 和 normalized error。输入包含 task/context snapshot，不含 renderer 传来的 secret；输出必须映射到目标 block、原文 hash、建议文本、意图、source refs 和 evidence status。

| 候选 | 适用范围 | 优点 | 风险/适配点 |
|---|---|---|---|
| 候选 A：原生 `fetch`/Electron `net.fetch` + 每个 provider 的薄 adapter | provider 数量少、需要完全控制请求/错误/stream schema | 依赖最少，内部 port 最清楚，便于把协议和数据模型掌握在项目内；Electron `net.fetch` 使用 Chromium 网络栈，可获得系统代理等能力 | 需要自己实现各 provider 的认证、SSE/stream、structured output、错误映射和测试；不能把 fetch response 原样写入项目；要决定 Node global fetch 与 `net.fetch` 的代理/网络语义 |
| 候选 B：provider 官方 SDK（例如 OpenAI 官方 JS/TS SDK） | 首版只接一个或少数明确 provider，追求 provider API 对齐 | 官方 SDK 通常覆盖 request types、streaming、错误和版本更新；OpenAI 官方库明确支持 TypeScript/JavaScript、Node 20+、Bun 1+，并默认避免在 browser 中暴露密钥 | vendor lock-in；不同 provider 的 SDK 类型不一致，仍需自己的 adapter；SDK 不能进入 renderer，且需确认 Electron packaged Node、bundling、proxy、AbortSignal 和 license/更新策略 |
| 候选 C：Vercel AI SDK (`ai` + provider package) | 需要跨 provider 的统一 text/structured output/streaming 语义 | provider-agnostic TypeScript API；官方文档提供 `streamText`、`abortSignal`、timeout、maxRetries、structured output 和 provider options，且可直接接 provider package | 当前文档默认面向 Node 22+ 等环境；AI SDK 高层能力可能引入隐含重试/多步/stream 生命周期，需确保与本地 task state machine、离线策略和错误码不冲突；引入 `zod`/provider package 等额外依赖 |
| 候选 D：LangChain.js（必要时再考虑 LangGraph） | 需要复杂 chain、tool、retriever 或可演进的 agent workflow | TypeScript 生态成熟，官方仓库列出 Node、Browser、Deno、Bun 等运行环境和大量 model/tool/retriever 集成 | 对当前“限定块 + 资料范围 + 独立提案”的小闭环可能过重；层级多、provider/agent 行为更难审计，可能扩大 bundle、调试和版本升级面；不能替代本 feature 的 target/version/evidence 约束 |

**Decision: NEEDS DECISION**。评审必须回答：首版是单 provider adapter 还是多 provider；是否需要跨 provider 统一流式/structured output；SDK 的重试和 timeout 是否由任务层接管；是否允许 provider-specific options 进入持久化 schema。

### 结果规范化的共同要求

无论选择哪一项，任务服务都不能把模型输出视为 proposal。必须经过：

1. 解析外部响应，限制大小和字段集合。
2. 校验每个 change 的 target block、original text/hash、suggested text、intent 和 evidence refs。
3. 将无法定位、目标版本过期、source ref 不可用或响应 malformed 的结果标为失败或人工判断。
4. 对不带证据的生成保留 `evidenceStatus=insufficient`，不伪造 citation。

## 候选二：任务执行载体

| 候选 | 适用范围 | 优点 | 风险/适配点 |
|---|---|---|---|
| 候选 A：main 内异步 task runner | 主要是网络 I/O，任务数量低，先求最小实现 | 不新增跨进程协议；直接复用 main-owned project writer、secret capability 和 Electron `ipcMain.handle`；最容易做真实 runtime smoke | provider SDK 的 CPU/解析异常和长同步工作可能影响 main；需要严禁同步文件/大 JSON 操作堵塞事件循环；未来迁移到 utility/worker 要保持 adapter port 不变 |
| 候选 B：Electron `utilityProcess` | 需要独立 child process、隔离 provider/不可信响应或希望 main 更稳 | Electron 提供 Node + MessagePort 的 utility process；可单独监控退出并将 provider 工作与 BrowserWindow main 隔离 | 打包入口、启动时机、MessagePort DTO、崩溃恢复和凭据传递复杂；secret 不应作为可复用进程状态长期驻留；utility process 仍由 main 管理，不能成为 renderer 的后门 |
| 候选 C：Node `worker_threads` | CPU 型 response normalization、压缩、解析或未来本地模型任务 | 使用结构化 clone/message passing，`worker.terminate()` 能停止 worker；不需要额外 Electron process | 与 main 同一进程，不能当作真正安全隔离；大型 context clone 有成本；第三方 SDK 的 worker/bundler 支持要实测；网络取消和 worker termination 不是同一语义 |
| 候选 D：独立外部 worker/service | 未来有本地模型、重 CPU 处理或远程队列 | 可隔离资源、独立扩缩和失败恢复 | 超出首版单机范围，增加部署、凭据、离线、升级和进程生命周期；违反“最小设计”除非有性能/稳定性证据 |

**Decision: NEEDS DECISION**。当前架构只依赖 `ProviderAdapter` port，不先承诺 A/B/C/D。决策输入应包括：最长同步工作、预计并发、可接受取消延迟、崩溃后的 pending/recovery 规则和 packaged build 的启动/退出行为。

## 候选三：网络实现

| 候选 | 适用范围 | 优点 | 风险/适配点 |
|---|---|---|---|
| 候选 A：provider SDK 的 transport | SDK 已覆盖 provider 请求并允许传入 signal/fetch | 少写协议细节；通常能保留 SDK 的错误/stream 类型 | 代理、TLS、timeout、retry 和 response body 生命周期由 SDK 决定；不同 SDK 行为不一致；不能让 SDK 在 renderer 创建 |
| 候选 B：Node/global `fetch` | main/utility 中的标准 HTTP API | 平台中立、类型简单，适合薄 adapter 和 fixture server | 需要自己处理系统代理/证书/stream、HTTP status、body size 和错误脱敏；Electron runtime 的 fetch 行为要单独 smoke |
| 候选 C：Electron `net.fetch` / `net.request` | 桌面应用需要 Chromium proxy/PAC/认证网络能力 | 官方文档说明 `net` 使用 Chromium networking，并支持 proxy、认证和 online 状态；可与 Electron session 相关联 | 只能在 app ready 后使用；在 utility process 中的 custom protocol 有限制；Provider SDK 是否接受该 transport 需适配；online=true 不能证明某 provider 可达 |

**Decision: NEEDS DECISION**。必须先决定系统代理/企业网络是否为首版要求；否则不能在 provider contract 中隐含“网络可用”或“离线可重试”。

## 候选四：取消、timeout、重试和并发

| 候选 | 适用范围 | 优点 | 风险/适配点 |
|---|---|---|---|
| 候选 A：自有 policy + `AbortController`/`AbortSignal` | 任务状态机是产品核心，重试规则很少且需要完整审计 | 无额外包；可把 user cancel、window close、timeout、retry delay 统一成 task signal；错误码和 attempt 记录完全由项目控制 | 需要自己写指数退避、jitter、Retry-After、可重试错误分类、并发上限和 timer 测试；容易遗漏边界 |
| 候选 B：`p-retry` | 只需要对 promise 操作做指数退避和 signal 取消 | 官方仓库提供 retries、backoff、`shouldRetry`、`AbortError`、max retry time 和 signal；适配 provider request 比较直接 | library 只解决重试，不解决 task durable state、并发、response idempotency 或项目恢复；默认参数不能直接采用；需要防止将用户取消重试成失败 |
| 候选 C：`p-queue` + 自有 retry policy | 需要限制同时运行的 task 数量 | 能表达 queue concurrency、timeout 和排队；适合桌面端的小型内存队列 | 官方仓库当前说明项目已 feature complete、不会继续开发；不是 durable queue，重启后必须由 `ai/tasks` 恢复；ESM-only 与当前 Electron build 需实测 |
| 候选 D：provider/AI SDK 内建 retries | provider SDK 已经提供稳定重试，项目只做 task 级包装 | 依赖少写一层；可能遵循 provider 特定 rate-limit semantics | 重试隐藏在 adapter 内会让 UI/审计看不到 attempt；与任务取消、storage checkpoint、429/费用控制可能冲突；必须显式关闭或代理其策略 |

**Decision: NEEDS DECISION**。需要冻结：默认最大 attempt、单次/总 timeout、429/5xx/网络错误分类、用户取消是否消耗 retry budget、重试是否新建 taskId、并发上限、应用退出时的 queued/running 行为。

## 候选五：DTO 与持久化数据的 runtime schema 校验

TypeScript 静态类型不能验证 renderer、文件或外部 provider 的运行时输入；至少应在 main 入口、从磁盘读取处和 provider response 处做 runtime validation。

| 候选 | 适用范围 | 优点 | 风险/适配点 |
|---|---|---|---|
| 候选 A：Zod | TypeScript-first、开发体验和复杂对象组合 | 官方文档提供静态推断、parse/safeParse、零依赖和现代 Node/browser 支持；与 AI SDK structured output 示例天然衔接 | runtime bundle 大小、schema 的 unknown field/version 语义和错误格式要明确；若 AI SDK 也依赖 Zod，需要锁定兼容版本；不能因为类型推断而省略 main 校验 |
| 候选 B：Valibot | 需要模块化、较小 bundle、Node/Bun/TypeScript | 官方文档说明模块化、无依赖、可运行于 Node/Bun，并实现 Standard Schema；可选择性导入 | API/生态和现有 AI SDK/团队经验需确认；JSON Schema 需要转换包；转换/unknown field 语义必须和 ADR schemaVersion 一致 |
| 候选 C：Ajv + JSON Schema/JTD | durable file、契约和未来跨语言工具需要标准 schema | JSON Schema/JTD 可独立于 TypeScript；Ajv 提供编译 validator、typed error 和 serializer；适合项目文件 schema 版本 | schema 文件与 TS 类型可能分离；格式插件和 untrusted format 要谨慎；错误到用户错误码需要 adapter；需考虑 renderer bundle 是否包含 Ajv |
| 候选 D：手写 type guard | DTO 很少且追求零依赖 | 不增加包和 bundle | 容易遗漏 nested/unknown fields、版本迁移和错误路径；不适合 provider response 和持久化文件；维护风险高 |

**Decision: NEEDS DECISION**。可按边界分别选择（例如项目文件使用 JSON Schema、内部 DTO 使用 TypeScript-first library），但必须避免多个 schema 真相源，并在 checklist 中冻结 unknown field、schemaVersion、错误路径和迁移策略。

## 候选六：provider secret 的使用边界

这个 feature 不拥有 secret 保存；它只依赖 005 暴露的 main-only capability。Electron 官方 `safeStorage` 提供主进程的 OS-backed 加密，并有异步 API、临时不可用和 key rotation 语义；Linux 可能没有可用 secret store，必须显式处理 backend/明文 fallback 风险。候选为：

- 候选 A：由 005 以 Electron `safeStorage` 封装的 `getProviderSecret(providerId)`；secret 只在 main/选定执行载体的短生命周期内存在。
- 候选 B：由 005 以独立 OS keychain adapter 封装；要接受 native module 的 Electron ABI、打包和平台依赖。历史上常见的 `keytar` 仓库已被 owner archive，不能把“过去常用”当成“当前维护活跃”的批准理由。
- 候选 C：不保存本机 secret，改用每次任务输入/外部 broker；安全上可减少本地持久化，但 UX、离线和重试成本显著增加。

**Decision: NEEDS DECISION**。至少要冻结：Linux secret store 不可用时是否拒绝任务、secret 是否可以传入 utility process、是否允许 provider 认证 token 进入 crash dump/log、以及 005 的接口版本。

## 候选七：外部 provider、离线和服务责任

候选能力不是实现承诺：

- 候选 A：直接从桌面端调用用户配置的 endpoint；任务需显示网络/认证/配额错误，并支持本地保留失败记录。
- 候选 B：调用可配置的企业 proxy/gateway；可以统一 auth、审计和 provider 路由，但新增服务、凭据和在线依赖。
- 候选 C：本地/embedded provider 或本地模型；可降低网络依赖，但超出当前 spec，涉及模型分发、资源、许可证、性能和更新。

**Decision: NEEDS DECISION**。产品必须明确“离线时能做什么”：能否创建 queued task、是否立即拒绝、是否允许取消/删除本地失败记录、是否有恢复时自动重试；同时明确数据是否发送到外部 provider、保留期限、区域/合规和用户提示。

## 与当前 Electron 40 / React 19 / Bun / TypeScript 的适配总结

| 现状 | 已知适配结论 | 仍需 probe/决策 |
|---|---|---|
| Electron 40 + sandbox renderer | provider、FS、safeStorage、任务状态在 main；preload 只映射 named typed methods | provider SDK 是否误用 browser build；utility/worker 打包；IPC update listener 的生命周期和窗口销毁 |
| React 19 | renderer 只消费 TaskSummary/TaskDetail/Proposal DTO；UI 可用普通 React state/外部 store，但不引入具体状态库 | 长任务订阅、窗口重新挂载后的快照补发、可访问状态文案和取消/重试 UI |
| Bun 1.3.4 | 适合作为 package manager、现有 scripts 和本地 fixture runner；部分候选官方声明支持 Bun | lockfile/安装策略、Electron 运行时解析、native module ABI、ESM/CJS；不运行网络安装来验证 |
| TypeScript 5.8 strict | shared discriminated unions、DTO 和 error code 可直接对齐 main/preload/renderer | 运行时 schema library 选型、JSON 文件/外部响应的 unknown field 和 migration |
| 现有 Vite/Electron build | 适合按 main/preload/renderer 分层扩展；当前 smoke 是 compiled foundation smoke | streaming/MessagePort/utility entry 的构建产物、source map 和 packaged app 测试 |

## 研究后的暂行架构（不是最终选型）

1. 先冻结 domain port 与文件/IPC contract，再把候选适配到 port。
2. 在无真实网络的情况下，用 deterministic fixture provider 验证状态机、取消、重试、evidence 和 proposal 规范化。
3. 将网络/SDK/worker 选择放在 main-owned adapter 后，避免后续换候选时修改 renderer、持久化 schema 或 009 输入。
4. 在实现前通过决策清单补齐性能阈值、外部服务、凭据、离线、可访问性和恢复/迁移边界。

## 参考资料（官方/一手资料）

1. [Electron IPC tutorial](https://www.electronjs.org/docs/latest/tutorial/ipc) — context isolation、preload 显式暴露和避免把整个 `ipcRenderer` 暴露给 renderer。
2. [Electron `ipcMain`](https://www.electronjs.org/docs/latest/api/ipc-main) — `ipcMain.handle`/`invoke` 的异步契约和错误序列化限制。
3. [Electron `utilityProcess`](https://www.electronjs.org/docs/latest/api/utility-process) — main-owned utility child process、Node/MessagePort 和启动/退出能力。
4. [Electron `net`](https://www.electronjs.org/docs/latest/api/net) — Chromium network stack、代理/认证与 `net.fetch` 限制。
5. [Electron `safeStorage`](https://www.electronjs.org/docs/latest/api/safe-storage) — main-only OS-backed secret storage、异步 API、Linux fallback 和 key rotation。
6. [OpenAI API JavaScript quickstart](https://platform.openai.com/docs/quickstart/make-your-first-api-request) — 官方 TypeScript/JavaScript SDK 和 server-side/Bun 使用说明。
7. [OpenAI Node SDK](https://github.com/openai/openai-node) — 官方 JS/TS SDK 的 runtime 支持和 browser secret 风险说明。
8. [Vercel AI SDK Core `streamText`](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-text) — streaming、AbortSignal、timeout、maxRetries 和 provider options。
9. [Vercel AI SDK stopping streams](https://ai-sdk.dev/docs/advanced/stopping-streams) — abort cleanup 与 `onAbort` 语义。
10. [Vercel AI SDK repository](https://github.com/vercel/ai) — provider-agnostic TypeScript toolkit、provider packages 和 structured output。
11. [LangChain.js repository](https://github.com/langchain-ai/langchainjs) — TypeScript、Node/Bun/Browser 支持和高层 agent/workflow 范围。
12. [Node.js `worker_threads`](https://nodejs.org/api/worker_threads.html) — worker message passing 与 `terminate()`。
13. [Node.js `child_process`](https://nodejs.org/api/child_process.html) — `AbortSignal` 与子进程取消参考。
14. [Zod](https://zod.dev/) — TypeScript-first schema validation 和静态推断。
15. [Valibot introduction](https://valibot.dev/guides/introduction/) 与 [Valibot installation](https://valibot.dev/guides/installation/) — 模块化、无依赖、Node/Bun 适配。
16. [Ajv TypeScript guide](https://ajv.js.org/guide/typescript.html) — JSON Schema/JTD、typed validator 和错误类型。
17. [p-retry repository](https://github.com/sindresorhus/p-retry) — backoff、retry predicate、AbortSignal 和 max retry time。
18. [p-queue repository](https://github.com/sindresorhus/p-queue) — concurrency/timeout queue，并记录其 feature-complete 维护状态。
19. [Standard Schema](https://github.com/standard-schema/standard-schema) — schema library 间的可互操作接口，可作为减少绑定的候选参考。
20. [node-keytar repository](https://github.com/atom/node-keytar) — 历史 OS keychain 候选及其 archived/native module 风险。

## 最终决策

| 决策域 | 最终决策 |
|---|---|
| provider SDK/协议 | NEEDS DECISION |
| 网络 transport | NEEDS DECISION |
| main / utilityProcess / worker_threads | NEEDS DECISION |
| retry/concurrency | NEEDS DECISION |
| runtime schema library | NEEDS DECISION |
| provider secret capability | NEEDS DECISION（由 005 共同决定） |
| 离线、外部服务、凭据和数据保留 | NEEDS DECISION |
| package version/lockfile/upgrade policy | NEEDS DECISION |
