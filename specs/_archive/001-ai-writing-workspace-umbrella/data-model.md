# Data Model: project workspace and storage hierarchy

## Storage roots

应用启动后由 main 进程计算以下路径，renderer 不接触绝对路径：

~~~text
<userData>/WriteLLM/
├── preferences.json                 # 全局 UI 偏好和非敏感 provider metadata
├── secrets/                          # main-owned safeStorage envelope；renderer 不可读
└── recent-projects.json             # 最近项目指针，绝不承载项目正文

<user-selected-parent>/
└── <project-name>.writellm/         # 用户拥有、可移动、可备份的项目根
    └── project files
~~~

projectId 是 main 进程生成的 UUID。项目根路径只由 main 在 native dialog 选择后或 recent index 中解析；所有从 renderer 来的 projectId/recentId 都必须先校验，不能把 renderer 传来的 path 直接交给 fs。

## RecentProjectRecord — app-owned launch data

File: userData/WriteLLM/recent-projects.json

~~~json
{
  "kind": "writellm.recent-projects",
  "schemaVersion": 1,
  "items": [
    {
      "recentId": "recent-uuid",
      "projectId": "project-uuid",
      "absolutePath": "/user/selected/Research.writellm",
      "displayName": "Research",
      "folderName": "Research.writellm",
      "parentLabel": "selected",
      "lastOpenedAt": "2026-07-11T10:05:00.000Z",
      "availability": "available"
    }
  ]
}
~~~

absolutePath 只在 main 和 userData 文件中存在，不返回 renderer。availability 为 available、missing 或 invalid。移除记录不删除项目；项目被移动后旧记录保留为 missing，用户重新打开新位置后按 projectId 合并。

## Project file hierarchy

~~~text
<user-selected-parent>/<project-name>.writellm/
├── .git/                                # 项目本地 Git history
├── .gitattributes                       # Markdown/JSON/text/binary diff policy
├── .gitignore                           # runtime/cache/embedding exclusions
├── project.json                         # ProjectManifest，项目身份和 revision
├── ui-state.json                        # 最近打开位置；不产生内容版本
├── content/
│   ├── motivation.md                    # 写作动机，UTF-8 Markdown
│   ├── outline.json                     # 有序 OutlineDocument
│   ├── citations.json                   # 项目级 Citation 索引
│   └── chapters/
│       └── <chapterId>/
│           ├── chapter.json             # Chapter metadata
│           └── chapter.md               # canonical Markdown + block identity comments
├── sources/
│   └── <sourceId>/
│       ├── source.json                  # Source metadata/status
│       ├── original.pdf                 # 用户导入的原始 PDF
│       ├── parsed.md                    # 第三方解析后的 Markdown
│       ├── assets/                      # 与 parsed.md 位置关联的图片
│       ├── chunks.jsonl                 # Chunk metadata + source ranges
│       └── embeddings/
│           └── <chunkId>.f32            # 预留：Float32 embedding payload
├── ai/
│   ├── tasks/
│   │   └── <taskId>.json                # AI 写作任务及其输入范围
│   └── proposals/
│       └── <proposalId>.json            # 独立于正文的修改提案
└── runtime/
    ├── pending/
    │   └── <transactionId>.json         # 崩溃恢复用 pending transaction
    └── search-index/                    # 可重建缓存，不进入 Git
~~~

创建项目时初始化 .git、.gitattributes、.gitignore、manifest、ui-state、motivation、outline、citations 和必要目录，并创建初始 Git commit；chapters/、sources/、ai/ 的实际实体文件在对应功能使用时创建。项目根目录名称不是身份来源，移动项目不需要修改 project.json。

## Entity definitions

### ProjectManifest — implemented in first slice

File: project.json

~~~json
{
  "kind": "writellm.project",
  "schemaVersion": 1,
  "format": "writellm-folder",
  "id": "7b7d4bf5-8d44-4e1a-a9b3-bf3dbe6f1c2a",
  "name": "我的第一篇文章",
  "createdAt": "2026-07-11T10:00:00.000Z",
  "updatedAt": "2026-07-11T10:00:00.000Z",
  "contentRevision": 1
}
~~~

Validation:

- id 必须是由 main 生成的 UUID；目录名可以因移动或用户重命名而改变。
- format 必须为 writellm-folder。
- name trim 后长度为 1–120 个 Unicode 字符，不得包含控制字符、路径分隔符或跨平台保留名；新建目录名由该名称加 .writellm 组成。
- 时间为 UTC ISO 8601 字符串，由 main 生成。
- contentRevision 从 1 开始，每次已提交的写作内容变更递增；仅打开项目或更新 ui-state 不递增。

### UIState — implemented in first slice

File: ui-state.json

