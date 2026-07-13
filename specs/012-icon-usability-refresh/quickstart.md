# Quickstart: 验证图标与易用性改进

本指南用于实现后的端到端验收。它引用 [action contract](./contracts/action-usability-contract.md) 与 [data model](./data-model.md)，不包含实现代码。

## Prerequisites

- 使用仓库声明的 Bun 1.3.14 与已安装依赖。
- spec、plan 与 ADR gate 已在 `specs/README.md` 标记 Accepted/Not required。
- 审计记录已覆盖 contract 列出的 5 个 surface。
- 测试项目/章节 fixture 可用于创建、打开、大纲、编辑、保存和导出流程。

## Automated baseline

```bash
bun run format:check
bun run lint
bun run typecheck
bun run test
bun run build
bun run test:smoke
bun run test:ui-runtime
```

预期：所有命令通过；既有 project、appearance、workspace、orientation、editor、paste/export 与 IPC regression 无行为或内容结果变化。

## Scenario 1: Mapping and source integrity

1. 对照 action contract 清点 launch、workspace、orientation/outline 与 editor 的每个可见操作。
2. 验证同一 action 使用相同 Lucide icon 和核心名称。
3. 搜索 emoji、Unicode 箭头、字符伪图标、icon font、remote icon URL 和第二 icon package。
4. 模拟 icon SVG 不显示，确认 visible/accessibility name 和操作仍存在。

预期：coverage 为 100%；只有 `lucide-react`；无重复装饰标记或无名空白按钮。

## Scenario 2: Keyboard and assistive semantics

1. 仅用 Tab/Shift+Tab/Enter/Space 遍历全部 icon-related controls。
2. 在每个 icon-only control 上检查可见 focus、明确 accessible name、focus/hover tooltip 和 Escape dismissal。
3. 使用 accessibility tree/屏幕阅读器确认 SVG 不重复朗读。
4. 检查 disabled、busy、selected、unsaved、success、warning 与 error 的名称/状态。

预期：全部操作可达；tooltip 不是唯一名称；状态至少有两个表达通道；既有 keyboard contract 不变。

## Scenario 3: Target size and responsive layout

在 compiled Electron runtime 中分别检查：

- 1200×800、100%；
- 960×640、100%；
- 960×640、200% 文本缩放。

记录每个 icon-related control 的 computed bounding box，并遍历换行后的 action group。

预期：目标宽高均至少 44 CSS px；primary/dangerous labels 不因窄屏消失；动作可合理换行且无阻断重叠、截断或不可达内容。

## Scenario 4: Theme and system preferences

对 Light、Dark、forced colors、reduced motion 分别运行 keyboard/focus/state 检查。

预期：icon、label、focus ring、boundary 与状态清晰；禁用/错误/成功/选中不只由颜色、icon 或动画表达；无 remote resource request。

## Scenario 5: Representative business flows

按顺序执行并记录首次尝试结果与错误：

1. 创建并打开项目；
2. 建立大纲并用可访问替代操作排序；
3. 开始章节；
4. 编辑并保存；
5. 粘贴内容并导出 Markdown。

同时触发离开保护、删除确认、保存 conflict、empty、failure 与 success 状态。

预期：业务结果、项目/文档内容、保护行为与 IPC contract 与改造前一致；界面每个时刻最多一个明确 primary next action。

## Scenario 6: Audit closure

1. 将每个 automated/manual result 关联到 `AuditEvidence`。
2. 每个 fail 创建或重开 `InterfaceAuditFinding`。
3. 确认所有 high finding 已 resolved；若 retained，确认同时存在产品批准、无障碍批准和 compensation。
4. 确认 5 个 surface 的控件与状态 coverage 均为 100%。

预期：没有 open high finding，没有缺失 placement/evidence 的 visible control。

## Scenario 7: Representative user validation

邀请熟悉桌面写作工具且未参与实现的代表性参与者（约 5 人是执行预期，不是硬门槛），让每人执行 Scenario 5 的五条流程。记录 `UserFlowObservation`，不收集不必要身份信息，也不要求改造前 baseline。

预期：

- 五条流程首次尝试完成率至少 90%；
- 至少 80% 参与者对“容易找到操作”和“界面层级清晰”均给出 4/5 或 5/5；
- 找不到、误解 icon 或错误选择均有 observation，并在需要时生成 finding。

## Final gate

只有 automated suite、runtime matrix、audit closure 与 user validation 全部达到上述结果，且 source/IPC/storage diff audit 证明业务边界未改变，012 才可报告完成。
