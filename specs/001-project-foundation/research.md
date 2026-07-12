# Research: 可移动项目与启动工作区基础

## Scope

本研究只解决 `001-project-foundation` 需要的 portable project、recent pointer、
startup IPC 和可靠的本地 JSON 写入。写作内容、Git history、provider、PDF、远程
同步和项目文件删除不在本 feature 的研究范围内。

## Decisions

### 1. Storage: versioned JSON files, no database or Git

**Decision**: 项目根使用 `project.json`，工作区使用 `workspace/state.json`；应用级
recent index 使用 `app.getPath('userData')/recent-projects.json`。不引入 SQLite、Git
或第三方 persistence package。

**Rationale**: 当前 spec 只要求 manifest、空工作区、最近编辑位置和 recent records；
JSON 足够可读、可移动且能被只读验证。Git/history 属于后续 version-history/内容
feature，提前初始化会扩大项目创建失败面和恢复协议。

**Alternatives considered**:

- SQLite：为当前少量元数据引入 schema/runtime 依赖，不增加用户价值。
- 每项目 Git：历史不在本 feature scope，且会把初始化/commit 失败引入创建路径。
- 只保存 userData：项目被移动或备份时会丢失项目自身的格式契约。

### 2. Atomic writes: same-directory temporary file/directory plus rename

**Decision**: JSON 文件先写同目录临时文件，完成后 rename；创建项目先在父目录
创建唯一临时目录，写完 manifest/state 和 `workspace/` 后再 rename 成最终
`<displayName>.writellm`。任何失败都不更新 recent index，也不把临时目录当作有效项目。

**Rationale**: `node:fs/promises` 提供异步 filesystem primitives；同目录临时路径
避免跨文件系统 rename。项目验证只认可正式目录中的 `project.json` 与必需 state，
所以中断的临时目录不会被启动页识别为有效项目。

**Alternatives considered**:

- 直接 recursive mkdir/write：中断时可能留下看似有效的半成品。
- `write-file-atomic` package：当前只需少量 JSON 写入，内置 helper 可以减少依赖和
  license/升级面；若后续需要平台特定 durability，再单独评估。

### 3. Validation: explicit type guards and schema version 1

**Decision**: 在 `src/main/project/project-validation.ts` 使用显式 type guards/field
validators；`schemaVersion` 和 `kind` 必须匹配 v1。未知版本、缺字段、错误 UUID、
缺必需目录或 state 只返回诊断，不自动修复或写入。

**Rationale**: 输入面小且 schema 固定，手写校验可让错误码、read-only 语义和 main
权限边界直接可审查；不需要把第三方 parser 引入 preload 或 domain schema。

**Alternatives considered**:

- Zod/Valibot/Ajv：都可行，但此 feature 的 DTO/file shapes 少；新增依赖没有减少
  当前跨边界风险，后续若 schema 复杂可提出独立决策。

### 4. Dialog ownership and path privacy

**Decision**: `dialog.showOpenDialog` 只在 main 调用。create 由 renderer 提交名称，
main 打开父目录选择；open/relink 由 main 打开项目目录选择。renderer 永不提交或
接收绝对路径；recent record 的绝对路径只存放于 main-owned userData index。

**Rationale**: native dialog 是 main-process API；路径是 filesystem authority 的
敏感数据，不需要跨 renderer boundary。relink 使用 recentId 在 main 查找原记录，
然后比对磁盘 manifest 的 stable projectId。

**Platform note**: `openDirectory` 是跨平台的目录选择能力；macOS 的
`createDirectory`/Windows 的 `promptToCreate` 差异不作为项目创建的 correctness
基础。产品始终让用户选择现有父目录，再由 main 创建项目子目录。

### 5. Recent index: five records, pointer cache only

**Decision**: recent index schema v1 最多保存 5 条，按 `lastOpenedAt` 倒序；按
`projectId` upsert，超过上限淘汰最旧记录。记录包含 main-only absolute path、摘要、
状态和 last-opened time；renderer 只收到 `recentId`、projectId、displayName、time、
availability 和 diagnostic code。

**Rationale**: 直接落实 clarification 与 FR-006/FR-007；index 失效不会损伤项目真相。
重新选择位置只有 stable ID 匹配时才更新原 record；普通 open 可以把一个有效项目
作为新记录打开。

### 6. Testing: existing Bun and compiled Electron smoke

**Decision**: 继续使用仓库现有 `bun:test`、TypeScript/build 和 `test:smoke`；新增
project unit/contract/integration/runtime tests，但不在本 feature 引入 Playwright、
React Testing Library 或其他 runner。

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

## Sources and repository evidence

- [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security)：
  context isolation、sandbox、sender validation 和 minimal contextBridge boundary。
- [Electron context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)：
  不暴露 generic IPC API，使用显式 bridge methods。
- [Electron dialog API](https://www.electronjs.org/docs/latest/api/dialog)：
  `showOpenDialog` 为 main-process native dialog，支持 `openDirectory`。
- [Node file system API](https://nodejs.org/api/fs.html)：`fs/promises` 的异步 mkdir、
  file and path operations。
- [Bun test runner](https://bun.sh/docs/test)：现有 `bun test` 的 TypeScript test
  baseline。
- [AGENTS.md](../../AGENTS.md)、[project storage ADR](../../docs/adr/001-project-storage.md)
  和当前 `src/main`/`src/preload`/`src/shared` foundation。

## Research conclusion

技术 unknowns 已被解析为一条最小实现路径。剩余状态是 acceptance gate：spec、plan、
contract 和所需 ADR 仍需维护者接受；这不应在 implementation tasks 中被默认为批准。
