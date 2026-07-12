# ADR-001: Portable .writellm projects and Git-backed history

- Status: Proposed
- Date: 2026-07-11
- Owners: WriteLLM v2 maintainers
- Scope: 项目创建、可移动项目文件夹、启动页最近项目，以及后续章节/资料/AI/版本历史的存储边界

## Context

WriteLLM v2 是单作者 Electron 桌面应用。用户希望项目可以放在任意位置，并以一个自包含的 xxx.writellm 文件夹管理；软件启动时应像 Adobe Home 一样提供新建、打开和最近项目快速入口。

renderer 需要创建、打开、保存和删除项目，但不能直接访问文件系统。项目除了短小的元数据和写作内容，还会包含 PDF、解析后的 Markdown、图片、文本块和 embedding；后续还要追踪人工和模型已保存的变更。

当前仓库只有 Electron + React 启动基础，没有数据库或持久化依赖。项目将使用本地 Git repository 管理本地历史，但不要求用户手动执行 Git。仓库约束要求 renderer 保持 sandbox、关闭 node integration，并且所有 renderer 输入都必须在 main 进程验证。首版不包含远程同步、多人协作、分支合并或冲突解决。

## Decision

### 1. The project is a portable self-contained folder

- 创建项目时用户选择父目录，main 在该目录下创建一个以项目名和 .writellm 结尾的文件夹。
- project.json 保存项目 UUID、显示名、schemaVersion、contentRevision 和时间，不保存绝对路径。
- .writellm 文件夹包含全部 manifest、正文、资料、AI 任务、历史和恢复文件；项目可以被复制、移动或备份。
- 新建时固定使用 .writellm 后缀；打开项目时验证 manifest 和结构。为保持可发现性，用户重命名文件夹时应保留后缀。
- 文件夹当前名称不作为项目身份；项目身份永远是 manifest 中由 main 生成的 UUID。

项目因此不依赖 app.getPath('documents')、应用安装位置或某个固定 workspace root。

### 2. Application configuration stores only recent-project pointers

应用配置位于 app.getPath('userData')/WriteLLM/，其中 recent-projects.json 保存最多 12 条 recent records：

- opaque recentId；
- projectId（若 manifest 可读）；
- main-only absolute path；
- displayName、folderName、parentLabel；
- lastOpenedAt；
- availability：available、missing 或 invalid。

recent index 只是启动页的指针缓存，不是项目真相来源。项目被移动、重命名、外部删除或权限变化时，记录显示 missing/invalid。用户可以移除记录或通过 Open Project 重新绑定；移除记录不删除项目文件。打开移动后的项目时，main 根据 projectId 合并/更新已有 recent record。

应用不扫描固定目录，也不把项目复制到 userData。recent index 损坏或丢失不应损坏 .writellm 项目。

### 3. Native dialogs are main-owned

- createProject(name) 先由 main 校验名称，再调用 Electron native directory dialog 选择父目录，创建项目文件夹。
- openProjectFromDialog() 由 main 调用 openDirectory dialog，读取所选目录的 project.json 并验证结构。
- renderer 不传绝对路径，也不接收绝对路径；它只收到创建/打开结果、摘要和 workspace DTO。
- 目录选择取消是可恢复的 canceled result，不是 storage failure。

打开目录时不信任 recent index 的名称或路径标签；必须重新读取 manifest、kind、schemaVersion、projectId 和必要文件。

### 4. Naming and collision behavior

项目名称 trim 后为 1–120 个 Unicode 字符，不得包含控制字符、路径分隔符、跨平台保留名或会导致文件夹名不稳定的尾随空格/句点。main 生成 displayName.writellm。

同一父目录存在同名文件夹时返回 PROJECT_EXISTS，要求用户改名或更换位置。不得静默覆盖、合并或删除已有项目。display name 修改是后续项目 metadata 操作；首版不自动重命名外部文件夹。

### 5. Use Markdown canonical content and a project-local Git repository

项目根目录初始化 .git、.gitattributes 和 .gitignore。project.json 是 manifest，ui-state.json 保存最近编辑位置，content/ 保存作者内容，sources/ 保存资料，ai/ 保存任务和提案，runtime/ 保存可重建缓存和 pending 状态。章节正文以 Markdown 为 canonical content，block/citation identity 使用不可见 HTML comments。

