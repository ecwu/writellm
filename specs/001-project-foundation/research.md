# Research: 可移动项目与启动工作区基础

## Scope

本研究只解决 `001-project-foundation` 需要的 portable project、recent pointer、
startup IPC、单实例生命周期和可靠的本地 JSON 写入。写作内容、Git history、provider、PDF、远程
同步和项目文件删除不在本 feature 的研究范围内。

## Decisions

### 0. Toolchain baseline: latest stable direct dependencies, frozen before feature work

**Decision**: 产品实现前升级并精确冻结 Bun 1.3.14、TypeScript 7.0.2、Electron
43.1.0、React/React DOM 19.2.7、Vite 8.1.4、`@vitejs/plugin-react` 6.0.3、
`@types/node` 26.1.1、`@types/react` 19.2.17 和 `@types/react-dom` 19.2.3。
升级必须先通过现有 typecheck、test、build 和 compiled Electron smoke；不额外引入
运行时库。

**Rationale**: 维护者明确选择 TypeScript 7 及截至 2026-07-12 的最新稳定相关依赖，
并要求依赖基线先于 001 产品实现稳定下来。TypeScript 7 在本仓库只作为 `tsc` CLI
使用，不依赖其尚未稳定的 programmatic API。

**Alternatives considered**:

- 保留现有 lockfile：不满足维护者确认的 TypeScript 7 与最新稳定基线。
- 使用 prerelease/canary：不符合“最新稳定版本”的约束。
- 在功能实现中顺带升级：会混合工具链回归与产品行为回归，削弱失败归因。

### 1. Storage: versioned JSON files, no database or Git

**Decision**: 项目根使用 `project.json` 和 manifest 声明的空 `workspace/` 必需目录；
应用级 recent index 使用 `app.getPath('userData')/recent-projects.json`；main-only
cleanup receipts 使用同一 userData 下的版本化 JSON，只保存待核验根路径和随机 token，
不能续接创建。001 不创建 workspace state 文件，不引入 SQLite、Git 或第三方
persistence package。

**Rationale**: 当前 spec 只要求 manifest、可进入的空工作区和 recent records；JSON
足够可读、可移动且能被只读验证。工作区状态、Git/history 属于后续内容 feature，
提前初始化会扩大项目创建失败面和恢复协议。

**Alternatives considered**:

- SQLite：为当前少量元数据引入 schema/runtime 依赖，不增加用户价值。
- 每项目 Git：历史不在本 feature scope，且会把初始化/commit 失败引入创建路径。
- 只保存 userData：项目被移动或备份时会丢失项目自身的格式契约。

### 2. Collision-safe creation: exclusive root plus manifest-last publication

**Decision**: 不先做 `exists/access` 检查。main 直接以 `recursive: false` 独占创建最终
`<displayName>.writellm` 根目录；已存在的任何同名目录项都返回 `PROJECT_EXISTS`，绝不
覆盖。创建根前先原子记录不可续接的 cleanup receipt；新根目录立即写 tokenized
manifest temp，再创建空 `workspace/`，最后将 temp manifest rename 为 `project.json`
作为有效性 commit marker；只有 manifest 可再次验证后才移除 receipt 并写 recent
index。下次启动只清理 receipt/token 匹配、没有有效 manifest 且不含未知文件的未完成
根目录；无 marker 或内容含混时保留并显示安全警告。

**Rationale**: `mkdir(..., { recursive: false })` 由目标文件系统原子裁决同名冲突；
Node 的通用 `rename` 不是跨平台 no-replace 原语，不能单独证明 100% 不覆盖。把
`project.json` 最后发布，使中断目录在任何阶段都不会被识别为有效项目，同时所有权
receipt 与 tokenized temp manifest 把 best-effort cleanup 限制在应用可证明拥有的未完成
创建。receipt 不保存 stage 或业务数据，因此不能恢复或继续事务。

**Alternatives considered**:

- 同父目录 staging 后直接 rename：目标存在时没有通用 no-replace 保证。
- 直接写 manifest 再建目录：中断时可能留下看似有效的半成品。
- `write-file-atomic` package：当前只需少量 JSON 写入，内置 helper 可以减少依赖和
  license/升级面；若后续需要平台特定 durability，再单独评估。

