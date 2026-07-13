# Implementation Plan: 全界面图标与易用性改进

**Branch**: `012-icon-usability-refresh` | **Date**: 2026-07-13 | **Spec**: [spec.md](./spec.md)

**Status**: Draft — implementation remains gated until the feature specification and this plan are accepted.

**Input**: Feature specification from `/specs/012-icon-usability-refresh/spec.md`

**Note**: 本计划只生成设计材料；未编写产品代码、未安装依赖、未修改 lockfile、未生成 `tasks.md`。

## Summary

在当前已实现的启动页、工作台、写作导向、大纲与章节编辑体验中，统一使用仓库已经固定版本并可离线打包的 `lucide-react` 图标，建立源码可评审的动作映射与逐界面审计记录。实现以现有 `Button`、`Tooltip`、语义 tokens 和 feature composition 为边界：主要动作保留文字，只有满足四项准入条件的辅助动作才可仅显示图标；所有图标均为装饰性 SVG，由控件本身提供名称和状态。布局、状态、焦点、44×44 CSS px 操作目标、窄窗口、200% 缩放、主题与高对比行为将通过 DOM、编译后 Electron runtime、审计和代表性用户流程共同验证。

本 feature 不新增持久化、IPC、后台进程、远程资源或业务能力，不改变项目与文档结果。它消费已接受的 [ADR-003](../../docs/adr/003-ui-foundation.md)，不需要新 ADR。

## Technical Context

**Language/Version**: TypeScript 7.0.2、React/React DOM 19.2.7、Electron 43.1.0、Bun 1.3.14；不升级现有栈

**Primary Dependencies**: 已固定的 `lucide-react` 1.24.0；现有 source-owned shadcn-style primitives、Base UI 1.6.0、Tailwind CSS 4.3.2

**Storage**: N/A；动作映射、审计发现与验证证据是仓库内设计/测试材料，不新增运行时持久化

**Testing**: Bun test、Happy DOM、Testing Library、既有 compiled Electron runtime harness、人工无障碍/响应式审计、代表性用户流程

**Target Platform**: Electron desktop；现有支持窗口范围，至少覆盖 1200×800、960×640 与 200% 文本缩放

**Project Type**: 单 renderer 的 Electron desktop application

**Performance Goals**: 图标使用静态 tree-shakeable named imports；不产生运行时网络请求，不引入图标字体，不新增可感知的交互延迟或布局跳动

**Constraints**: `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`；业务行为、数据格式、持久化与 IPC 不变；一个图标体系；操作目标至少 44×44 CSS px；状态不只靠颜色/图标/动画；主要动作不隐藏文字

**Scale/Scope**: 审计当前 5 个体验区域及其所有可见操作/状态；统一至少 12 类规范动作；未来 renderer feature 消费同一 contract，但 005–010 未实现界面不在本轮逐页改造范围

## Constitution Check (pre-research)

| Principle | Status | Plan evidence |
|---|---|---|
| I. Secure Desktop Boundary | PASS | 仅 renderer source、CSS、测试与文档变化；不接触 preload/main capability，图标随 bundle 离线提供。 |
| II. Typed, Minimal IPC | PASS | 不新增或修改 IPC；现有 bridge contract 作为回归门禁。 |
| III. Specification-Driven, Minimal Evolution | GATED | 设计材料可继续；spec 与 plan 当前均为 Draft，接受前不得生成 implementation tasks 或实现。消费 ADR-003，因不跨 durable/system/process boundary 而不需要新 ADR。 |
| IV. Verification at the Failure Boundary | PASS | 映射以静态/DOM 检查验证，焦点、主题、forced colors、缩放与真实布局在 compiled Electron runtime 验证，业务结果由既有回归验证。 |

当前 gate 没有需要 Complexity Tracking 豁免的设计违规。唯一未满足项是正常的接受门禁；它明确阻止实现，但不阻止本轮规划。

## Project Structure

### Documentation (this feature)

```text
specs/012-icon-usability-refresh/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── checklists/
│   └── requirements.md
└── contracts/
    └── action-usability-contract.md
```

### Source Code (repository root)

```text
src/renderer/
├── components/
│   ├── ui/                  # Button/Tooltip state, size and accessible behavior
│   └── patterns/            # Empty/status compositions
├── launch/                  # launch actions and recent projects
├── workspace/               # project navigation, tool rail/panels/status
├── features/
│   ├── writing-orientation/ # motivation, outline, reorder and delete actions
│   └── editor/              # chapter, paste, save and export actions
├── theme/                   # semantic tokens and theme behavior
└── styles.css               # responsive composition and target sizing

test/
├── unit/ui/                 # mapping/primitives/accessible icon semantics
├── integration/             # representative feature flows and regression
└── runtime/                 # Electron focus, layout, media and zoom validation
```

**Structure Decision**: 保持现有单 renderer 结构。共享组件只承载通用尺寸、状态与 tooltip 行为；动作名称、风险、优先级和业务状态由各 feature composition 提供。动作映射与审计记录属于 `specs/012-icon-usability-refresh/` 的可评审 contract/evidence，不创建运行时 registry、全局 service 或第二个设计系统。

## Phase 0 — Research decisions

完整决定见 [research.md](./research.md)。研究结论为：

