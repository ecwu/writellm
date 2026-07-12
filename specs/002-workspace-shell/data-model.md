# Data Model: 写作工作台外壳

**Feature**: [spec.md](./spec.md)

**Boundary note**: 本模型描述 shell 需要消费、协调和展示的实体，不决定 UI library、state library、存储包或 IPC 实现。所有跨进程/持久化字段都以 `NEEDS DECISION` 标记，不能把候选库硬编码进 schema。

## 领域实体

### 1. WorkspaceShellState（工作台会话状态）

工作台在一个 renderer 会话中的可协调状态。它不是项目正文，也不是 Git history。

| 字段 | 类型 | 必填 | 持久化 | 说明/校验 |
|---|---|---:|---:|---|
| `surface` | `'workspace'` | 是 | 否 | 只有在 001 返回有效项目后才进入；launch page 不属于本模型的业务状态。 |
| `projectId` | opaque `ProjectId` | 是 | 由 001 决定 | 只接受 main 产生/验证的 opaque ID；不得接受绝对路径作为身份。 |
| `activePanel` | `PanelId \| null` | 是 | 默认否 | 同一时间最多一个；必须属于已注册且当前可用的 panel。 |
| `activeModal` | `ModalId \| null` | 是 | 否 | modal 打开时必须有可访问名称和焦点策略；默认不跨重启恢复。 |
| `focusOrigin` | `FocusOrigin \| null` | 否 | 否 | 记录触发入口的稳定 DOM ref/key 或 fallback descriptor；不可序列化为 durable project data。 |
| `layoutMode` | `'wide' \| 'compact'` | 是 | 否 | 由 viewport/布局规则派生，不代表 native window API。阈值需与 960×640 验收规则一致。 |
| `backgroundInteraction` | `'enabled' \| 'inert'` | 是 | 否 | `activeModal !== null` 时必须为 `inert`；不能只靠半透明遮罩。 |
| `editorContextRef` | opaque `EditorContextRef \| null` | 否 | 否 | 只指向未来编辑器上下文，不携带正文；由 004/编辑 owner 定义。 |
| `status` | `WorkspaceStatus` | 是 | 否 | 由 project/editor/其他 owner 输入后映射；不得凭颜色单独表达。 |
| `errorNotice` | `WorkspaceErrorNotice \| null` | 否 | 否 | 只放安全摘要、稳定 code 和 owner action；不放 raw exception、path、secret 或正文。 |

### 2. PanelDescriptor（工具面板描述）

由 shell registry 或 feature slot 提供，用来生成可访问入口和面板 host；不是具体业务数据。

| 字段 | 类型 | 必填 | 校验 |
|---|---|---:|---|
| `id` | opaque string / `PanelId` | 是 | 在当前 shell registry 内唯一；不得根据用户输入拼接 DOM id。 |
| `ownerFeature` | feature key | 是 | 必须是已接受的 feature；当前可包括 foundation/orientation/editor/provider 等 owner，具体列表 `NEEDS DECISION`。 |
| `accessibleName` | non-empty string | 是 | 图标入口必须有 accessible name 或等价可见文字。 |
| `label` | non-empty string | 是 | 窄窗口时仍需有文字或可理解提示。 |
| `placement` | `'rail' \| 'surface'` | 是 | v1 只允许 shell 规划的区域，不允许 feature 任意创建原生窗口。 |
| `availability` | `'available' \| 'disabled' \| 'hidden'` | 是 | disabled/hidden 必须有可解释原因或设计规则。 |
| `render` | renderer-owned slot | 是 | 只在 renderer 执行；不得携带 main/preload handle。 |

### 3. ModalDescriptor（模态描述）

描述一个需要聚焦的 renderer modal。具体 modal 内容和业务提交由 owner feature 负责。

