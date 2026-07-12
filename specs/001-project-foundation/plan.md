# Implementation Plan: 可移动项目与启动工作区基础

Branch: `codex/v2-greenfield`  
Feature: `001-project-foundation`  
Date: 2026-07-12  
Spec: [spec.md](./spec.md)  
Status: Draft — design complete; implementation remains gated on acceptance

## Summary

为作者建立一个最小但可移动的 `.writellm` 项目基础：项目根目录由版本化
`project.json` 描述，`workspace/state.json` 保存空工作区和最近编辑位置，应用
`userData` 只保存最多 5 条 main-owned 最近项目指针。创建、打开、重新绑定、移除
最近记录和工作区状态更新全部由 main 进程负责；renderer 只能通过显式、typed
preload IPC 取得安全摘要。

本计划只覆盖 `spec.md` 的项目入口与启动工作区基础。它不初始化 Git、不提供项目
文件删除、不实现章节/资料/AI/历史，也不引入 SQLite、远程服务或新的运行时依赖。

## Current baseline

当前仓库是 Electron 40 + React 19 + Vite 6 + TypeScript 5 的启动 foundation：

- `src/main/main.ts` 已创建带 `contextIsolation: true`、`nodeIntegration: false`、
  `sandbox: true` 的窗口，并限制导航和外部窗口。
- `src/preload/preload.cts` 只暴露 `getRuntimeInfo`；`src/shared/ipc.ts` 是现有
  typed IPC 类型的唯一来源。
- renderer 只有基础运行时状态页；当前没有项目存储、最近索引或 project IPC。
- 仓库命令为 `bun run typecheck`、`bun run test`、`bun run build` 和
  `bun run test:smoke`。

现有 draft 设计曾包含 Git、项目删除和 12 条 recent records；这些内容与本 feature
  的 accepted clarification/scope 不一致，本计划明确删除这些依赖。

## Technical Context

**Language/Version**: TypeScript 5.8.2；React/React DOM 19；Electron 40.10.5；Bun 1.3.4。  
**Primary Dependencies**: 继续使用现有 Electron、React、Vite、TypeScript；不新增 schema、数据库、Git 或 UI 库依赖。使用 Node 内置 `node:fs/promises`、`node:path`、`node:crypto`。  
**Storage**: 项目目录内的 UTF-8 JSON manifest/state；应用 `app.getPath('userData')` 下的 `recent-projects.json`。写入使用同目录临时文件/临时目录与 rename；不使用 SQLite 或 Git。  
**Testing**: `bun:test` 的 domain/contract tests、现有 `bun run typecheck` 和编译产物 smoke；新增 project runtime smoke 通过真实 compiled Electron 路径或等价 runtime seam 验证 IPC、文件选择取消和失败结果。  
**Target Platform**: Electron desktop app，macOS、Windows、Linux；单作者、单机、单窗口。  
**Project Type**: 沙箱化 Electron desktop app。  
**Performance Goals**: 满足 spec 的 SC-001 至 SC-005；文件操作异步执行并让启动页显式呈现 loading/error 状态。本 feature 不新增未经接受的毫秒级 SLA。  
**Constraints**: 最近列表最多 5 条；renderer 不接收绝对路径、不访问 Node/Electron、不发 generic IPC；无效项目只读诊断且不自动修复；应用不提供删除项目文件夹的操作；取消、校验失败和存储失败不得显示为成功。

## Constitution Check — pre-research gate

| Principle | Status | Evidence / gate |
|---|---|---|
| I. Secure Desktop Boundary | PASS WITH ACCEPTANCE CONDITION | 文件选择、路径解析、manifest 读取和写入只在 main；renderer 只收安全 DTO。实现必须保留现有 BrowserWindow 安全配置。 |
| II. Typed, Minimal IPC | PASS WITH ACCEPTANCE CONDITION | [contracts/contract.md](./contracts/contract.md) 冻结 7 个 named methods；preload 逐项映射，禁止通用 `send/invoke/on` 暴露。 |
| III. Specification-Driven, Minimal Evolution | BLOCKED UNTIL ACCEPTED | 当前 `spec.md` 为 Draft，`ADR-001` 为 Proposed；本计划不生成 `tasks.md`、不实现代码。实现前必须接受 spec、plan 和所需 ADR/contract。 |
| IV. Verification at the Failure Boundary | PASS WITH PLAN | 测试覆盖 domain、IPC contract、compiled Electron 和文件系统失败边界；不能用 typecheck 代替 runtime 验证。 |

