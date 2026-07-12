# Data Model: Block 章节编辑器

ChapterDocument(chapterId,title,revision,blocks); Block(blockId,type,content,attrs,order,citationMarks); CitationMark(citationId,sourceId,chunkId,range,validity)。

## Invariants

- Durable entity 带 kind/schemaVersion，main 在跨边界前验证。
- stable identity、revision、validity 由 domain/main 产生或核验。
- 保存、应用、恢复失败返回结构化错误，不报告成功。
- 第三方库不得写入不可替换的 domain schema；adapter 负责隔离选择。
