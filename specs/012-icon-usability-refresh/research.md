# Phase 0 Research: 全界面图标与易用性改进

## Decision 1: Use the repository's pinned Lucide React package

**Decision**: 使用 `package.json` 已精确固定的 `lucide-react` 1.24.0 作为唯一产品操作图标来源，采用按图标 named import，让 Vite 打包静态 SVG component。

**Rationale**: 这是 shadcn 体系推荐且仓库已具备的图标集；无需新增依赖或 lockfile 变化，能离线运行，并与 source-owned UI foundation 的 React/Tailwind 模型一致。

**Alternatives considered**: 远程 icon registry/font（违反离线与隐私约束）；复制 SVG 文件（产生来源/升级漂移）；混用 emoji/Unicode 字符（平台渲染和辅助技术语义不一致）；新增另一 React icon library（形成第二视觉体系）。

## Decision 2: Keep action semantics outside SVGs

**Decision**: 图标 SVG 是装饰性内容，默认 `aria-hidden="true"`、不可聚焦，并使用统一的视觉尺寸。控件本身通过可见文字或明确的 `aria-label` 提供 accessible name；icon-only 控件必须由现有 Tooltip 在 keyboard focus 与 hover 时提供补充说明。

**Rationale**: 控件只有一个稳定名称源，避免屏幕阅读器重复朗读 icon title 与 button label。Tooltip 可帮助视觉用户，但不会成为唯一名称。

**Alternatives considered**: 给每个 SVG 添加 `<title>`（易与控件名称重复）；只靠 tooltip（触摸/辅助技术/加载失败时不可靠）；通过 CSS background image 呈现功能 icon（语义和 forced-colors 控制较弱）。

## Decision 3: Use a reviewable design contract, not a runtime icon registry

**Decision**: 在 feature contract 中维护规范动作、Lucide component 名、核心名称、风险、优先级、准入形式和位置；实现代码在各 feature 中直接 named import。测试/审计依据 contract 检查一致性。

**Rationale**: FR-002 要求统一映射，但当前 renderer 规模不需要运行时 lookup、dynamic component map 或 service。直接 import 便于 tree shaking、类型检查与局部阅读，同时 contract 是跨 feature 的 source of truth。

**Alternatives considered**: 全局运行时 `actionId → component` registry（增加 indirection 和 bundle 风险）；每页自行选择 icon（无法保证一致性）；把业务 action 放入 UI primitive（破坏 ADR-003 的 feature → patterns → ui 边界）。

## Decision 4: Admit icon-only controls only through four explicit gates

**Decision**: 只有辅助操作、空间受限、图标惯例明确、审计无歧义四项全部满足时才允许 icon-only；否则使用 icon + visible label。危险动作即使有 icon 也保留文字、destructive treatment 和既有确认/leave protection。

**Rationale**: 直接编码 FR-006 的澄清，减少为视觉简洁牺牲发现性。visible label 同时为翻译、图标加载失败与认知无障碍提供韧性。

**Alternatives considered**: 所有动作 icon-only（不符合 spec）；按窗口宽度自动移除主要动作文字（导致放大/窄屏时名称丢失）；仅由开发者主观判断熟悉度（不可审计）。

## Decision 5: Record audit findings as durable repository evidence

**Decision**: 审计以结构化 Markdown 表/记录覆盖每个可见控件和状态，包含区域、流程、受影响用户、severity、要求、处置、证据和批准。High finding 只有 resolved，或 retained 且同时具产品与无障碍批准及补偿措施，才可关闭。

**Rationale**: 使 SC-001、FR-004 和未来 icon 例外可复核，不引入运行时数据模型。仓库材料可与实现 diff 和验证结果同评审。

**Alternatives considered**: 临时个人 checklist（不可追溯）；只记录未解决问题（不能证明 100% coverage）；把 finding 写入应用数据（与产品无关且扩大持久化边界）。

## Decision 6: Verify at three complementary boundaries

**Decision**: 使用 source/DOM tests 验证映射、名称和状态；使用 compiled Electron runtime 验证真实 focus、geometry、theme、forced colors、reduced motion、960×640 和 200% 缩放；使用人工审计及代表性用户任务验证发现性、层级和首次成功率。

**Rationale**: 静态测试不能证明真实桌面布局或用户理解，用户测试也不能可靠穷举 IPC/业务回归。分层验证对应 Constitution IV。

**Alternatives considered**: snapshot-only（无法证明 interaction/geometry）；只跑人工检查（不可重复）；只跑自动化 a11y 扫描（不能证明 icon 含义与任务发现性）。

## Decision 7: No new ADR is required

**Decision**: 012 消费 ADR-003 的 source-owned renderer UI、语义 token、accessibility ownership 与 verification rules；不改变 primitive base、IPC、持久化、系统权限或进程边界。

**Rationale**: 这是既有已接受 renderer architecture 内的横向一致性改造。plan 明确设置 boundary tripwire：若实现需要跨这些边界，必须停止并重新开启 ADR gate。

**Alternatives considered**: 为 Lucide mapping 新建 ADR（没有 durable/system/process 决策，治理成本超过价值）；不记录 ADR 判断（会让 registry gate 保持模糊）。
