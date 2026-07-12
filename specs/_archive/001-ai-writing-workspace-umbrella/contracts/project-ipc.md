# Contract: launch and project IPC

## Boundary

这是 renderer ↔ preload ↔ main 的内部桌面接口，不是对外 HTTP API。所有 method 都必须在 src/shared/ipc.ts 中定义 channel、request、response 和 error 类型。

当前 renderer 只允许调用：

| Preload method | Channel | Purpose |
|---|---|---|
| listRecentProjects() | writellm:recent-list | 读取 Launch Home 的最近项目摘要 |
| createProject(request) | writellm:project-create | 校验名称、由 main 打开父目录选择器并创建项目 |
| openProjectFromDialog() | writellm:project-open-dialog | 由 main 打开目录选择器并验证所选 .writellm 文件夹 |
| openRecentProject(request) | writellm:project-open-recent | 根据 opaque recentId 快速打开 |
| removeRecentProject(request) | writellm:recent-remove | 只移除启动页记录，不删除文件夹 |
| saveProjectWorkspace(request) | writellm:project-save | 保存动机、大纲和编辑位置 |
| deleteProject(request) | writellm:project-delete | 将已解析项目移入 OS trash |
| readProviderSettings() | writellm:provider-settings-read | 读取非敏感 provider summary，不返回 API key |
| saveProviderSecret(request) | writellm:provider-secret-save | 由 main 使用 safeStorage 保存/替换 API key |
| testProviderConnection(request) | writellm:provider-test | 由 main 使用已保存 secret 验证 provider |

preload 不得暴露 generic send/invoke、文件系统 API、绝对路径或未列出的 channel。

## DTOs

~~~text
RecentProjectSummary {
  recentId: UUID
  projectId: UUID | null
  name: string
  folderName: string
  parentLabel: string
  lastOpenedAt: ISODate
  availability: "available" | "missing" | "invalid"
}

ListRecentProjectsResponse {
  items: RecentProjectSummary[]   // 按 lastOpenedAt 倒序，最多 12 条
}

CreateProjectRequest {
  name: string
}

CreateProjectResponse =
  { status: "created", workspace: ProjectWorkspace }
  | { status: "canceled" }

OpenProjectResponse =
  { status: "opened", workspace: ProjectWorkspace }
  | { status: "canceled" }

OpenRecentProjectRequest {
  recentId: UUID
}

RemoveRecentProjectRequest {
  recentId: UUID
}

DeleteProjectRequest {
  projectId: UUID
}

ProjectSummary {
  id: UUID
  name: string
  createdAt: ISODate
  updatedAt: ISODate
  contentRevision: positive integer
  folderName: string
  locationLabel: string
}

ProjectWorkspace {
  project: ProjectSummary
  motivation: string
  outline: OutlineItem[]
  chapters: ChapterSummary[]
  activeEditor: EditorDocument | null
  activeLocation: WorkspaceLocation
  contentRevision: positive integer
  externalChanges: "clean" | "present" | "needs_review"
}

ChapterSummary {
  id: UUID
  outlineItemId: UUID | null
  title: string
  status: "draft" | "in_progress" | "complete"
  updatedAt: ISODate
}

EditorDocument {
  chapterId: UUID
  blocks: BlockNoteBlock[]
  identityStatus: "valid" | "needs_review" | "external_change"
}

SaveEditorDocumentRequest {
  projectId: UUID
  chapterId: UUID
  expectedContentRevision: positive integer
  blocks: BlockNoteBlock[]
}

ProviderSettingsSummary {
  providerId: string
  endpoint: string
  modelLabel: string
  secretConfigured: boolean
  lastValidatedAt: ISODate | null
}

SaveProviderSecretRequest {
  providerId: string
  endpoint: string
  modelLabel: string
  apiKey: string
}

ProviderConnectionResponse {
  providerId: string
  status: "ok" | "invalid" | "unavailable"
  message: string
}

SaveProjectWorkspaceRequest {
  projectId: UUID
  expectedContentRevision: positive integer
  motivation?: string
  outline?: OutlineItemInput[]
  activeLocation?: WorkspaceLocation
}

WorkspaceLocation {
  section: "motivation" | "outline" | "chapters" | "sources"
  chapterId: UUID | null
  blockId: UUID | null
}

OutlineItemInput {
  id: UUID
  title: string
  summary: string
  status: "not_started" | "in_progress" | "done"
  chapterId: UUID | null
}
~~~

createProject 和 openProjectFromDialog 的绝对路径只存在 main handler 内部；response 不返回 path。saveProjectWorkspace 不是 arbitrary patch，只接受上表列出的三个明确字段，省略字段表示保持原值。

## Launch Home contract

启动页加载 listRecentProjects：

~~~text
loading → ready(empty | with-items)
loading → error
ready → creating → workspace | canceled | error
ready → opening-dialog → workspace | canceled | error
ready → opening-recent → workspace | missing | invalid | error
ready → removing-recent → ready
~~~

