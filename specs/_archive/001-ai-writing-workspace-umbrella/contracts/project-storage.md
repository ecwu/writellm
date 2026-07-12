# Contract: portable project storage and Git history

## Canonical paths

~~~text
<userData>/WriteLLM/
└── recent-projects.json

<user-selected-parent>/<project-name>.writellm/
├── .git/
├── .gitattributes
├── .gitignore
├── project.json
├── ui-state.json
├── content/
│   ├── motivation.md
│   ├── outline.json
│   ├── citations.json
│   └── chapters/<chapterId>/
│       ├── chapter.json
│       └── chapter.md
├── sources/
│   ├── <sourceId>/
│   └── processing-events.ndjson
├── ai/
│   ├── tasks/
│   └── proposals/
└── runtime/
    ├── pending/
    └── search-index/
~~~

project-name.writellm 是创建时的默认文件夹名，不是项目身份来源。项目可以在文件管理器中移动；打开时以 manifest.id 作为身份，.git 也随项目移动。

## Creation invariant

createProject 必须：

1. trim 和验证 name；
2. 由 main 打开 native directory dialog，获得用户选择的父目录；
3. 生成 projectId 和 name.writellm 目标目录；
4. 检查目标目录不存在；存在则返回 PROJECT_EXISTS；
5. 在同一父目录下创建随机临时目录；
6. 写入 manifest、ui-state、空 motivation、空 outline、空 citations、.gitattributes 和 .gitignore；
7. 在临时项目根初始化本地 Git repository；
8. 写入初始 human Git commit，commit message 带 WriteLLM-Actor、WriteLLM-Event 和 WriteLLM-Content-Change trailers；
9. 将临时目录 rename 为最终 .writellm 目录；
10. 在 userData recent index 写入/更新 recent record；
11. 返回 workspace。

任一步失败时不得留下可见半项目或成功 recent record；错误中包含 stable code 和可重试建议。

## Open invariant

openProjectFromDialog 和 openRecentProject 都必须：

1. 在 main 内获得目录路径；
2. 读取 project.json 并验证 kind、format、schemaVersion、id 和必需文件；
3. 验证 .git 是以该目录为 work tree 的有效 repository；
4. 检查 runtime/pending transaction 和 Git working tree 状态；
5. 读取 Markdown/JSON workspace DTO；
6. 成功后以 manifest.id 合并 recent record，并更新 lastOpenedAt；
7. 只返回不含绝对路径的 workspace DTO。

recent index 的 displayName、folderName 和 pathLabel 不能替代 manifest 或 Git validation。

如果检测到外部未提交修改，不能静默覆盖；workspace 返回 externalChanges 状态，让用户查看、提交为 human event 或明确丢弃。

## Save invariant

saveProjectWorkspace 是按 project 串行化的 main-owned transaction：

1. 校验 project id、expected revision 和 payload；
2. 将 motivation/outline/chapter Markdown 和 JSON 写入同目录 temp files，再以 rename 替换；
3. 计算 new revision，并将 contentRevision 写入待提交的 project.json；
4. 将明确变更的路径（包括 project.json）加入 Git index；
5. 创建 Git commit，commit message 必须包含：

~~~text
WriteLLM-Actor: human | model | system
WriteLLM-Event: content | task | processing | metadata
WriteLLM-Content-Change: true | false
WriteLLM-Project-Revision: <revision>
WriteLLM-Task-ID: optional
WriteLLM-Proposal-ID: optional
~~~

6. 仅当 Git commit 成功时确认 project.json.contentRevision 已成为最新稳定 revision；
7. 清理 runtime/pending transaction；
8. 更新 recent record 的 displayName/folderName/lastOpenedAt；
9. 返回新的 workspace DTO。

Git commit 失败时不得向 renderer 报告保存成功；保留工作树和 pending 状态，允许 main 在下次操作中 retry/recover。不要使用 git reset --hard 覆盖用户内容。

## Git tracking policy

Tracked:

- project.json、content/**/*.md、content/**/*.json；
- sources 的 source.json、parsed.md、chunks.jsonl、原始 PDF 和图片；
- ai tasks/proposals；
- sources/processing-events.ndjson。

Ignored or rebuildable:

- runtime/；
- sources/embeddings/ 和 search-index/；
- 同目录临时文件、crash recovery scratch files。

.gitattributes 至少声明 UTF-8 Markdown/JSON/JSONL 为 text、LF 为 canonical newline，并将 PDF、图片、f32 embedding 标为 binary；Git 官方支持用 attributes 控制 text/binary diff 行为。

## Markdown block identity

章节正文以 Markdown 为 canonical content。block 和 citation identity 使用不可见 HTML comments，例如：

~~~text
<!-- writellm:block id="block-uuid" type="paragraph" -->
普通 Markdown 文本。
~~~

main 的 markdown-codec 负责解析和验证 id。id 缺失、重复或被外部编辑破坏时，标记 externalChanges/needsReview，不能静默重绑定引用。

## Recent index invariant

recent-projects.json 是 app-owned cache：

- 最多保留 12 条，按 lastOpenedAt 倒序。
- 路径只由 main 写入和读取；renderer 只拿到 recentId 和显示摘要。
- 路径不存在或无法读取时标记 missing/invalid，不自动删除。
- removeRecentProject 只修改 index，不触碰 project root。
- 打开移动后的项目时，以 projectId 合并旧记录，避免重复卡片。
- index 损坏时备份坏文件、返回空列表或恢复错误，但不修改任何 .writellm 项目。

## Version semantics

- contentRevision 代表已保存的 project content，Git initial commit 建立 revision 1。
- 打开、列表读取和 ui-state 更新不产生 content-change commit。
- 人工保存动机/大纲/章节/block/citation 产生 human content commit。
- 被接受的 AI proposal 产生 model content commit，并连接 task/proposal/source references。
- 失败/取消的 AI task 可以产生 task event commit，但 WriteLLM-Content-Change 必须为 false。
- 资料 parse/chunk/embed/reindex 产生 processing event commit 或 event file，不伪装成正文修改。
- 恢复旧版本使用 git restore --source=<commit> -- <paths> 写入工作树，然后创建新的 human content commit；不删除、覆盖或改写旧 commits。

## Delete semantics

removeRecentProject 是非破坏操作，只移除启动页卡片。deleteProject 必须由 main 根据已验证的 projectId 解析项目根，确认 manifest 和 .git 有效后调用 Electron trash API；成功后从 recent index 移除，失败时目录和记录均保持不变，并返回 STORAGE_ERROR。

## Recovery semantics

- 临时项目目录、临时文件和 runtime/pending transaction 不参与正常 recent list。
- open 前先检查 pending transaction 和 Git repository health。
- 如果工作树文件已完整写入但 commit 未完成，按 pending record 重试或保留为 externalChanges，不覆盖文件。
- 如果 Git repository 损坏，不自动初始化新 history；返回 STORAGE_RECOVERY_REQUIRED，保留项目正文并提供修复/导出入口。
- 如果状态混合且无法安全判断，不覆盖任何文件，返回 STORAGE_RECOVERY_REQUIRED。
