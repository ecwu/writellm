# Data Model: AI Provider 设置与密钥状态

ProviderConfig(providerId,label,baseUrl,modelLabel,enabled); SecretState(configured/unavailable/invalid); ValidationResult(status,checkedAt,safeMessage,diagnosticCode)。

## Invariants

- Durable entity 带 kind/schemaVersion，main 在跨边界前验证。
- stable identity、revision、validity 由 domain/main 产生或核验。
- 保存、应用、恢复失败返回结构化错误，不报告成功。
- 第三方库不得写入不可替换的 domain schema；adapter 负责隔离选择。