~~~json
{
  "kind": "writellm.ui-state",
  "schemaVersion": 1,
  "lastOpenedAt": "2026-07-11T10:05:00.000Z",
  "theme": "dark",
  "density": "comfortable",
  "activeTool": "outline",
  "activeLocation": {
    "section": "outline",
    "chapterId": null,
    "blockId": null
  }
}
~~~

`section` 初始值为 motivation，允许 motivation、outline、chapters、sources。`theme` 为 system、light 或 dark；`density` 为 comfortable 或 compact；`activeTool` 为 null、outline、sources、assistant、citations 或 history。它们只用于恢复工作台位置和偏好，不写入正文 version record。UI state 不得包含 API key、绝对路径、完整 Markdown draft 或任意可执行内容。

### ProviderSettingsSummary / ProviderSecret — app-owned, main-only secret

`preferences.json` 只保存 renderer 可以安全显示的 metadata：

~~~json
{
  "kind": "writellm.provider-preferences",
  "schemaVersion": 1,
  "providers": [
    {
      "providerId": "openai-compatible",
      "displayName": "OpenAI-compatible",
      "endpoint": "https://api.example.test/v1",
      "modelLabel": "writing-model",
      "secretConfigured": true,
      "lastValidatedAt": "2026-07-11T10:10:00.000Z"
    }
  ]
}
~~~

API key 的 plaintext 只在 Settings modal 的短生命周期 form state 和 main handler 的参数内存在；main 使用 `safeStorage` 异步 API 保存到 `userData/WriteLLM/secrets/` 的 app-owned envelope。任何返回 renderer 的 DTO 只能包含 `secretConfigured`、provider id 和 typed status/error code。Linux backend 为 `basic_text` 或加密能力不可用时，保存 MUST 失败，不得自动写明文。

### Motivation — implemented in first slice

File: content/motivation.md

内容是用户可编辑的 UTF-8 Markdown 文本。空项目使用空字符串文件。保存时统一换行符为 LF，不自动改写用户内容；首版建议上限为 100,000 个 Unicode 字符，超出由 main 返回 INVALID_INPUT。

### OutlineDocument / OutlineItem — implemented in first slice

File: content/outline.json

~~~json
{
  "kind": "writellm.outline",
  "schemaVersion": 1,
  "projectId": "7b7d4bf5-8d44-4e1a-a9b3-bf3dbe6f1c2a",
  "items": [
    {
      "id": "1aa783a0-3c2a-4d55-9cc7-0b75a7a4ef2e",
      "title": "问题背景",
      "summary": "说明为什么要写这篇文章",
      "status": "not_started",
      "chapterId": null
    }
  ]
}
~~~

首版 items 数组顺序就是显示顺序，重新排序时由 main 重新校验并保存完整有序数组。id 由 main 生成且在项目内唯一。title trim 后为 1–200 个 Unicode 字符；summary 可为空，建议上限 2,000 个字符；status 为 not_started、in_progress 或 done；chapterId 为空表示尚未创建章节。首版不实现嵌套大纲，避免在第一切片引入不必要的树操作；未来可通过 schemaVersion migration 增加 parentId。

### Chapter / Block — Markdown canonical, reserved for later slices

Chapter file records its relation to the project and outline:

~~~json
{
  "kind": "writellm.chapter",
  "schemaVersion": 1,
  "id": "chapter-uuid",
  "projectId": "project-uuid",
  "outlineItemId": "outline-item-uuid",
  "title": "问题背景",
  "status": "draft",
  "createdAt": "2026-07-11T10:10:00.000Z",
  "updatedAt": "2026-07-11T10:10:00.000Z"
}
~~~

chapter.md 是章节正文的 canonical representation。每个 block 以不可见 HTML comment 记录稳定 identity：

~~~text
<!-- writellm:block id="block-uuid" type="paragraph" -->
这是普通 Markdown 段落。
~~~

type 预留 heading、paragraph、list、quote、citation；citation anchor 可以使用相同的 HTML comment 机制。Markdown 删除或移动正文时，main 重新解析 block identity；缺失或重复 id 标记为需要检查，不静默把引用绑定到另一段内容。这样章节可以被普通 Markdown 工具打开，同时 editor 能恢复 block/citation 关系。

### Source / Chunk / Embedding — reserved for later slices

source.json 保存原始文件 hash、展示名、标签、备注、处理状态和错误信息。状态至少为 imported、parsing、chunking、embedding、ready、partial_failure、failed。只有同时存在 chunk 文本、embedding metadata、解析后 Markdown range 和原始 page range 的 chunk 才能进入可引用检索结果。

chunks.jsonl 每行保存一个 chunk：

