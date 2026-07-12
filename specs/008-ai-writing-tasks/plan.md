# Implementation Plan: AI 写作任务与提案生成

**Branch**: `008-ai-writing-tasks` | **Date**: 2026-07-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/008-ai-writing-tasks/spec.md`

**规划状态**：第一版高可行性实施方案。候选库、协议和任务执行载体均未拍板；凡涉及依赖、平台能力、持久化格式或跨进程契约的最终选择，均标记为 `NEEDS DECISION`，在实现前需要维护者接受 feature spec、ADR-001 以及本目录的决策清单。

## Summary

本 feature 为选定章节块创建“可审计、可取消、不会直接改正文”的 AI 写作任务。任务提交时冻结目标块版本、指令和资料范围；main 进程负责校验请求、读取项目/受保护 provider 配置、编排任务、调用 provider 适配器、规范化结果并持久化状态。完成后生成独立修改提案，提案包含目标块、原文快照或哈希、建议文本、变更意图、资料依据和证据不足/需要作者判断的标记。正文在本 feature 中始终不变，应用变更由后续提案审阅 feature 负责。

当前实现只存在 Electron + React 的安全启动 foundation。本计划新增的是 feature 的领域模型、main-owned task runner、provider adapter、文件持久化、显式 preload/IPC 契约和 runtime smoke；不会把 provider SDK、任务队列、worker 载体或 schema 库当作已批准依赖。

## Technical Context

**Language/Version**: TypeScript 5.8，严格模式；Electron `40.10.5`；React `^19.0.0`；Bun `1.3.4` 作为 package manager/脚本运行器；Vite `6.2.2`。Electron main 的运行时以 Electron 自带 Node 为准，不把 Bun 当作生产 main runtime。

**Primary Dependencies**: 当前已存在 React、React DOM、Electron、Vite 和 TypeScript。provider SDK/协议抽象、网络请求实现、schema 校验、重试/并发和可选 worker/utility process 均为候选项，最终决策 `NEEDS DECISION`；详见 [research.md](./research.md)。

**Storage**: 以 `docs/adr/001-project-storage.md` 的 Proposed 设计为约束：`.writellm` 自包含项目、main-owned 串行写入、同目录临时文件 + rename、`runtime/pending` 恢复协议和项目内 Git 事件。计划中的 AI 领域文件位于项目的 `ai/` 下，具体 schemaVersion、文件拆分和 prompt/context 快照策略在实现前 `NEEDS DECISION`，不得使用未接受 ADR 的替代数据库。

**Testing**: 现有 `bun run typecheck`、`bun run build`、`bun run test`、`bun run test:smoke`；计划增加 shared contract/状态机/校验单元测试、fixture provider/故障注入测试和真实 Electron runtime IPC smoke。不得只用 renderer 测试替代 main/preload/runtime 验证。

**Target Platform**: Electron 桌面应用，当前 BrowserWindow 约束为 sandbox、`contextIsolation: true`、`nodeIntegration: false`；首版单作者、本地项目、网络 provider 可选，离线和凭据能力仍需明确。

**Project Type**: 单仓库 Electron desktop app + React renderer。

**Performance Goals**: 以 spec 的可理解性和可恢复性为先。具体任务排队/首个状态更新/取消响应/完成时间阈值仍为 `NEEDS DECISION`；至少要定义可测的状态更新时限、超时上限、并发上限和 500/429/网络中断等失败后的重试上限。不能把“provider 慢”伪装成客户端成功。

**Constraints**: 正文和已保存手动编辑不得被任务改写；renderer 不接触绝对路径、API key、文件系统或通用 IPC；任务要能记录目标版本和资料范围；失败/取消/中断要留下可理解原因；外部 provider 的错误不得泄露凭据；所有跨进程输入由 main 再校验。`009-ai-proposal-review` 只能应用作者接受的提案，`010-version-history` 负责记录实际正文变更。

**依赖命名已统一**：提案接受、正文应用和审阅边界由 `009-ai-proposal-review` 负责；本 feature 的 `spec.md`、本计划及交接契约均使用该编号和名称。

**Scale/Scope**: 首版围绕单项目、多个章节块、多个并发任务的本地使用；不设计远程队列、多用户协作、跨项目检索、自动合并、自动正文写入或特定 provider 的专用功能。

### 已有 foundation 与计划新增的明确区分

已存在：

- `src/main/main.ts` 创建受安全配置约束的 BrowserWindow，并只注册 `getRuntimeInfo`。
- `src/preload/preload.cts` 只暴露命名的 `getRuntimeInfo`。
- `src/shared/ipc.ts` 只有 runtime DTO 和 channel。
- `src/renderer/App.tsx` 只展示启动状态；没有项目、章节、资料或 AI 领域 UI。
- `package.json` 只有现有 Electron/React/Vite/TypeScript 依赖和 foundation scripts。

计划新增（本 feature 的实现阶段，不在本次规划中实现）：

- shared 中的 task/proposal DTO、错误码、状态机和 runtime validation 边界。
- main 中的 task service、串行 project writer、provider adapter registry、retry/cancel policy 和 proposal normalizer。
- `ai/tasks/`、`ai/proposals/` 以及 `runtime/pending/` 的项目文件协作。
- preload 的显式 task 方法和受控 task update listener；renderer 的任务状态/提案只读消费入口。
- fixture provider、状态机测试、契约测试和 Electron runtime smoke。

## Constitution Check

### Phase 0 前检查

| 原则 | 规划结论 | 依据/待办 |
|---|---|---|
| I. Secure Desktop Boundary | 通过设计约束 | provider、密钥、项目路径和持久化只在 main/经批准的 utility 边界；renderer 只收到非敏感 DTO。 |
| II. Typed, Minimal IPC | 通过设计约束 | 只定义 `create/get/list/cancel/retry` 和受控更新事件；不暴露 `ipcRenderer`、任意 channel、任意文件读取或 provider 原始客户端。 |
| III. Specification-Driven, Minimal Evolution | **实现前阻塞** | `spec.md` 当前为 Draft，ADR-001 当前为 Proposed；必须在实现前接受，并冻结本 feature 的 IPC、storage schema 和外部协议 ADR。 |
| IV. Verification at the Failure Boundary | 通过验证策略 | 共享契约用静态/单元校验，跨进程行为用编译后的 Electron smoke，provider/存储失败用本地 fixture 和故障注入。 |

**Gate 结论**：允许继续做设计和研究；不允许据此开始产品实现。`spec.md`、ADR-001、provider/worker/storage 决策和下方契约在实现前仍需接受。

### Phase 1 设计后复核

设计复核必须再次确认：

- 所有持久化写入是否仍由 main 的串行队列和 ADR-001 pending protocol 管理。
- renderer 是否只拿到脱敏、版本化 DTO，且 sender/project/session 校验发生在 main。
- 任务取消是否贯穿 queue、provider call、重试等待和持久化，而不是只改变 UI 状态。
- 任何未定位、目标版本过期、证据不足或 provider 返回不符合 schema 的结果是否停留在独立提案/人工判断状态。
- runtime smoke 是否覆盖“renderer 继续编辑 + task 运行 + task 失败/取消 + 原文未变”的边界，而不仅是 `getRuntimeInfo`。

若其中任一项不能回答，状态为 `NEEDS DECISION`，不得通过实现前 gate。

## Project Structure

### Documentation（本 feature）

```text
specs/008-ai-writing-tasks/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── task-ipc.md
│   └── provider-adapter.md
└── checklists/
    ├── requirements.md
    └── plan-decisions.md
