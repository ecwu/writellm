# ADR-001: Portable .writellm content and Git-backed history

- Status: Accepted
- Date: 2026-07-11
- Owners: WriteLLM v2 maintainers
- Scope: ADR-002 foundation 之上的章节、资料、AI、内容格式和版本历史存储边界

## Context

WriteLLM v2 是单作者 Electron 桌面应用。作者内容、资料、AI 任务和版本历史需要
保存在 ADR-002 定义的自包含 `.writellm` 项目内，并能随项目移动、备份和恢复。

renderer 需要通过 typed IPC 读取和保存这些内容，但不能直接访问文件系统。项目除了
短小的元数据和写作内容，还会包含 PDF、解析后的 Markdown、图片、文本块和 embedding；
后续还要追踪人工和模型已保存的变更。

当前仓库只有 Electron + React 启动基础，没有数据库或持久化依赖。ADR-002 负责项目
根目录、project identity、recent pointer 和基础 JSON 写入。本 ADR 在该 foundation
之上决定内容格式、项目内 Git repository 和可恢复的内容历史，但不重新定义 001 的
启动页或 recent index。仓库约束要求 renderer 保持 sandbox、关闭 node integration，
并且所有 renderer 输入都必须在 main 进程验证。首版不包含远程同步、多人协作、分支
合并或冲突解决。

## Relationship to ADR-002

ADR-002 是 `001-project-foundation` 的实现前置 ADR，且可以独立于本 ADR 被接受。
本 ADR 的 portable project 内容、Git history 和跨内容 transaction 条款假定 ADR-002
已经定义了项目根目录和项目身份；它们不授权 001 初始化 Git 或实现内容历史。

## Decision

### 1. Content lives inside the ADR-002 project root

所有章节、资料、AI 任务、提案和历史文件都位于 ADR-002 定义的 `.writellm` project
root 内。project identity、recent pointer、启动页 dialog、项目名称和 collision
规则由 ADR-002 负责；本 ADR 不重复定义这些 foundation 行为。

### 2. Use editor-native canonical content and explicit interchange projections

项目在第一次成功内容保存事务中初始化 `.git`、`.gitattributes` 和标准 `.gitignore`；项目创建或只读打开不提前初始化 Git。`project.json` 是 manifest，`content/` 与 feature-owned workspace documents 保存作者内容，`sources/` 保存资料，`ai/` 保存任务和提案，`runtime/` 保存可重建缓存和 pending 状态。章节正文使用对应编辑器的 canonical document format；采用 BlockNote 的章节保存 BlockNote JSON wrapper，Markdown 只作为明确的输入、粘贴和导出 projection。

所有 JSON 文档都带 schemaVersion 和 kind。main 进程读取后先验证 kind、projectId、revision 和必需字段，再交给 renderer。未知字段可以保留，未知 schemaVersion 必须返回可理解的迁移/不支持错误。BlockNote block id、props、content 和 children 由 canonical JSON 保存；Markdown 转换不得承担恢复 block identity 或引用关系的职责。Git attributes 将 Markdown/BlockNote JSON/JSONL 视为 text，将 PDF、图片和 embedding 视为 binary 或 ignored cache。

Git repository 是项目的一部分，随 `.writellm` 文件夹移动。项目打开时必须验证 `.git` 位于当前项目根，不自动接受外部 repository。初始化时首个 commit 包含项目根内当时存在的全部可追踪文件；`.git` 自身、同目录临时文件、`runtime/pending/`、可重建 cache、日志、崩溃转储和任何 secret material 不得进入 index。标准 `.gitignore` 即使当前不配置 remote 也必须存在，因为它定义本地历史边界并避免把恢复中间态或可重建大文件写入永久历史。

### 3. Use structured Git commits for product history

首版 Git engine 使用 main-only `isomorphic-git` adapter，并传入 Electron main 的 Node
`fs`。它覆盖本产品需要的 init、add/remove、commit、status/log/diff/restore primitives，
不调用用户系统 Git，也不打包独立 Git executable。精确 package 版本在实现任务开始时
锁定到 `package.json`/`bun.lock`，并通过三平台 packaged Electron 验证。若未来需要
isomorphic-git 不支持或性能不足的 Git 能力，必须通过新的 ADR amendment 更换 adapter；
domain repository 与 renderer contract 不得依赖 engine-specific API。

Git author 和 committer identity 由应用固定为
`WriteLLM <history@writellm.local>`；不得读取用户的全局或 repository-local
`user.name`/`user.email`。首个消费 feature 必须在任何产品存储代码之前解析、安装并将
一个精确 `isomorphic-git` 版本写入 `package.json` 和 `bun.lock`，完成 license、Bun、
Electron build 与 packaged runtime compatibility probe。后续 feature 复用同一 adapter，
不得自行安装第二个 Git engine。

标准 `.gitignore` 内容固定为：

~~~gitignore
# WriteLLM transaction and recovery intermediates
runtime/pending/
runtime/cache/
runtime/logs/
runtime/crash/
runtime/embeddings/
**/.writellm-tmp-*

# Secrets must never be project content or history
secrets/
*.secret
~~~

这些条目只排除中间态、可重建数据、诊断输出和禁止进入项目的 secret。`project.json`、
feature-owned workspace/content documents、sources、用户导入的附件和其他 canonical
project payload 默认全部跟踪。更改这份 ignore baseline 属于 storage-boundary review，
不能由单个 feature 静默扩大。

