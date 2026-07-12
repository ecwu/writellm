# Implementation Plan: 可移动项目与启动工作区基础

Branch: `codex/v2-greenfield`  
Feature: `001-project-foundation`  
Date: 2026-07-12  
Spec: [spec.md](./spec.md)  
Status: Accepted — maintainer accepted 2026-07-12

## Summary

为作者建立一个最小但可移动的 `.writellm` 项目基础：项目根目录由不可变的版本化
`project.json` 和空 `workspace/` 必需目录构成，应用 `userData` 只保存最多 5 条
main-owned 最近项目指针。创建、打开、重新绑定和移除最近记录全部由唯一活动 main
实例负责；open/relink 对项目树严格只读，renderer 只能通过 6 个显式、typed preload
IPC 取得安全摘要。

本计划只覆盖 `spec.md` 的项目入口与启动工作区基础。它不初始化 Git、不提供项目
文件删除、不实现章节/资料/AI/历史，也不引入 SQLite、远程服务或新的运行时库。进入
产品实现前，先把现有直接依赖升级并冻结到 2026-07-12 已确认的最新稳定基线。

## Current baseline

当前仓库是 Electron 40 + React 19 + Vite 6 + TypeScript 5 的启动 foundation；001 的
第一项工程变更是升级到已确认的新基线：

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

**Language/Version**: TypeScript 7.0.2；React/React DOM 19.2.7；Electron 43.1.0；
Bun 1.3.14。

**Primary Dependencies**: Vite 8.1.4、`@vitejs/plugin-react` 6.0.3、`@types/node`
26.1.1、`@types/react` 19.2.17、`@types/react-dom` 19.2.3；所有直接依赖在
`package.json` 与 `bun.lock` 精确冻结。不新增 schema、数据库、Git、UI 或其他运行时
库；使用 Node 内置 `node:fs/promises`、`node:path`、`node:crypto`。

**Storage**: 项目目录内只有 UTF-8 JSON manifest 与空 `workspace/` 必需目录；应用 `app.getPath('userData')` 下保存 `recent-projects.json` 和 main-only、不可续接的 cleanup receipt index。创建根使用 exclusive mkdir，manifest 最后原子发布；不使用 SQLite 或 Git。

**Testing**: `bun:test` 的 domain/contract tests、现有 `bun run typecheck` 和编译产物 smoke；新增真实 compiled Electron runtime smoke 验证 IPC、文件选择取消、失败结果和双进程单实例。

**Target Platform**: Electron desktop app，macOS、Windows、Linux；单作者、单机、单活动实例、单窗口。

**Project Type**: 沙箱化 Electron desktop app。

**Performance Goals**: 满足 spec 的 SC-001 至 SC-005；文件操作异步执行并让启动页显式呈现 loading/error 状态。本 feature 不新增未经接受的毫秒级 SLA。

**Constraints**: 最近列表最多 5 条且按 projectId 唯一；renderer 不接收绝对路径、不访问 Node/Electron、不发 generic IPC；名称只做路径安全检查并由当前目标文件系统裁决；open/relink 只读且不更新 manifest 时间戳；应用不提供删除项目文件夹；secondary 在任何 storage/IPC/window bootstrap 前退出；取消、校验失败和存储失败不得显示为成功。

## Constitution Check — pre-research gate

| Principle | Status | Evidence / gate |
|---|---|---|
| I. Secure Desktop Boundary | PASS WITH PLAN | 文件选择、路径解析、manifest 只读验证和项目创建只在 primary main；renderer 只收安全 DTO。实现必须保留现有 BrowserWindow 安全配置。 |
| II. Typed, Minimal IPC | PASS WITH PLAN | [contracts/contract.md](./contracts/contract.md) 设计为恰好 6 个 named methods；preload 逐项映射并移除旧 runtime-info，禁止通用 `send/invoke/on` 暴露。 |
| III. Specification-Driven, Minimal Evolution | PASS | `spec.md`、本 plan、更新后的 `ADR-002` 与 6-method contract 已接受；ADR-001 的内容/Git history 条款不属于 001 前置条件；tasks 已从已接受设计重新生成。 |
| IV. Verification at the Failure Boundary | PASS WITH PLAN | 测试覆盖 domain、IPC contract、compiled Electron 和文件系统失败边界；不能用 typecheck 代替 runtime 验证。 |

