# Contract: Block 章节编辑器

loadChapter、validateChapter、applyBlockCommand、saveChapter。main 负责 canonical codec、revision、transaction；editor adapter 不接触文件路径。

Request/response/error 必须有 shared TypeScript 类型和 main runtime validation；禁止 generic IPC、任意路径/命令、secret echo 或未约束外部 response。contract version、DTO、错误码、取消/重试/恢复语义当前为 NEEDS DECISION。
