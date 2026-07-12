# 数据模型：资料检索与可追溯引用

**状态**：设计草案；字段语义可评审，持久化格式/schemaVersion/hash 算法仍为 `NEEDS DECISION`。  
**边界**：本模型描述 007 需要消费、派生或关联的实体，不替代 ADR-002/001 的 project identity、已接受 ADR-001 的内容存储边界、004 canonical chapter 或 006 source contract。

## 1. 模型原则

1. `Source`/`SourceVersion`/`SourceChunk` 的 canonical ownership 属于 006；007 不重新定义 PDF 解析和资料处理。
2. `SearchIndexEntry` 是可重建派生数据，不能替代 `SourceChunk`，也不能单独支撑引用恢复。
3. 资料名称可重复；所有过滤、引用和失效判断使用 opaque `sourceId`、`sourceVersionId`、`chunkId`，不用名称或路径做身份。
4. 引用必须同时记录“当时指向的 source version/chunk”和必要的显示 snapshot；snapshot 用于失效后解释，不等于当前资料仍然有效。
5. 所有状态和 identity 均可被 main 校验；renderer 只能收到 DTO，不能提交任意对象、路径、SQL 或 provider-specific 类型。

## 2. 实体与字段

### 2.1 Source（资料摘要，006-owned）

| 字段 | 类型 | 必需 | 约束/说明 |
|---|---|---:|---|
| `sourceId` | opaque string | 是 | 项目内稳定；不得由文件名或绝对路径派生。 |
| `projectId` | opaque string | 是 | 必须匹配当前打开项目。 |
| `displayName` | string | 是 | 用于展示/过滤；允许重复，trim 后不能为空。 |
| `tags` | string[] | 是 | 去重、trim；空数组合法；标签名限制由 006/项目通用校验决定。 |
| `lifecycleState` | enum | 是 | `importing`、`processing`、`ready`、`partial`、`failed`、`deleted`；具体与 006 contract 对齐。 |
| `activeVersionId` | opaque string/null | 否 | 当前显示/检索版本；不存在时不得返回可引用结果。 |
| `createdAt` / `updatedAt` | timestamp | 是 | main 生成/校验。 |

007 只读 Source 摘要。删除/替换由 006/storage domain 产生事件或可查询的版本变化；007 负责让索引和引用状态跟随变化。

### 2.2 SourceVersion（资料版本，006-owned）

| 字段 | 类型 | 必需 | 约束/说明 |
|---|---|---:|---|
| `sourceVersionId` | opaque string | 是 | 每次成功导入/替换/重处理产物的稳定版本身份。 |
| `sourceId` | opaque string | 是 | 外键指向 Source。 |
| `processingState` | enum | 是 | 至少能区分 `processing`、`ready`、`partial`、`failed`。 |
| `contentRevision` | opaque string/number | 是 | 与 006/ADR revision 语义一致，不能由 renderer 提供。 |
| `processorRevision` | string | 否 | 解析器/切分器/embedding 产物版本；用于判断索引是否需要 rebuild。 |
| `title` | string | 否 | source context 展示用。 |
| `canonicalMarkdownRef` | opaque ref | 否 | 仅供 main 内部读取/校验；不跨 IPC 传绝对路径。 |
| `originalLocationSummary` | display DTO | 否 | 可展示的来源摘要；原始文件路径不出 renderer。 |
| `deletedAt` | timestamp/null | 否 | 删除后保留最小历史/引用诊断所需信息，策略与 006/ADR 决定。 |

### 2.3 SourceChunk（资料片段，006-owned）