所有 JSON 文档都带 schemaVersion 和 kind。main 进程读取后先验证 kind、projectId、revision 和必需字段，再交给 renderer。未知字段可以保留，未知 schemaVersion 必须返回可理解的迁移/不支持错误。Git attributes 将 Markdown/JSON/JSONL 视为 text，将 PDF、图片和 embedding 视为 binary 或 ignored cache。

Git repository 是项目的一部分，随 .writellm 文件夹移动。项目打开时必须验证 .git 的 work tree 指向当前项目根，不自动接受外部 repository。

### 6. Use structured Git commits for product history

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

### 7. Make writes recoverable and main-owned

- 每个项目由 main 进程维护串行写入队列。
- 单文件写入使用同目录临时文件、完整写入后 rename。
- 跨文件保存先写 runtime/pending/<transactionId>.json，记录目标 revision、待替换文件和 hashes；替换文件后由 Git adapter 创建 commit，commit 成功后清理 pending。
- 启动或 open 时检测 pending transaction 和 Git working tree：若文件写入完成但 commit 未完成，则重试或标记 externalChanges；无法判断时返回 STORAGE_RECOVERY_REQUIRED，不覆盖文件。
- 创建项目使用临时项目目录完成初始树、Git repository 和初始 commit，成功后一次性 rename 为最终 .writellm 目录；半成品不得被 recent index 看到。
- Git runtime 由应用管理，main 使用固定 executable/adapter 和参数，不把任意 Git command 暴露给 renderer，也不依赖用户的全局 Git config。

### 8. Keep IPC explicit

renderer 只能通过命名方法访问 launch/project domain：

- listRecentProjects
- createProject
- openProjectFromDialog
- openRecentProject
- removeRecentProject
- saveProjectWorkspace
- deleteProject

方法的 request/response/error 类型定义在 src/shared/ipc.ts 和 src/shared/project.ts，preload 逐一映射为 window.writellm 方法。main 校验 IPC sender、输入结构、recentId/projectId、manifest、revision 和文件路径；绝对路径、任意 channel 和任意文件内容读取均不跨边界。

## Consequences

### Positive

- 项目真正由用户拥有，能放在任意目录、移动、备份和恢复。
- Launch Home 可以跨任意位置提供最近项目快速打开。
- recent index 失效不会删除项目，也不阻止用户重新选择项目。
- 项目正文可被用户检查和迁移，不依赖数据库服务。
- Git trailers 可以准确区分人工、模型和系统，并连接 AI task/source。
- main 是唯一文件系统 authority，符合 Electron 安全基线。

### Negative

- 项目移动后需要用户通过 Open Project 重新绑定，不能自动全盘搜索。
- recent index 保存绝对路径，需要处理路径泄露、权限和配置损坏；这些数据只留在 main/userData。
- 多文件 transaction/recovery 需要额外代码和测试。
- Git history 会因为 PDF、图片等二进制文件的替换而增长；需要未来增加大文件策略、压缩或 Git LFS 兼容性评估。
- Markdown 里的 block identity comments 需要 codec；外部编辑删除/复制 comments 时必须标记 needs_review。

## Alternatives considered

### Fixed application-managed project root

它无法满足用户选择任意位置和可移动项目的要求，也会让项目备份依赖应用路径。

### One SQLite database per project

SQLite 能提供事务和查询，但需要引入数据库依赖或运行时兼容性处理；同时不利于用户直接看到 Markdown、PDF 和图片的文件层级。首版选择可读 domain files，事务由 main 的 pending protocol 提供。

### Initialize a Git repository in every project

这是本 ADR 的选择。Git 不是 renderer API，而是由 main 管理的项目内 history backend；commit trailers 表达 processing event、AI proposal、actor 和 source/chunk 关联。发布版不能依赖用户系统 Git，应由应用携带已知 runtime。

## Acceptance checklist before implementation

- [ ] feature spec 从 Draft 变为项目认可的 Accepted 状态。
- [ ] 维护者接受本 ADR，确认任意父目录、.writellm 自包含项目和 userData recent index。
- [ ] 维护者接受 Git-backed history、Markdown canonical content、commit trailers 和 binary/cache tracking policy。
- [ ] `001-project-foundation` 的 project IPC contract method names、DTO、dialog result 和错误码冻结。
- [ ] `001-project-foundation` 的 project storage contract portable root、schemaVersion、transaction/recovery 规则冻结。
- [ ] 任务计划包含真实 Electron runtime smoke，而不只有 renderer 单元测试。
