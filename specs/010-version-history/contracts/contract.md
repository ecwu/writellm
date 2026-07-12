# Contract: 项目版本历史与恢复

listHistory、compareHistory、planRestore、applyRestore。renderer 不执行 Git；restore 经过 WriteQueue，保留 pending/recovery，并写入新人工 history record。

Request/response/error 必须有 shared TypeScript 类型和 main runtime validation；禁止 generic IPC、任意路径/命令、secret echo 或未约束外部 response。contract version、DTO、错误码、取消/重试/恢复语义当前为 NEEDS DECISION。
