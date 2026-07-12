# Contract: Block 章节编辑器

`loadChapter`、`validateChapter`、`applyBlockCommand`、`saveChapter` 和显式的
`exportChapterMarkdown`。main 负责 BlockNote document wrapper 的校验、revision、
transaction 和持久化；editor adapter 不接触文件路径或数据库连接。

`loadChapter`/`saveChapter` 的 canonical payload 是带 `kind`、`schemaVersion`、
`chapterId`、`revision`、`editorFormat: "blocknote-json"` 和 BlockNote blocks 的
ChapterDocument。Markdown 只通过 `exportChapterMarkdown` 或明确的 import/paste flow
进入转换边界；不能用 Markdown 文本替代 canonical payload。

Request/response/error 必须有 shared TypeScript 类型和 main runtime validation；禁止
generic IPC、任意路径/命令、secret echo 或未约束外部 response。Markdown export 的
lossy warning、未知 block type、schema migration、错误码、取消/重试/恢复语义必须在
实现前冻结。