**Gate conclusion**: 设计可以进入 review；implementation gate 仍为 blocked，直到
`spec.md`、本 `plan.md` 和跨边界存储/IPC 决策被接受。没有申请 Constitution exception。

## Research decisions

Phase 0 的决定已记录在 [research.md](./research.md)，没有遗留的技术空白。
尚未接受的事项是治理门槛，而不是未研究的技术问题：

1. 使用内置 JSON + `fs/promises`；不引入 schema/database/Git package。
2. 使用项目根 `project.json` + `workspace/state.json`，schemaVersion 固定为 `1`；
   未知版本只读报错，不迁移、不修复。
3. 创建使用同父目录临时目录完成后 rename；最终目录在完成前不写入 recent index。
4. 所有 native directory dialogs 由 main 发起；renderer 不传路径，relink 操作必须
   比对稳定 `projectId`。
5. recent index 最多保留 5 条；路径是 main-only 数据，renderer 只收到状态和摘要。
6. 使用现有 Bun test/build/smoke 基础，不在本 feature 计划中引入 Playwright、
   React Testing Library 或其他新依赖。

## Project Structure

### Documentation

```text
specs/001-project-foundation/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── contract.md
├── checklists/
│   ├── requirements.md
│   └── plan-decisions.md
└── tasks.md                  # 由 speckit-tasks 生成；本次不创建
```

### Planned source delta

```text
src/
├── main/
│   ├── main.ts               # 注册 project IPC，并持有 repository/index
│   └── project/
│       ├── project-repository.ts
│       ├── project-validation.ts
│       ├── recent-index.ts
│       └── atomic-json.ts
├── preload/
│   └── preload.cts            # 逐项暴露 contract 中的 named methods
├── shared/
│   ├── ipc.ts                 # channel names + WriteLLMIpc
│   └── project.ts             # DTO、manifest、state、error unions
└── renderer/
    ├── App.tsx                # 启动页装配层
    ├── launch/
    │   ├── LaunchPage.tsx
    │   └── launchState.ts
    └── styles.css

test/
├── unit/project/              # 名称、manifest、recent/index、原子写入
├── contract/project/          # IPC DTO、redaction、错误码和暴露面
├── integration/project/       # launch UI loading/error/cancel/empty 状态
└── runtime/project/           # compiled Electron IPC 和真实文件 fixture
```

**Structure decision**: 保持现有单仓库 Electron 分层。project domain 与文件系统
只在 `src/main/project`；跨边界类型在 `src/shared`；preload 只做显式映射；renderer
只渲染 launch state。不会复制 `legacy/v1-freeze` 的代码、组件、IPC 或持久化模型。

## Implementation Phases

### Phase 0 — Review gate and fixture contract

1. 接受 feature spec、plan 和 `docs/adr/001-project-storage.md` 中适用于 portable
   root/recent pointer 的部分；明确 ADR 中 Git/history 条款不属于本 feature。
2. 确认 [data-model.md](./data-model.md) 的 JSON 文件名、schemaVersion、必需目录、
   recent 上限和 `lastEditedLocation` v1 值域。
3. 确认 [contracts/contract.md](./contracts/contract.md) 的 method、DTO、错误码、
   cancel/relink 语义；将确认结果反映到 `plan-decisions.md`，再生成 tasks。

### Phase 1 — Domain storage and validation

1. 实现 project name normalization、跨平台保留名/分隔符控制、最终目录名生成和
   collision detection。
2. 实现 `project.json`、`workspace/state.json` 的 encode/decode/validation；严格
   校验 kind、schemaVersion、UUID、显示名、timestamps 和 required `workspace` 目录。
3. 实现创建事务：同父目录临时目录 → 写 manifest/state → fsync/close 能力按平台
   可用性处理 → rename 到最终 `.writellm` 目录；失败时不注册 recent record。
4. 实现 `recent-projects.json` 的 atomic read/write、最多 5 条的 upsert/排序/淘汰，
   以及 missing/invalid/inaccessible 状态刷新。recent index 失败不得删除项目目录。

### Phase 2 — Main, preload and IPC integration

