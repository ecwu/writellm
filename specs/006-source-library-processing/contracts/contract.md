# Contract: PDF 资料导入与处理

importSourceFromDialog、startProcessing、getProcessingStatus、retryProcessing、cancelProcessing。原始二进制和绝对路径不跨 preload；状态更新可重放。

Request/response/error 必须有 shared TypeScript 类型和 main runtime validation；禁止 generic IPC、任意路径/命令、secret echo 或未约束外部 response。contract version、DTO、错误码、取消/重试/恢复语义当前为 NEEDS DECISION。
