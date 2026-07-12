# 003 写作方向数据模型

**状态**: 第一版设计草案；持久化文件路径、schemaVersion、验证器和 error codec 均 `NEEDS DECISION`。

**范围**: 本文定义写作动机、大纲、章节关联和恢复位置的领域数据，不定义正文 Block、资料、AI task、provider secret 或版本时间线。

## 设计原则

1. durable identity 由 main 创建并作为 opaque string 传输；数据模型不暴露绝对路径。
2. 项目文档必须具备 `kind`、`schemaVersion`、`projectId` 和 `contentRevision`，与 ADR-001 的结构化 JSON 约束一致。
3. 动机和大纲以一个完整快照表达，renderer 可以局部编辑，但 main 只接受经过校验的完整 DTO；这样排序和重复保存不会产生增量合并歧义。
4. 写作方向可以存在而没有章节；`chapterRef` 只是与 004 的不透明关联，不是正文的嵌套副本。
5. UI 的 dirty/saving/error 状态是运行时状态；最后选中条目/位置是 002-owned UI state 的贡献，不改变内容真相。

## 实体与字段

### `WritingOrientationDocument`

项目级、单作者、单层大纲的 canonical snapshot。建议逻辑载体为 `content/writing-orientation.json`，但精确路径由 001/ADR-001 决定。

| 字段 | 类型/示例 | 必填 | 校验与语义 | 所有权 |
|---|---|---:|---|---|
| `kind` | literal `writing-orientation` | 是 | 必须精确匹配；未知 kind 拒绝 | 003 schema |
| `schemaVersion` | string/整数版本 | 是 | 只接受已支持版本；未知版本返回可理解错误 | 003 + storage ADR |
| `projectId` | opaque string | 是 | 必须与当前 project session 一致；不得是路径 | 001 生成，003 引用 |
| `contentRevision` | non-negative integer 或已冻结 revision 类型 | 是 | 保存 request 的 base revision 必须匹配，冲突不得静默覆盖 | 001/storage |
| `updatedAt` | ISO 8601 timestamp | 是 | 由 main 写入；renderer 不可信任其值 | main/storage |
| `motivation` | `WritingMotivation` | 是 | 对象允许字段为空，但对象存在 | 003 |
| `outlineItems` | ordered `OutlineItem[]` | 是 | 可以为空；id 唯一，数组顺序即显示顺序 | 003 |

### `WritingMotivation`

| 字段 | 类型 | 必填 | 校验与语义 |
|---|---|---:|---|
| `problem` | string | 是（可为空） | trim 只用于判断/显示状态；保存时是否保留用户原始空白需 `NEEDS DECISION` |
| `targetReaders` | string | 是（可为空） | 允许多行；控制字符政策和长度上限 `NEEDS DECISION` |
| `desiredOutcome` | string | 是（可为空） | 允许多行；表达预期结果；长度上限 `NEEDS DECISION` |

动机三字段都允许为空，空状态必须能被 UI 识别为“尚未填写”，不能因为字段为空而伪装成保存失败。

### `OutlineItem`

| 字段 | 类型/示例 | 必填 | 校验与语义 | 所有权 |
|---|---|---:|---|---|
| `outlineItemId` | opaque ID | 是 | 同一项目内唯一且稳定；不得由标题或数组位置派生 | main 生成，003 使用 |
| `title` | string | 是 | trim 后至少一个非空白字符；最大长度 `NEEDS DECISION` | 003 |
| `summary` | string | 是（可为空） | 摘要可为空；控制字符和最大长度 `NEEDS DECISION` | 003 |
| `status` | `not_started` \| `in_progress` \| `completed` | 是 | 只允许三态；显示文字由 UI 本地化；状态不由 chapterRef 自动推断 | 003 |
| `chapterRef` | opaque string \| null | 是 | null 表示尚未关联；非 null 只能作为 004 chapter identity 引用 | 004 生成/拥有 lifecycle，003 保存/展示 |
| `position` | 不单独持久化；由 array index 表达 | 否 | 读取时从 `outlineItems` 顺序派生；不得同时维护可漂移的 position 字段 | 003 |

不保存 `chapterTitle`、正文、Block、资料引用或 provider 信息，避免与 004/005/006/007 重复真相。

### `WritingOrientationLocationContribution`

002 拥有完整 `ui-state.json`，003 只定义其可被 002 消费的最小贡献：

| 字段 | 类型 | 语义 |
|---|---|---|
| `activeArea` | literal `writing-orientation` | 表示上次恢复到写作方向面板 |
| `selectedOutlineItemId` | opaque ID \| null | 上次查看的条目；若条目已删除，打开时回退到可用位置 |
| `focusTarget` | `motivation` \| `outline` \| `null` | 可选的可访问焦点意图；不是 DOM selector |

是否与内容快照同一个 transaction、字段是否进入 002 的通用 location union、滚动位置是否持久化，均 `NEEDS DECISION`。003 不直接写完整 `ui-state.json`。

### `WritingOrientationReadModel`

这是 renderer 消费的 DTO，可由 main 将 canonical document 与 004 的只读关联信息组合而成：

| 字段 | 类型 | 说明 |
|---|---|---|
| `document` | `WritingOrientationDocument` | 最近一次成功保存的内容 |
| `chapterLinkState` | `Record<outlineItemId, 'unlinked' \| 'linked' \| 'needs_review'>` | 只读投影；缺失/重复 chapter identity 不得静默重绑 |
| `lastLocation` | `WritingOrientationLocationContribution \| null` | 002 的 location 投影 |
| `persistence` | `PersistenceSnapshot` | renderer 可展示的 saved/recovery 摘要，不含绝对路径 |

