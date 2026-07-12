# Data Model: 写作工作台外壳

**Status**: Draft design; renderer-only and non-persistent

## WorkspaceSurface

```ts
type WorkspaceSurface =
  | { kind: 'launch' }
  | { kind: 'workspace'; project: ProjectSnapshot };
```

`ProjectSnapshot` 是 001 已冻结的 `{ projectId, displayName }`。只有 001 的成功结果可建立 workspace surface；cancel/error 不改变为 workspace。

## WorkspaceSession

```ts
type WorkspaceSession = {
  surface: WorkspaceSurface;
  activePanelId: ToolPanelId | null;
  panelMode: 'preview' | 'pinned' | null;
  panelFocusReturnKey: FocusReturnKey | null;
  latestStatusSequenceBySource: ReadonlyMap<StatusSourceId, number>;
  statusBySource: ReadonlyMap<StatusSourceId, OwnerStatusSummary>;
};
```

### Invariants

- `surface.kind === 'launch'` 时 panel/focus/status maps 为空。
- 同时最多一个 `activePanelId`。
- `activePanelId === null` 当且仅当 `panelMode === null`；preview 可由 pointer grace timer 关闭，pinned 不响应 blur/pointer-leave timer。
- 所有字段仅存在于当前 renderer 会话，不序列化、不跨重启恢复。
- layout mode 由 CSS 推导，不进入 session。
- Dialog open state、selection、scroll、slot content 和 DOM refs 不属于 shell model。

## WorkspaceRegion

| Region | Required semantics | Owner |
|---|---|---|
| project-navigation | 当前项目名称、返回启动页入口 | 002 composition；项目 identity 属于 001 |
| tool-navigation | 有名称的 panel triggers 与 active state | 002 |
| workspace-slot | 持续挂载、有名称的主要内容区域与 focus fallback | 002 container；内容属于 consumer |
| tool-panel | 最多一个、有 heading/close path 的辅助区域 | 002 host；内容属于 panel owner |
| workspace-status | 可见、非颜色、可公告的 owner status | 002 host；事实/action 属于 owner |

## WorkspaceSlot

```ts
type WorkspaceSlotProps = {
  project: ProjectSnapshot;
  children: ReactNode;
};
```

同一 `projectId` 会话中 slot root identity 必须稳定。panel open/switch/close、status updates、theme changes 与 responsive reflow 不得更换 key、卸载或重建 root。

## ToolPanelDescriptor

```ts
type ToolPanelDescriptor = {
  id: ToolPanelId;
  label: string;
  disabled?: boolean;
  render(): ReactNode;
};
```

- `id` 在当前 registry 唯一且稳定。
- `label` 同时支持 visible copy/accessible name；Tooltip 只是补充。
- disabled trigger 不可成为 active panel。
- 未注册或当前不可用的 descriptor 不产生 trigger；不渲染未来工具占位入口。
- content 不得拥有 shell、项目 identity 或其他 panel 的生命周期。

## FocusReturnKey

稳定的 renderer control key，不是 DOM node、selector、path 或持久化 id。关闭时通过 registry 查找当前 connected/enabled trigger；找不到则聚焦 workspace slot 的命名 fallback。

## OwnerStatusSummary

```ts
type OwnerStatusSummary = {
  sourceId: StatusSourceId;
  sequence: number;
  state:
    | 'in-progress'
    | 'complete'
    | 'error'
    | 'needs-action'
    | 'unknown'
    | 'owner-unavailable';
  severity: 'info' | 'success' | 'warning' | 'error';
  message: string;
  action?: { label: string; invoke(): void };
};
```

### Validation and ordering

- `sourceId` 在当前 renderer session 内稳定；`sequence` 为 owner 单调递增的有限非负整数。
- shell 只接受同一 source 的 `sequence > lastSeen`；重复或更小 sequence 是 no-op。
- message/action label 必须非空并由 owner 安全化；不得含路径、secret、raw exception 或项目内容。
- action 只调用 owner callback，不解释为 IPC/channel/file command。
- severity 与 state 必须一致：`complete` 可 success；`error` 必须 error；其他状态不得伪装 success。
- 多 source 同时存在时，展示优先级为 `error > needs-action > owner-unavailable > unknown > in-progress > complete`；同 state 取较新 accepted sequence，再以 sourceId 稳定排序。
- status region 只渲染上述规则选出的一个主状态，不渲染历史或并列列表。

## State transitions

| Event | Preconditions | Result |
|---|---|---|
| `workspace.enter(project)` | 001 success | 建立 workspace，清空 panel/focus/status |
| `workspace.leave` | workspace | 回 launch，清空全部 session state |
| `panel.activate(id,key)` | registered and enabled | 当前 id 则 close；否则原子替换 active id/key |
| `panel.preview(id,key)` | pointer enters registered/enabled trigger | 设置 active id 与 preview mode；不移动键盘焦点 |
| `panel.previewLeave` | preview mode and pointer outside trigger/preview | grace period 后 close；重新进入则取消 pending close |
| `panel.pin(id,key)` | click/keyboard activation | 设置 active id 与 pinned mode；取消 preview timer |
| `panel.close` | active panel | active/key 清空；执行一次 focus restoration |
| `status.receive(summary)` | valid and newer sequence | 更新该 source snapshot；旧/重复 no-op |
| `status.remove(sourceId)` | owner unmount/leave | 删除该 source；不生成成功状态 |

## Persistence and IPC

无持久实体、schema version、migration 或 IPC DTO。`ProjectSnapshot` 来自 001；appearance 来自 011；其余数据不跨 preload boundary。
