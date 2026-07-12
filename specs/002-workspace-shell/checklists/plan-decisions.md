# Planning Decisions Checklist: 写作工作台外壳

**Purpose**: 验证 002 设计决定已收敛且可追溯；本清单不代表 spec/plan 已获 maintainer 接受，也不授权实施。
**Updated**: 2026-07-12

## Dependencies and ownership

- [x] CHK001 直接消费 001 `ProjectSnapshot` 与成功 union，不扩展项目 DTO。
- [x] CHK002 返回启动页复用现有 LaunchPage/六方法，不复制项目业务或产生额外副作用。
- [x] CHK003 011 是唯一 UI foundation；已删除 overlay、style、state library 与 test harness 的平行选型。
- [x] CHK004 002 只拥有 renderer workspace regions、session reducer、panel/focus/responsive/status composition。
- [x] CHK005 workspace slot/panel/status 的内容和业务动作仍由各 feature owner 拥有。

## Session, IPC and persistence

- [x] CHK006 active panel、focus return、status sequence 均为 session-only；layout 由 CSS 推导。
- [x] CHK007 selection、scroll、slot content、Dialog state 与 DOM refs 不进入 shell persistence/model。
- [x] CHK008 001 六方法与 011 appearance 两方法保持 exact；002 新增 IPC 数为零。
- [x] CHK009 无 project/recent/appearance/localStorage/ui-state schema、migration、save queue 或 recovery protocol。
- [x] CHK010 路径、secret、raw exception、项目内容、任意 Electron/Node capability 不进入 renderer contract。

## Interaction and accessibility

- [x] CHK011 同时最多一个 panel；current toggle、atomic switch、Escape/explicit close 与 rapid-event 规则已冻结。
- [x] CHK012 v1 panel 不因 outside click 关闭；Dialog 打开时 011 优先处理 Escape/background interaction。
- [x] CHK013 panel close 恢复 connected/enabled trigger，否则恢复命名 workspace fallback，绝不落到 body。
- [x] CHK014 Dialog、Tooltip、ScrollArea、StatusNotice 的 role/name/keyboard/focus/announcement 使用 011 contract。
- [x] CHK015 icon-only trigger 自带 accessible name；Tooltip 只是补充；状态始终有可见非颜色文字。
- [x] CHK016 重要 error 在 panel/Dialog 期间仍可发现；非紧急状态默认 polite，避免无谓打断。
- [x] CHK016A hover 只产生可宽限收回的 preview；点击/键盘产生 pinned，且 blur/pointer leave/timer 不关闭 pinned panel。

## Status and ordering

- [x] CHK017 六种 generic owner state 已冻结，不发明 save-specific 状态或错误码。
- [x] CHK018 `sourceId + sequence` 忽略重复/乱序更新；多 source 展示优先级与 tie-break 已冻结。
- [x] CHK019 action 只在 owner 提供时显示并调用 owner callback；shell 不解释为 IPC/file command。
- [x] CHK020 unknown、owner-unavailable、needs-action、error 不得显示为 complete/success。

## Responsive and stable context

- [x] CHK021 workspace slot 与 panel sibling 且同 project session 持续挂载。
- [x] CHK022 宽/受限 CSS reflow、局部 scrolling、wrap 与 `min-width:0` 责任已明确。
- [x] CHK023 960×640、200% 下 project/workspace/tools/panel-close/status 可达标准已明确。
- [x] CHK024 theme、reduced-motion 与 responsive changes 不得 remount slot 或丢失 project/panel/context。
- [x] CHK025 100 次循环测量 DOM identity、content、selection、scroll 与 focus context。

## Verification and gates

- [x] CHK026 DOM harness 与 compiled Electron UI fixture 各自 failure boundary 已明确。
- [x] CHK027 四种 001 success、cancel/error、return 与项目树只读回归均有 quickstart 场景。
- [x] CHK028 System/Light/Dark、reduced motion、forced colors、1200×800、960×640、200% 有 runtime 场景。
- [x] CHK029 所有 FR-001–FR-017 与 SC-001–SC-008 可追溯至 plan、contracts/data-model 与 quickstart。
- [x] CHK030 没有未解决的技术 clarification、Constitution exception 或所需新 ADR。
- [x] CHK031 Maintainer 已接受更新后的 002 spec 与 plan。
- [x] CHK032 011 已完成实现且 001 migration regression 全部通过。

## Implementation gate

只有 CHK031 与 CHK032 均完成后，才可生成/接受 implementation tasks 并开始产品实现。