available recent card 可以直接打开；missing/invalid card 只能选择移除记录或调用 openProjectFromDialog 重新选择。移除记录不能调用 deleteProject。

## Main-owned validation

- name trim 后 1–120 字符，拒绝控制字符、路径分隔符、跨平台保留名和不稳定尾随空格/句点。
- main 生成 UUID、createdAt、recentId 和 folderName；renderer 不能提交 projectId 以外的路径标识。
- createProject 在用户选择的父目录下创建 name.writellm；同名目录返回 PROJECT_EXISTS，不覆盖。
- openProjectFromDialog 只接受用户选择的目录，必须验证 project.json、kind=writellm.project、format=writellm-folder、schemaVersion、projectId 和必需文件。
- openRecentProject 先读取 main-owned recent record，再重新验证路径和 manifest；recent index 的 name/pathLabel 不作为信任依据。
- open project 必须验证项目内 .git repository；Git 缺失或损坏返回 INVALID_PROJECT_HISTORY，不自动初始化新历史。
- 如果 Git working tree 有外部未提交修改，workspace.externalChanges 为 present 或 needs_review；main 不静默覆盖。
- saveProjectWorkspace 的 expectedContentRevision 必须等于当前 manifest revision；不等时返回 CONFLICT，不执行任何写入。
- saveEditorDocument 的 `blocks` 必须通过 main-owned BlockNote schema/identity validation；BlockNote Markdown lossy helper 不作为保存协议。
- saveProviderSecret 只接受非空 provider id/endpoint/model label 和用户提交的 key；main 不将 key 写入 project root，response 不返回 key。
- testProviderConnection 只使用 main-owned secret store 中的 key；renderer 不能提交任意 Authorization header 或 raw request body。
- projectId/recentId 必须为 UUID；目录路径由 main resolver 得出，不接受 renderer 传 path。

## Sender and path checks

每个 ipcMain.handle handler 必须验证 sender 属于当前应用创建的 BrowserWindow，拒绝未知 webContents。路径选择和文件系统访问必须发生在 main；resolver 必须确保最终项目根是用户选择的目录，并且所有内部文件路径由固定文件名和已校验的 id 组成。

## Responses and errors

成功返回 JSON-compatible DTO；不返回 Error object、Buffer、FileHandle 或绝对路径。

错误使用稳定 code：

| Code | Meaning | Renderer action |
|---|---|---|
| INVALID_INPUT | 请求字段或状态不符合约束 | 标记表单字段并允许修改 |
| PROJECT_EXISTS | 目标父目录已有同名 .writellm 文件夹 | 要求改名或更换位置 |
| NOT_FOUND | recent/project id 不存在 | 刷新列表并提示项目不可用 |
| RECENT_PROJECT_MISSING | 最近路径不存在或无权限 | 保留失效卡片，允许重新选择 |
| INVALID_PROJECT_FOLDER | 所选目录不是有效 .writellm 项目 | 显示 manifest/结构校验错误 |
| INVALID_PROJECT_HISTORY | 项目内 Git repository 缺失或损坏 | 保留项目文件，提供修复/导出入口 |
| EXTERNAL_CHANGES | 检测到项目被外部修改 | 让用户查看、提交或明确丢弃 |
| CONFLICT | expected revision 过期 | 重新打开最新 workspace，避免覆盖 |
| UNSUPPORTED_SCHEMA | 项目格式版本不可读 | 保留文件并提示迁移/升级 |
| STORAGE_RECOVERY_REQUIRED | pending transaction 无法安全完成 | 提供重试、导出诊断或联系支持 |
| STORAGE_ERROR | 文件系统创建/读取/替换/回收站失败 | 不显示保存成功，提供重试 |
| SECRET_STORAGE_UNAVAILABLE | OS secret backend 不可用 | 保留 form，提示用户修复系统 keychain 后重试；不写明文 |
| PROVIDER_AUTH_FAILED | provider 验证失败 | 只显示脱敏错误，允许修改 endpoint/key |

取消 native dialog 返回 canceled result，不创建错误 toast，也不改变 recent index。

## Workspace state contract

~~~text
ProjectWorkspace:
  loaded + clean
  loaded + dirty
  loaded + editor-needs-review
  dirty → saving → clean
  saving → conflict | storage-error
  back-to-home → Launch Home
~~~

## Verification

- contract test 断言 channel 集合和 preload 暴露 method 集合严格相等。
- renderer 测试使用 fake window.writellm，不 mock Node fs。
- smoke test 启动编译后的 Electron，验证 create/open/recent/remove/delete 的实际 main/preload contract。
- storage test 用临时父目录验证任意位置、同名冲突、移动后重新打开、invalid folder 和 recent index 损坏恢复。
- UI/editor contract test 断言 shell regions、panel/modal state、BlockNote stable block ids 和 lossy Markdown 不覆盖 canonical content。
- secret contract test 断言 provider read response 不含 key，save/test 只在 main safeStorage adapter 内使用 secret；backend failure 不生成明文文件。