### `PersistenceSnapshot`

| 字段 | 类型 | 语义 |
|---|---|---|
| `contentRevision` | 与文档相同 | renderer 的保存基线 |
| `lastSavedAt` | ISO timestamp \| null | 最近一次成功保存时间 |
| `status` | `saved` \| `saving` \| `failed` \| `recovery_required` | 只读状态投影，不替代 renderer 的 dirty 草稿 |
| `recoverable` | boolean | 是否存在可以重试/重新载入的恢复路径 |

## 关系

```text
Project (001-owned)
└── 1 ── 1 WritingOrientationDocument (003-owned)
    ├── 1 WritingMotivation
    └── 0..N OutlineItem (ordered by array order)
        └── 0..1 chapterRef ── Chapter (004-owned, opaque relation)

WorkspaceShell (002-owned)
└── 0..1 WritingOrientationLocationContribution
```

## 状态与转换

### 大纲条目业务状态

```text
new -> not_started
not_started <-> in_progress
in_progress <-> completed
not_started <-> completed   (允许作者直接标记)
任何状态 -> deleted          (仅通过显式删除流程；有 chapterRef 时先确认)
```

- `status` 代表作者对写作计划的判断，不自动等同于章节是否存在。
- 新增条目默认为 `not_started`；默认值是否可由用户偏好改变 `NEEDS DECISION`。
- `chapterRef` 从 null 变为非 null 由 004 的章节创建流程决定；003 只刷新关联投影。
- 删除只从数组移除；如果存在 chapterRef，删除操作必须先返回“需要确认影响”，不能静默删除章节或 chapter 数据。

### renderer 持久化状态

```text
loaded/saved -> dirty -> saving -> saved
                         └──────> failed -> saving (retry)
loaded/saved -> recovery_required (main reports unresolved pending/external state)
dirty -> recovery_required (open/reload cannot prove safe merge)
```

- dirty 草稿只在 renderer 当前会话保留；save failure 时必须原样保留并可 retry。
- 最近一次成功保存的内容由 main 返回；renderer 不得把未保存草稿显示成 saved。
- 未送达 main 的进程崩溃前草稿是否进入 crash recovery 属于产品决策；本版默认只承诺成功保存和 main pending transaction recovery。

## 校验规则

### 结构与身份

1. main 必须校验 `projectId` 与当前已打开项目一致，不能接受 renderer 提供的绝对路径或任意 project root。
2. `kind`、`schemaVersion`、必需字段、JSON 可序列化值和 `contentRevision` 必须存在；未知 schemaVersion 返回迁移/不支持错误，不按“尽力读取”覆盖原文件。
3. `outlineItemId` 必须唯一；数组中不得有重复对象或重复 id；保存顺序以数组顺序为准。
4. `chapterRef` 只能是不透明 ID 或 null；003 不解析、拼接或通过它定位文件。

### 文本与业务

1. 动机允许保存全空对象，UI 必须有清晰空状态。
2. `title.trim()` 为空时拒绝保存；`summary` 可为空。
3. 不接受未约定的控制字符；哪些换行/制表字符属于允许文本、错误位置如何返回和最大长度/条目数均 `NEEDS DECISION`。
4. 重复提交同一 client mutation 不得制造重复条目或不同顺序；建议以 `baseRevision + clientMutationId` 做幂等/冲突判断，最终格式 `NEEDS DECISION`。
5. 删除请求必须说明目标 `outlineItemId` 和 base revision；main 必须重新读取关联状态，不能信任 renderer 的 `chapterRef: null`。

### 持久化与恢复

1. 每次成功保存应提高 project/content revision，并把 actor/event/change metadata 交给 001 Git adapter；具体 revision 是否全项目共享 `NEEDS DECISION`。
2. 单文件写入使用同目录临时文件和 rename；多文件或 Git commit 失败必须能由 pending transaction 表达。
3. open 时如果发现未完成 pending、外部修改、未知版本或 hashes 无法判断，不覆盖用户文件，返回稳定 recovery 状态。
4. schema migration 只能在接受 migration policy 后进行；未识别版本默认只读/阻止保存，而不是静默降级。

## 与其他 feature 的边界

| Feature | 003 依赖/提供 | 明确不负责 |
|---|---|---|
| `001-project-foundation` | projectId、当前 project session、storage adapter、全局 revision、portable root、recent/open 错误 | 创建/打开/移动/删除项目，recent index，manifest implementation |
| `002-workspace-shell` | 面板入口、保存状态投影、location contribution | shell layout、modal/focus/ESC/background scroll 全部实现 |
| `004-block-editor` | chapterRef、linked/unlinked/needs_review 投影和 chapter delete impact | 章节创建流程、正文、Block、chapter storage |
| `005-provider-settings` | 无 | provider endpoint、secret、凭据验证 |
| `006-source-library-processing` / `007-source-search-citations` | 无；未来只允许引用 opaque IDs | 资料文件、解析、检索、citation 内容 |
| `008-ai-writing-tasks` / `009-ai-proposal-review` | 只读取方向作为 future context 的可能输入，需另定 contract | AI task、proposal、provider 调用、接受/拒绝逻辑 |
| `010-version-history` | 003 提供稳定 event/content metadata 给 history boundary | 时间线、diff UI、restore UI；Git implementation 由 ADR/基础层决定 |
