# Implementation Plan: AI 提案审阅

**Branch**: `009-ai-proposal-review` | **Date**: 2026-07-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/009-ai-proposal-review/spec.md`

> 本文是第一版高可行性实施方案。它锁定安全边界、领域责任和可验证的事务流程；涉及第三方包、Git runtime 形态、持久化 ADR 接受状态和具体协议版本的最终决定均保留为 `NEEDS DECISION`。本阶段不生成 `tasks.md`，也不实现代码。

## Summary

本 feature 为 `008-ai-writing-tasks` 产出的独立修改提案提供作者可控的审阅闭环：读取并展示目标 Block 的原文、建议文本、意图和资料依据；持久化单项审阅状态；在应用前以项目 revision、Block 稳定标识和内容 fingerprint 做过期/冲突/不可定位检测；仅将明确接受的变更装配到内存中的当前正文，并由 main 进程通过单项目串行写入队列、pending transaction、原子文件替换和历史交接完成保存。

已有 Electron + React foundation 包含安全窗口、001 project lifecycle/六方法 typed bridge，并有已接受的 011 UI/appearance 设计。它不包含 ADR-001 内容存储、Block 编辑器、资料引用、AI task、proposal 或 history 实现。本计划把这些依赖视为必须先冻结的外部边界。

## Technical Context

**Language/Version**: TypeScript 7.0.x、ES2022；现有 `package.json` 使用 Bun 1.3.14 作为 package manager/runtime 入口。

**Primary Dependencies**: 当前只有 Electron 43.1.0、React 19.2.7、React DOM 19.2.7、Vite 8.1.4。proposal diff、runtime schema validation、diff viewer、atomic write helper、Git runtime/adapter 均为候选项，**Decision: NEEDS DECISION**；候选及适配比较见 [research.md](./research.md)。

**Storage**: ADR-002/001 提供 portable `.writellm` root 和 project identity；内容存储依赖 ADR-001 Proposed 中的 editor-native canonical content、`ai/` proposal、pending recovery 和 main-owned Git history。004 canonical chapter 是 BlockNote JSON wrapper，Markdown 只作为 import/paste/export projection。ADR-001 接受状态与 proposal schema 仍为 **NEEDS DECISION**。

**Testing**: 现有脚本为 `bun run typecheck`、`bun run test`、`bun run build`、`bun run test:smoke`。计划新增的 domain/contract 测试使用现有 `bun test` 入口；涉及 preload/main/storage/recovery 的行为必须有真实 Electron runtime smoke 或等价 runtime-level fixture。测试 fixture、故障注入 seam 和最终阈值仍需冻结。

**Target Platform**: Electron desktop，现有 foundation 已设置 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、`webSecurity: true`，开发/发布 renderer 分别由 Vite dev server / compiled `dist` 加载。

**Project Type**: 单作者、单机、本地项目的 secure desktop app；本 feature 不增加远程同步、多人协作、分支合并或 provider 调用。

**Performance Goals**: spec 只提供作者完成时间和 100% 安全性结果，没有规定 diff 规模、Block 数、批量上限或 p95 阈值。打开提案、预览冲突、批量应用的工程性能目标为 **NEEDS DECISION**；研究阶段只要求实现可测量的计时点，不预先承诺数值。

**Constraints**: renderer 不得接触绝对路径、文件系统、Git 命令、provider secret 或任意 IPC；所有 renderer 输入由 main 再校验。应用失败不得报告正文已保存；不允许静默覆盖较新的手动编辑。项目规模、单 Block 最大文本、批量变更上限、离线策略和迁移兼容窗口为 **NEEDS DECISION**。

**Scale/Scope**: 依赖 `004-block-editor` 的稳定 Block identity、`007-source-search-citations` 的可追溯 citation/source validity、`008-ai-writing-tasks` 的完成 proposal；下游向 `010-version-history` 发出模型内容变更信息。当前仓库尚无这些产品目录，均是计划新增或外部 feature contract。

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Before research

| Gate | 状态 | 依据/缺口 |
|---|---|---|
| Accepted specification and plan before implementation | **FAIL / BLOCKED** | `009`、其依赖 spec 和 storage ADR 当前仍为 Draft/Proposed；必须在实现前接受。 |
| Renderer least privilege and named typed IPC | **PASS for design** | 现有 foundation 已有 typed `window.writellm` bridge；新增方法继续只走 named wrappers，详见 `contracts/proposal-ipc.md`。 |
| Cross-boundary/durable decisions have ADR | **NEEDS DECISION** | storage ADR 已记录总体方向但尚未接受；proposal schema、transaction/recovery 细节和 IPC contract 冻结前需要接受现有 ADR 或新增/修订 ADR。 |
| Smallest design satisfying requirements | **PASS for v1 shape** | 采用 Block-level proposal + main-owned batch transaction；不引入协作、远程服务或独立数据库到本 feature 的强制范围。 |
| Verification at failure boundary | **PASS for plan** | 计划包含 shared contract、main storage、renderer bridge 和真实 Electron smoke；恢复故障需要 fixture/failure injection。 |

### Post-design re-check

设计维持上述边界，但不能把第一行和第三行标记为最终通过。Phase 1 完成的条件是：

1. `009` spec、`004`/`007`/`008` 依赖契约和 `001` storage ADR 获得项目接受；
2. 依赖 `008` 已将 review feature 统一写成 `009-ai-proposal-review`，不再需要旧编号兼容别名；
3. IPC 方法/DTO/error code、proposal storage envelope、schema migration policy 和 history handoff 被冻结；
4. 候选库/工具与版本策略做出明确决定，或明确批准使用平台能力/自研实现。

未满足的项目不能通过 implementation gate；不能用“代码先做、以后补 ADR”替代。

## Existing foundation vs planned additions

### 当前已存在（只读基线）

- `src/main/main.ts`：创建安全 `BrowserWindow`、注册已接受的 001 project handlers，并限制导航和外部窗口；011 appearance boundary 独立存在。
- `src/preload/preload.cts`：通过 `contextBridge` 暴露冻结的 001 六方法 project bridge；proposal review 必须使用额外的独立具名能力。
- `src/shared/ipc.ts`：已包含 001 project contract；proposal DTO/channel 必须单独冻结且不得泛化 project namespace。
- `src/renderer/App.tsx`、`src/renderer/main.tsx`、`src/renderer/styles.css`：基础 React shell 和 runtime 状态展示。
- `scripts/dev-electron.mjs`、`scripts/electron-smoke.mjs`：开发启动和现有 compiled foundation smoke。
- `package.json`：已有 Electron/React/Vite/TypeScript/Bun scripts；没有 proposal/storage/diff 依赖。

### 计划新增（本 feature 之后才允许实现）

- `src/shared/proposal.ts`、`src/shared/proposal-errors.ts`：跨进程 DTO、状态、错误码和版本化 envelope。
- `src/main/proposals/`：proposal read/decision、snapshot fingerprint、diff/conflict analysis、apply coordinator、storage adapter 和 recovery adapter。
- `src/renderer/features/proposal-review/`：提案列表、变更详情、证据提示、状态操作、冲突/恢复提示和可访问 diff view。
- `src/preload/preload.cts` 与 `src/shared/ipc.ts` 的显式扩展：只增加本 feature 冻结的方法，不改变 generic IPC 规则。
- `tests/unit/`、`tests/contract/`、`tests/integration/` 与 smoke fixture：当前仓库尚未有这些 feature 目录，测试层级按失败边界新增。
- 项目 `.writellm` 内 proposal/review/pending/history 记录：必须由 `001` storage owner/main 管理，不由 renderer 直接创建。

## Architecture and boundaries

### Responsibility split

| Boundary | 负责 | 明确不负责 |
|---|---|---|
| Renderer | 展示 proposal snapshot/diff/evidence；维护选择和可见 UI 状态；发出 typed intent | 文件路径、Git、hash 真相、冲突判定、任意 patch、provider secret |
| Preload | 将 `window.writellm.proposalReview.*` 映射到固定 IPC channels；做最小序列化 | 业务决策、文件读取、通用 `send/invoke/on` 暴露 |
| Main | 校验 sender 和 DTO；读取项目真相；校验 task/proposal/source；计算 fingerprint/diff/conflict；串行化写入；创建 pending transaction；返回安全错误 | 直接相信 renderer 的 accepted flag、路径、revision 或 patch |
| Project storage/history owner | 提供 canonical Block/content revision、原子保存、pending recovery 和 `010` history handoff | 由本 feature 自行发明第二套 project root、数据库或历史时间线 |
| `008` task producer | 生成独立 proposal 和 source snapshot/reference | 在本 feature 内再次调用 provider、重跑任务或写正文 |
| `007` source/citation owner | 提供 citation/source identity 和 validity | 由 review 复制或改写资料真相 |

### Safe apply algorithm (logical, package-neutral)

1. main 读取当前 proposal、当前 canonical content、project `contentRevision` 和所有 target Block。
2. 对每个待处理 change 校验 stable IDs、operation、原文/base fingerprint、anchor、source/citation validity，并检测同一 proposal 内的 overlap/duplicate。
3. 任一 selected change 不能安全定位时，返回带 change IDs 的 `STALE_PROPOSAL`、`CONFLICTING_CHANGES`、`TARGET_NOT_FOUND` 或 `SOURCE_INVALID`；不写正文。
4. 所有 selected changes 在内存中生成候选 content，并重新计算 affected Block/content fingerprints。用户的“接受”只允许作为明确的 selected input，不能成为自动合并许可。
5. main 在 `runtime/pending/<transactionId>`（实际路径 **NEEDS DECISION**）记录 before/after hashes、proposal/change IDs、expected revision 和阶段；按 project storage owner 的协议写入 canonical content、proposal review state 和 history metadata。
6. 只有所有文件替换并且 history commit/handoff 成功，才把 `applied` 状态和新 revision 返回 renderer；失败时返回明确错误，启动/open 时继续走 recovery，不报告成功。

一次 `applyAcceptedProposalChanges` 是一个原子批次：批次内任一 change 失败则该批次不产生正文变更；此前已经独立完成的 reject/defer/apply 仍保留。结果必须列出 `appliedChangeIds`、`pendingChangeIds`、`blockedChangeIds`，避免把“未应用”误报为“已应用”。

## Project structure

### Documentation (this feature)

```text
specs/009-ai-proposal-review/
├── spec.md                         # 已有；本 feature requirements
├── plan.md                         # 本文件
├── research.md                     # Phase 0；候选与官方资料
├── data-model.md                   # Phase 1；逻辑实体和状态
├── quickstart.md                   # Phase 1；端到端验证场景
├── contracts/
│   ├── proposal-ipc.md             # renderer↔preload↔main
│   ├── proposal-storage.md         # project storage/recovery/history handoff
│   └── task-proposal-boundary.md   # 008→009 proposal input
├── checklists/
│   ├── requirements.md             # 已有；不覆盖
│   └── plan-decisions.md           # 本轮新增；需求/计划决策质量
└── tasks.md                        # 本轮明确不创建
```

### Real source tree at planning time

```text
src/                                # [现有]
├── main/
│   └── main.ts                     # [现有 startup foundation]
├── preload/
│   └── preload.cts                 # [现有 explicit bridge]
├── renderer/
│   ├── App.tsx                     # [现有 foundation shell]
│   ├── main.tsx                    # [现有]
│   └── styles.css                  # [现有]
├── shared/
│   └── ipc.ts                      # [现有 runtime IPC types]
└── vite-env.d.ts                   # [现有]