| 字段 | 类型 | 必需 | 约束/说明 |
|---|---|---:|---|
| `chunkId` | opaque string | 是 | 在 source version 内稳定；若重切分产生新 chunk identity。 |
| `sourceId` / `sourceVersionId` | opaque string | 是 | 必须存在且匹配。 |
| `text` | string | 是 | 非空、可展示；不接受仅图片/空白 chunk 作为可引用证据。 |
| `parsedLocator` | structured locator | 是 | Markdown/段落/标题/offset 等解析后位置，具体字段与 006 freeze。 |
| `originalLocator` | structured locator | 是 | 至少能表达 page/region；缺失时不能成为可引用结果。 |
| `contextAssetRefs` | AssetRef[] | 是 | 可为空；图片/表格与文本的相邻关系来自 006。 |
| `retrievalRepresentation` | representation metadata | 是 | 表示该 chunk 已有关键词索引项或 embedding 等检索表示；不在模型中硬编码某个库的数据结构。 |
| `chunkContentFingerprint` | opaque digest | 是 | 对 text + locator 语义的稳定摘要；算法和编码 **NEEDS DECISION**。 |
| `eligibility` | enum/derived | 是 | `eligible` 或 `ineligible`；只有 text、retrievalRepresentation、originalLocator 全部可验证且 source version 状态允许时才为 eligible。 |

### 2.4 SearchIndexEntry（007-owned derived）

| 字段 | 类型 | 必需 | 约束/说明 |
|---|---|---:|---|
| `indexEntryId` | opaque string | 是 | 可由 source version/chunk identity 映射，但不依赖某库的内部 row id。 |
| `sourceId` / `sourceVersionId` / `chunkId` | opaque string | 是 | 用于过滤、回查 canonical chunk 和判断 stale。 |
| `indexRevision` | opaque string | 是 | 表示 entry 对应的 source/processor/embedding schema 版本。 |
| `searchableFields` | derived | 是 | 由 adapter 决定的检索字段；不能成为 UI contract。 |
| `filterFields` | derived | 是 | 至少可按 sourceId、displayName identity、tag、eligibility 过滤。 |
| `embeddingModelIdentity` | string/null | 否 | 仅当 entry 有 embedding；model/version 变化时需标记 stale/rebuild。 |
| `indexState` | enum | 是 | `queued`、`indexed`、`stale`、`error`、`removed`。 |
| `lastErrorCode` | safe error code/null | 否 | 不保存 provider secret/raw response。 |

该实体的持久化文件/数据库/表结构和是否拆分 lexical/vector index 为 **NEEDS DECISION**。无论选择何种候选，必须能通过 SourceVersion/SourceChunk rebuild。

### 2.5 SearchQuery（请求时实体，不一定持久化）

| 字段 | 类型 | 必需 | 约束/说明 |
|---|---|---:|---|
| `queryId` | opaque string | 是 | main 生成，用于日志、取消和 error correlation。 |
| `text` | string | 是 | Unicode trim 后不能为空；长度、控制字符和最大 token 预算需冻结。 |
| `mode` | enum | 是 | `keyword`、`natural-language`、`hybrid`、`auto`；最终可用 mode 需与候选能力决定。 |
| `sourceIds` | opaque string[] | 否 | 只允许当前 project 的 source IDs。 |
| `tagIds/names` | string[] | 否 | 由 main 规范化；空标签过滤语义需冻结。 |
| `includeIneligible` | boolean | 是 | 产品默认必须为 false；即使内部诊断允许，也不能进入可引用结果。 |
| `limit` / `cursor` | number/string | 是 | main 设上限并拒绝任意分页对象；top-k/cursor 规则 **NEEDS DECISION**。 |

### 2.6 SearchResult（展示 DTO）

| 字段 | 类型 | 必需 | 约束/说明 |
|---|---|---:|---|
| `resultId` | opaque string | 是 | 一次查询结果中的稳定引用，用于后续 context/citation request；不是 source identity。 |
| `sourceSummary` | SourceSummaryDto | 是 | displayName、sourceId、tags、lifecycle/index state 的安全摘要。 |
| `sourceVersionId` / `chunkId` | opaque string | 是 | 允许 main 重新验证；renderer 不得自行信任。 |
| `text` / `matchedText` | string | 是 | 可展示片段；高亮标记不能允许 HTML 注入。 |
| `parsedLocator` / `originalLocator` | display locator | 是 | 为空即不满足可引用结果。 |
| `contextAssetRefs` | AssetRef[] | 是 | 仅返回允许展示的 asset identity/安全 metadata。 |
| `score` / `rankingKind` | number/string | 否 | 仅用于展示/排序解释，不作为引用有效性的依据。 |
| `citationEligibility` | enum | 是 | `eligible` 或 `ineligible`，main 计算；ineligible 不允许 insert citation。 |
| `indexRevision` | opaque string | 是 | context/citation 时用于检测结果过期。 |

