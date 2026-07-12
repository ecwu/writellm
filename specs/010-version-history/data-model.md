# Data Model: 项目版本历史与恢复

VersionRecord(commitId,parentId,actor,event,timestamp,projectRevision,changedFiles); VersionCompare(from,to,scope,changes); RestorePlan(sourceVersion,scope,invalidCitations,expectedRevision)。

## Invariants

- Durable entity 带 kind/schemaVersion，main 在跨边界前验证。
- stable identity、revision、validity 由 domain/main 产生或核验。
- 保存、应用、恢复失败返回结构化错误，不报告成功。
- 第三方库不得写入不可替换的 domain schema；adapter 负责隔离选择。