| 字段 | 类型 | 必填 | 校验 |
|---|---|---:|---|
| `id` | `ModalId` | 是 | 当前活动模态唯一；nested modal 是否允许为 `NEEDS DECISION`。 |
| `ownerFeature` | feature key | 是 | 必须能提供关闭、成功、失败和取消语义。 |
| `title` | non-empty string | 是 | 为 dialog accessible name 提供可读标题，或显式 `aria-label`。 |
| `description` | string \| null | 否 | 复杂结构不应被强行作为一整段 `aria-describedby`。 |
| `dismissPolicy` | `'escape-and-outside' \| 'escape-only' \| 'explicit-only'` | 是 | 破坏性/未保存操作须明确关闭策略；不能由库默认值隐式决定。 |
| `initialFocus` | `FocusTarget` | 是 | 可为第一个动作、静态标题/说明或最不破坏性动作；需按内容类型决定。 |
| `returnFocus` | `FocusTarget` | 是 | 默认返回 trigger；trigger 不存在时必须有合理 fallback。 |

### 4. WorkspaceStatus（工作台状态展示）

这是 owner 状态到 shell 可理解视图的稳定映射，不是项目存储的最终状态。

```text
WorkspaceStatus =
  | { kind: 'idle'; label: string }
  | { kind: 'unsaved'; label: string; action?: WorkspaceAction }
  | { kind: 'saving'; label: string }
  | { kind: 'saved'; label: string; timestamp?: string }
  | { kind: 'error'; label: string; error: WorkspaceErrorNotice; action?: WorkspaceAction }
  | { kind: 'needs-action'; label: string; error: WorkspaceErrorNotice; action?: WorkspaceAction }
```

校验：`label` 必须可单独理解；`saved` 不能由保存请求开始时提前显示；error/needs-action 必须保留明确下一步；颜色只能是辅助信息。具体 timestamp 精度、是否显示 owner 名称和 live-region politeness 为 `NEEDS DECISION`。

### 5. WorkspaceErrorNotice（安全错误摘要）

```text
WorkspaceErrorNotice = {
  code: WorkspaceErrorCode,
  message: string,
  retryable: boolean,
  ownerAction?: WorkspaceAction,
  correlationId?: string
}
```

建议的 shell-level code（不是已冻结的 main/storage error enum）：

```text
WorkspaceErrorCode =
  | 'SAVE_FAILED'
  | 'STORAGE_RECOVERY_REQUIRED'
  | 'EXTERNAL_CHANGE'
  | 'OWNER_UNAVAILABLE'
  | 'VALIDATION'
  | 'UNKNOWN'
```

`message` 必须是可向用户显示的安全摘要，不能包含 secret、完整 provider credential、absolute path、raw stack 或任意文件内容。底层 001/storage/provider 错误到这些 shell code 的映射、是否保留底层 code、`correlationId` 的隐私策略均为 `NEEDS DECISION`。

### 6. FocusTarget / WorkspaceAction（交互动作）

```text
FocusTarget =
  | { kind: 'trigger'; controlId: string }
  | { kind: 'element'; elementRef: unknown }   // renderer-only，不得持久化
  | { kind: 'fallback'; region: 'editor' | 'panel' | 'status' }

WorkspaceAction =
  | { kind: 'retry'; actionId: string }
  | { kind: 'recover'; actionId: string }
  | { kind: 'open-owner'; actionId: string }
```

这里只定义语义，不定义组件库回调或 IPC channel。`elementRef` 不能进入 shared IPC DTO；跨进程只传经过白名单的 `actionId`，由 owner 再决定是否调用项目 IPC。

## 关系与归属

```text
Project (001) 1 ── 1 WorkspaceShellState (renderer session)
WorkspaceShellState 1 ── 0..1 PanelDescriptor active
WorkspaceShellState 1 ── 0..1 ModalDescriptor active
WorkspaceShellState 1 ── 0..1 EditorContextRef (004 owner)
WorkspaceShellState 1 ── 1 WorkspaceStatus view
WorkspaceStatus 0..1 ── 0..1 WorkspaceErrorNotice
PanelDescriptor/ModalDescriptor N ── 1 owner feature
```