**Gate conclusion**: 研究与 Phase 1 设计可以完成，没有 Constitution exception 或
`NEEDS CLARIFICATION`；durable schema 与 6-method project IPC contract 已冻结，tasks
已从已接受设计重新生成，implementation gate 已满足。

## Research decisions

Phase 0 的决定已记录在 [research.md](./research.md)，没有遗留的技术空白。
已接受并冻结的研究决定如下：

1. 使用内置 JSON + `fs/promises`；不引入 schema/database/Git package。
2. 使用项目根 `project.json` + 空 `workspace/`，schemaVersion 固定为 `1`；不创建
   workspace state，未知版本只读报错，不迁移、不修复。
3. 创建前记录 main-only cleanup receipt，再以 exclusive mkdir 保留最终根，写 tokenized
   manifest temp 与必需目录，最后原子发布 manifest；任何同名目录项都不覆盖，manifest
   验证成功前不写 recent index。receipt 不含 stage/payload，不能续接事务。
4. 所有 native directory dialogs 由 main 发起；renderer 不传路径，relink 操作必须
   比对稳定 `projectId`。
5. recent index 最多保留 5 条并按 projectId upsert；普通 Open 相同 ID 更新原路径与
   时间，renderer 只收到状态和摘要。
6. 名称只验证非空当前平台叶子与路径 confinement；不 trim/normalize/限长或应用
   跨平台保留名，其他合法性由目标文件系统裁决。
7. main 在任何 bootstrap 副作用前取得单实例锁；secondary 退出，primary 恢复并聚焦
   原窗口。真实 compiled Electron 双进程 smoke 验证该边界。
8. 产品实现前先升级并精确冻结 Bun 1.3.14、TypeScript 7.0.2、Electron 43.1.0、
   React/React DOM 19.2.7、Vite 8.1.4、`@vitejs/plugin-react` 6.0.3 及对应类型包；
   升级后必须通过现有 typecheck、test、build、smoke。不引入 Playwright、React
   Testing Library 或其他新依赖。
9. 本 feature 不依赖外部服务、凭据、Git 或 SQLite；失败操作不自动重试或自动合并，
   用户通过再次发起 named method 重试，001 不实现跨项目冲突解决。
10. 001 只处理小型项目与 recent 元数据，不新增毫秒级 SLA 或大文件处理承诺；
   平台目标保持 macOS、Windows、Linux，行为验收以 spec success criteria 和 compiled
   Electron smoke 为准。

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
└── tasks.md                  # 由 speckit-tasks 从已接受设计重新生成
```

### Planned source delta

```text
src/
├── main/
│   ├── main.ts               # 单实例门、窗口生命周期与一次性 project IPC 注册
│   └── project/
│       ├── project-repository.ts
│       ├── project-validation.ts
│       ├── recent-index.ts
│       ├── cleanup-receipts.ts
│       └── atomic-json.ts
├── preload/
│   └── preload.cts            # 逐项暴露 contract 中的 named methods
├── shared/
│   ├── ipc.ts                 # channel names + WriteLLMIpc
│   └── project.ts             # DTO、manifest、recent、error unions
└── renderer/
    ├── App.tsx                # 启动页装配层
    ├── launch/
    │   ├── LaunchPage.tsx
    │   └── launchState.ts
    └── styles.css