```

本次不生成 `tasks.md`；任务拆解必须等本计划和相关决策被接受后再运行 `speckit-tasks`。

### 真实源码目录结构（当前）

```text
src/
├── main/
│   └── main.ts                 # 已有：BrowserWindow、基础 IPC、导航策略
├── preload/
│   └── preload.cts             # 已有：显式 runtime bridge
├── renderer/
│   ├── App.tsx                 # 已有：foundation 状态页
│   ├── main.tsx               # 已有：React bootstrap
│   └── styles.css              # 已有：foundation 样式
├── shared/
│   └── ipc.ts                  # 已有：runtime channel/DTO
└── vite-env.d.ts               # 已有：Vite 类型

scripts/
├── dev-electron.mjs            # 已有：本地 Vite + Electron 启动
└── electron-smoke.mjs          # 已有：编译 foundation smoke
```

### 计划中的源码结构（仅路径与职责，不代表已创建）

```text
src/
├── main/
│   ├── main.ts
│   ├── ipc/
│   │   └── writing-tasks.ts     # 计划：sender/session 校验与 handler 注册
│   ├── ai/
│   │   ├── task-service.ts      # 计划：生命周期、取消、重试、查询
│   │   ├── task-runner.ts       # 计划：队列/执行载体（候选待决）
│   │   ├── provider-adapter.ts  # 计划：内部 provider port
│   │   ├── proposal-normalizer.ts
│   │   └── retry-policy.ts
│   ├── project/
│   │   ├── ai-task-store.ts     # 计划：ai/ 文件与 manifest/revision 校验
│   │   └── project-writer.ts     # 计划：复用 ADR-001 串行写入/pending
│   └── security/
│       └── provider-secret.ts   # 计划：只调用 005 的 main-owned secret capability
├── preload/
│   └── preload.cts              # 计划：逐一映射命名 task API
├── renderer/
│   └── features/ai-tasks/       # 计划：状态/提案展示，不持有 provider 或文件权限
└── shared/
    ├── ipc.ts                   # 计划：新增 task channel/DTO/error union
    └── ai-tasks.ts              # 计划：领域类型和无依赖 schema 定义