边界说明：

- `Project` 的身份、名称、schemaVersion、路径和持久化由 001/main/ADR-001 负责；shell 只拿安全摘要。
- `EditorContextRef` 指向 004 的编辑上下文，shell 不保存正文、selection model 或 block 数据。
- 003/004/005 的业务状态可以映射为 status 或提供 panel，但不得把业务实体加入 shell schema。
- shell 不创建 provider secret、source、AI task、proposal、history 或 Git entity。

## 状态与转换

### 会话状态

```text
no-project
  -- valid project snapshot --> ready
ready
  -- open panel --> panel-open(panelId)
panel-open(panelId)
  -- switch panel --> panel-open(otherPanelId)
panel-open(panelId)
  -- close --> ready (focus returns to trigger/editor fallback)
ready/panel-open
  -- open modal --> modal-open(modalId, background=inert)
modal-open
  -- escape/outside/explicit close --> prior state (focus return/fallback)
any
  -- owner status change --> same interaction state + WorkspaceStatus update
any
  -- project close/open or owner failure --> no-project or needs-action/error
```

规则：

1. `activePanel` 变更不得销毁主要编辑上下文的身份；其内容、selection、scroll position 的保存由 editor owner 提供，但 shell 不能通过切换主动重建。
2. modal 打开时 active panel 可以保留为背景上下文，但 background 必须不可操作；modal 是否能再开 modal 为 `NEEDS DECISION`。
3. Escape 的消费顺序、外部点击是否关闭和未保存阻止关闭必须在 `ModalDescriptor.dismissPolicy` 与 contract 中明确，不能完全依赖候选库默认值。
4. focus target 不存在时，必须按 editor/panel/status 的语义 fallback，而不是把焦点丢到 body。

## 校验规则

### Renderer/session 校验

- `projectId` 非空且来自已验证的 project DTO；不接受 path。
- `activePanel` 只能是 registry 中一个 id；未知 id 降级为 `null` 并产生可诊断的非敏感状态。
- `activeModal` 只能对应一个 descriptor；dialog 必须有 accessible name、关闭机制和初始/返回焦点。
- modal 时 `backgroundInteraction === 'inert'` 且 background scroll policy 已执行；关闭后恢复之前状态。
- status label、error summary、icon tooltip 必须能在不依赖颜色时理解。
- `WorkspaceAction.actionId` 必须由 owner 白名单提供；renderer 不构造任意 main command。

### IPC/持久化校验

- 任何跨进程 request 必须是 shared typed DTO，由 main 重新验证；不信任 renderer 的 projectId、revision、actionId 或 status。
- 不跨边界传 `elementRef`、绝对路径、secret、任意文件内容、raw exception 或 React store。
- durable UI fields 只能在接受 schema/ADR 后写入 `ui-state.json`；字段必须带 `kind`、`schemaVersion`、`projectId`（若适用）并定义未知版本行为。
- shell 不能用本地 store 覆盖 main 返回的 project/storage truth；保存失败必须保留当前可恢复状态。

## 持久化候选与未决边界

| 候选字段 | 默认建议 | 当前决定 |
|---|---|---|
| `activePanel` | session-only；重开项目进入默认 panel/owner-defined location | `NEEDS DECISION` |
| `activeModal` | 永不持久化 | `NEEDS DECISION`（是否明确写成硬规则） |
| `focusOrigin` / DOM refs | 永不持久化 | 不应持久化；需写入 contract |
| `layoutMode` | 派生于 viewport | 不持久化；阈值需明确 |
| rail collapsed / last panel preference | 可选 `ui-state.json` 字段 | `NEEDS DECISION`，需要 ADR/schema/migration/recovery |
| editor last location | 由 001/003/004 owner 管理 | shell 只消费 opaque ref；字段归属 `NEEDS DECISION` |