scripts/                            # [现有]
├── dev-electron.mjs
└── electron-smoke.mjs

test/                               # [现有]
└── smoke/
    └── ipc-contract.test.ts        # [现有 foundation contract smoke]
```

### Planned source layout

```text
src/
├── main/
│   ├── main.ts                     # [现有；只注册新增 domain handler]
│   └── proposals/                  # [计划新增]
│       ├── proposal-service.ts     # read/decision orchestration
│       ├── proposal-analysis.ts    # diff, fingerprint, conflict/expiry
│       ├── proposal-apply.ts       # selected change application
│       ├── proposal-storage.ts     # project-owned read/write adapter
│       └── recovery.ts             # pending transaction detection/retry
├── preload/
│   └── preload.cts                 # [现有；计划新增 named wrappers]
├── renderer/
│   ├── App.tsx                     # [现有 shell；计划接入 feature route]
│   └── features/proposal-review/  # [计划新增]
│       ├── ProposalReviewView.tsx
│       ├── ChangeDetail.tsx
│       ├── DiffView.tsx
│       └── proposal-review-state.ts
└── shared/
    ├── ipc.ts                      # [现有；计划扩展]
    ├── proposal.ts                 # [计划新增 shared DTO]
    └── proposal-errors.ts          # [计划新增 stable error codes]

