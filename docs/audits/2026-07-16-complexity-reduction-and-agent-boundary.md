# 2026-07-16 复杂度收敛与 Agent 边界审计

状态：已记录；作为 Checkpoint 19.5 的输入与验收依据

本审计基于架构文档、实施跟踪和 Phase 记录，未读取完整源码。因此它能够确认设计偏差、高风险边界和验收缺口，但不能替代 CP19.5 的源码级验证。

## 总体结论

Checkpoint 1–19 不需要推翻重做。Electron 安全边界、项目容器、三数据库职责、BlockNote 权威 revision、MinerU raw/normalized 分离、可重建索引和 Agent 提案式写入仍是正确基础。

在进入 Checkpoint 20 前，必须先完成一次性收敛窗口：`Checkpoint 19.5: Complexity Reduction And Agent Boundary Freeze`。该窗口不重写 1–19，只删除没有产品需求支撑的临时能力、收窄恢复边界、修正性能验收，并冻结首版 Agent 的工具和持久化范围。

本审计中的“已过时”表示旧设计不再是后续实现的目标；CP1–19 的历史 verification 仍保留为历史证据，不表示这些设计可以继续扩展。

## 一、继续保留的设计

- Renderer sandbox、窄 IPC、sender authorization、`projectSessionId` capability、路径 containment 和 Main 权威边界。
- `app.sqlite`、项目 `.writellm/project.sqlite`、可重建 `.writellm/index.sqlite` 三种数据库职责。
- BlockNote 原生 JSON、数据库权威 revision、content hash/CAS 和可重建 materialization。
- MinerU raw revision 与 normalized revision 分离，以支持不重新上传文件的 normalizer 升级。
- `index.sqlite` 与独立 Index utility process；继续使用 sqlite-vec，除非真实 benchmark 提供替换证据。
- Agent 只生成经过 revision 检查和用户批准的 typed mutation proposal，不获得任意 filesystem、SQL、shell 或 unrestricted network 能力。

## 二、CP19.5 必须完成的收敛项

### 1. 删除持久化 MinerU signed URL

`parse_tasks` 只保留 `remote_task_id`、`remote_state`、`provider`、`submitted_at`、`last_polled_at`、`result_fingerprint`、`download_state` 和 retry metadata。不得新增或继续读取 `signed_url`、`download_url`、`encrypted_download_url`、`signed_url_ciphertext`、`recovery_capability` 等字段。

恢复流程固定为：打开项目 -> 读取 `remote_task_id` -> 重新查询 MinerU -> 获取新的下载 URL -> 下载。signed URL 只存在于 Import/API utility 当前请求的内存中。

迁移可以先停止读取、再在后续 schema 整理中删除列；旧项目不尝试解密或迁移旧 URL，清空旧 ciphertext 即可。snapshot 必须证明项目数据库和 manifest 不包含 URL 字段或值。

必须覆盖：下载前崩溃后 reopen/poll、过期 URL refresh、项目跨机器复制后恢复、snapshot 无 URL/ciphertext、取消后晚到 URL 不触发下载。

### 2. 固化 durable job 与 interactive work 的边界

durable jobs 仅用于：

```text
mineru_parse
normalize_parse_revision
build_index_generation
build_embedding_generation
remove_index_item
rebuild_index
artifact_cleanup
```

MinerU submit/poll/download/publish 仍可作为一个 durable job，由 `parse_tasks.stage` 记录内部阶段。

知识库查询、query embedding、rerank、provider connection test、citation expansion、普通 manuscript save、brief/outline mutation 和 Agent 对话/model streaming 不得进入 `jobs`。它们使用 request-scoped `AbortController`、普通 limiter/p-queue、`projectSessionId`、request ID 和必要的 `model_requests` 记录。关闭项目时标记 interactive work 为 aborted，不重新执行。

冻结或删除：无 handler 的 `paused` 状态、无实际 job type 的 `llm auxiliary` queue、durable rerank、durable agent-turn、通用 plugin/handler discovery，以及为短请求运行 heartbeat。保留 `job_transitions`，但不扩展成通用 event-sourcing 审计层。

