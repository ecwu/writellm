# Phase 0 Research: 写作工作台外壳

**Date**: 2026-07-12
**Status**: Complete — no unresolved clarification

## Decision 1 — Consume the implemented 001 handoff

**Decision**: 002 直接消费 `ProjectSnapshot { projectId, displayName }`。create 的 `created` 与 open/recent/relink 的 `opened` 统一进入 workspace；cancel/error 不进入。返回启动页是 renderer surface 切换并复用现有 LaunchPage。

**Rationale**: `src/shared/project.ts` 与 001 contract 已冻结安全 DTO；当前四条成功路径已在 LaunchPage 汇聚。DTO 不含路径、manifest 或内容。

**Alternatives considered**: 拒绝从 recent record 推导当前项目、扩展 ProjectSnapshot、重新 open/revalidate 或复制启动页业务。

## Decision 2 — Use a minimal renderer session reducer

**Decision**: React built-ins 管理 `surface`、`activePanelId` 和 `panelFocusReturnKey`。布局由 CSS 推导；Dialog 状态由 011 primitive/consumer 管理；slot 内容、selection、scroll 属于 slot owner。

**Rationale**: 状态转换有限且同步，不需要外部状态库或 state machine。session-only 模型满足 FR-016。

**Alternatives considered**: 拒绝 Zustand/XState、JS breakpoint state、modal registry、序列化 DOM ref、selection 或 scroll。

## Decision 3 — Keep the workspace slot mounted

**Decision**: workspace slot 与 panel host 是 sibling；同一 project session 内 panel events 不改变 slot key 或 conditional mount。切换 project session 才可替换 slot identity。

**Rationale**: DOM identity 是保持内容、选区、滚动和焦点上下文的可验证前提。

**Alternatives considered**: 拒绝按 active panel 切换整个 page、把 slot 放入 panel 分支或用保存/恢复快照掩盖 remount。

## Decision 4 — Freeze deterministic panel and focus rules

**Decision**: 当前 trigger toggle close；其他 trigger 原子替换；Escape/显式关闭幂等；rapid events 以最后提交 id 为准。v1 panel 不支持 outside-click close。Dialog 打开时 011 Dialog 优先处理 Escape。关闭后聚焦仍有效的 trigger，否则聚焦 workspace fallback。

**Rationale**: 规则消除重复 close 与焦点跳转，同时把 modal focus/inert 责任留给 011。

**Alternatives considered**: 拒绝 panel outside-click baseline、落焦 body、shell 重写 focus trap 或 nested modal。

## Decision 5 — Consume the accepted 011 UI foundation

**Decision**: 使用 011 的 Button、Tooltip、Card、Separator、ScrollArea、Dialog、StatusNotice/Alert、Badge、EmptyState 与 Typeset；遵循 `feature → patterns → ui → Base UI/native`。

**Rationale**: 011 spec/plan/UI contract 与 ADR-003 已接受，已冻结 source-owned shadcn/Rhea + Base UI、Tailwind v4、semantic tokens 与 overlay behavior。

**Alternatives considered**: 拒绝 React Aria/Ariakit/Radix 另选、直接 Base UI import、复制 primitive、第二套 theme。Sidebar/Sheet/Tabs/Resizable 未经需求证明不加入。

## Decision 6 — Use CSS reflow, not a new overlay primitive

**Decision**: 宽布局为 rail + flexible workspace + bounded panel；受限布局把 rail reflow 为 toolbar、panel 变为 stacked region。局部区域独立滚动；不新增 native window IPC 或 JS breakpoint。

**Rationale**: 011 明确 layout 属于 feature；该策略在 960×640 与 200% 下保留 workspace、tools、close path 与 status 可达性。

**Alternatives considered**: 拒绝 Sheet/Sidebar、窄宽卸载 slot、renderer 控制 BrowserWindow、只做不可验证的视觉描述。

## Decision 7 — Render owner-provided status without owning transactions

**Decision**: shell 接收六种安全 presentation state、severity、visible message 与可选 owner callback。StatusNotice 默认 polite，重要 error 可 urgent；动作只在 owner 提供时显示。

**Rationale**: shell 可提供一致状态区域，同时不推断保存成功、不发明 retry/recover IPC，也不泄露 owner internals。

**Alternatives considered**: 拒绝 save-specific enum、shell action registry/opaque IPC、所有状态使用 alert、unknown 映射 success。

## Decision 8 — Add no IPC or persistence

**Decision**: 001 的六方法 project namespace 与 011 的两方法 appearance namespace 原样保持。002 不新增 preload、channel、project file、recent field、appearance field、localStorage 或 ADR。

**Rationale**: 所有 shell 行为均能在 renderer 完成；spec 明确 session-only，且不依赖 ADR-001。

**Alternatives considered**: 拒绝 workspace IPC、window bounds IPC、ui-state.json、layout preference、save queue 与 recovery schema。

## Decision 9 — Reuse the accepted two-level UI harness

**Decision**: Bun + Happy DOM + React Testing Library + user-event 覆盖 reducer/DOM；011 compiled Electron UI fixture 覆盖 native keyboard、activeElement、portal/inert、theme/media 与窗口尺寸。001 全套回归保持为 gate。

**Rationale**: DOM harness 适合快速组合验证，真实 Electron 才能检测 focus、inert、native keyboard 与 runtime appearance failure。

**Alternatives considered**: 拒绝 snapshot/types-only、仅 lifecycle smoke、Playwright 新依赖或图像快照作为行为替代。

## Decision 10 — Follow the foundation extension protocol

**Decision**: 先 compose、再 named variant、再 feature-local semantic layout；仅在 accepted need 证明后提交 FoundationExtensionRequest。

**Rationale**: 维持共享可访问性/主题/升级边界，同时让 002 拥有业务组合。

**Alternatives considered**: 拒绝 feature copy、direct Base UI、raw palette、任意 z-index、`!important`、blind generated overwrite 与预建假想 primitive。
