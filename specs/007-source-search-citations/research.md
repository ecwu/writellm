# 研究记录：资料检索与可追溯引用

**研究日期**：2026-07-12  
**研究范围**：本地 Electron 桌面应用中的全文/自然语言检索、过滤、上下文定位、引用身份和失效重绑。  
**结论状态**：以下仅为候选研究；没有任何库、包、服务、版本或部署方式获得批准。每一项最终决策均写为 `Decision: NEEDS DECISION`。

## 1. 现状与约束

- 当前 `package.json` 只有 Electron 43.1.0、React 19.2.7、React DOM、Vite、TypeScript；没有数据库、全文索引、向量索引或 embedding runtime。
- Bun 负责现有脚本和测试，但 Electron main 的运行时是 Electron 自带 Node。Bun 官方兼容性页目前把 `node:sqlite` 标为未实现，因此不能在未经验证的情况下把 Bun 的 Node API 当作生产 SQLite 方案。[Bun Node.js compatibility](https://bun.sh/docs/runtime/nodejs-compat)
- ADR-001 已规定 portable `.writellm`、`sources/`、`runtime/`、main-owned 文件系统、可重建缓存和 Git-backed history；其状态仍为 Proposed。索引不可成为资料或正文引用的唯一真相。
- Electron 官方建议通过 context isolation、sandbox、contextBridge 和每方法的 IPC 暴露来缩小 renderer 能力；这与本 feature 的 main-owned search facade 一致。[Electron Context Isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)、[Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)、[Electron Process Sandboxing](https://www.electronjs.org/docs/latest/tutorial/sandbox)
- React 19.2.7 已是现有 renderer 基础，但检索 UI 不需要引入新的状态框架；是否需要额外 UI 包不在本 feature 的必要范围。[React 19.2.7](https://react.dev/blog/2024/12/05/react-19)

## 2. 评估维度

候选需要用同一组问题比较，而不是以“看起来能搜到”为批准条件：

1. 是否支持本地、可移动项目和无网络运行？
2. 是否能同时按 sourceId/sourceRevisionId、资料名称、标签和处理状态过滤？
3. 是否能返回稳定 chunk identity、匹配片段/高亮、原始页码和 Markdown locator，而不是只有一段字符串？
4. 索引能否从 canonical source/chunk 重建，能否检测版本漂移、损坏和部分更新？
5. 在 Electron 43 的主进程、macOS/Windows/Linux 打包和 Bun lockfile 下，原生模块、ABI、安装和升级风险如何？
6. 500 份资料和实际 chunk 数下的冷启动、增量更新、内存/磁盘占用、查询 p95 是否可测？
7. 包、二进制、模型和服务的许可证、telemetry、网络、凭据和供应链更新策略是否可接受？

## 3. 全文/混合检索候选

### 候选 A：SQLite FTS5 + main-owned metadata tables

**适用范围**：关键词检索、BM25 排序、snippet/highlight、source/tag/status 过滤；向量检索需要另一个能力。

**优点**：

- 官方 SQLite 扩展，支持 external-content/contentless 表，可以把较大的 canonical 文本留在 domain 表，仅在 FTS 表中维护索引。
- 内置 `bm25()`、`highlight()`、`snippet()`，天然适合把命中位置转换成 search result DTO。
- 单文件/本地运行模型和项目 runtime 目录相容，不要求用户安装搜索服务；SQL 过滤也容易表达 source revision 和 eligibility 条件。

**风险**：

- 它不是向量/自然语言语义检索；需要额外的 embedding 和 ranking/merge 方案。
- external-content FTS 表若未保持与 canonical content 同步，官方文档明确提示查询结果可能不可预测；更新、删除、rebuild 和 crash recovery 必须由 main 队列保证。
- Electron 可用的 SQLite binding、内置 SQLite 版本/FTS5 能力、原生模块打包和 Bun 测试运行时适配均未验证；不能假设 `node:sqlite` 解决生产路径。

**与当前工程适配**：最适合作为 main-only adapter 的候选，不进 preload 或 renderer；索引文件放在 `runtime/` 的具体位置和驱动包为 **NEEDS DECISION**。Bun 只负责测试脚本时，可让 Electron/Node adapter 和 Bun test adapter 分离，但这会增加验证矩阵。

**一手资料**：[SQLite FTS5 Extension](https://www.sqlite.org/fts5.html)、[SQLite FTS5 external-content pitfalls](https://www.sqlite.org/fts5.html#external_content_table_pitfalls)、[SQLite FTS5 bm25/highlight/snippet](https://www.sqlite.org/fts5.html#built_in_auxiliary_functions)

**Decision: NEEDS DECISION**

### 候选 B：Orama（TypeScript 进程内搜索）

**适用范围**：同一 TypeScript 运行时中的 full-text、vector、hybrid、filters、facets、BM25、typo tolerance；可把搜索门面置于 main 或 main-owned worker。

**优点**：

- 官方定位为 TypeScript、zero-dependency 的 full-text/vector/hybrid engine，API 与现有 TypeScript/ESM 工程相近。
- 不需要单独服务或 native binary；可在 Bun package manager 中安装，也可由 Electron main 使用。
- 官方 README/文档展示了 schema、向量字段、过滤、hybrid 和多语言 tokenizer 能力；适合快速做 500-资料规模的 POC。

**风险**：

- “进程内”不等于 durable canonical storage；持久化插件、序列化、启动恢复、增量更新、索引内存和 Electron 进程重启行为必须单独验证。
- 向量维度、embedding model revision、混合打分/重排和过滤顺序需要由 domain adapter 封装，不能把 Orama 的内部 document schema 直接暴露为产品 contract。
- 若误放入 renderer，会增大 bundle、占用 UI 内存并绕过 main-owned file boundary；必须限制在 main/worker。

**与当前工程适配**：TypeScript/ESM 和无 native ABI 是优势；但需要决定索引快照是否写入 `runtime/`、是否使用 worker、Bun/Electron 两个运行时的结果一致性。Natural-language query 仍需要独立 embedding provider。

**一手资料**：[Orama 官方文档](https://docs.orama.com/docs/orama-js)、[Orama 官方仓库](https://github.com/oramasearch/orama)、[Orama npm package（研究时版本快照，仅供观察）](https://www.npmjs.com/package/%40orama/orama)

**Decision: NEEDS DECISION**

### 候选 C：Meilisearch 本地服务/随应用二进制

**适用范围**：成熟的 full-text、typo tolerance、facets/filters、search-as-you-type、vector/hybrid search；通过 local HTTP/SDK 与 main 交互。

**优点**：

- 功能覆盖接近产品搜索体验：全文、过滤、facet、排序、向量和 hybrid 皆有官方能力描述。
- 作为独立 search engine 可以将索引工作与 Electron main 的 UI 生命周期隔离，且不要求 renderer 直接接触服务。
- 上游仓库、release 和 JavaScript client 活跃，适合在 POC 中验证相关性和过滤体验。

**风险**：

- 引入子进程/二进制/端口或 socket 生命周期、随应用打包、跨平台升级、崩溃恢复和 shutdown 管理；这比当前 foundation 复杂。
- 官方仓库说明存在匿名 telemetry，可停用；产品必须明确是否允许、如何默认关闭以及是否会把本地资料或查询发出。
- 服务版本、索引格式、API key、license edition、网络绑定和本地安全需要 ADR；外部服务不可在 renderer 直接调用。

**与当前工程适配**：可由 main 启动/停止并通过窄 adapter 使用，适合把 provider 失败与 renderer 分离；但与 `.writellm` 自包含和“不开额外服务”的桌面预期存在取舍。Meilisearch 的最新版本/二进制策略不在本计划锁定。

**一手资料**：[Meilisearch 官方仓库](https://github.com/meilisearch/meilisearch)、[Meilisearch releases（研究时活跃度/版本观察）](https://github.com/meilisearch/meilisearch/releases)、[Meilisearch 官方 JavaScript client 组织页](https://github.com/meilisearch)

**Decision: NEEDS DECISION**

### 辅助候选 D：Fuse.js（小型 fuzzy/typo fallback）

**适用范围**：小到中型、可加载到内存的数据集上的轻量 fuzzy search；适合作为 fixture/本地降级或资料名称辅助筛选，不是完整的 source search backend。

**优点**：TypeScript、zero-dependency、browser/server 均可用；API 简单，适合验证名称/标签提示和无 dedicated backend 的最小 fallback。

**风险**：没有 durable index、原生的 source revision/locator 管理或 semantic retrieval；全量加载大量 chunks 会增加内存和 UI 风险；不能单独满足 FR-001、FR-002 和自然语言查询。

**一手资料**：[Fuse.js 官方仓库](https://github.com/krisk/Fuse)

**Decision: NEEDS DECISION**（是否需要作为非主路径 fallback）

## 4. 向量索引候选

### 候选 A：sqlite-vec SQLite extension

**适用范围**：将向量、metadata 和 KNN 查询放入 SQLite 生态，配合 FTS5 或 metadata tables 做统一本地 project runtime。

**优点**：纯 C、无依赖、可运行于多平台；仓库提供 Node 安装路径和 `vec0` virtual table；与 SQLite 文件和 main-owned storage 的概念相近。

**风险**：官方仓库明确标为 pre-v1、可能有 breaking changes；native extension 加载和 Electron packaging/ABI 仍需验证。上游公开 issue 记录了 virtual table 与 JOIN/WHERE 过滤的限制，需要先过滤候选 ID 或使用额外查询层；这直接影响 source/tag 过滤的 correctness 和性能。

**与当前工程适配**：若采用，需固定扩展二进制、版本/校验和、加载失败重建策略，并把 query/filter 编排留在 main adapter；不可把 vec0 SQL schema 当 shared DTO。

**一手资料**：[sqlite-vec 官方仓库](https://github.com/asg017/sqlite-vec)、[sqlite-vec releases](https://github.com/asg017/sqlite-vec/releases)、[sqlite-vec JOIN/filter limitation issue](https://github.com/asg017/sqlite-vec/issues/196)

**Decision: NEEDS DECISION**

### 候选 B：LanceDB embedded OSS + TypeScript SDK

**适用范围**：本地/嵌入式向量、全文、hybrid search 和 metadata/filter；可以独立承载 search index 或与 source metadata adapter 配合。

**优点**：官方文档列出 OSS embedded library、vector/full-text/hybrid search、secondary indexes 和 prefiltering；TypeScript SDK 由 Rust library 经 `napi-rs` 提供，适配 TypeScript API，同时保留高性能 native core。

**风险**：TypeScript SDK 会下载各平台 native library；Electron 打包、架构矩阵、rebuild、签名、升级和 Bun/Electron runtime 差异都必须做真实 smoke。它的表/format 不是 ADR-001 已接受的项目 canonical format；索引损坏、schema evolution、复制/备份和迁移边界需另行定义。

**与当前工程适配**：比独立服务少一层网络，但比纯 TypeScript 多 native packaging 风险；main/worker-only 使用可行，renderer/preload 不适合。研究时 npm 页面显示有近期版本发布，但具体版本不可在本计划锁定。

**一手资料**：[LanceDB 官方概览](https://docs.lancedb.com/)、[LanceDB SDK/API reference](https://docs.lancedb.com/api-reference)、[LanceDB TypeScript API](https://lancedb.com/documentation/js/globals/)、[LanceDB vector prefiltering](https://docs.lancedb.com/search/vector-search)

**Decision: NEEDS DECISION**

### 候选 C：不引入专用向量库，使用已持久化 embedding 的可重建进程内扫描/轻量索引

**适用范围**：把 500-资料首版作为明确上限，先将向量存为 project-local derived data，由 main/worker 做 exact similarity 或使用已选全文 engine 的 vector capability。

**优点**：最少 native dependency 和 schema 绑定；实现可解释，容易以 source revision 和 query snapshot 重建；适合先冻结 domain contract。

**风险**：chunk 数而非资料数决定成本，最坏情况可能超过 SC-001；需要明确上限、取消、内存预算和迁移路径；一旦规模增长，替换 engine 可能需要双写或全量 rebuild。

**与当前工程适配**：最符合“技术选型暂不拍板”的第一版设计，但必须通过 500 资料/实际 chunk 规模 POC 才能证明不是把性能风险推迟。

**Decision: NEEDS DECISION**

## 5. Natural-language query embedding 候选

### 候选 A：复用 005 provider 的远程 embedding API

**适用范围**：处理阶段或查询阶段由用户配置的 provider 生成 chunk/query embeddings；007 只消费抽象的 embedding result。

**优点**：无需随应用分发模型；模型/维度可由 provider 选择；在较弱设备上可保持本地 CPU/磁盘开销较小。

**风险**：需要 credentials、网络、超时、费用、数据出境和 provider 协议；查询可能在离线时不可用；模型变更会使旧向量与新查询不兼容，必须把 model identity/version 写入 index metadata。

**与当前工程适配**：只能由 main 调用 005 的受保护能力；不能把 key 或 raw provider error 传入 renderer。005 spec 目前也未冻结具体协议。

**Decision: NEEDS DECISION**

### 候选 B：Transformers.js 本地模型

**适用范围**：在 JavaScript/TypeScript 进程中加载本地/缓存模型生成 query embedding，支持无 Python 进程的本地推理。

**优点**：官方 Node 教程支持 server-side inference、ESM 和本地模型 cache；可减少资料离开设备的需求，缓存后可为离线查询提供路径。

**风险**：第一次运行可能下载模型文件；模型大小、内存、CPU/GPU、模型许可证和 cache 迁移需定义；文档以 Node 为主，Bun/Electron 43 的 native/WASM/worker 组合必须验证。模型文件不是 npm 版本本身，不能只靠 package lock 做可复现性。

**与当前工程适配**：应放 main-owned worker 或 main，而不是 renderer/preload；需要本地模型 fixture、下载/预置策略、取消和失败状态。

**一手资料**：[Transformers.js Node server-side inference](https://huggingface.co/docs/transformers.js/en/tutorials/node)、[Transformers.js 官方文档](https://huggingface.co/docs/transformers.js/en/index)

**Decision: NEEDS DECISION**

### 候选 C：ONNX Runtime JavaScript（Web 或 Node binding）

**适用范围**：自行选择 ONNX embedding model，在 JS API 中做本地推理；可以评估 WASM、WebGPU 或 Node execution provider。

**优点**：官方 JavaScript API 统一 Web/Node/React Native；Web 文档给出 WASM、WebGPU 等支持矩阵，可用来明确设备降级和性能测量。

**风险**：模型/tokenizer/worker/EP 组合由产品负责；官方矩阵显示 Node 侧的 WebGPU 不等同于 browser，Node WASM 有单线程限制；浏览器 WebGPU 在平台上也有差异。引入 runtime 和模型打包仍需跨平台 smoke。

**与当前工程适配**：可作为 main/worker provider 的低层能力，但必须先确定模型、线程、GPU、缓存和离线策略；不应在 shared contract 中暴露 ORT 类型。

**一手资料**：[ONNX Runtime JavaScript API](https://onnxruntime.ai/docs/get-started/with-javascript/)、[ONNX Runtime Web support matrix](https://onnxruntime.ai/docs/get-started/with-javascript/web.html)

**Decision: NEEDS DECISION**

## 6. 执行位置候选

### 候选 A：main 进程串行执行

适合小规模、低风险的索引更新和查询；持久化边界最简单，与 ADR-001 的 main-owned write queue 一致。风险是模型加载、全文 rebuild 或 native 调用阻塞 main，必须有取消和时限。

**Decision: NEEDS DECISION**

### 候选 B：main-owned worker thread/utility process

main 保留 authority，worker 只承担 CPU/native/provider 工作，通过版本化 requestId/message contract 返回结果。UI responsiveness 和崩溃隔离更好，但有生命周期、共享资源、取消、错误序列化和 Electron sandbox/packaging 的额外复杂度。

**Decision: NEEDS DECISION**

### 候选 C：随应用 child process/local service

适合重型 native engine 或独立 search server；可以单独重启和监控，但打包体积、端口、权限、telemetry、升级和防止任意本地连接的安全负担最高。

**Decision: NEEDS DECISION**

任何执行位置都必须满足：renderer 无直接访问、provider error 可解释、索引可重建、应用退出时不留下无法恢复的 pending transaction。

## 7. 版本、依赖和供应链策略候选

### 候选 A：在 `package.json` 使用 exact + `bun.lock` 可复现安装

优点是审查和跨平台构建可重复；缺点是升级需明确 cadence 和安全 patch 流程。Bun 官方说明 `bun.lock` 应提交，`--frozen-lockfile` 会拒绝漂移。[Bun lockfile](https://bun.sh/docs/pm/lockfile)、[Bun install/frozen lockfile](https://bun.sh/docs/pm/cli/install)

**Decision: NEEDS DECISION**

### 候选 B：受控 semver range + 定期锁文件更新

减轻手工升级，但 native/search/model 组合可能出现未预期行为；必须用 compiled build、runtime smoke、fixture relevance 和 SBOM/许可证检查做 gate。

**Decision: NEEDS DECISION**

### 候选 C：不在 007 直接新增 dependency，先提供 adapter/fixture

可先接受 domain/IPC/storage contract，将引擎选择推迟到实现前 POC；优点是符合当前“暂不拍板”，缺点是性能/可行性不能仅凭抽象保证。

**Decision: NEEDS DECISION**

## 8. 决策登记表

| ID | 决策主题 | 当前记录 |
|---|---|---|
| D-001 | 全文/混合检索 engine | **Decision: NEEDS DECISION**；候选 A SQLite FTS5、B Orama、C Meilisearch、辅助 D Fuse.js。 |
| D-002 | 向量索引介质 | **Decision: NEEDS DECISION**；候选 A sqlite-vec、B LanceDB、C 进程内可重建扫描/轻量索引。 |
| D-003 | query embedding 来源 | **Decision: NEEDS DECISION**；候选 A 005 provider、B Transformers.js、C ONNX Runtime JS。 |
| D-004 | main/worker/service placement | **Decision: NEEDS DECISION**；候选 A main、B worker/utility、C child process/local service。 |
| D-005 | offline/network/credentials/data egress | **Decision: NEEDS DECISION**；需与 005、ADR-001 对齐。 |
| D-006 | index schema、存储路径、hash/model identity、migration | **Decision: NEEDS DECISION**；实现前需 ADR 或接受的 storage decision record。 |
| D-007 | dependency version/license/lockfile/native artifact policy | **Decision: NEEDS DECISION**；不把研究时的最新版本写成批准版本。 |
| D-008 | IPC method names、DTO、error codes、contract version | **Decision: NEEDS DECISION**；需与 001/004/006 freeze。 |
| D-009 | SC-001 测量口径、分页/top-k、资源阈值、a11y 和恢复边界 | **Decision: NEEDS DECISION**；见 plan-decisions checklist。 |

## 9. 下一步研究动作（不等于选型）

实现授权后，先用相同的 deterministic fixture 对候选测量：

1. 500 份资料、真实 chunk 分布、重复名称、标签、多语言文本、图片/表格 locator、处理中/失败记录。
2. 关键词、自然语言、过滤和 context lookup 的 p50/p95、冷/热启动、索引增量/全量 rebuild、内存/磁盘。
3. 删除/替换 source revision 后的 stale detection、显式 rebind 的 exact/ambiguous/no-candidate 三路结果。
4. macOS/Windows/Linux 的 `bun run build` 和 `bun run test:smoke`，包括 native artifact、model cache、无网络启动和损坏索引恢复。

在这些数据、ADR 和 checklist 决策完成之前，`research.md` 中的候选都不应出现在生产 `package.json`、lockfile 或实现代码中。

