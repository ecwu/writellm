# Contract: AI Provider 设置与密钥状态

getProviderSummary、saveProviderConfig、replaceProviderSecret、validateProvider。secret 仅一次性进入 main；response 只含 redacted summary/status。

Request/response/error 必须有 shared TypeScript 类型和 main runtime validation；禁止 generic IPC、任意路径/命令、secret echo 或未约束外部 response。contract version、DTO、错误码、取消/重试/恢复语义当前为 NEEDS DECISION。
