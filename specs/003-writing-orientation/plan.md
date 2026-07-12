# Implementation Plan: 写作动机与文章大纲

**Branch**: `003-writing-orientation` | **Date**: 2026-07-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-writing-orientation/spec.md`

**规划状态**: 第一版高可行性方案。本文允许实现团队继续细化，但在 spec、storage ADR、依赖 feature contract 和下方决策未接受前，不授权实现产品代码。

## Summary

本 feature 为每个可移动 `.writellm` 项目维护一份写作方向文档：可为空的写作动机、单层有序大纲、条目状态和可选章节关联；工作台在重新打开项目时恢复最近一次成功保存的方向和编辑位置。渲染进程只维护当前草稿和交互状态，主进程负责校验、串行保存、项目存储和失败恢复。

方案沿用 ADR-001 的 main-owned portable project、结构化 JSON、同目录临时文件加 rename、pending transaction 和本地 Git history 边界，但不复制 001 的项目创建/打开实现。003 通过一个最小的写作方向存储 adapter 接入 001 的 project session/storage contract，通过 002 的 workspace shell 接入面板和位置状态，通过 004 的不透明 chapter reference 展示关联，不拥有章节正文。

库、包、Git runtime、排序实现、schema validator、IPC 方法粒度和版本策略均只形成候选；本版每项最终决策均为 `Decision: NEEDS DECISION`，详见 [research.md](./research.md) 和 [checklists/plan-decisions.md](./checklists/plan-decisions.md)。

## Technical Context

**Language/Version**: TypeScript 5.8.x（仓库当前），React 19.x，Electron 40.10.5，Bun 1.3.4；具体升级/锁定策略 `NEEDS DECISION`。

**Primary Dependencies**: 当前已有 `electron`、`react`、`react-dom`、Vite、TypeScript 和 Bun test。003 不预批准新增依赖；schema 校验、原子写入、Git adapter、排序/无障碍能力的候选见 [research.md](./research.md)，版本范围与是否引入均 `NEEDS DECISION`。

**Storage**: 计划使用项目根目录下由 001/ADR-001 管理的结构化 JSON 文档保存写作方向，建议逻辑文件为 `content/writing-orientation.json`；`project.json`、`ui-state.json`、`runtime/pending/`、`.git` 仍分别由项目基础/工作台/存储边界管理。精确文件路径、schemaVersion、revision 组合和 Git commit 事件格式依赖 ADR-001 与 001 contract 接受，均 `NEEDS DECISION`。

**Testing**: 现有 `bun run typecheck`、`bun run test`、`bun run build`、`bun run test:smoke`，以及 `bun run dev` / `bun run dev:electron` 手工运行入口。计划增加 shared/domain 单元、IPC contract、main storage integration 和真实 Electron runtime smoke；测试工具不另行拍板。

**Target Platform**: Electron 40 桌面应用，renderer 保持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。支持的操作系统矩阵、随应用携带的 Git runtime 和发布包策略 `NEEDS DECISION`。

**Project Type**: 单仓 Electron + React 桌面应用。

**Performance Goals**: spec 目前只有用户级 SC-001～SC-004，没有 load/save p95、文档大小或条目数量阈值。建议决策时分别给出普通写作方向文档的读取/保存目标、最大动机/摘要长度和最大条目数；在阈值接受前标记为 `NEEDS DECISION`，不能把建议值当作验收标准。

**Constraints**: 单作者、单机、本地优先、首版离线可用；单层有序列表；动机允许为空；空白标题不得保存；保存失败必须保留可恢复草稿并给出重试；删除有关联章节的条目必须先确认；不实现正文、资料、AI、provider、远程同步、多人协作或版本历史产品界面。renderer 不接触绝对路径、文件系统、Git、凭据或任意 IPC。

**Scale/Scope**: 一个已打开项目内的一份写作方向文档，包含一组扁平大纲条目和一个最近位置贡献。项目 identity、目录、recent index、通用 UI state、chapter 正文和外部 provider 均由其他 feature/ADR 管理；条目数量和文本上限 `NEEDS DECISION`。

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### 研究前检查

| 原则/门禁 | 状态 | 规划结论 |
|---|---|---|
| 接受的 feature spec 与 plan 后再实现 | **BLOCKED UNTIL ACCEPTED** | 003 spec 当前为 Draft；本文件是规划产物，不代表接受。 |
| I. Secure Desktop Boundary | PASS（设计意图） | renderer 只处理 DTO 和草稿；文件、Git、路径和恢复均留在 main/storage adapter。 |
| II. Typed, Minimal IPC | PASS（待冻结） | 只增加具名 typed methods；preload 不暴露 generic IPC；contract 尚待 001/003 接受。 |
| III. Specification-Driven, Minimal Evolution | **BLOCKED UNTIL ACCEPTED** | ADR-001 为 Proposed，001/002 为 Draft；跨持久化/进程决策先记录并接受 ADR/contract。 |
| IV. Verification at the Failure Boundary | PASS（计划） | 保存故障、IPC 校验、pending recovery 和 renderer↔main 流程均安排相应层级验证及 Electron smoke。 |

未满足的接受门禁不是实现阶段的默认许可，具体记录在 Complexity Tracking；所有技术候选决策提醒见 [plan-decisions.md](./checklists/plan-decisions.md)。

### 设计后复核（本版）

- 安全边界和 typed IPC 仍满足 constitution；contracts 明确拒绝绝对路径、任意 channel、任意文件读写和 generic bridge。
- 最小方案是单一写作方向快照保存 API + 单一删除确认 API；排序、编辑和状态先在 renderer 草稿中更新，避免为每个字段增加 IPC channel。
- `revision`、pending transaction、Git commit 和 UI location 横跨 durable/system boundaries；在 storage ADR、001 project contract、002 shell/location contract 接受前保持 `NEEDS DECISION`。
- Quickstart 安排 `bun run test`、`bun run typecheck`、`bun run build` 和 `bun run test:smoke`，并要求真实 Electron runtime 场景，不以 renderer 静态检查替代边界验证。

## Project Structure

### Documentation (this feature)

```text
specs/003-writing-orientation/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── writing-orientation-ipc.md
│   └── writing-orientation-storage.md
└── checklists/
    ├── requirements.md       # 已有；本次不修改
    └── plan-decisions.md     # 本次新增