1. 使用仓库已有、精确固定的 `lucide-react`，只做 named imports；不安装依赖、不使用远程服务或 icon font。
2. 图标 SVG 默认 `aria-hidden="true"` 且不可聚焦；交互名称来自 button/link，tooltip 只补充名称。
3. 以集中、可评审的动作 contract 约束 icon、核心名称、风险、优先级、允许呈现形式与使用位置；避免建立运行时图标查找 service。
4. 审计记录覆盖每个可见控件与状态，并对高严重度保留建立产品和无障碍双批准字段。
5. 验证分层：静态映射和 DOM 语义、Electron runtime 视觉/焦点/媒体行为、人工审计与代表性用户任务。

所有 Technical Context 项均已解决；无 `NEEDS CLARIFICATION`。

## Phase 1 — Design and contracts

### Data model

[data-model.md](./data-model.md) 定义 `ActionIconMapping`、`ActionPlacement`、`InterfaceAuditFinding`、`AuditEvidence` 与 `UserFlowObservation`。这些是设计、审计和验证记录，不是新的产品持久化模型。

### UI contract

[contracts/action-usability-contract.md](./contracts/action-usability-contract.md) 冻结：

- 规范动作、Lucide icon、核心名称和风险/优先级；
- visible-label 与 icon-only 准入规则；
- SVG、accessible name、tooltip、state 与 44×44 target 契约；
- 每屏单一主要下一步、危险动作与响应式布局规则；
- 新动作和例外的评审/验证流程。

### Implementation sequence

1. 建立动作映射与审计清单，逐一登记 5 个体验区域中的可见操作、状态、重复字符和当前验证证据。
2. 加固共享 `Button`/`Tooltip` 与语义样式，使 icon size、gap、44×44 target、focus、disabled/busy 和 forced-colors 行为一致；不让 primitive 知道业务动作。
3. 按启动页 → 工作台 → 写作导向/大纲 → 章节编辑器顺序替换图标和字符标记，并同步修复该区域已登记的层级、分组、空/错/保存反馈与窄窗口问题。
4. 每个区域迁移后运行其既有业务回归及新增 DOM contract checks，避免把全量回归推迟到最后。
5. 完成 compiled Electron runtime 矩阵、审计闭环和代表性用户流程；记录所有发现的解决状态、证据或批准的保留理由。
6. 更新未来 renderer feature 的消费说明，并确认没有第二套 icon source、远程资源、业务/IPC/存储 diff。

## Verification Strategy

| Failure boundary | Verification | Pass condition |
|---|---|---|
| Action mapping/source | source inventory + contract test | 覆盖动作 100% 映射到 Lucide named import；无字符伪图标、icon font、远程 icon 或未经批准的第二来源。 |
| Accessible DOM | Testing Library interaction tests | 仅图标控件有独立名称与 focus/hover tooltip；SVG 不重复朗读；键盘、disabled/busy/selected 状态语义正确。 |
| Layout and input target | computed-style checks + compiled Electron screenshots/DOM geometry | 相关目标至少 44×44 CSS px；960×640、200% 缩放下主要动作可达且无阻断重叠/截断。 |
| Theme/media behavior | compiled Electron runtime | light/dark/forced-colors/reduced-motion 下 icon、文字、focus 与状态可辨；状态不只靠单一视觉通道。 |
| Business behavior | existing unit/integration/runtime suites | 创建/打开/离开/大纲/章节/保存/粘贴/导出行为、结果、保护与 IPC contract 100% 保持。 |
| Audit completeness | review of audit records | 5 个区域 100% 可见控件/状态有记录；所有 high finding 已解决或具产品+无障碍批准及补偿措施。 |
| User outcomes | moderated representative flows | 五条流程首次成功率 ≥90%；发现性与层级评分 4/5 或 5/5 的参与者 ≥80%；样本量记录但不是硬 gate。 |

详细执行步骤与预期结果见 [quickstart.md](./quickstart.md)。

## Constitution Check (post-design)

| Principle | Status | Post-design conclusion |
|---|---|---|
| I. Secure Desktop Boundary | PASS | 设计限定在 renderer composition/source-owned assets；无 Node/Electron 暴露、远程资源或新权限。 |
| II. Typed, Minimal IPC | PASS | contract 明确禁止 IPC 变化，既有 shared/preload/main surface 纳入回归。 |
| III. Specification-Driven, Minimal Evolution | GATED | 采用现有依赖与目录，不创建 runtime registry 或新 architecture。新 ADR 明确 Not required。spec/plan 接受前实现 gate 仍关闭。 |
| IV. Verification at the Failure Boundary | PASS | DOM、compiled Electron、人工审计、用户流程与既有业务回归分别覆盖其能观察到的失败。 |

设计后无 Constitution violation 或未解决的 clarification。接受 spec 与 plan 后，才能将 registry 状态改为 Accepted 并进入 tasks/implementation。

## ADR and dependency gate

- 硬依赖 001、002、003、004、011 在 registry 中均为 Complete，满足规划前置。
- ADR-003 已接受并授权 source-owned renderer UI、Lucide-compatible shared composition/accessibility verification boundary。
- 本 feature 不改变 durable storage、IPC、系统权限、UI primitive base 或跨 feature process；**新 ADR：Not required**。
- 任何实现中出现上述边界变化时必须停止，将 ADR gate 重新打开，而不是在 tasks 中隐式决定。

## Complexity Tracking

无。当前设计没有 Constitution exception。