test/
├── unit/project/              # 本地名称、manifest、recent/index、collision-safe 创建
├── contract/project/          # IPC DTO、redaction、错误码和暴露面
├── integration/project/       # launch UI loading/error/cancel/empty 状态
└── runtime/project/           # compiled Electron IPC、双进程单实例和真实文件 fixture
```

**Structure decision**: 保持现有单仓库 Electron 分层。project domain 与文件系统
只在 `src/main/project`；跨边界类型在 `src/shared`；preload 只做显式映射；renderer
只渲染 launch state。不会复制 `legacy/v1-freeze` 的代码、组件、IPC 或持久化模型。

## Implementation Phases

### Phase 0 — Review gate and toolchain baseline

1. 本 plan 与更新后的 `docs/adr/002-project-foundation.md` 已重新接受，并明确
   `docs/adr/001-project-storage.md` 的 Git/history 条款不属于本 feature。
2. 确认 [data-model.md](./data-model.md) 的 manifest-only 项目状态、不可变 timestamps、
   空必需目录、projectId 去重、native-name 与 single-instance 不变量。
3. [contracts/contract.md](./contracts/contract.md) 的 6 个 method、DTO、错误码、
   cancel/relink/只读 open 语义已确认；`plan-decisions.md` 已更新，tasks 已重新生成。
4. 在产品功能代码之前升级并精确冻结已确认的直接依赖版本；处理 TypeScript 7 的配置
   兼容性，并要求 `bun run typecheck`、`bun run test`、`bun run build`、
   `bun run test:smoke` 全部通过后，才进入 Phase 1。

### Phase 1 — Domain storage and validation

1. 实现 project name 的最小安全验证：非空当前平台叶子、NUL/路径控制拒绝和 parent
   confinement；不 trim/normalize/限长或应用跨平台规则，目标文件系统裁决其他合法性。
2. 实现 `project.json` encode/decode/validation；严格校验 kind、schemaVersion、UUID、
   原样显示名、相同 createdAt/updatedAt 和 required 空 `workspace/` 目录。
3. 实现 collision-safe 创建：原子 cleanup receipt → exclusive mkdir 最终根 →
   tokenized manifest temp → 空 workspace → manifest-last 原子发布 → 验证 → recent
   publish。任何同名 entry 都不覆盖；cleanup 只核验 receipt 路径，并只删除 token
   匹配、无有效 manifest 且不含未知文件的未完成根。receipt 不支持恢复创建。
4. 实现 `recent-projects.json` 的 atomic read/write、最多 5 条、按 projectId 的
   upsert/排序/淘汰，以及 missing/invalid/inaccessible 状态刷新。普通 Open 相同 ID
   保留 recentId 并更新路径/时间；recent index 失败不得删除或修改项目目录。

### Phase 2 — Main, preload and IPC integration

1. 在任何 `whenReady`、IPC/storage 初始化和窗口创建前取得 single-instance lock；
   secondary 只退出，primary 注册 `second-instance` 并与 macOS activate 共用幂等的
   restore/show/focus 窗口路径。
2. 移除现有 `getRuntimeInfo`，只注册 `listRecentProjects`、`createProject`、
   `openProjectFromDialog`、`openRecentProject`、`relinkRecentProject` 和
   `removeRecentProject`；不注册 workspace save 或 `deleteProject`。
3. 使用 Electron main-owned directory dialogs；create 选择父目录，open/relink 选择
   项目目录。所有 renderer 输入在 handler 入口重新验证，并校验 IPC sender。
4. 将绝对路径、raw filesystem exceptions、project file contents 和任何 secret
   从 response 中剥离，只返回 bounded project/recent DTO 与稳定错误码。
5. open/relink 只读验证磁盘 manifest 和 required directory；relink 只有在磁盘
   `projectId` 与原 recent record 一致时更新 recent，否则保留原 record 不变并返回
   `PROJECT_ID_MISMATCH`。任何结果都不得写项目树。

### Phase 3 — Launch renderer

1. 将 `App.tsx` 改为启动页状态装配：loading、空 recent、available、missing/invalid
   和 operation error 都有明确文本。
2. 新建流程提交显示名并调用 `createProject`；取消、失败均留在启动页，不伪造成功。
3. 最近项目卡片按 main 返回顺序展示最多 5 条；失效记录提供 remove 与 relink，
   available 记录提供 open。没有删除项目文件夹按钮或通用路径输入框。
4. 打开成功后只渲染空工作区，不保存工作区状态或编辑位置；不实现章节、block、
   资料或 AI 内容。启动页使用原生语义控件、可见 focus 和可读 status/error 文本，
   不新增 UI 依赖。

### Phase 4 — Failure-boundary verification

1. unit tests 覆盖当前平台名称边界、目标 filesystem 拒绝、manifest 不可变 timestamps、
   required directory、任何同名 entry 不覆盖、recent limit/ID upsert 和原子写入失败。
2. contract tests 覆盖 preload exposed keys、DTO redaction、sender/input validation、
   stable error codes、cancel result 和无 `deleteProject`。
3. integration tests 覆盖 first launch、empty/loading、dialog cancel、invalid project、
   missing recent、relink mismatch、普通 Open 同 ID 去重、remove recent、语义 focus 与
   safe error display；open/relink 前后对项目 tree hash 与 timestamps 做字节不变断言。
4. compiled Electron smoke 覆盖 create → open empty workspace、restart → recent open、
   move/relink、同名不覆盖、项目移除仅移除 record，以及真实双进程 secondary 退出、
   primary 单窗口 restore/show/focus 和无 secondary storage/IPC bootstrap。
5. 运行仓库命令并记录失败边界；任何实现偏离 data model/contract/ADR 都必须先更新
   设计材料，不在 tasks 中隐式改决定。

## Verification Matrix

| Failure boundary | Required evidence |
|---|---|
| Renderer → preload → main | 恰好 6 个 named methods；旧 runtime-info/workspace save 不存在；取消、非法 DTO、错误结果可观察且不含绝对路径。 |
| Main → native dialog | create/open/relink 取消不会写入；选择目录由 main 接收并校验。 |
| Main → project storage | exclusive root 保证任何同名 entry 不覆盖；manifest 最后发布；invalid/open/relink 不写入或自动修复。 |
| Project → recent index | open/upsert 后最多 5 条且每个 projectId 一条；普通 Open/移动后更新原记录；remove 不触碰项目文件。 |
| Project read-only boundary | open/relink 前后 tree hash、manifest bytes 和 createdAt/updatedAt 完全不变。 |
| Main process lifecycle | 锁在 bootstrap 前取得；secondary 不注册 IPC、不初始化 storage、不创建窗口并退出。 |
| Compiled Electron runtime | 真实 preload/main/renderer 路径完成 create/open/restart/relink 与双进程 single-instance smoke。 |

## Constitution Check — Phase 1 design re-check

| Principle | Status | Design evidence / remaining gate |
|---|---|---|
| I. Secure Desktop Boundary | PASS IN DESIGN | `contract.md` 不返回路径；repository/dialog 只在 primary main；实现必须保留 sandbox/context isolation/nodeIntegration baseline。 |
| II. Typed, Minimal IPC | PASS IN DESIGN | DTO/error/channel 已定义为 6 个最小方法；无 runtime-info、workspace save、generic IPC、delete method 或任意文件 API。 |
| III. Specification-Driven, Minimal Evolution | PASS | spec、plan、ADR-002、durable schema 与 contract 已接受；授权实施的 tasks 已从这些设计重新生成。 |
| IV. Verification at the Failure Boundary | PASS IN DESIGN | domain、contract、integration、只读 hash 和真实双进程 Electron smoke 对应 filesystem、IPC 与 lifecycle failure boundary。 |

**Post-design gate**: 没有 Constitution exception，也没有技术 unknown。Phase 1 设计、
维护者确认和 tasks 重新生成均已完成；implementation 可按 `tasks.md` 从 T001 开始。

## Complexity Tracking

无 Constitution exception。exclusive root + manifest-last、main-owned repository、
single-instance lifecycle 和 bounded 6-method IPC 是满足 FR-002、FR-004、FR-006、
FR-009、FR-010、FR-012 与 FR-014 所需的最小复杂度；Git、SQLite、workspace state、
跨平台名称规则、多实例锁协议、全盘扫描、自动修复、远程同步和 renderer 文件系统访问
均明确拒绝。