```

不创建 `tasks.md`；它属于后续 `/speckit-tasks` 阶段。

### Source Code (repository root)

以下是当前真实源码布局和该 feature 计划新增的最小位置。`[已有基础]` 表示本轮读取到的代码；`[计划新增]` 只描述后续实现落点，不表示本次已创建。

```text
src/
├── main/
│   ├── main.ts                         # [已有基础] BrowserWindow、安全设置、runtime IPC
│   ├── project-storage/                # [计划新增/由 001 提供或冻结 adapter]
│   │   ├── project-session.ts          # [计划新增] 当前项目与 revision 上下文边界
│   │   ├── atomic-writer.ts             # [计划新增] 候选实现，最终包/平台能力未定
│   │   └── git-repository.ts            # [计划新增] main-owned Git adapter
│   └── writing-orientation/
│       ├── handlers.ts                  # [计划新增] IPC handler 与 sender/输入校验
│       ├── repository.ts                # [计划新增] 003 domain 与 storage adapter 的连接
│       └── validation.ts                # [计划新增] schema/业务规则；validator 未定
├── preload/
│   └── preload.cts                      # [已有基础] 只暴露 runtime；计划增加具名方向方法
├── renderer/
│   ├── App.tsx                          # [已有基础] startup foundation；计划由 002 接入 workspace
│   ├── main.tsx                         # [已有基础]
│   ├── styles.css                       # [已有基础] foundation 样式；计划增加 feature 样式
│   └── features/
│       └── writing-orientation/         # [计划新增] 动机表单、大纲列表、状态和失败恢复 UI
│           ├── WritingOrientationPanel.tsx
│           ├── outline-state.ts
│           └── writing-orientation.css
├── shared/
│   ├── ipc.ts                           # [已有基础] runtime channel；计划扩展 typed DTO/API
│   ├── writing-orientation.ts           # [计划新增] DTO、状态、错误码与 schema 版本常量
│   └── project.ts                       # [计划新增/依赖 001] 项目/工作区共享类型（如 001 采用该边界）
└── vite-env.d.ts                        # [已有基础]

test/
├── smoke/
│   └── ipc-contract.test.ts             # [已有基础] foundation IPC contract
├── unit/                                # [计划新增] domain validation/ordering/recovery decisions
├── integration/                         # [计划新增] main storage adapter 与 temp project fixture
└── contract/                            # [计划新增] shared/preload/main DTO/channel shape