tests/                            # 当前未建立统一 feature 测试树，路径待实现阶段决定
├── unit/                         # 状态机、校验、normalizer、retry policy
├── contract/                     # preload/main DTO 和 provider fixture
└── runtime/                      # 编译 Electron、取消/失败/恢复 smoke
```

**Structure Decision**：保持当前单项目结构，把领域服务放在 main、DTO/错误码放在 shared、最小桥接放在 preload、展示放在 renderer。provider adapter 是端口，不把 provider SDK 直接 import 到 renderer；是否使用 `utilityProcess`、`worker_threads` 或 main async runner 留在 `NEEDS DECISION`。

## 分阶段实施顺序（不等同于 tasks.md）

### Phase 0：研究和决策输入（本次规划）

1. 读取 004/005/007 的依赖边界，确认 009 的消费边界和 ADR-001 的文件/写入规则。
2. 记录 provider、网络、执行、schema、重试和密钥能力候选；不安装依赖，不改 `package.json`。
3. 把候选选择、版本策略、外部服务/凭据、离线、性能、可访问性、恢复/迁移问题写入 [checklists/plan-decisions.md](./checklists/plan-decisions.md)。

### Phase 1：冻结领域与契约（实施前 gate）

1. 接受 feature spec、ADR-001，并明确是否需要新增 AI task/provider/storage ADR。
2. 冻结 [data-model.md](./data-model.md) 的 schemaVersion、任务状态迁移、attempt/retry 规则、proposal/result schema 和 context snapshot 策略。
3. 冻结 [contracts/task-ipc.md](./contracts/task-ipc.md) 的方法/事件、DTO、错误码、sender/session 校验和取消语义。
4. 冻结 [contracts/provider-adapter.md](./contracts/provider-adapter.md) 的内部 port、normalized result、AbortSignal、timeout/retry 和 secret 使用边界。

### Phase 2：最小本地闭环

1. 在 shared 建立类型、schema/runtime validation、状态机和安全错误映射。
2. 在 main 建立 task store 和 project writer；先用 deterministic fixture provider 跑通创建、排队、完成、提案独立保存。
3. 接入显式 IPC；renderer 只显示任务摘要、状态和只读提案。
4. 加入目标版本/文本 hash、source revision、evidence status 和 unlocatable/manual-review 保护。

### Phase 3：失败边界与控制能力

1. 实现取消贯穿 queue、provider request、retry delay、写入 pending 和 UI update。
2. 实现可重试失败与不可重试错误的明确策略；每次 attempt 保留原因/时间/脱敏诊断。
3. 注入 provider timeout、429、认证失败、网络中断、malformed result、应用关闭/重启和 storage recovery fixture。
4. 保证失败/取消/中断不生成“已完成”提案，不改变正文，不丢失可恢复 task record。

### Phase 4：真实 provider 与 runtime acceptance

1. 仅在 provider 方案、协议、凭据、离线策略和版本策略批准后接入一个 provider adapter。
2. 用真实 Electron runtime 验证 preload→main→provider/fixture→storage→renderer update；不把网络凭据放入测试日志。
3. 通过独立提案 schema 将交付边界交给 009；正文应用和版本时间线不在本 feature 实现。

## 跨进程、外部服务与持久化边界

```text
Renderer
  │ named typed IPC only: create/get/list/cancel/retry + task update listener
  ▼
Preload
  │ validate/shape bridge; no generic ipcRenderer, no secret/path/file access
  ▼