每次成功保存由 main-owned GitRepository adapter 执行 add/commit。Git commit id、parent、timestamp、changed files 和 diff 是版本记录；Git log 作为时间线，Git diff 作为比较，Git restore 作为非破坏恢复基础。

commit message 使用稳定 trailers：

~~~text
WriteLLM-Actor: human | model | system
WriteLLM-Event: content | task | processing | metadata
WriteLLM-Content-Change: true | false
WriteLLM-Project-Revision: 3
WriteLLM-Task-ID: optional
WriteLLM-Proposal-ID: optional
~~~

只有 WriteLLM-Content-Change=true 的 commit 进入正文版本时间线；失败/取消的 AI task 可以保留 task event commit，但不改变正文 revision。首版保持单线性本地 history，不做分支、合并或远程同步。

### 4. Make content writes recoverable and main-owned

- 每个项目由 main 进程维护串行写入队列。
- 若项目尚无 `.git`，第一次内容保存先在 pending transaction 中准备 canonical 文件和标准 Git metadata，再初始化 repository、stage 项目内全部可追踪文件并创建 initial structured content commit。初始化、stage 或 commit 任一步失败都返回稳定的 `GIT_INITIALIZATION_FAILED` 或 `GIT_COMMIT_FAILED`，保留 renderer 草稿并显示可重试提醒，不得报告保存成功。
- 单文件写入使用同目录临时文件、完整写入后 rename。
- 跨文件保存先写 runtime/pending/<transactionId>.json，记录目标 revision、待替换文件和 hashes；替换文件后由 Git adapter 创建 commit，commit 成功后清理 pending。
- 启动或 open 时检测 pending transaction 和 Git working tree：若文件写入完成但 commit 未完成，则重试或标记 externalChanges；无法判断时返回 STORAGE_RECOVERY_REQUIRED，不覆盖文件。
- Git runtime 由应用管理，main 使用锁版 isomorphic-git adapter、应用固定的 author/committer identity 和参数，不把任意 Git command 暴露给 renderer，也不读取或依赖用户的全局 Git config。

### 5. Keep IPC explicit

内容、任务、提案和历史的 request/response/error 类型由各自 feature contract 定义，
并通过 ADR-002 的 foundation boundary 进入 main-owned storage。任何 feature 都不得
暴露 generic IPC、任意 channel、绝对路径、任意文件内容读取或文件系统对象。

## Consequences

### Positive

- 作者内容、资料和 AI 记录随 ADR-002 定义的项目根目录移动、备份和恢复。
- editor-native canonical document 避免用 Markdown projection 承担完整恢复责任。
- Git trailers 可以准确区分人工、模型和系统，并连接 AI task/source。
- main 是唯一文件系统 authority，符合 Electron 安全基线。
- 失败的多文件内容保存可以通过 pending transaction 进入可解释的恢复流程。

### Negative

- 多文件 transaction/recovery 需要额外代码和测试。
- Git history 会因为 PDF、图片等二进制文件的替换而增长；需要未来增加大文件策略、压缩或 Git LFS 兼容性评估。
- Markdown 导出可能无法表达高级 block、props 或引用位置；导出必须允许显式 lossy warning，不能把 Markdown 当作恢复章节的唯一来源。

## Alternatives considered

### Fixed application-managed content root

内容不应脱离 ADR-002 定义的 portable project root 单独保存，否则项目移动、备份和
恢复会失去一致性。

### One SQLite database per project

SQLite 能提供事务和查询，但仍需要保存可版本化的 editor-native document，并处理数据库迁移、备份和可移动项目边界。是否使用数据库由具体内容 feature 决定，不由 Markdown 互操作要求决定；事务必须继续由 main-owned storage boundary 提供。

### Use the user's system Git

拒绝作为生产默认值。macOS、Windows 和 Linux 对 Git 的预装、版本、PATH、首次启动提示和全局配置没有统一保证；它只可作为开发诊断工具，不能决定用户能否保存。

### Bundle a standalone Git executable

首版拒绝。完整 executable 能提供原生 Git 的最大兼容性，但需要为 macOS、Windows、Linux 分别打包、签名、更新和验证二进制，明显超过当前 init/add/commit/log 范围。若后续出现 isomorphic-git 无法满足的 repository maintenance 或性能需求，再通过 ADR amendment 采用。

## Acceptance checklist before implementation

- [x] ADR-002 已接受并实现，确认任意父目录、`.writellm` 自包含项目和 userData recent index。
- [x] 维护者接受 portable canonical files、structured Git trailers、binary/cache tracking 和 main-owned recovery 的公共基线；具体 editor schema 与 interchange lossiness 由消费 feature 在各自 spec/plan 中接受。
- [x] 维护者接受 isomorphic-git main-only adapter、首次内容保存初始化、固定 `WriteLLM <history@writellm.local>` identity、标准 `.gitignore` 和 existing-project failure/retry semantics。
- [x] ADR 采用分阶段消费：本 ADR 的接受不要求所有未来内容、任务、提案和历史 IPC 同时冻结；每个消费 feature 必须在自身实施前冻结自己的 method、DTO、dialog/error contract，并引用本 ADR。
- [x] ADR-002 project foundation contract 由后续 feature 作为 storage prerequisite 复用。
- [x] 每个消费 feature 的任务计划必须包含其真实 Electron runtime failure-boundary smoke；003 已包含该门禁。
