# ADR-002: Portable project foundation and recent-project pointers

- Status: Accepted — maintainer accepted 2026-07-12
- Date: 2026-07-12
- Owners: WriteLLM v2 maintainers
- Scope: `001-project-foundation` 的项目创建、打开、移动、启动页和最近项目记录

## Relationship to ADR-001

本 ADR 从 ADR-001 中拆出 `001-project-foundation` 所需的项目基础边界。
它负责可移动项目根目录、项目身份、启动页 recent pointer、main-owned native
dialog 和基础 JSON 写入。ADR-001 保留后续章节/资料/AI 内容存储、editor-native
canonical document、Git-backed history 和跨内容事务的决策。

`001-project-foundation` 只依赖本 ADR；ADR-001 在 001 实现前不需要被整体接受。

## Context

WriteLLM v2 是单作者 Electron 桌面应用。项目必须由作者放在任意位置、移动、备份
和重新打开。renderer 是不可信边界，不能直接访问 Node、Electron、文件路径或文件
系统；项目文件和 native dialog 必须由 main 进程拥有。

当前 feature 只需要创建一个可验证的空项目、打开项目、识别移动后的项目和管理
recent records；它不保存工作区状态或最近编辑位置。章节正文、资料、AI、Git history、
远程同步和项目文件删除不属于本 ADR。

## Decision

### 1. Portable self-contained project root

- 用户选择父目录，main 创建 `<displayName>.writellm` 项目目录。
- `project.json` 保存 main 生成的稳定 `projectId`、显示名、`schemaVersion` 和时间。
- `createdAt` 与 `updatedAt` 在创建时写入相同值，并在 001 内保持不变。
- 项目身份由 `projectId` 决定，不由文件夹名称或旧路径决定。
- 项目可以被复制、移动、重命名或备份；打开时必须重新验证 manifest 和必需结构。
- 本 ADR 不初始化 Git；Git repository 和内容历史由 ADR-001 及后续 feature 负责。
- 显示名必须是当前平台的非空叶子名称；除路径安全边界外，应用不 trim、normalize、
  限长或套用跨平台保留名列表，其余合法性由目标文件系统裁决。

### 2. Foundation file contract

项目基础只保存以下 durable 文件或目录：

- `project.json`：kind 为 `writellm.project`，schemaVersion 为 `1`。
- `workspace/`：manifest 声明的空必需目录；001 不在其中创建或保存状态文件。
- 应用 `userData` 下的 `recent-projects.json`：只保存 recent pointer cache，不是项目真相。
- 应用 `userData` 下的 `pending-project-cleanups.json`：main-only cleanup receipts，只含
  待核验根路径、随机 token 和创建时间，不保存 stage/payload，也不能续接创建。

001 只接受 exact `kind` 和 `schemaVersion: 1`。未知 schema version、未知 kind、缺失
字段、错误 UUID 或缺失必需目录只产生稳定诊断；v1 不自动修复、迁移或写入无效项目。

### 3. Main-owned recent pointer index

- recent index 最多保存 5 条记录，按 `lastOpenedAt` 倒序。
- 每条记录包含 opaque `recentId`、`projectId`、显示摘要、时间、availability 和
  stable diagnostic code。
- 绝对路径只保留在 main-owned userData index，不跨 preload 边界。
- index 缺失按空列表处理；index 损坏只在内存中按空列表展示并给安全 warning，不立即
  覆盖原文件。用户成功创建或打开项目后，main 才能通过原子写入替换为新的有效 index。
  任何 index 处理都不得损坏项目目录。
- 移除 recent 只删除 pointer，不删除、移动或修改项目文件。
- relink 只有在候选项目的 `projectId` 与原记录匹配时才更新路径。
- 普通 Open 若发现相同 `projectId`，也更新原记录的路径与时间并保留 `recentId`，不得
  创建重复记录。

### 4. Main-owned dialogs and validation

- create 由 main 打开父目录选择 dialog；open/relink 由 main 打开项目目录选择 dialog。
- renderer 只提交显示名或 opaque `recentId`，不提交绝对路径。
- main 在每个 IPC handler 入口重新验证 sender、输入、manifest、schema 和 project identity。
- dialog cancel 是可恢复的 `canceled` result，不是 storage failure。
- open/relink 对项目目录严格只读；成功与失败都不得更新 manifest、timestamps 或任何
  其他项目文件，唯一允许的写入是 main-owned recent index。

### 5. Collision-safe foundation writes and failure boundary

- 单文件 JSON 使用同目录临时文件、完整写入后 rename。
- 创建项目不先做 `exists/access` 预检；main 以 `recursive: false` 独占创建最终根目录，
  已存在的任何同名目录项都必须返回 collision，绝不替换。
- 创建根前先原子写 cleanup receipt；新根目录立即写与 receipt token 匹配的临时
  manifest，再创建空 `workspace/`，最后将临时 manifest 发布为 `project.json`，作为
  有效性 commit marker；只有 manifest 可再次验证后才能移除 receipt 并发布 recent。
- 任一创建或写入失败都不得更新 recent index，也不得留下可被识别为有效的半成品项目。
- 下次启动不扫描任意父目录，只核验 receipt 指向的路径；仅当 tokenized temp manifest
  匹配、没有有效 manifest 且不含未知文件时执行 best-effort cleanup。有效 manifest、
  marker 缺失或含未知内容的目录必须保留，清理失败只产生安全 warning。
- 001 不定义跨内容文件的 Git transaction；后续内容事务由 ADR-001 和对应 feature
  storage contract 负责。

### 6. Single active application instance

- main 必须在 ready、IPC/storage 初始化和窗口创建前同步取得 single-instance lock。
- secondary 取得锁失败后只退出，不注册 handlers、不初始化 recent index、不创建窗口。
- primary 接收后续启动请求，并恢复、显示和请求聚焦现有窗口；macOS activate 复用同一
  幂等窗口路径。
- 单实例生命周期必须由真实 compiled Electron 双进程 smoke 验证，不能只依赖静态或
  Node-mode 测试。

### 7. Explicit security boundary

preload 只暴露 001 contract 中 6 个项目入口 named typed methods，不包含 runtime-info
或 workspace save。不得暴露 generic IPC、任意文件
API、Node/Electron 对象、绝对路径、raw filesystem exception、项目文件内容或
`deleteProject` 能力。

## Consequences

- 001 可以独立实现和验证项目入口，不被 Git、章节编辑器或未来内容 schema 阻塞。
- ADR-001 的后续内容和历史决策仍可在 003/004/006/008/009/010 中统一复用。
- 工作区状态与章节/block location 需要后续接受的 schema 和 contract 扩展。
- 项目移动后的自动发现不在范围内，用户需要显式 Open 或 Relink。

## Acceptance checklist before implementation

- [x] 维护者接受本 ADR 的 manifest-only project state、只读 open/relink、native-name、
  projectId 去重和单实例规则。
- [x] `project.json`、空 `workspace/`、`recent-projects.json` 和 main-only cleanup
  receipt index 的 schema、版本、错误码与恢复边界已冻结。
- [x] 001 project IPC contract 的 6 个 method names、DTO、dialog result、redaction 和
  错误码已冻结。
- [x] `ADR-001` 的内容存储/Git history 条款明确保留为后续 feature 决策，不作为 001 实现前置条件。
- [x] 任务计划包含项目只读验证和真实 Electron 双进程单实例 smoke。
