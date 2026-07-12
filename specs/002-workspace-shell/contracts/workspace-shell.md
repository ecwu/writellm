# Contract: Renderer Workspace Shell

**Status**: Draft design

## Public composition

```ts
type WorkspaceShellProps = {
  project: ProjectSnapshot;
  workspaceSlot: ReactNode;
  panels: readonly ToolPanelDescriptor[];
  statuses: readonly OwnerStatusSummary[];
  onLeaveWorkspace(): void;
};
```

Exact export/file names may be refined during tasks, but semantic inputs and guarantees are frozen by this contract.

## Required regions

| Region | Contract |
|---|---|
| Project navigation | 显示 `project.displayName`，提供可访问的返回启动页 action。 |
| Tool navigation | 每个 trigger 有 accessible name、active/disabled semantics 与 supplementary Tooltip。 |
| Workspace slot | 有名称的主要 region，持续挂载，并提供 `tabIndex=-1` focus fallback。 |
| Panel host | 最多一个 panel；有 heading、独立 ScrollArea（需要时）和显式 close path。 |
| Status region | 使用 StatusNotice/Alert 显示安全文字、severity、announcement 与 owner action。 |

## Events and priority

1. Dialog 打开时，011 Dialog 优先处理 Escape、outside interaction、focus containment 与 return。
2. 否则 Escape 关闭 active panel；没有 active panel 时 no-op。
3. 激活当前 trigger 等同 close；激活另一 trigger 原子替换 active id；rapid events 以最后 committed event 为准。
4. 显式 close 与 Escape 共用幂等 close transition；v1 panel 不支持 outside-click close。
5. close 后先聚焦 connected/enabled trigger；否则聚焦 workspace fallback，绝不落到 body。
6. 普通非模态 panel 打开后焦点留在 trigger；下一次 Tab 进入 panel。Dialog 使用 011 的模态焦点进入规则。
7. Pointer hover 仅产生 preview mode；指针可从 trigger 移入 preview region，离开两者后经 200ms grace period 收回。点击/键盘激活产生 pinned mode，取消 preview timer，且不因 blur、pointer leave 或 timeout 关闭。

Tool navigation 只渲染已注册且当前可用的 descriptor；未注册的未来工具不产生 DOM、禁用入口或占位 panel。

## Stable-slot guarantee

同一 project session 内，以下变化不得卸载或重新创建 workspace slot root：panel open/switch/close、status receive/remove、Dialog open/close、theme/reduced-motion changes、responsive reflow。测试必须比较 DOM identity，并检查 content、selection、scroll 与 focus context。

Preview 与 pinned 共享同一个 panel host 和“最多一个 panel”不变量；mode 转换不得先卸载 workspace slot，也不得短暂挂载两个 panel。

## Responsive contract

- 宽：tool rail + flexible workspace + bounded panel column。
- 受限：tool toolbar + persistent workspace + bounded stacked panel。
- 所有 grid/flex children 允许收缩且长内容局部滚动；header/status 可换行。
- 在 960×640 和 200% text scale 时，project、workspace、tools、panel close 与 important status 都可到达。
- 不依赖 Sheet/Sidebar/Tabs、JS breakpoint、native window IPC 或重新挂载 slot。

## Status contract

- shell 按 `sourceId + sequence` 忽略重复/乱序更新，并按 data-model 的固定优先级选取主展示。
- 状态区域只渲染选出的一个主状态，不提供状态历史或“全部状态”展开入口。
- visible text 必须承载含义；color/icon/animation/Tooltip 不能单独承载状态。
- action 仅 owner 明确提供时出现，并原样调用 owner callback。
- unknown、owner-unavailable、error 与 needs-action 不得映射为 complete/success。
- urgent error 可用 alert；其他状态默认 polite，避免无谓打断写作。

## 011 consumption contract

002 只通过 011 公共 entry paths 使用 primitives/patterns。Dialog、Tooltip、ScrollArea、StatusNotice、theme、Typeset 与 extension protocol 以 011 contract 为权威；002 不复制 primitive、直接 import Base UI 或建立第二套 theme。

## Non-goals

不定义项目/内容持久化、editor model、业务 panel 内容、保存/retry/recovery 语义、native window、router、nested modal 或跨重启 shell restoration。
