# Cordis 重构阶段细化设计(中文稿)

本目录是 [`../implementation-plan.md`](../implementation-plan.md) 的逐阶段细化设计,与
[`../target-architecture.md`](../target-architecture.md) 和
[ADR 045](../../adrs/045-isolated-cordis-agent-replacement.md) 配套阅读。

约定:

- 每份文件对应一个 reform stage(R0–R9),内容为该阶段的目标、范围、设计细节、工作项、
  测试计划、验收门槛、回滚与风险。
- 中文为工作语言;标识符、service key、事件名、文件路径、表名保持英文。
- 阶段细化稿是**设计文档**,不是交付证据。阶段被接受并开始实施后,实施证据仍按仓库规则写入
  `docs/implementation-todo/` 的 Phase 文件,本目录文件只在设计修订时更新。
- 若细化稿与 `target-architecture.md` 冲突,以更新后的架构文档为准,并同步修订本目录。
- 每个阶段顶部的"上游引用"列出设计所依据的 cordis / DeepSeek Harness 源码与文档位置
  (固定 commit 见 `docs/audits/2026-08-14-cordis-and-deepseek-harness-prestudy.md`)。

## 阶段索引

| 文件 | 阶段 | 状态 |
| --- | --- | --- |
| [r0.md](r0.md) | R0 — 接受并冻结架构 | 设计稿 |
| [r1.md](r1.md) | R1 — Cordis 基座与 conformance | 设计稿(已核对 cordis 源码) |
| [r2.md](r2.md) | R2 — 独立进程骨架与引擎 shell | 设计稿 |
| [r3.md](r3.md) | R3 — 持久会话纵切 | 设计稿(已核对 dsh 源码) |
| [r4.md](r4.md) | R4 — 引擎中立产品权威 | 设计稿 |
| [r5.md](r5.md) | R5 — 上下文、读工具、Skills 与确定性检查 | 设计稿(已核对 dsh 源码) |
| [r6.md](r6.md) | R6 — 协作、提案、审批与图像生成 | 设计稿 |
| [r7.md](r7.md) | R7 — 运营与 UI 平价 | 设计稿 |
| [r8.md](r8.md) | R8 — 默认切换与删除资格 | 设计稿 |
| [r9.md](r9.md) | R9 — 删除 Pi | 设计稿 |

R1/R3/R5 三份稿件的 API 级细节已就 cordis fork 与 dsh 固定 commit 的源码复查修订
(预研文档之外新增的一次核对,结论已并入各稿)。