验收必须证明：持久化 import/normalize/embedding/index work 可恢复；search/rerank/Agent turn close 后为 aborted；一次知识库查询和一次 Agent model request 都不写入 `jobs`；每种 jobs type 都有明确重启语义。

### 3. 冻结首版 Agent 工具边界

首版读工具固定为：

```text
get_writing_context
read_section
search_knowledge
read_citations
```

`get_writing_context({ includeBrief, includeOutline, activeSectionId? })` 返回 brief 摘要、outline、状态/字数、当前 section、Renderer 主动提交的 selected block IDs 和当前 revision。`read_section({ sectionId, blockIds?, cursor?, limit? })` 同时覆盖按 block 读取，不再另设 `read_blocks`。

首版写工具固定为：

```text
propose_brief_update
propose_outline_patch
propose_section_patch
```

`propose_outline_patch` 覆盖 section create、metadata update、move/reorder 和 delete；`propose_section_patch` 使用既有 typed BlockNote operations。

首版不加入通用文件读取、SQL、任意 JSON Patch、shell/process、Agent 自定义工具创建、plugin/skill registry、自动应用、多 Agent/sub-agent、长期记忆、Agent 修改 provider 配置或触发 restore/snapshot。

### 4. 收窄首版 Agent 持久化 schema

首版保留：`agent_sessions`、`agent_runs`、`agent_events`、`mutation_proposals` 和已有 `model_requests`。`agent_events` 是按 `sequence` 排序的事件表，事件类型限定为 `user_message`、`assistant_message`、`tool_call`、`tool_result`、`run_interrupted`、`run_completed`。

`mutation_proposals` 增加 `status`、`decision_at`、`applied_revision_id`、`rejected_reason`，不提前建立 `mutation_applications`。Agent lineage 优先落在 `section_revisions`、`mutation_proposals`、`model_requests`；只有 citation 数量和 JSON 查询真实不足时才增加 `proposal_citations`，不提前建立 `accepted_source_links`。

首版不建立独立持久化 compaction subsystem。使用最近 N 个 events，必要时把一次 bounded summary 作为普通 event 保存；只有真实 token 压力出现后才设计多级 summary。

### 5. 重做 sqlite-vec benchmark 定义

已有 8D/100k 测试改名为 `sqlite-vec correctness smoke`，不得继续作为真实性能结论。新增 10k、50k、100k chunks 的真实 benchmark，至少使用当前首选 embedding model 的真实维度，并记录 index 文件大小、vector table 大小、embedding build、增量新增/删除 1,000 chunks、cold-start open、Top-20 query p50/p95、峰值 RSS 和 rebuild 时间。文本和 metadata 使用代表性长度。

继续使用 sqlite-vec；LanceDB 仍保持 deferred。验证连续导入十个文件是否反复全量 build；若是，先增加 1–3 秒 invalidation debounce 合并更新，不立即引入复杂 copy-on-write generation。

### 6. 控制 BlockNote revision 膨胀

保存顺序固定为 `canonicalize JSON -> content hash -> hash 未变化则不创建 revision`。autosave 使用 1–2 秒 idle debounce、single-flight，新输入覆盖尚未提交的 pending save。

revision source 分类为 `manual_autosave`、`manual_checkpoint`、`agent_accepted`、`import`。建议 retention：每 section 最新 20 个 manual autosave、最近 24 小时每小时一个 checkpoint、最近 30 天每天一个 checkpoint、所有 `agent_accepted` revision，以及 Agent 修改前的直接父 revision。pruning 不放在正文提交事务内，改为 best-effort cleanup/maintenance job。

验收覆盖 30 分钟连续编辑、hash 不变不产 revision、数据库体积、Agent revision 不被普通 retention 删除和 crash recovery。

### 7. 固定三个 worker role

只保留：

```text
agent-worker
background-worker
index-worker
```

`agent-worker` 负责 Pi loop、streaming、event protocol 和 tool bridge；`background-worker`（由旧 import-worker 重命名）负责 provider probe、MinerU submit/poll/download、normalization、embedding、rerank；`index-worker` 独占 `index.sqlite`、chunking、FTS、sqlite-vec、generation build/query。

