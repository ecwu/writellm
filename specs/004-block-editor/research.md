# Research: Block 章节编辑器

本轮将编辑器技术与产品需求分开：PRD 描述可编辑内容块、常见 Markdown 语法输入/粘贴
和 Markdown 导出；实现层选择 BlockNote 作为 block editor，并把它的原生 JSON 作为
章节 canonical document。Markdown 不作为 durable source of truth。

## Decision: BlockNote editor adapter

**Decision**: 采用 BlockNote 作为 004 的编辑器实现，使用其 block document、稳定 block
id、扩展 block schema 和 React adapter。精确 package 版本、UI package、bundle/license
审查和 Electron 40/Bun 兼容性在实现前锁定，但不再把 Tiptap、Lexical 或其他编辑器
当作本 feature 的并行实现候选。

**Rationale**:

- BlockNote 的模型直接以 block、children、props 和 stable id 表达本 feature 的核心
  用户行为。
- 官方建议将 `editor.document` 的 BlockNote JSON 用作 durable、lossless storage。
- BlockNote 的 Markdown 能力适合作为常见 Markdown 语法的输入/粘贴和导出互操作，不
  适合作为所有 block、props、引用关系的完整持久化格式。

**Alternatives considered**:

- Tiptap/ProseMirror、Lexical：仍可完成 block editing，但不符合当前明确的 BlockNote
  产品技术方向；不再作为 004 的实现候选。
- 自定义 JSON domain model + editor codec：会制造第二套与 BlockNote 平行的 block
  schema，增加同步和迁移风险；只保留 WriteLLM wrapper，不复制一套独立 block truth。

## Decision: Canonical storage and Markdown interop

**Decision**: `ChapterDocument` 保存 WriteLLM wrapper + BlockNote JSON。Markdown 通过
显式 adapter 进行 `import/paste/export`；导出必须允许 lossy warning，不能用 Markdown
恢复 block identity、引用位置或高级 block props。

BlockNote 官方格式表将 BlockNote JSON 标为 lossless storage，并将 Markdown import/export
标为 lossy。常见 CommonMark/GFM 子集可支持；超出范围的扩展语法需要明确降级或提示。

**Alternatives considered**:

- Markdown canonical + HTML comments：拒绝；BlockNote 特有结构和稳定 block id 不能可靠
  通过 Markdown comments 维持 round-trip。
- 同时把 BlockNote JSON 和 Markdown 作为可编辑真相：拒绝；会产生双向同步、revision
  冲突和外部修改归属不清的问题。

## Decision: Storage adapter boundary

**Decision**: 004 只依赖 main-owned `ChapterDocumentStore`/repository contract。第一版
可以使用项目内 JSON 文件，也可以在后续接受 storage ADR 后使用项目内 SQLite；无论
物理介质如何，canonical payload、schemaVersion、revision、迁移和 atomic save 语义
保持一致。renderer/editor adapter 不接触文件路径、数据库连接或 raw persistence API。

**Rationale**: BlockNote 不是 Markdown 存储，并不自动意味着必须使用数据库。先冻结
逻辑文档 contract，可让文件存储与数据库存储成为可替换实现。

## Decision: Identity, citations and migration

- 稳定 block identity 使用 BlockNote block id；不再设计 Markdown identity comment grammar。
- CitationMark 以结构化关系保存 `blockId/sourceId/chunkId/range/validity`；Markdown
  导出只生成面向用户的标记，不承担引用恢复。
- `schemaVersion`/`editorSchemaVersion` 是 WriteLLM 的迁移边界；BlockNote package
  version 只作为运行时兼容信息，不直接等同于 durable schema version。
- 未知 block type、损坏 payload、缺失 id 和重复 id 进入只读/needs-review/recovery
  路径，不静默删除或重绑定。

## Sources

- [BlockNote format interoperability](https://www.blocknotejs.org/docs/foundations/supported-formats)
- [BlockNote document structure](https://www.blocknotejs.org/docs/foundations/document-structure)
- [BlockNote HTML/export guidance](https://www.blocknotejs.org/docs/features/export/html)
- [BlockNote server-side processing](https://www.blocknotejs.org/docs/features/server-processing)
- [Project storage ADR](../../docs/adr/001-project-storage.md)
- [AGENTS.md](../../AGENTS.md)

## Remaining acceptance gates

技术方向已经选为 BlockNote + BlockNote JSON canonical storage。实现前仍需接受：
BlockNote package/version/UI adapter、ChapterDocument schema、Markdown lossy policy、
引用 anchor、revision/conflict/recovery contract，以及实际 Electron runtime smoke。