~~~json
{
  "id": "chunk-uuid",
  "sourceId": "source-uuid",
  "text": "可检索文本",
  "markdownRange": { "start": 120, "end": 560 },
  "sourcePages": { "start": 3, "end": 4 },
  "embedding": {
    "path": "embeddings/chunk-uuid.f32",
    "model": "configured-model-id",
    "dimensions": 1536,
    "dtype": "float32"
  }
}
~~~

表格和图片保持在 parsed.md 与 assets/ 的位置关系中；chunk 可以记录相邻 asset/table anchors，避免检索结果丢失上下文。具体索引实现属于后续研究。

### Citation — reserved for later slices

content/citations.json 保存正文 block 与 source/chunk 的可追溯关系。Citation 至少包括 id、blockId、sourceId、chunkId、显示标签、Markdown range、source page range 和 status（valid、invalid_source、needs_rebind）。删除/替换 source 时只把 citation 标记为失效，不静默绑定另一份资料。

### AiTask / Proposal — reserved for later slices

AI task 文件保存目标章节/block ids、用户指令、明确选定的 source/chunk 范围、状态、请求时间和错误；proposal 文件保存原文、建议文本、意图、依据、target revision 和每个 change 的审阅状态。proposal 在接受前不修改 content/。

### GitCommit — designed now, emitted by later content slices

Source: project-local .git repository

Git commit message body 使用 trailers 记录产品元数据：

~~~text
WriteLLM-Actor: human
WriteLLM-Event: content
WriteLLM-Content-Change: true
WriteLLM-Project-Revision: 3
WriteLLM-Task-ID: optional
WriteLLM-Proposal-ID: optional
~~~

Git commit id、parent、timestamp、changed files 和 diff 是版本记录。只有 Content-Change=true 的 commit 进入正文版本时间线；task/processing/metadata commit 可以保留失败任务或处理状态，但不增加正文 revision。

### ProcessingEvent — designed now, emitted by later source slices

sources/processing-events.ndjson 记录 parse、chunk、embedding、reindex 的开始/结束、状态、输入 hash、输出文件和错误。它关联 source，Git 可以记录其文本变更，但不代表人工或模型正文修改。

## Renderer UI entities

以下实体是 renderer 的可序列化 UI DTO 或 ephemeral state，不是新的持久化真相；它们的 contract 见 [workspace-ui.md](./contracts/workspace-ui.md)。

### AppShellState — ephemeral renderer state

~~~ts
type AppShellState = {
  view: 'launch' | 'workspace';
  project: ProjectWorkspace | null;
  activeTool: ToolId | null;
  openPanel: ToolId | null;
  openModal: ModalDescriptor | null;
  editor: EditorSessionState | null;
  save: SaveState;
  notification: NotificationState | null;
};
~~~

Invariants:

- `view='launch'` 时 `project`、`editor`、`openPanel` 必须为 null；`openModal` 只允许 launch-scoped modal。
- `view='workspace'` 时 `project` 必须存在；`openPanel` 至多一个，且必须是当前 project 支持的 tool。
- `openModal` 不得携带 absolute path、secret、raw IPC channel 或文件句柄；modal payload 只能是 domain id、safe DTO 和 form draft。
- `save` 的 `expectedRevision` 必须来自最近一次 main 返回的 workspace DTO；冲突后必须进入 `conflict`，不得自动重试覆盖。

### ToolPanelState — left rail and floating panel

~~~json
{
  "tool": "outline",
  "label": "大纲",
  "panel": "outline-panel",
  "anchor": "left-rail",
  "dismiss": ["toggle", "escape", "outside-click"],
  "keyboardShortcut": "Mod+Shift+O"
}
~~~

允许的首版 `ToolId`：`outline`、`sources`、`assistant`、`citations`、`history`。每个 panel 只能通过 feature command 改变 workspace state，不能直接访问项目路径或 storage adapter。panel 内容为空时显示可执行 empty state，不用假数据冒充可用资料/引用。

### ModalDescriptor — configuration and review modal

~~~ts
type ModalDescriptor =
  | { kind: 'new-project'; source: 'header' | 'launch'; draft: { name: string } }
  | { kind: 'project-switcher'; source: 'header' }
  | { kind: 'settings'; tab: 'general' | 'providers' | 'appearance' }
  | { kind: 'proposal-review'; proposalId: UUID }
  | { kind: 'history-diff'; leftRevision: number; rightRevision: number }
  | { kind: 'confirm'; action: 'delete-project' | 'discard-draft' | 'restore-revision' };
~~~

Validation：`kind` 是有限 union；每个 id 必须是 main 已返回的 UUID；modal opening/closing 必须可由 keyboard 完成；destructive action 必须有显式 confirm；关闭 dirty form 必须先给出 discard choice，不能静默丢失。modal 背景 scrim/blur 只属于 renderer presentation，不写入项目内容。

### EditorSessionState — BlockNote projection