Main task service
  ├─ validates sender, active project, target blocks, source refs, revisions
  ├─ reads provider summary and secret through 005-owned main boundary
  ├─ runs queue + cancellation + retry policy
  ├─ calls ProviderAdapter port (main or selected isolated execution substrate)
  ├─ normalizes evidence/proposal; never applies to content/
  └─ writes task/proposal/pending through ADR-001 project writer
       │
       ├─ external provider: HTTPS/API, no renderer credentials, redacted errors
       ├─ project files: ai/tasks, ai/proposals, runtime/pending, Git task event
       └─ downstream: 009 reads proposal; 010 records only later accepted content change
```

边界规则：

- renderer 只发送 project/session scoped DTO；不发送绝对路径、密钥、任意 prompt execution command 或 provider client instance。
- main 必须重新读取并校验目标块、source chunk 是否存在且可用，不能相信 renderer 的名称、摘要或“已引用”标记。
- task 创建保存 `targetVersion`、块文本 hash、source IDs/revisions 和 context hash；任务运行期间正文可继续编辑，但完成结果必须标记版本差异。
- provider 只接收 task service 组装的最小上下文；secret 只由 main/005 提供给 adapter，不进入 IPC、task JSON、proposal JSON、Git message、诊断或 UI。
- task/proposal 的写入不得绕过 ADR-001 的串行 writer；跨文件保存使用 pending transaction，commit 未完成时下次 open 必须恢复或显式报错。
- proposal 是独立、只读结果；本 feature 不调用 block editor 的写入 API，不更新正文 revision，不自动应用任何变更。
- 外部 provider 结果必须先通过 normalized result schema；无法映射的目标块、过期目标、缺少依据或 malformed output 只能进入人工判断/失败状态。

## 验证策略

| 验证层 | 关注失败模式 | 计划证据 |
|---|---|---|
| 类型与静态 | DTO 漂移、错误码遗漏、preload 方法超范围 | `bun run typecheck`；shared 类型由 main/preload/renderer 共用 |
| 领域单元 | 状态跳转、重复取消、重试预算、证据不足、过期目标 | 不依赖网络的状态机/normalizer/policy tests |
| storage/contract fixture | 半写入、未知 schema、pending、重复 taskId、错误脱敏 | 临时 `.writellm` fixture + fake writer/provider；不依赖真实 provider |
| compiled build | Electron/preload 产物路径和 ESM/CJS 边界 | `bun run build` |
| Electron runtime | sender 校验、命名 IPC、取消和状态更新、正文未变 | 扩展 `scripts/electron-smoke.mjs` 的 runtime scenario；需在实现阶段补 fixture |
| provider integration | API 认证、429/5xx、超时、SSE/stream、malformed response、凭据不泄露 | opt-in local fixture server；真实外部 provider 只在有凭据和批准策略时手动运行 |
| accessibility/content | 状态不只依赖颜色、失败原因可理解、取消/重试可达、提案只读边界清楚 | renderer review + keyboard/assistive tech acceptance；具体阈值 `NEEDS DECISION` |

最小端到端断言：创建任务后立即可见 `queued/running`；作者可继续编辑；fixture 成功只写入独立 proposal；fixture 失败/取消/中断保留原因但不写正文；重启/open 后 task 状态和 proposal 仍与 schema/revision 一致；目标块发生变化时结果被标记为 stale/manual review。

## Complexity Tracking

| 项目 | 为什么需要 | 更简单的替代为何不能直接接受 |
|---|---|---|
| main-owned task service + adapter port | 需要隔离 provider、凭据、取消、重试和提案规范化，避免把具体 vendor API 扩散到 UI | renderer 直接调用 provider 会违反安全边界；把 vendor response 直接持久化会锁定协议并破坏 009 的稳定输入 |
| task/proposal 分离文件 | 任务状态和只读提案有不同生命周期，任务失败/取消也要保留审计记录 | 把结果写进正文会违反 FR-006/FR-007；单一大 JSON 难以做恢复和版本校验 |
| 可选执行隔离层 | provider SDK 或解析/规范化可能阻塞或携带不可信响应，需要在决策后选择 main、worker 或 utility process | 现在 foundation 只有 main；在没有性能/隔离证据前强行引入 worker 会增加 IPC 和打包复杂度 |

这些不是当前的技术选型结论；是否引入额外依赖、是否使用额外进程以及最终 schema/协议，均以 `NEEDS DECISION` 为准。