test/                               # [计划扩展现有测试约定]
├── unit/                           # pure state/diff/fingerprint/model rules
├── contract/                       # DTO, error, preload/main contract
├── integration/                    # real project fixture and Electron runtime
└── smoke/                          # compiled Electron and security boundary smoke
```

**Structure Decision**: 继续采用现有单 Electron project 的 `src/main`、`src/preload`、`src/renderer`、`src/shared` 布局；proposal review 按 domain 放在 main/renderer 子目录，跨边界类型集中在 shared，持久化只经 main 的 project storage adapter。新增目录是实施阶段计划，不代表当前源码已经存在。

## Phased implementation order

### Phase 0 — Acceptance and decision inputs

- 接受 `009` spec、`001` storage ADR 和依赖 feature 的状态/contract；
- 修正 `008` 的 review feature 编号引用，并明确 `008` 产物是独立 proposal；
- 冻结 Block identity、content revision、citation validity、task/proposal relation 和 `010` history handoff；
- 在 `plan-decisions.md` 关闭候选库、版本、schema、IPC、error、offline、performance、a11y、recovery/migration 决策。

### Phase 1 — Shared domain and read-only boundary

- 定义 proposal envelope、change、target snapshot、evidence reference、review state、analysis result、apply result；
- 定义 versioned JSON envelope 和 unknown-field/unknown-schema policy；
- 增加 typed IPC contract，但先只接 read/preview；
- 以 fixture 驱动 `008→009` 的 invalid proposal、missing target、invalid evidence 处理。

### Phase 2 — Review state and diff presentation

- 读取 proposal 并展示原文/建议/意图/依据；
- 实现 pending/accepted/rejected/deferred/blocked/applied 的明确转换规则；
- 提供逐项和批量 decision，保持未处理项；
- diff 计算和 viewer 由已冻结的候选方案实现，但不让 UI 组件拥有 apply 权限；
- 补齐键盘焦点、状态播报、颜色之外的 added/removed/blocked 语义。

### Phase 3 — Expiry and conflict analysis

- 用 project revision、per-block fingerprint、stable target/anchor 做 stale detection；
- 检测同 proposal 内 overlap、duplicate、target missing、source invalid；
- 明确“重新确认”是否生成一次性 preview token，以及其 TTL/绑定 revision（**NEEDS DECISION**）；
- 任一不可安全定位的 change 进入人工判断，不自动尝试静默 rebase。

### Phase 4 — Atomic apply, recovery, and history handoff

- 按 project storage owner 的串行队列创建 pending transaction；
- 内存装配所有 selected accepted changes，批次全成功才写 canonical content；
- 同步 proposal review state 和 `010` 所需模型来源/任务/提案关联；
- 覆盖 write failure、commit failure、crash after replace、unknown recovery state；
- recovery 无法判断时只返回 `STORAGE_RECOVERY_REQUIRED`，禁止覆盖当前可恢复正文。

### Phase 5 — Runtime verification and handoff

- 运行 unit/contract/integration，并使用 `bun run build` + `bun run test:smoke` 验证 compiled Electron bridge；
- 真实 Electron smoke 覆盖 renderer→preload→main→fixture project→response；
- 手动/自动验证 stale、overlap、partial review、atomic failure、restart recovery 和 accessibility；
- 将稳定的 `ProposalAppliedEvent` 交给 `010`，不在本 feature 增加 history timeline UI。

## Cross-process, persistence, and external boundaries

### IPC

仅允许命名方法：`getProposalReview`、`decideProposalChanges`、`previewProposalApply`、`applyAcceptedProposalChanges`，以及由 recovery owner 暴露的最小 recovery result。具体 channel 字符串、是否分 query/command namespace、是否加入 one-time confirmation token 仍为 **NEEDS DECISION**。请求中只允许 `projectId`、`proposalId`、change IDs、revision、decision 和有限用户意图；绝对路径、任意 patch、任意 channel、provider secret 不跨边界。

### Persistence

逻辑实体和 transaction 见 [data-model.md](./data-model.md)；逻辑文件/owner/阶段见 [contracts/proposal-storage.md](./contracts/proposal-storage.md)。所有保存由 main 调用项目 storage authority；renderer 只能收到脱敏 DTO。是否由 ADR 规定 JSON/JSONL、文件命名、Git commit trailer 和 schema migration 细节，必须在实现前决定。

### External worker/provider

009 不调用 provider，不读取密钥，不重跑 008 task。它只接受 008 已完成 proposal 的 versioned input；invalid/partial task result 只能显示为不可审阅或人工判断。若未来改成 worker stream、IPC event 或 provider SDK，属于 008/005 的决策，不得在本 feature 中隐式引入。

## Validation strategy

验证以失败边界为中心，而不是只做 renderer unit test：

| 失败边界 | 验证材料 | 关键断言 |
|---|---|---|
| Shared DTO/schema | `bun run typecheck`、contract tests | 未知/缺失字段、非法状态转换、错误码和版本策略明确 |
| Diff/conflict | `bun run test` unit fixtures | 变更可定位、重叠/重复/过期/失效 source 被区分；不静默 rebase |
| Main storage/apply | integration fixture | 只改变 accepted IDs；批次任一失败则正文不变；pending journal 可恢复 |
| Preload/main IPC | contract + compiled smoke | 只存在 named wrappers；sender/DTO/revision 被 main 校验；不返回 path/secret |
| Electron runtime | `bun run build`、`bun run test:smoke`、新增 runtime fixture | 实际 renderer→preload→main 结果与错误可见，不能由静态类型替代 |
| Accessibility | renderer review scenario/manual audit | diff 语义不只依赖颜色；键盘可达；冲突/失败/成功状态可被辅助技术理解 |
| Performance | fixture benchmark（阈值待定） | 记录提案大小、Block 数、diff/apply/recovery 耗时；阈值必须先写进决策清单 |

可执行端到端步骤与当前脚本见 [quickstart.md](./quickstart.md)。当前 startup foundation 没有 proposal fixture、project storage、真实 runtime recovery seam，因此这些 smoke 在实现前仍是准备项。

## Complexity Tracking

| 项目 | 为什么需要 | 更简单方案为何不够 |
|---|---|---|
| Block-level precondition + batch transaction | 防止旧 proposal 覆盖作者新编辑，并满足失败可恢复 | 只按字符串直接替换无法检测目标版本、重叠和 stale |
| Pending recovery record | 多文件 canonical content、proposal state、history handoff 需要可恢复边界 | 只写单文件或仅依赖 UI retry 不能解释 crash 后的半提交状态 |
| Shared typed contract + main re-validation | proposal 包含用户可见文本和高权限写入意图 | renderer 内部类型检查不可信，也不能防止恶意/过期 IPC |
| 依赖 008/007/010 的 versioned handoff | 本 feature 只负责审阅/应用，不复制 task/source/history 真相 | 在 009 内复制实体会造成多个 owner 和 schema 漂移 |

上述复杂度是需求直接要求的安全边界，不构成新增 framework 或平台依赖的批准。任何新增库、Git/SQLite/worker 能力或跨 feature storage 变更仍需在 `plan-decisions.md` 和 ADR 中留下决定记录。

## ADR-003 / 011 renderer integration

- proposal list、diff status、decision actions、冲突提示和 apply confirmation 优先复用 `Button`、`Badge`、`StatusNotice`、`ScrollArea`、`Dialog` 和 semantic tokens；block-aware diff viewer 可为 feature-local composition。
- preview 可使用 Typeset，但 diff identity、accepted change 和 apply payload 始终基于 004 canonical BlockNote blocks，而不是 HTML/Markdown projection。
- feature 不直接导入 Base UI、不复制 primitive 或建立第二套 theme；覆盖 light/dark、forced-colors、reduced-motion、完整键盘审阅流程与 focus return，缺口走 `FoundationExtensionRequest`。