~~~ts
type EditorSessionState = {
  chapterId: UUID | null;
  document: BlockNoteDocument;
  selectedBlockIds: UUID[];
  focusedBlockId: UUID | null;
  targetRevision: number;
  dirty: boolean;
  identityStatus: 'valid' | 'needs_review' | 'external_change';
};
~~~

BlockNote 顶层 block 必须有稳定 UUID；renderer 可以在创建新 block 时暂时生成 client id，但保存前由 main 校验格式、唯一性和 chapter ownership。`document` 不得包含 secret、absolute path 或未验证的 remote HTML。citation block/inline content 只引用 safe `citationId`，source/chunk/page 信息由 main 返回的 Citation DTO 绑定。BlockNote 的 Markdown 导出是 lossy，因此 canonical Markdown 必须经过项目自有 codec，不得直接用 `blocksToMarkdownLossy` 覆盖 chapter file。

### QuickAction — bottom command bar action

每个 QuickAction 具有 `id`、`label`、`iconName`、`enabled`、`shortcut`、`availability` 和 `command`。首版 action：`open-assistant`、`open-markup`、`open-citations`、`open-history`、`save`。`command` 是 renderer reducer command，不是 IPC channel；需要 privileged work 时由 feature adapter 调用 named bridge method。

### ProviderSettingsForm — transient form

~~~ts
type ProviderSettingsForm = {
  providerId: string;
  endpoint: string;
  modelLabel: string;
  apiKey: string;
  apiKeyTouched: boolean;
};
~~~

`apiKey` 不得写入 reducer persistence、URL、analytics、toast 或 error message；submit 后清空 form 中的 plaintext。服务端错误只保留 typed `PROVIDER_AUTH_FAILED` / `SECRET_STORAGE_UNAVAILABLE` 等 code 和用户可读 message。

## Relationships and invariants

~~~text
Project
├── has one Motivation
├── has one ordered OutlineDocument
├── has many Chapters
│   └── each Chapter may link to one OutlineItem
├── has many Sources
│   └── Source has many Chunks, each Chunk has at most one current Embedding
├── has many Citations
│   └── Citation links a Block to a Chunk/Source range
├── has many AiTasks
│   └── Task may produce one Proposal containing many Changes
└── has a linear Git history of commits and separate ProcessingEvents
~~~

主要不变量：

1. 项目 UUID 和 project.json.id 必须一致；目录名不参与身份判断。
2. 任何内容读取都先检查 kind、schemaVersion、projectId 和 hash/revision。
3. 保存采用 expected contentRevision；陈旧 renderer 得到 CONFLICT，不得覆盖新保存。
4. 正文内容成功写入后才允许创建 Content-Change=true 的 Git commit；写入或 commit 失败不得向 UI 报告成功。
5. 恢复历史版本使用 git restore 写入工作树，再创建新的 human Git commit，不改写已有 history。
6. 资料处理状态与正文版本分离；未完成资料不能出现在可引用结果中。
7. renderer UI state 不能成为 project content 或 secret storage 的第二真相；只有 main 返回的 revision/DTO 能确认保存成功。
8. modal/panel 的 presentation state 可丢失；恢复项目时只恢复安全的 activeLocation/theme/density，不恢复 API key 或未保存 editor draft。

## State transitions

### Project lifecycle

~~~text
none → creating → active → trashed
             ↘ failed
~~~

临时目录处于 creating 时不参与 recent list；初始化失败时删除临时目录并返回可重试错误。trashed 项目从 recent list 移除，但实际删除动作必须由 main 成功完成。

### Recent record lifecycle

~~~text
new → available → missing
              ↘ invalid
missing/invalid → removed
missing → available   # 用户重新选择移动后的项目
~~~

recent record 的 removed 只代表应用索引删除，不代表项目文件删除。

### Outline item lifecycle

~~~text
not_started → in_progress → done
      ↘ in_progress
~~~

状态变化属于 human content save，并增加 contentRevision。章节尚未创建时 chapterId 保持 null。

### Workspace UI lifecycle

~~~text
launch → opening-project → workspace
launch → settings-modal → launch
workspace → panel-open → workspace
workspace → modal-open → workspace
workspace → saving → saved
workspace → saving → dirty/error | conflict
~~~

panel/modal 关闭不改变 project content；只有 editor/outline/motivation 等 domain command 经过 main save 成功后才从 dirty 进入 saved。窗口关闭或切换项目时如果 dirty/error/conflict，UI 必须先让用户保存、重试、查看冲突或放弃。

## Migration and recovery

读取旧 schema 时由 main 执行显式 migration，并在迁移成功后用原子替换写回；未知版本只返回不支持错误，不猜测字段含义。打开项目时先处理 runtime/pending/，再验证 .git、读取 manifest 和 content；无法安全恢复时保留原文件、标记 storage error，并给用户重试/导出诊断信息。
