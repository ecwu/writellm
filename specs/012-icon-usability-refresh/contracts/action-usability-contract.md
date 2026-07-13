# Action Icon and Usability Contract

## Purpose and ownership

本 contract 是所有 renderer feature 选择操作图标、名称、呈现形式与验证方式的 source of truth。012 负责建立初始 mapping；以后 feature 新增动作时必须在同一体系中扩展并指定验证责任。`components/ui` 只实现通用 control contract，不拥有业务 action semantics。

## Canonical action mapping

| Action ID | Lucide icon | Core visible label | Risk | Default priority | Presentation |
|---|---|---|---|---|---|
| `create-project` | `FolderPlus` | Create project | safe | primary | label-required |
| `open-project` | `FolderOpen` | Open project | safe | secondary | label-required |
| `return-to-projects` | `ArrowLeft` | Back to projects | caution | secondary | label-required |
| `save` | `Save` | Save | safe | primary when unsaved | label-required |
| `add-outline-item` | `Plus` | Add outline item | safe | primary when outline empty; otherwise secondary | label-required |
| `move-up` | `ArrowUp` | Move up | safe | secondary | icon-only-eligible |
| `move-down` | `ArrowDown` | Move down | safe | secondary | icon-only-eligible |
| `delete` | `Trash2` | Delete | destructive | dangerous | label-required |
| `close-panel` | `X` | Close | safe | secondary | icon-only-eligible |
| `paste-markdown` | `ClipboardPaste` | Paste Markdown | caution | secondary | label-required |
| `export-markdown` | `Download` | Export Markdown | safe | secondary | label-required |
| `settings` | `Settings` | Settings | safe | secondary | icon-only-eligible for tool rail only |
| `workspace-tool` | action-specific Lucide icon | stable tool name | safe | secondary | icon-only-eligible for tool rail only |

`workspace-tool` 是受控 extension point，不是允许任意 icon 的逃生口。每个实际 tool ID 必须增加稳定的 icon/name/location/owner mapping，不得只记录 generic row。

## Control contract

1. Icon 必须是 `lucide-react` named import。生产运行时不得请求 remote icon、font 或 registry。
2. Interactive SVG 必须置于 semantic button/link 内；SVG 本身默认 `aria-hidden="true"`、`focusable="false"`，不提供重复 accessible name。
3. Icon + label control 的 accessible name 由可见文字提供。icon-only control 必须由控件的明确 `aria-label` 提供名称。
4. Tooltip 只提供补充说明，必须在 keyboard focus 和 hover 时可获得，并可用 Escape 关闭；tooltip 不得是唯一名称。
5. 每个 icon-related pointer target 的 computed box 至少 44×44 CSS px。视觉 icon 可以更小，但不得缩小 target。
6. Busy/disabled/selected/success/warning/error 必须使用文字、ARIA/native state 或同等第二通道；不得只替换 icon、颜色或动画。
7. Icon 加载/渲染失败时，可见文字或 accessible name、布局与操作仍可用。

## Icon-only admission gate

一个 placement 只有以下全部为真才能使用 icon-only：

- 是辅助操作，不是当前主要业务下一步或 destructive result；
- 实际布局空间受限，并记录为什么 visible label 会损害可达布局；
- 图标惯例明确，目标用户不会与同屏动作混淆；
- 审计证明无歧义，且记录 accessible name、tooltip 和验证责任。

任一项不满足时使用 icon + visible label。响应式布局不得为了腾出空间而自动移除主要动作或危险动作文字。

## Hierarchy and responsive contract

- 每个 view 当前上下文最多一个 primary next action；其他动作使用 secondary/ghost/dangerous hierarchy。
- destructive action 与 primary action 在位置、文字和视觉 treatment 上可区分，并保留现有 confirmation/leave guard。
- 960×640 与 200% 文本缩放时 action groups 可以换行或重排；不得隐藏 primary、改变动作顺序含义或造成关键名称截断。
- Empty/error/unsaved/success state 必须说明当前情况；可恢复时提供上下文相关的下一步。
- Light/dark/forced-colors/reduced-motion 下 focus、边界和状态保持可辨。

## Audit coverage contract

以下 surface 的每个可见 interactive control 和 state 必须有一个 `ActionPlacement` 或明确的 non-action audit row：

1. launch/recent projects；
2. workspace navigation, tool rail, panel and status region；
3. writing motivation/orientation；
4. outline list, reorder, selection and delete；
5. chapter editor, paste, save/conflict and export dialogs。

每条 finding 必须按 [data-model.md](../data-model.md) 记录。High finding 只有 resolved，或由产品和无障碍评审分别批准 retained 并记录 compensation 时才可关闭。

## Change and exception protocol

新增或修改 action 时，提交者必须：

1. 复用现有 mapping，或说明为什么需要新的 action/icon；
2. 记录核心名称、risk、priority、presentation、locations 和 verification owner；
3. 检查 icon 是否与已有动作冲突；
4. 增加 DOM contract coverage，并按 layout/focus 风险增加 Electron runtime coverage；
5. 对 icon-only 或第二来源请求进行 accessibility review；第二 icon source 默认不允许。

若变更需要新的 primitive base、运行时 registry、remote asset、IPC、持久化或系统 capability，必须停止 feature implementation 并重新评估 ADR gate。