1. 在 main 注册 `listRecentProjects`、`createProject`、`openProjectFromDialog`、
   `openRecentProject`、`relinkRecentProject`、`removeRecentProject` 和
   `saveProjectWorkspace`；不注册 `deleteProject`。
2. 使用 Electron main-owned directory dialogs；create 选择父目录，open/relink 选择
   项目目录。所有 renderer 输入在 handler 入口重新验证，并校验 IPC sender。
3. 将绝对路径、raw filesystem exceptions、project file contents 和任何 secret
   从 response 中剥离，只返回 bounded project/recent DTO 与稳定错误码。
4. open/relink 时重新读取磁盘 manifest；relink 只有在磁盘 `projectId` 与原 recent
   record 一致时更新路径，否则保留原 record 不变并返回 `PROJECT_ID_MISMATCH`。

### Phase 3 — Launch renderer

1. 将 `App.tsx` 改为启动页状态装配：loading、空 recent、available、missing/invalid
   和 operation error 都有明确文本。
2. 新建流程提交显示名并调用 `createProject`；取消、失败均留在启动页，不伪造成功。
3. 最近项目卡片按 main 返回顺序展示最多 5 条；失效记录提供 remove 与 relink，
   available 记录提供 open。没有删除项目文件夹按钮或通用路径输入框。
4. 打开成功后渲染空工作区，并以 `saveProjectWorkspace` 保存 v1 的
   `lastEditedLocation: { kind: "workspace" }`；不实现章节、block、资料或 AI 内容。

### Phase 4 — Failure-boundary verification

1. unit tests 覆盖名称/manifest、版本拒绝、required directory、collision、recent
   limit、ID matching 和 atomic write failure。
2. contract tests 覆盖 preload exposed keys、DTO redaction、sender/input validation、
   stable error codes、cancel result 和无 `deleteProject`。
3. integration tests 覆盖 first launch、empty state、loading、dialog cancel、invalid
   project、missing recent、relink mismatch、remove recent 和 safe error display。
4. compiled Electron smoke 覆盖 create → open workspace、restart → recent open、移动
   后 relink、同名不覆盖、项目移除仅移除 record、project folder 不被 delete。
5. 运行仓库命令并记录失败边界；任何实现偏离 data model/contract/ADR 都必须先更新
   设计材料，不在 tasks 中隐式改决定。

## Verification Matrix

| Failure boundary | Required evidence |
|---|---|
| Renderer → preload → main | 只有 7 个 named methods；取消、非法 DTO、错误结果可观察且不含绝对路径。 |
| Main → native dialog | create/open/relink 取消不会写入；选择目录由 main 接收并校验。 |
| Main → project storage | 同名不覆盖；失败不注册 recent；invalid project 不写入或自动修复。 |
| Project → recent index | open/upsert 后最多 5 条；移动后以 stable ID 更新；remove 不触碰项目文件。 |
| Compiled Electron runtime | 真实 preload/main/renderer 路径完成 create/open/restart/relink smoke。 |

## Constitution Check — Phase 1 design re-check

| Principle | Status | Design evidence / remaining gate |
|---|---|---|
| I. Secure Desktop Boundary | PASS WITH ACCEPTANCE CONDITION | `contract.md` 不返回路径；repository/dialog 只在 main；实现必须保留 sandbox/context isolation/nodeIntegration baseline。 |
| II. Typed, Minimal IPC | PASS WITH ACCEPTANCE CONDITION | DTO/error/channel 已在 contract 中定义；无 generic IPC、delete method 或任意文件 API。 |
| III. Specification-Driven, Minimal Evolution | BLOCKED UNTIL ACCEPTED | 设计完成不等于批准；spec、plan、ADR 和 contract 仍需 review/acceptance 后才可进入 tasks/implementation。 |
| IV. Verification at the Failure Boundary | PASS | domain、contract、integration 和 compiled Electron smoke 分别对应文件系统、IPC 和 runtime failure boundary。 |

**Post-design gate**: 没有 Constitution exception。实现授权仍取决于接受
`spec.md`、本 plan、所需 ADR/contract，并将所有 acceptance decisions 记录到 checklist。

## Complexity Tracking

无 Constitution exception。临时目录 + rename、main-owned repository 和 bounded IPC
是满足 FR-004、FR-007、FR-009、FR-010 及安全基线所需的最小复杂度；Git、SQLite、
全盘扫描、自动修复、远程同步和 renderer 文件系统访问均明确拒绝。