### 3. Native name validation: safety boundary plus target-filesystem authority

**Decision**: main 只执行产品与安全所需的最小检查：输入必须是非空字符串和当前平台
的单个叶子名称，不得含 NUL、当前平台路径分隔符或路径控制段；最终路径必须仍直接位于
用户选择的父目录。应用不 trim、不 Unicode normalize、不设置统一长度上限，也不维护
跨平台保留名或字符列表。其余合法性由目标文件系统的实际 `mkdir` 结果裁决，并映射为
稳定的 `INVALID_PROJECT_NAME`、`PROJECT_EXISTS` 或 `STORAGE_WRITE_FAILED`。

**Rationale**: FR-013 明确拒绝额外跨平台规则；但 renderer 输入仍不得把“名称”升级成
路径权限。实际 filesystem operation 比预演其他平台规则更准确，也避免 `access` 检查
与后续创建之间的 TOCTOU。

**Alternatives considered**:

- 固定 1–120 字符、trim 和跨平台 reserved-name 列表：违反已接受澄清。
- 自动 sanitize：静默改变显示名称并制造不可预期碰撞。
- 先 `access/exists` 再创建：存在竞态，不能作为授权或 collision 保证。

### 4. Manifest validation: explicit type guards and schema version 1

**Decision**: 在 `src/main/project/project-validation.ts` 使用显式 type guards/field
validators；`schemaVersion` 和 `kind` 必须匹配 v1。未知版本、缺字段、错误 UUID 或
缺必需 `workspace/` 目录只返回诊断，不自动修复或写入。`createdAt` 与 `updatedAt`
在创建时写入相同值，并在 001 内保持不变。

**Rationale**: 输入面小且 schema 固定，手写校验可让错误码、read-only 语义和 main
权限边界直接可审查；不需要把第三方 parser 引入 preload 或 domain schema。

**Alternatives considered**:

- Zod/Valibot/Ajv：都可行，但此 feature 的 DTO/file shapes 少；新增依赖没有减少
  当前跨边界风险，后续若 schema 复杂可提出独立决策。

### 5. Dialog ownership, path privacy and read-only open

**Decision**: `dialog.showOpenDialog` 只在 main 调用。create 由 renderer 提交名称，
main 打开父目录选择；open/relink 由 main 打开项目目录选择。renderer 永不提交或
接收绝对路径；recent record 的绝对路径只存放于 main-owned userData index。
open/relink 只用 read/stat 验证；成功后唯一允许的写入是 recent index，不得更新
manifest、timestamps 或项目目录。

**Rationale**: native dialog 是 main-process API；路径是 filesystem authority 的
敏感数据，不需要跨 renderer boundary。relink 使用 recentId 在 main 查找原记录，
然后比对磁盘 manifest 的 stable projectId。

**Platform note**: `openDirectory` 是跨平台的目录选择能力；macOS 的
`createDirectory`/Windows 的 `promptToCreate` 差异不作为项目创建的 correctness
基础。产品始终让用户选择现有父目录，再由 main 创建项目子目录。

### 6. Recent index: five records, one pointer per project identity

**Decision**: recent index schema v1 最多保存 5 条，按 `lastOpenedAt` 倒序；按
`projectId` upsert，超过上限淘汰最旧记录。记录包含 main-only absolute path、摘要、
状态和 last-opened time；renderer 只收到 `recentId`、projectId、displayName、time、
availability 和 diagnostic code。

**Rationale**: 直接落实 clarification 与 FR-006/FR-007；index 失效不会损伤项目真相。
重新选择位置只有 stable ID 匹配时才更新原 record；普通 open 若发现相同 `projectId`
也更新原 record 的路径和时间并保留其 `recentId`，不得创建重复记录。缺失 index 按空
列表处理；损坏 index 只在内存中显示空列表和安全 warning，不立即覆盖，成功
create/open 后再原子替换。

### 7. Single active instance: synchronous lock before bootstrap