一个打开的项目最多各有一个上述 role。不增加 provider-specific worker、local HTTP server 或通用 RPC framework。公共协议只共享 envelope、request ID、session ID、error schema、logging；业务 payload 保持独立 contract。stale response 应拒绝并记录；只有 capability mismatch、协议破坏或重复非法消息才终止 worker。

### 8. 删除无需求的 watcher 和空壳模块

当前没有外部编辑自动同步需求，因此从 fixed technology stack 和依赖中删除 `chokidar`，不建立项目目录全局 watch。原文件外部变化不自动覆盖 content-addressed copy。atomic write 只保留一套经过测试的实现，不同时使用 `write-file-atomic` 与自定义实现。

仅在满足独立安全边界、独立事务边界、多个调用方、替换实现、明确生命周期或独立 invariant 测试之一时保留独立模块。CP19.5 只合并确定为空壳的转发层，不做大规模 rename churn。候选包括 project lifecycle wrapper、credentials/secrets 双抽象、knowledge/main storage 双抽象、无事务边界的 per-table repositories、独立 tool-policy/context-builder/assembly wrapper、重复 worker 目录、提前建立的 updater 和 provider factory/DI container。

## 三、文档与测试治理

后续文档分为四层目标结构：

```text
docs/
  architecture.md
  current-plan.md
  adrs/
  history/implementation-log.md
```

`architecture.md` 只保留当前不变量和 explicit non-choices；`current-plan.md` 只保留当前 checkpoint、未完成项、验收标准和 deferred 项；ADR 只记录长期决定；Phase verification、Decision Log 和历史审计迁移到 history。迁移完成前，现有 `docs/implementation-todo*.md` 作为历史计划阅读，不得覆盖本审计冻结的当前设计。`AGENTS.md` 的读取规则应改为 architecture、current-plan 和当前任务关联 ADR，不要求读取全部历史 Phase。

测试分层目标为 `pnpm check:fast`、`pnpm check:electron`、`pnpm check:e2e`、`pnpm check:package` 和独立 `pnpm benchmark`。普通业务改动不必每次运行 packaged smoke；Electron major、native sqlite、builder、worker entrypoint、Pino transport 或 release branch 变更时必须运行 package gate。关键回归保留，但清理重复验证同一 invariant 的测试。

## 四、CP19.5 源码级定向检查

在 CP20 前只做以下八项定向检查：

1. 搜索 signed URL、download URL、recovery capability、ciphertext。
2. 枚举全部 durable job type。
3. 枚举全部 `utilityProcess.fork` 调用点。
4. 统计连续编辑十分钟的 `section_revisions` 数量和数据库增量。
5. 连续导入十个文件，检查 index generation build 次数。
6. 检查 `chokidar` 和 `write-file-atomic` 的实际使用。
7. 找出只有转发作用的 repository/service/policy wrapper。
8. 用真实 embedding dimension 重跑 sqlite-vec benchmark。

同时人工检查 close final flush 与新 mutation、job cancellation/close/requeue/lease expiry、MinerU cancellation 后晚到 poll/download、index generation source fingerprint recheck、snapshot inventory 与复制一致性、worker 退出后的旧消息、以及 Agent proposal apply 前的 revision revalidation。

## 五、执行顺序与门禁

```text
19.5.1  精简文档和读取规则
19.5.2  删除持久化 signed URL
19.5.3  固化 durable 与 interactive work 边界
19.5.4  缩减 Agent 工具和持久化 schema
19.5.5  调整 BlockNote autosave/revision retention
19.5.6  重做真实维度 sqlite-vec benchmark
19.5.7  删除未使用 chokidar 和重复 atomic-write 实现
19.5.8  合并确认属于空壳的模块
```

每一项必须有源码、迁移（如适用）、测试和结构化日志证据；全部通过后才允许开始 Checkpoint 20。不得把本审计理解为回退安全边界、恢复能力、数据完整性或 Agent proposal boundary。