scripts/
├── dev-electron.mjs                     # [已有基础]
└── electron-smoke.mjs                  # [已有基础] build 后 Electron foundation smoke；计划扩展场景
```

**Structure Decision**: 保持现有单仓三层边界（main / preload / renderer）和 `src/shared` typed contract；003 以 feature module 分组，不把文件系统或 Git 逻辑放到 renderer，不新建独立 backend/package。项目存储实现由 001/ADR-001 提供的 adapter 作为依赖边界；若最终目录命名不同，只调整 adapter 路径，不改变 003 的 domain/IPC contract。

## 分阶段实施顺序

### Phase 0 — 接受前置决策并冻结边界

1. 将 003 spec 从 Draft 接受，并明确 SC-002 的“保存/重新打开测试”包含哪些平台和失败场景。
2. 接受 ADR-001，尤其是 portable root、canonical JSON、project-local Git、串行队列、pending recovery 和 packaged Git runtime。
3. 接受 001 的 project IPC/storage contract 与 002 的 workspace/location contract；确认 003 不重复实现项目创建、最近项目和工作台 shell。
4. 对 [research.md](./research.md) 的 schema、atomic writer、Git adapter、reorder、ID、test runner 候选做最终选择，并记录版本策略；未完成前仍为 `NEEDS DECISION`。

### Phase 1 — Shared domain model and validation

1. 将 [data-model.md](./data-model.md) 的 `WritingOrientationDocument`、动机、条目、location contribution、revision 和错误码编码到 `src/shared`。
2. 在 main 边界实现 schema 与业务规则校验：空动机可保存、标题 trim 后不得为空、条目 id/order 唯一、状态为有限 enum、chapter reference 不透明。
3. 为旧/未知 `schemaVersion`、重复提交、revision conflict、控制字符和上限策略保留显式分支；数值上限在决策 checklist 完成前不得默认为产品承诺。

### Phase 2 — Main-owned persistence and recovery

1. 通过 001 storage adapter 读取项目 manifest、writing orientation 文档和 UI location；003 不接收或拼接绝对路径。
2. 按项目串行化完整快照保存：校验 → 写入 pending transaction → 同目录临时文件 → rename → Git adapter commit → 清理 pending。
3. 保存失败返回稳定错误 DTO，renderer 草稿不被替换；打开项目发现 pending 或无法判断 commit 状态时返回 `STORAGE_RECOVERY_REQUIRED`，不覆盖已有文件。
4. 删除有关联 chapter reference 的条目必须在 main 再次检查并要求确认；删除与保存的 revision/transaction 关系要可恢复。

### Phase 3 — IPC and preload bridge

1. 按 [contracts/writing-orientation-ipc.md](./contracts/writing-orientation-ipc.md) 在 `src/shared/ipc.ts` 增加最小具名方法，或在 001 冻结的 `saveProjectWorkspace` contract 中挂载等价 domain payload。
2. `preload.cts` 逐一包装具名方法；不暴露 `ipcRenderer`、任意 channel、路径、Git command 或通用读写函数。
3. main handler 校验 sender、当前 project session、DTO、revision、章关联确认和请求大小；错误以可判别 DTO 返回，不依赖 Electron 只序列化 Error.message 的行为。

### Phase 4 — Workspace shell integration and renderer feature

1. 在 002 提供的持久工作台面板中接入动机编辑区和单层大纲列表；进入面板时保持 shell 的编辑上下文。
2. renderer 使用单一本地草稿：新增/编辑/删除前的 UI 状态、排序和状态切换即时反映；保存时提交完整 snapshot，成功后以 main 返回 revision 替换草稿基线。
3. 保存状态至少区分 loading/saved/dirty/failed/recovery-required，并通过文字或图标之外的非颜色信息提供重试/恢复动作。
4. 排序必须有键盘等价路径（例如上移/下移或明确的键盘拖拽），拖动库若选择使用只能辅助交互，不能承担持久化规则。

### Phase 5 — Chapter association boundary

1. 与 004 约定 chapter reference 的 opaque ID 和“已关联/未关联”读模型；003 只展示关联状态，不读取或编辑正文。
2. 从大纲删除前读取/确认关联状态；chapter 删除、迁移或标识异常由 004/共享 storage contract 定义，003 显示可理解的影响提示。
3. 明确大纲状态与章节是否存在不自动互相覆盖，避免 003 静默把 `in_progress` 或 `completed` 改写成其他状态。

### Phase 6 — Failure-boundary validation and handoff

1. 运行 domain/contract/integration 测试，覆盖 100 次保存/重开 fixture、顺序稳定性、空标题、重复提交、revision conflict 和 linked chapter confirmation。
2. 用真实 Electron build smoke 验证 preload→main→storage→renderer 的调用链、保存失败、pending recovery 和重启位置恢复。
3. 在 quickstart 的最小窗口、键盘排序、状态可发现性和不依赖网络场景上完成验收；把仍未决的技术/产品边界回写 ADR、spec 或 tasks 前置决策。

## 跨进程、持久化与 feature 边界

| 边界 | 负责者 | 允许跨越的内容 | 明确禁止/待决 |
|---|---|---|---|
| renderer → preload | renderer + preload | 已知 DTO、具名函数调用和结构化结果 | Node/Electron 对象、绝对路径、generic IPC、任意文件内容 |
| preload → main | preload + main handler | `get/save/delete` 写作方向调用、projectId、revision、用户编辑快照 | raw `ipcRenderer`、Git 参数、文件路径、未校验字符串 |
| main → project storage | main adapter | project session、canonical document、transaction metadata、hash/revision | renderer 直接读写、跨项目路径拼接；adapter 实现及包 `NEEDS DECISION` |
| 003 → 002 workspace | feature contract | 面板入口、保存状态、最后选中的 outline item/location contribution | 003 不拥有 shell、焦点管理或完整 `ui-state.json` |
| 003 → 004 chapter | opaque relation | `chapterRef`、linked/unlinked/read-only association state | 003 不创建/编辑正文；chapter lifecycle `NEEDS DECISION` |
| main → Git runtime | main-owned adapter | 固定参数、事件 trailers、commit result | 不暴露给 renderer；携带 runtime vs library `NEEDS DECISION` |

### 建议的持久化边界

| 逻辑数据 | 建议位置/载体 | 读写者 | 失败与恢复 |
|---|---|---|---|
| 写作动机 + 大纲快照 | `content/writing-orientation.json`（路径待 001/ADR 接受） | main storage adapter；renderer 只收 DTO | 单文档原子替换；pending 记录目标 revision/hashes；commit 未确定时不覆盖 |
| 最近选中条目/写作位置 | `ui-state.json` 的 002-owned contribution | 002 workspace state；003 提供/消费字段 | 与内容保存的是否同事务由 002 contract 决定；不能把 UI state 当内容真相 |
| 项目身份/格式版本 | `project.json` | 001 project foundation | 003 只读 projectId/revision；manifest 失败由 001 错误处理 |
| pending transaction | `runtime/pending/<transactionId>.json` | main/storage recovery | 启动/open 检查；成功 commit 后清理；无法判断返回 `STORAGE_RECOVERY_REQUIRED` |
| history | `.git` + structured commit | main Git adapter | 003 传 actor/event/change metadata；Git strategy 和 packaging `NEEDS DECISION` |

## 验证策略

验证按失败边界分层，而不是只验证 React 组件：

| 失败边界 | 需要回答的要求问题 | 验证形态 |
|---|---|---|
| domain | 空动机、空白标题、重复 id/order、状态、控制字符和版本边界是否被写清且一致 | `bun test` 下的 shared/domain 单元与 property-like fixtures |
| IPC contract | 具名方法、DTO、错误码和安全拒绝面是否与 preload/main 一致 | contract test + `bun run typecheck` |
| main storage | 多次保存、串行写入、原子替换、revision conflict、Git commit/pending recovery 是否可解释 | temp project integration；不依赖真实用户目录 |
| Electron runtime | 真实 sandbox renderer 是否能经 preload 调用 main，失败后 UI 仍能恢复 | `bun run build` + `bun run test:smoke`，必要时扩展 `scripts/electron-smoke.mjs` |
| workspace UX | 面板切换不丢上下文、排序可用、状态非颜色、最小窗口可达、重启恢复位置 | `bun run dev:electron` 手工场景与可访问性审查 |
| acceptance | spec 的 5 分钟动机/两条大纲、30 秒排序、100 次重开稳定性 | quickstart fixture/观察记录；具体平台与阈值先完成决策 |

## Complexity Tracking

| 未满足门禁或额外复杂度 | 为什么当前必须记录 | 更简单方案为何不能直接采用 |
|---|---|---|
| 003 spec、001/002 spec 和 ADR-001 尚未 Accepted | 持久化、revision、project identity 和 UI location 会跨 feature/系统边界；constitution 要求先有 accepted spec/ADR | 直接实现会把 Proposed storage assumptions 变成不可逆 contract，不能用“先写再定”替代接受流程 |
| schema validator、atomic writer、Git runtime、排序能力尚未定 | 用户明确要求第一版只做高可行性方案，不拍板库/包/平台能力 | 直接锁定任一包会违反本轮范围，并可能与 Electron 40 sandbox、Bun、打包目标不兼容 |
| 写作方向内容与位置可能涉及两个持久化文档 | 003 要恢复方向和编辑位置，但 002 拥有完整 workspace state | 把 `ui-state.json` 复制进 003 会造成双写真相和跨 feature 冲突；需由 002 contract 决定是否同事务 |

