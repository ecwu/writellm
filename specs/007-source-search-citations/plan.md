# Implementation Plan: 资料检索与可追溯引用

**Branch**: `007-source-search-citations`  
**Date**: 2026-07-12  
**Spec**: [spec.md](./spec.md)  
**状态**: 第一版高可行性规划；spec 仍为 Draft，技术选型暂不批准

## Summary

本 feature 在 `006-source-library-processing` 已完成且具备完整来源位置的资料片段之上，提供关键词/自然语言检索、资料名/标签过滤、上下文查看、引用插入，以及资料替换或删除后的失效检测和显式重绑。

计划采用一个 main-owned 的搜索门面：renderer 只提交受限查询并接收可展示 DTO；main 负责读取项目资料、维护可重建的检索索引、协调关键词/语义查询、校验引用目标和串行持久化；preload 只暴露命名且类型化的方法。搜索索引是派生缓存，不成为资料或正文的唯一真相；引用使用稳定的资料版本/片段身份和正文 block placement 关联，禁止静默重绑。

全文索引、向量索引、嵌入执行位置、worker/外部服务、版本策略和离线策略都保留候选，不在本计划中拍板；见 [research.md](./research.md) 和 [checklists/plan-decisions.md](./checklists/plan-decisions.md)。

## Technical Context

**Language/Version**: TypeScript 7.0.2；ESM 主工程；当前 `package.json` 为 `bun@1.3.14`、Electron 43.1.0、React 19.2.7、Vite 8.1.4。
**Primary Dependencies**: 当前只有 Electron、React、React DOM、Vite、TypeScript 和 Node types。检索/向量/嵌入候选尚未加入依赖，候选与版本策略均为 **NEEDS DECISION**。  
**Storage**: 遵循 [ADR-001](../../docs/adr/001-project-storage.md) 的可移动 `.writellm` 项目、`sources/` 资料域、`content/` 正文域、`runtime/` 可重建缓存和 main-owned 写入队列。索引具体介质、文件位置、schemaVersion 和迁移方式为 **NEEDS DECISION**，实现前需接受或更新 ADR。  
**Testing**: 使用现有 `bun run typecheck`、`bun run test`、`bun run build`、`bun run test:smoke`。纯函数/契约可由 Bun test 覆盖；renderer↔preload↔main、项目恢复和安全边界必须进入编译 Electron runtime smoke。  
**Target Platform**: Secure Electron desktop；renderer 保持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`，main 使用 Electron 自带 Node runtime。  
**Project Type**: 单项目 Electron + React desktop application。  
**Performance Goals**: 继承 spec 的 500 份已处理资料、90% 有效搜索在 5 秒内返回带来源位置的结果；冷启动/热查询、p95、索引构建和内存上限尚未定义，需在决策 checklist 中冻结。  
**Constraints**: 只有具备文本、检索表示和来源位置的片段才能作为完整可引用证据；处理中、失败或部分缺失的资料不得伪装成可用结果。renderer 不接触文件路径、原始文件读写、任意 IPC 或凭据。首版不做 PDF 导入解析、AI 任务执行、出版级参考文献排版、远程同步和多人协作。  
**Scale/Scope**: 首版目标为单作者本地项目、约 500 份已处理资料；片段数量、平均资料大小、图片/表格上下文比例和索引磁盘预算仍为 **NEEDS DECISION**。

## Project Structure

### 当前基础与计划新增

当前源码已有 001 project foundation；资料、搜索、引用和 ADR-001 内容存储尚未实现：

```text
src/
├── main/main.ts                 # 已有：安全 BrowserWindow、001 project handlers 与 011 appearance foundation
├── preload/preload.cts          # 已有：contextBridge + 单个 typed API
├── renderer/App.tsx             # 已有：启动 foundation UI
├── renderer/main.tsx            # 已有：React root
├── renderer/styles.css          # 已有：foundation 样式
├── shared/ipc.ts                # 已有：001 project DTO/六方法 contract；后续 domain contract 独立冻结
└── vite-env.d.ts                # 已有：Vite 类型
tests/                           # 当前不存在
```

实施时才计划新增以下目录/文件；它们不是当前代码，也不应在本规划阶段创建源码：

```text
src/
├── main/
│   ├── ipc/                     # 计划新增：sender 校验、request parsing、错误映射
│   ├── sources/                 # 计划新增：006 资料/片段只读 adapter
│   ├── search/                  # 计划新增：query orchestration、index lifecycle、ranking
│   ├── citations/               # 计划新增：binding、失效检测、显式 rebind/remove
│   ├── storage/                 # 计划新增：复用 001/ADR 的 main-owned project adapter
│   └── workers/                 # 计划新增：仅在 worker 方案获批后使用
├── preload/preload.cts          # 已有，计划扩展为逐方法 bridge
├── shared/
│   ├── ipc.ts                   # 已有，计划扩展 typed channels/DTO/errors
│   ├── sources.ts               # 计划新增：资料/片段展示 DTO
│   ├── search.ts                # 计划新增：查询、过滤、结果、上下文 DTO
│   └── citations.ts             # 计划新增：引用身份、状态、重绑 DTO
└── renderer/
    ├── App.tsx                  # 已有，计划接入 feature shell
    └── features/
        ├── source-search/       # 计划新增：搜索、过滤、结果和上下文 UI
        └── citations/           # 计划新增：插入、失效提示、重绑/移除 UI

