# Data Model: Block 章节编辑器

ChapterDocument(chapterId,title,revision,editorFormat,editorSchemaVersion,blocks); BlockNoteBlock(id,type,props,content,children); CitationMark(citationId,blockId,sourceId,chunkId,range,validity)。

## Canonical document format

章节的 durable truth 是应用包装后的 BlockNote 原生 block document，而不是 Markdown。
应用自己的 wrapper 负责项目身份、章节身份、revision 和 schema 演进；BlockNote 的
`id/type/props/content/children` 负责编辑器结构。Markdown 只作为显式的输入、粘贴和
导出 projection，不能作为恢复章节或恢复引用关系的唯一来源。

```json
{
  "kind": "writellm.chapter.blocknote",
  "schemaVersion": 1,
  "projectId": "...",
  "chapterId": "...",
  "title": "...",
  "revision": 3,
  "editorFormat": "blocknote-json",
  "editorSchemaVersion": 1,
  "blocks": []
}
```

`editorSchemaVersion` 是 WriteLLM 对 BlockNote schema/custom blocks 的兼容版本，不
直接把第三方包版本当作用户数据迁移版本。未知 block type 或 schema 只读显示并进入
needs-review/迁移路径，不静默删除 block。

## Invariants

- Durable entity 带 `kind`/`schemaVersion`，main 在跨边界前验证。
- stable identity、revision、validity 由 domain/main 产生或核验。
- Block identity 使用 BlockNote block id；不得依赖 Markdown 注释恢复稳定标识。
- block 顺序和嵌套关系由 `blocks` 数组与 `children` 表达；不重复保存一套独立的 order truth。
- Markdown 转换允许 lossy 结果；引用关系和高级 block 属性必须以 canonical BlockNote JSON 保存。
- 保存、应用、恢复失败返回结构化错误，不报告成功。
- 第三方库不得写入不可替换的 domain schema；adapter 负责隔离选择。