**Decision**: main 在 `whenReady`、IPC 注册、recent 初始化和窗口创建之前同步调用
`app.requestSingleInstanceLock()`。失败的 secondary 只退出，不执行 primary bootstrap；
primary 立即注册 `second-instance`，与 macOS `activate` 共用幂等的窗口恢复路径：必要时
创建窗口，最小化时 restore，隐藏时 show，最后 focus。IPC handlers 只注册一次。

**Rationale**: 这把 FR-014 的并发边界放在所有存储和窗口副作用之前；单一
ensure-and-focus helper 也避免 `activate` 与 `second-instance` 同时创建两个窗口。

**Alternatives considered**:

- 在 `whenReady` 后取锁：secondary 可能已经初始化存储或 handlers。
- 多实例只读模式或跨进程锁：超出已接受的最小单实例方案。
- 每次 secondary 都新建窗口：违反聚焦现有窗口的验收行为。

### 8. Testing: existing Bun plus a real dual-process Electron smoke

**Decision**: 继续使用仓库现有 `bun:test`、TypeScript/build 和 `test:smoke`；新增
project unit/contract/integration/runtime tests，并让 runtime 阶段以同一临时 userData
启动两个真实 Electron 进程，证明 secondary 退出、primary 收到一次事件且只有一个
窗口。现有 `ELECTRON_RUN_AS_NODE` 检查保留，但不能代替真实双进程验证。本 feature
不引入 Playwright、React Testing Library 或其他 runner。

**Rationale**: domain/storage logic 可在 Bun test 中快速验证，IPC exposure 和 native
runtime 必须再由 compiled Electron 证明。测试 seam 应注入 temporary fixture、dialog
result 和 filesystem failure，而不是把真实用户路径或外部服务带入测试。

## Rejected scope decisions

| Candidate | Decision | Reason |
|---|---|---|
| Git repository/history | Deferred to later content/history feature | 不在本 spec；会增加创建/保存失败面。 |
| `deleteProject` IPC | Rejected | FR-008 明确禁止应用内删除项目文件夹；只保留 remove recent record。 |
| Full-disk/project-root scan | Rejected | 移动项目由用户显式 open/relink；扫描会扩大隐私、权限和性能面。 |
| Automatic repair/migration | Rejected for v1 | Clarification 要求只读诊断；未知版本留给未来迁移设计。 |
| Application-level portable name rules | Rejected | FR-013 要求由当前 OS 和目标文件系统裁决。 |
| Multiple active instances | Rejected | FR-014 冻结为单活动实例。 |

## Sources and repository evidence

- [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security)：
  context isolation、sandbox、sender validation 和 minimal contextBridge boundary。
- [Electron context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)：
  不暴露 generic IPC API，使用显式 bridge methods。
- [Electron dialog API](https://www.electronjs.org/docs/latest/api/dialog)：
  `showOpenDialog` 为 main-process native dialog，支持 `openDirectory`。
- [Node file system API](https://nodejs.org/api/fs.html)：`fs/promises` 的异步 mkdir、
  file and path operations，以及避免 `access` 预检的错误处理模式。
- [Node path API](https://nodejs.org/api/path.html)：当前平台路径分隔和叶子名称边界。
- [Electron app API](https://www.electronjs.org/docs/latest/api/app)：
  `requestSingleInstanceLock` 与 `second-instance` 生命周期。
- [Electron BrowserWindow API](https://www.electronjs.org/docs/latest/api/browser-window)：
  restore、show 与 focus 行为。
- [Electron headless CI](https://www.electronjs.org/docs/latest/tutorial/testing-on-headless-ci)：
  Linux runtime smoke 的 display/Xvfb 要求。
- [Bun test runner](https://bun.sh/docs/test)：现有 `bun test` 的 TypeScript test
  baseline。
- [AGENTS.md](../../AGENTS.md)、[project foundation ADR](../../docs/adr/002-project-foundation.md)
  和当前 `src/main`/`src/preload`/`src/shared` foundation。

## Research conclusion

技术 unknowns 已被解析为一条最小实现路径，没有 `NEEDS CLARIFICATION`。更新后的
plan、contract、ADR-002 与 durable schema 已由维护者接受；implementation tasks 已从
这些材料重新生成，且不得恢复旧设计。
