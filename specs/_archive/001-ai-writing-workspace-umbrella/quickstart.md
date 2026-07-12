# Quickstart: WriteLLM 工作区 UI 与 portable project 验证

本指南验证实现后的 Electron runtime 行为，不替代完整测试套件。当前仓库仍是 v2 startup foundation；在 feature spec 与 storage ADR 被接受、任务生成并实现前，下面的 product-specific 场景是验收目标而不是已完成能力。

## Prerequisites

- macOS、Windows 或 Linux
- Bun 1.3.4
- 仓库根目录

```sh
bun install
```

实现 UI foundation 时还应确认以下依赖已经纳入 lockfile：

- shadcn/ui source components with the Radix variant (`shadcn init -b radix`)
- Tailwind CSS v4 + `@tailwindcss/vite` + `tw-animate-css`
- `lucide-react`
- `@blocknote/core`、`@blocknote/react`、`@blocknote/shadcn`

运行时不能依赖联网访问 shadcn registry；CLI 只负责开发期把 source component 加入项目。

## Static and existing foundation checks

```sh
bun run typecheck
bun run test
bun run build
bun run test:smoke
```

Expected:

- TypeScript renderer/electron 两套配置通过。
- 现有 runtime-info IPC contract test 通过；preload 不暴露 generic IPC。
- build 生成 `dist/` 和 `dist-electron/`，BlockNote/shadcn/Tailwind 编译成功。
- Electron foundation smoke 通过。

## UI shell manual scenario

1. 启动 `bun run dev:electron`。
2. 首次启动确认进入 Launch Home；没有项目时显示新建、打开和空状态。
3. 创建或打开一个 `.writellm` 项目，确认进入 workspace shell。
4. 检查界面包含：顶部 `WorkspaceHeader`、左侧窄 `ToolRail`、中心 `EditorStage`、底部悬浮 `QuickActionBar`。
5. 点击“大纲” rail button，确认只打开一个锚定左侧 rail 的 floating panel；再次点击、点击 outside 或按 `Escape` 都能关闭。
6. 在 panel 打开时点击 editor，确认 editor selection、内容和 dirty 状态不丢失。
7. 点击设置，确认背景出现 scrim 和轻量 blur，焦点进入 modal；按 `Escape` 关闭后焦点回到设置按钮。
8. 缩小窗口到最小尺寸，确认 rail、header、editor 和 bottom bar 仍可操作；quick action 在紧凑模式下有 tooltip/accessible label，且不覆盖最后一行正文。

Expected:

- shell layout 是复用的单一模板，不因打开不同 panel 而复制一套页面壳层。
- modal/panel 的状态是 renderer state，不会写入章节 Markdown；关闭 panel/modal 不会导致 editor 重建。
- 所有 icon button 有 accessible name、visible focus ring 和非颜色 active state。
- 键盘快捷键至少支持 `Mod+S` 保存和 `Mod+Shift+O` 切换大纲；快捷键不应在输入法或 modal text field 中误触发破坏性操作。

## BlockNote editor scenario

1. 在一个空章节中输入标题、段落、列表、引用，并通过 BlockNote block menu 新增/移动一个 block。
2. 打开/关闭左侧 panel 和底部 markup action，确认 BlockNote document、selection 和 focus 不被重置。
3. 插入产品 citation block/inline content 的 stub，确认它引用的是 `citationId` 而不是 array index 或 DOM position。
4. 修改一个 block 后确认保存状态进入 dirty；点击保存后显示 saving，再等待 main 返回 revision 后显示 saved。
5. 模拟保存失败或 revision conflict，确认 editor 内容仍在，UI 显示 retry/conflict 操作而不是绿色成功状态。
6. 用普通 Markdown 工具修改 chapter 文件后重新打开项目，确认 identity mismatch/external change 显示为 needs review，不静默覆盖外部内容。

Expected:

- editor 通过 `@blocknote/shadcn` 的 `BlockNoteView` 接入 shared shadcn components，而不是另起一套 Mantine 视觉系统。
- BlockNote document 作为 editor session projection；canonical chapter content 由 main-owned codec 写 Markdown/metadata。
- BlockNote 的 lossy Markdown helper 只用于显式导入/导出或 preview，不能直接覆盖 canonical chapter file。
- 每个顶层 block 有稳定 id；citation、AI proposal target 和 history diff 都能定位到 block id。

