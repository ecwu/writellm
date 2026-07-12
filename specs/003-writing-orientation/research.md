# 003 写作方向技术研究

**日期**: 2026-07-12
**状态**: Phase 0 complete；无未决技术澄清

## Decision 1 — IPC

**Decision**: 使用 Electron `ipcMain.handle` / `ipcRenderer.invoke`，由独立的 `window.writellmWritingOrientation` namespace 暴露 `load`、`save`、`deleteOutlineItem` 三个具名方法；所有结果使用可判别 DTO。

**Rationale**: 与现有安全边界一致，方法面最小，且错误不依赖 Electron 对 `Error` 的序列化。

**Alternatives considered**: generic IPC router（权限面过宽）；逐字段保存 methods（增加竞态和 contract 面）。

## Decision 2 — Runtime validation

**Decision**: 对本 feature 的小型、版本固定 DTO 使用 shared 类型加 main-owned 手写 parser/type guard，不新增 schema 依赖。

**Rationale**: 规则有限，稳定错误码比通用 issue tree 更重要；避免为单一小 schema 增加依赖。parser 同时用于磁盘和 renderer 输入。

**Alternatives considered**: Zod、Valibot（均可行，但当前收益不足以抵消依赖和双边 bundle 成本）。

## Decision 3 — Persistence and atomicity

**Decision**: 将 canonical snapshot 保存为 `workspace/writing-orientation.json`。main 使用每项目串行队列、同目录临时文件、flush/close 后 rename 的单文件替换，并通过 accepted ADR-001 的 main-owned Git adapter 为成功内容保存创建结构化 commit。只有文件替换、Git commit 和 pending cleanup 达到 ADR-001 定义的成功状态后才返回新 revision；失败保留 renderer 草稿并进入明确的重试或恢复状态。003 不实现版本历史 UI。

**Rationale**: 一个 snapshot 文件即可表达动机、条目、顺序和章节关联；ADR-001 的 pending transaction 与 Git commit 为可恢复保存和后续 010 history 提供统一基础，而 003 只消费该基础，不提前实现历史浏览或恢复 UI。该 durable contract 必须在 ADR-001 接受后实施。

**Alternatives considered**: SQLite（当前规模过重）；只做文件替换而不记录 Git commit（与 ADR-001 的统一 history 决策冲突）；第三方 atomic-write 包（Node primitive 足够且更透明）。linked chapter deletion 仍是独立的多文件 transaction，由共享 content repository contract 负责。

## Decision 4 — Revision and idempotency

**Decision**: 文档使用非负整数 `revision`。load 不改变 revision；save 必须携带 `baseRevision`，匹配后递增一次。请求携带 `mutationId`，main 在活动项目 session 内按 method + exact payload 缓存最近完成的 mutation/result；相同请求返回同一结果，同一 ID 搭配不同 method/payload 被拒绝。新条目由 renderer 提交 session-scoped `clientDraftId`，durable entity ID 由 main 的 `crypto.randomUUID()` 生成，成功响应返回两者映射。save input 不包含 main-owned `chapterRef`，且不得省略已有 durable ID；删除只能走独立 command。

**Rationale**: revision 防止旧草稿静默覆盖；session-scoped mutation 去重覆盖重复点击，不把命令日志变成新的 durable truth。

**Alternatives considered**: last-write-wins（会丢内容）；内容派生 ID（标题变化破坏身份）；新增 UUID 包（无必要）。

## Decision 5 — Outline editing and reorder

**Decision**: renderer 维护完整 draft snapshot。固定详情区编辑选中条目。上移/下移按钮是完整键盘路径；HTML drag events 是同一 pure reorder command 的指针增强。数组顺序是唯一 order truth。

**Rationale**: 无新增拖拽依赖即可同时满足指针和非指针排序；两条路径天然共享顺序规则。

**Alternatives considered**: dnd-kit（首版无必要）；持久化 position 数值（会产生重排和冲突复杂度）。

## Decision 6 — Linked chapter deletion boundary

**Decision**: 003 删除使用单独 main command。main 根据当前 revision 重新读取关联状态；未关联条目可以删除，存在 `chapterRef` 时返回 `LINKED_DELETE_NOT_AVAILABLE` 且不修改任何内容。003 不预留确认布尔值或实现一侧事务。004 首次产生 chapter link 时，必须通过 accepted extension 同时定义 create/link 与 linked delete 的共享原子事务。

**Rationale**: 004 上线前不会产生真实 chapter link，因此不应让尚未存在的 chapter repository 阻塞 003。安全拒绝既避免部分删除，也为 004 保留基于真实 repository/recovery 设计事务的空间。

**Alternatives considered**: renderer 直接从 draft 删除（可绕过 authoritative link state）；003 提前实现假 chapter fixture transaction（冻结不存在的 repository）；先删条目再删章节（产生部分删除）。

## Decision 7 — Default entry and leave guard

**Decision**: 最近选中条目只存在于当前 renderer session，不写入 canonical content 或项目 UI state。重新打开时，有条目默认选择第一项，无条目显示大纲首页空状态。离开 guard 由 003 向 002 shell 提供 dirty 状态与异步 `save`、同步 `discard` callbacks；无 dirty 直接离开，Save 成功后离开，Save 失败留在当前项目，Discard 后离开，Stay 不改变任何状态。

**Rationale**: 不持久化 selection 消除无用户价值的 durable location contract；owner 决定保存语义，shell 只编排离开，符合 002 FR-004A 为 accepted downstream feature 预留的扩展方式。

**Alternatives considered**: 写入 orientation content 或 `ui-state.json`（用户不要求跨重启 selection，增加无必要的写入和 contract）；renderer localStorage（脱离项目身份和 main validation）。

## Decision 8 — Verification

**Decision**: 沿用 Bun tests、现有 build/typecheck 和 compiled Electron UI/runtime harness，不新增 runner。

**Rationale**: unit、contract、temp-directory integration 和真实 Electron runtime 分别覆盖对应失败边界。

**Alternatives considered**: 只做组件/静态测试（无法证明 preload、文件替换、重启和 focus 行为）；新增 runner（无已知缺口）。

## Resolved baseline

- TypeScript/React/Electron/Bun 版本以仓库 lockfile 为准，本 feature 不升级。
- Git runtime/adapter 由 accepted ADR-001 统一选择、打包和维护；003 不自行引入第二套 Git dependency。
- 文本按 Unicode string 保存，禁止 NUL；标题 trim 后必须非空。产品未规定硬字数上限，因此本 feature 不发明内容上限；main 只设置 2 MiB request/document safety ceiling，并以 `PAYLOAD_TOO_LARGE` 报错。
- 平台目标沿用项目发布矩阵；atomic replacement 必须在每个支持平台的 packaged Electron validation 中证明。