### 2.7 ContextWindow（上下文视图 DTO）

包含 `sourceId`、`sourceVersionId`、中心 `chunkId`、相邻 chunk 摘要、Markdown heading/offset、original page/region、图片/表格 asset refs、可理解的缺失上下文提示和 `contextRevision`。它不得包含绝对路径、任意文件 URL、原始 provider response 或未经安全处理的 HTML。

### 2.8 CitationTarget（引用目标 snapshot）

这是引用在插入时捕获的资料依据身份，不等于正文 placement：

| 字段 | 类型 | 必需 | 约束/说明 |
|---|---|---:|---|
| `citationTargetId` | opaque string | 是 | 同一 source version/chunk anchor 可被多个正文 placement 引用。 |
| `sourceId` / `sourceVersionId` / `chunkId` | opaque string | 是 | 组合身份；来源删除/替换后可判断失效。 |
| `chunkContentFingerprint` | opaque digest | 是 | 检测同一 chunk identity 下的内容漂移。 |
| `locatorFingerprint` | opaque digest | 是 | 检测位置漂移；算法 **NEEDS DECISION**。 |
| `displaySnapshot` | object | 是 | source name、text excerpt、parsed/original locator、createdAt；用于失效诊断/展示。 |
| `status` | enum | 是 | `valid`、`stale`、`missing`、`ambiguous`、`removed`。 |
| `statusReason` | safe code/null | 否 | 例如 `SOURCE_VERSION_REPLACED`、`SOURCE_DELETED`、`CONTENT_DRIFT`。 |

### 2.9 CitationBinding（正文 placement，004-owned content relation）

| 字段 | 类型 | 必需 | 约束/说明 |
|---|---|---:|---|
| `bindingId` | opaque string | 是 | 每个正文出现位置唯一。 |
| `blockId` | opaque string | 是 | 指向 004 的稳定 content block；block 不存在时标记需要检查。 |
| `placementId` | opaque string | 是 | 同一 block 内的具体 citation marker 位置；split/merge 由 004 contract 负责迁移或标记。 |
| `citationTargetId` | opaque string | 是 | 指向 CitationTarget；同一 target 可有多个 binding。 |
| `insertedAt` / `updatedAt` | timestamp | 是 | main 生成。 |
| `contentRevision` | opaque string | 是 | 插入/更新时的正文 revision，用于冲突保护。 |

正文中如何编码 marker、JSON/Markdown 的具体字段和 Git event trailers 遵循 004/ADR-001；007 不另造第二套正文格式。

### 2.10 RebindCandidate（用户决策 DTO，不一定持久化）

包含 `sourceId`、新的 `sourceVersionId`、`chunkId`、display excerpt/locators、candidate reason、score/qualification 和相对于原 fingerprint 的差异说明。候选列表可以由 main 生成，但 rebind 只有用户明确选择一个 candidate 后才会改变 CitationTarget；零候选和多候选不可静默选择。

## 3. 关系

```text
Source 1 ── * SourceVersion 1 ── * SourceChunk
                                      │
                                      ├── 0..1 SearchIndexEntry (derived)
                                      │
                                      └── 0..* CitationTarget
                                                   │
Block 1 ── * CitationBinding ──────────────── 1 ───┘
```

- `SourceVersion` replacement 不复用旧版本的 `chunkId`，除非 006 contract 明确保证 identity 语义；默认以新 version 触发 stale 检测。
- `SourceChunk` 可被多次搜索命中和多处引用；搜索 resultId 不应被持久化为引用身份。
- `CitationBinding` 是位置关系，`CitationTarget` 是证据关系；删除一个 placement 不得删除其他 placement 的 target。

## 4. 状态与转移

### 4.1 Search eligibility/index state