tests/                           # 计划新增，当前不存在
├── unit/                        # domain validation、identity、ranking adapter
├── contract/                    # shared IPC/DTO/error contract
├── integration/                 # project fixture + index rebuild/persistence
└── smoke/                       # compiled Electron runtime boundary
```

**Structure Decision**: 保持当前单项目 `src/main`、`src/preload`、`src/renderer`、`src/shared` 布局；在 main 下按 domain 拆分，并把所有 renderer 可见类型放入 shared。索引和 provider adapter 不进入 renderer/preload。测试按 failure boundary 分为 unit、contract、integration 和 Electron smoke；由于当前没有 `tests/`，这些均为后续新增结构。

## Constitution Check

### 研究前 gate

| 原则 | 状态 | 规划判断 |
|---|---|---|
| I. Secure Desktop Boundary | PASS（设计约束） | 搜索、资料上下文、索引和引用保存均由 main 处理；renderer 只能取得脱敏、可展示 DTO。 |
| II. Typed, Minimal IPC | PASS（待 contract freeze） | 使用显式的 `searchSources`、`getSourceContext`、`insertCitation` 等 named methods；不暴露 generic IPC。方法、DTO、错误码仍需冻结。 |
| III. Specification-Driven, Minimal Evolution | BLOCKED UNTIL ACCEPTANCE | 当前 `spec.md` 为 Draft；ADR-001 已 Accepted，实现前仍必须接受本 feature spec 和跨边界决策。 |
| IV. Verification at the Failure Boundary | PASS（验证计划） | 单元检查 identity/invariants，contract 检查 DTO，Electron smoke 检查真实 preload/main/存储/恢复边界。 |

### 复杂度追踪

| Gate/问题 | 为什么当前需要记录 | 更简单的替代为何暂不接受 |
|---|---|---|
| spec 与 ADR 尚未 Accepted | 用户要求先产出规划而不实现，必须让实现 gate 保持关闭 | 直接实现会违反“先接受 spec/ADR”的项目约束；当前只写设计和决策清单 |
| 派生索引 + citation identity 跨进程/持久化边界 | 资料检索需要可重建性能，引用需要可验证追溯和失效重绑 | 直接在 renderer 扫描文件会违反安全边界；把索引当 canonical data 会增加损坏和迁移风险 |
| 可选 worker/provider adapter | 语义查询可能涉及原生模块、模型或网络 I/O | 全部同步塞入 main 可能阻塞应用；在未测量前不强行引入 worker，先保留窄接口 |

## Architecture and Phased Implementation Order

### Phase 0 — 接受条件与研究收敛

1. 接受 `007` spec，确认 `004` 的稳定 block identity/save conflict contract 和 `006` 的 source/chunk/processing output contract。
2. 评估研究候选的最小 proof-of-concept：全文查询、标签/资料过滤、上下文定位、500 资料规模、索引重建；不以 POC 自动批准依赖。
3. 冻结是否需要新增/更新 ADR，明确索引是 project-local runtime cache、provider/worker 的网络和凭据边界、离线降级和版本/原生构建策略。

### Phase 1 — Domain model 与跨进程 contract

1. 冻结 [data-model.md](./data-model.md) 中的 SourceVersion、SourceChunk、SearchIndexEntry、CitationBinding 和状态转移。
2. 冻结 [contracts/ipc.md](./contracts/ipc.md) 的 request/response/error DTO、sender 校验和方法命名。
3. 冻结 [contracts/index-provider.md](./contracts/index-provider.md) 的窄 adapter；具体库、协议和 worker placement 仍以 decision record 为准。

### Phase 2 — 资料读取与索引生命周期

1. 通过 006 adapter 读取已处理资料，不复制或重定义 PDF 解析职责。
2. 只接纳同时具备文本、检索表示、来源位置且状态允许的片段；记录 source revision 和 index revision。
3. 建立可重建、可检测 stale/corrupt 的索引；索引更新与资料 replacement/deletion 走 main-owned 串行队列。
4. 为首次建立、增量更新、取消、失败、重试和启动恢复定义可观察状态。

### Phase 3 — 搜索与上下文展示

1. main 验证 query、mode、filters、limit/cursor；在同一请求中应用资料名/标签过滤，并返回带 source/chunk identity 的结果。
2. 关键词结果提供匹配片段/高亮能力；自然语言结果必须有 query embedding 或明确的不可用错误，不能假装为关键词结果。
3. 上下文读取只返回项目内允许展示的 Markdown 位置、原始页码、图片/表格 asset refs 和安全的 fallback；不向 renderer 传绝对路径。
4. 空输入、无结果、处理中/失败资料和索引不可用均使用明确状态，不能生成“无依据结果”。

### Phase 4 — 引用写入、失效和重绑

1. 由搜索结果生成 CitationTarget snapshot，并通过 004 的 block/editor save contract 插入 placement；不要由 renderer 拼接正文标记。
2. 保存时记录 sourceId、sourceVersionId、chunkId、content/location fingerprint 和 block placement identity；同一片段多次出现保留多个 placement，但不创造无法区分的 source identity。
3. 006 报告资料删除/替换时，main 标记相关 binding 为 stale/missing；正文不得被静默改写。
4. rebind 只接受用户明确选择的候选；零候选、多个候选或内容冲突必须分别显示，不得自动选择。remove 只移除指定引用 placement，并保留可审计的正文保存结果。

### Phase 5 — 端到端验证与交付 gate

1. 先跑 `bun run typecheck`、`bun run test`、`bun run build`，再用 `bun run test:smoke` 验证 compiled Electron。
2. 用固定 fixture 覆盖关键词、自然语言、过滤、上下文、保存/重开、删除/替换、重绑/移除、外部编辑和恢复失败。
3. 在 500-资料 fixture 上测量 SC-001；另行冻结冷/热查询、p95、索引建立、内存/磁盘阈值和无网络运行口径。
4. 只有 spec、ADR、IPC contract、storage schema、error codes、offline/provider policy 和可访问性要求均已接受后，才允许生成 `tasks.md` 或实现。

## Cross-Process and Persistence Boundaries

### Renderer

- 只提交 `projectId`（若当前 workspace contract 允许）、query、query mode、sourceId/tag filter、分页参数和用户选择的 block/citation IDs。
- 只接收结果摘要、source/chunk opaque IDs、位置 DTO、已脱敏的 context asset DTO、引用状态和安全错误。
- 不接收/传入绝对路径、任意文件内容读写器、raw `ipcRenderer`、provider secret、通用 SQL 或 provider client。

### Preload

- 以 `contextBridge` 逐一映射 shared 类型中的 named methods；禁止 `send/invoke` 通用转发。
- 仅做最小参数序列化，不绕过 main validation；不要把 Node/native search package 放入 preload。

### Main

- 校验 IPC sender、当前 project scope、query/filter 长度、IDs、分页上限、schema/revision 和引用 placement；错误映射为稳定 code + 安全 message。
- 是资料读取、索引写入、provider/worker 调度、项目文件和正文保存的唯一 authority。
- 为索引更新、引用插入/失效/重绑使用串行写入队列；在写入失败、pending transaction 或 revision conflict 时返回恢复状态，不报告假成功。

### Provider/worker

- 只通过 [index-provider.md](./contracts/index-provider.md) 与 main 交互；worker 不成为 renderer 的第二条 IPC 通道。
- 如果使用外部 embedding/search provider，请求只能由 main 发起，凭据来自 005 的受保护存储；endpoint、网络、超时、重试、数据出境和离线策略在决策前均为 **NEEDS DECISION**。
- native addon、worker thread、utility process 或 child process 的选型未定；任何选项都必须保留可重建索引和可解释失败。

### 持久化

- `sources/` 是 006 资料、解析产物、source version、chunk provenance 的 canonical domain；007 只消费其稳定 DTO，并保存索引引用所需的 source revision/locator identity。
- `runtime/` 中的 search index、provider cache、pending/rebuild marker 都是派生或恢复状态；删除后可由 canonical source/chunk 重建，不可成为正文引用的唯一来源。
- `content/` 由 004 的 block/editor storage contract 管理；citation marker/binding 必须和 block stable ID 一起保存，不能仅存 renderer memory。
- 文件名、JSON/JSONL/SQLite/Arrow 等具体格式、hash 算法、schemaVersion 与 migration policy 不在本计划拍板，需 ADR/decision record。

## Constitution Check — Post-Design Re-evaluation

| 原则 | 设计后状态 | 证据/剩余 gate |
|---|---|---|
| I. Secure Desktop Boundary | PASS（待 runtime smoke） | 所有文件、索引、provider 和引用写入均 main-owned；测试必须验证 renderer 无 Node/filesystem 能力。 |
| II. Typed, Minimal IPC | PASS（待冻结） | contracts 只列必要 named methods；方法名、DTO、错误码、sender validation 需与 001/004/006 一起接受。 |
| III. Specification-Driven, Minimal Evolution | BLOCKED UNTIL ACCEPTANCE | `spec.md` Draft，且本 feature 的 index/provider/storage decisions 尚未接受；ADR-001 已 Accepted。 |
| IV. Verification at the Failure Boundary | PASS（需要 fixture） | 计划包含 unit/contract/integration/runtime smoke；当前仓库没有 feature fixture 或新增 smoke 实现。 |

**实施状态**: 规划可以供评审，不能作为实现授权。未决项见 [plan-decisions.md](./checklists/plan-decisions.md)。

## Complexity Tracking

见上面的“复杂度追踪”。当前没有为宪章例外申请批准；所有复杂度均是待评估的跨边界设计风险，若决策后仍需例外，必须补充 rationale、impact 和 approval。

## ADR-003 / 011 renderer integration

- 搜索输入、筛选、结果状态和上下文查看优先复用 `FormField`/`Input`、`Select`、`Button`、`StatusNotice`、`ScrollArea`、`Dialog` 与 semantic tokens；ranking、citation policy 和 source context 仍归 007。
- source context 使用 `.typeset-reading` 或 `.typeset-compact`，不得让 appearance 改写 source artifact、citation anchor 或插入内容。
- feature 不直接导入 Base UI、不复制 primitive；覆盖 light/dark、forced-colors、reduced-motion、键盘与 focus return，缺口走 `FoundationExtensionRequest`。
