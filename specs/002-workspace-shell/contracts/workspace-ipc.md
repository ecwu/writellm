# Contract: Workspace Cross-Boundary Compatibility

**Status**: Frozen design — 002 adds no IPC

## Existing namespaces remain exact

- `window.writellm`: 001 的六个 accepted project methods。
- `window.writellmAppearance`: 011 的两个 accepted appearance methods（在 011 实现后可用）。

002 不增加、删除、重命名或包装任何 method/channel，也不新增 preload namespace。

## Project handoff

工作台只消费 001 成功结果中的：

```ts
type ProjectSnapshot = {
  projectId: string;
  displayName: string;
};
```

- `createProject` 仅 `status: 'created'` 可进入 workspace。
- `openProjectFromDialog`、`openRecentProject`、`relinkRecentProject` 仅 `status: 'opened'` 可进入 workspace。
- canceled/error/invalid 不进入 workspace。
- 002 不接收 path、manifest、recentId、revision、workspace content 或 raw exception。

## Renderer-only actions

返回启动页、panel events、focus restoration、responsive layout 与 status callbacks 均为 renderer-local，不映射为 IPC。Owner action 是直接提供的受限 renderer callback；它若需要跨边界行为，由 owner 自己消费其已接受的 named contract。

## Prohibited additions

- generic `send/invoke/on`；
- project open/close snapshot、save/retry/recover、status stream；
- native window bounds/min-size；
- shell preference、layout persistence、DOM/focus/selection/scroll payload；
- path、secret、file content、raw exception。

## Verification

Contract tests 必须断言 001 project namespace 仍恰好六方法、011 appearance namespace 仍恰好两方法、002 没有新 channel/preload key，并保留项目 DTO redaction 与 main input validation 回归。