```text
SourceVersion processing/partial/failed
  └─> ineligible（不得进入完整证据结果）

SourceVersion ready + valid chunk fields
  └─> queued ──> indexed
                 ├─> stale ──> queued（rebuild）
                 ├─> error ──> queued（retry）
                 └─> removed（source/version 删除）
```

`partial` 是否允许关键词诊断性结果必须由产品决策冻结；默认不进入可引用结果，且 SearchResult 的 `citationEligibility` 必须为 `ineligible`。

### 4.2 Citation status

```text
valid
 ├─ source version replaced / content drift ─> stale
 ├─ source deleted / unavailable             ─> missing
 ├─ block/marker identity lost               ─> ambiguous
 └─ user removes binding                     ─> removed

stale/missing/ambiguous
 ├─ user selects one valid RebindCandidate  ─> valid
 └─ user removes binding                   ─> removed
```

任何自动扫描只能更新状态和候选，不能执行 `stale -> valid` 的隐式转移。

## 5. 校验与不变量

### 查询/过滤

- 空输入、超长输入、控制字符、超限 limit/cursor 由 main 拒绝；错误必须指出字段，不回显敏感 provider 信息。
- sourceId、sourceVersionId、tag 和 block/citation IDs 必须属于当前打开项目；renderer 提供未知/跨项目 ID 时返回 `INVALID_SCOPE` 或等价稳定错误。
- source name 仅用于展示/输入搜索；同名资料仍必须以 sourceId 区分。
- 资料名过滤与标签过滤的 AND/OR 语义、空标签语义、排序稳定性和分页边界需要在 contract freeze 时明确。

### 可引用资格

- `text` 非空、`retrievalRepresentation` 可验证、`originalLocator` 可验证、source version lifecycle 允许且 index entry 未 stale，才可 `citationEligibility=eligible`。
- 只有 keyword 结果但缺少 locator、只有 embedding 但缺少 text、或上下文 asset 不可读取，都不能进入 citation insert。
- score 低不等于失效；有效性由 identity/version/provenance 验证，不由 ranking score 决定。

### 引用身份/重绑

- `sourceId + sourceVersionId + chunkId + chunkContentFingerprint + locatorFingerprint` 是逻辑 identity 组合；digest 算法、规范化、碰撞处理和版本化尚未决定。
- 原资料被替换时保留 snapshot，标记 stale；资料被删除时标记 missing；正文不得被静默修改。
- 重绑必须带原 target、用户选择的 candidate、当前 content revision 和 expected target status；revision 不一致时返回冲突，不覆盖更新内容。
- 同一片段多次插入共享 target identity，但每个正文位置拥有独立 bindingId/placementId。

### 持久化/恢复

- index entry 可丢失并重建；CitationTarget snapshot 和 CitationBinding 不可仅存在派生 index 中。
- 写入引用前必须由 main 再读/校验当前 source version、chunk provenance 和 block revision；search result 过期不得直接写入。
- pending transaction、未知 schemaVersion、索引损坏或无法判断是否已提交时，返回 ADR-001 规定的恢复错误语义；不得报告成功或覆盖用户正文。

## 6. 跨 feature 边界

| 领域 | 由谁拥有 | 007 允许做什么 |
|---|---|---|
| 项目根目录、文件读写、Git、pending/recovery | 001 + ADR-001/main | 通过已接受的 storage adapter 请求读写；不直接使用 renderer 路径。 |
| PDF、解析 Markdown、图片/表格、source/chunk、processing state | 006 | 消费稳定 read DTO 和版本变化；不重新解析/修改 canonical source。 |
| block stable ID、正文保存、split/merge、save conflict | 004 | 通过其 content contract 请求插入/绑定；不直接拼接或覆盖章节文件。 |
| Provider secret/config | 005 | 只使用受保护的 embedding/provider capability；不读取/持久化 key。 |
| AI task context | 008 | 可消费作者选择的 CitationTarget/上下文；不定义搜索排名。 |
| Proposal review | 009 | 可显示引用失效警告/依据；不负责 source rebind。 |
| 版本事件/恢复界面 | 010 | 通过 stable event metadata 记录引用/索引变化；不成为搜索真相。 |