## Settings and API key scenario

1. 打开“设置 → Providers” modal，确认现有 key 只显示“已配置”，输入框不预填 plaintext。
2. 输入新 key 并提交，确认 UI 只显示 success/configured 状态；刷新或重开 modal 也不能从 renderer state 读回 key。
3. 检查 `.writellm` 项目目录和 Git diff，确认不存在 API key。
4. 在 test double 中让 `safeStorage` 不可用，确认保存失败，form 仍可重试，不生成明文 secret 文件。

Expected:

- provider settings 是 app-owned，不随 `.writellm` 项目移动或备份。
- key 通过 named typed IPC 进入 main，main 使用异步 safeStorage；renderer 只能获得 redacted summary/status。
- 错误信息不包含 key、请求 header 或 provider secret。

## Launch, portable project and history scenario

1. 在 Launch Home 点击新建项目，输入 `Demo project`，确认 native directory dialog 由 main 打开。
2. 选择任意父目录，确认创建 `Demo project.writellm/` 并进入 workspace。
3. 输入 motivation，增加“背景”和“方法”两个 outline item，并移动一次；关闭 Electron 后重启。
4. 在最近项目中点击项目卡片，确认内容、顺序、theme/density 和最近编辑位置恢复。
5. 将项目文件夹移动到另一个父目录，重启后确认旧卡片显示 missing，而不是被静默删除；通过 Open Project 选择移动后的目录后，旧记录被 projectId 合并为 available。
6. 在项目中进行一次人工修改，再通过后续 AI proposal 流程接受一次模型修改；在 history modal 中确认 actor、revision、时间和受影响范围可见。

Expected:

- renderer 不收到绝对路径；目录选择、项目验证、保存、Git 和 recent index 由 main 完成。
- `.writellm` 中包含 `.git`、manifest、UI state、content 和必要目录；API key 不在其中。
- `contentRevision` 只在成功的项目内容保存后递增；UI-only panel/theme 变化不制造正文版本。
- Git history 保留后续版本，恢复较早版本时创建新的 human restore event，不改写历史。

## Automated lifecycle smoke

实现后补充 `test/smoke/launch-project-lifecycle.smoke.test.ts` 或等价 Electron harness：

```sh
bun run test:smoke
```

The smoke must:

1. 使用隔离的 userData 和任意 temp parent 启动真实 Electron。
2. 通过实际 preload bridge 触发 create/open/save，并验证 sender/path/revision boundary。
3. 断言 workspace shell 的主要 accessible regions 存在，rail panel 与 modal 的开合不重建 editor。
4. 在真实 BlockNote instance 中编辑一个 block，验证 stable ids、dirty → saving → saved 和 conflict/error transitions。
5. 验证 `@blocknote/shadcn` styles 与 project shadcn components 能共同编译和渲染。
6. 验证 settings IPC 只返回 redacted provider summary，safeStorage failure 不落明文。
7. 断言 `.writellm` 层级、manifest、`.git` initial commit、portable move/rebind、recent missing 和 Git history。
8. 验证 removeRecentProject 不删除文件，deleteProject 成功后移入 OS trash。

## Failure-boundary checks

| Boundary | Check | Expected |
|---|---|---|
| Renderer → preload | 读取 `window.writellm` keys | 只有显式 launch/project/workspace/settings methods |
| Preload → main | 契约测试 channel set + sender | 无 generic IPC；非受信 frame 被拒绝 |
| UI shell | 点击 rail / modal / Escape / outside | 只改变 panel/modal state，不丢 editor session |
| BlockNote → persistence | block id、citation id、Markdown codec | stable identity；lossy Markdown helper 不覆盖 canonical |
| Settings → secret store | 保存、读取 summary、backend failure | plaintext 不回 renderer、不进项目；失败可重试 |
| Native dialog → main | 取消创建/打开选择器 | 返回 canceled，不创建项目、不修改 recent |
| Main → filesystem | traversal-like/non-UUID IDs | 无法访问任意项目外部路径 |
| Portable project | 移动 `.writellm` 后通过 dialog 打开 | 以 manifest.id 恢复，不依赖旧路径 |
| Persistence → UI | rename/write/Git 失败 | UI 不显示保存成功，保留 dirty/retry/conflict 状态 |
