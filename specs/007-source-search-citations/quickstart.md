# Quickstart：资料检索与可追溯引用验证

**状态**：验证指南草案；当前仓库尚未实现 007，也没有 feature fixture 或新增 smoke case。下面的命令均使用仓库已有 script，不要求联网安装依赖。

## 1. 前置条件

已具备：

- 本地 Bun、Node 和 Electron foundation 的现有依赖安装状态。
- 当前仓库的 `bun run typecheck`、`bun run test`、`bun run build`、`bun run test:smoke` scripts。
- 已接受的 001 project/workspace storage contract、004 block editor contract、006 source/chunk processing contract，以及接受后的 007 spec/ADR。

仍需准备：

- 一个临时 `.writellm` fixture，包含至少 500 份 source 摘要或可缩小的等价基准集；不能把真实用户项目写入测试。
- 至少三类 source version：`ready + eligible`、`processing/partial`、`failed`；ready fixture 要包含文本、Markdown locator、原始页码、图片和表格 context refs。
- 重名资料、不同 tags、重复/相邻 chunk、被替换的 source version、被删除的 source，以及可用于外部编辑冲突的 block fixture。
- 已冻结的 index/provider adapter。若采用 native package、local service 或本地 model，还需对应的打包 artifact、checksum、cache 和跨平台 smoke fixture。
- 默认离线可运行的 deterministic embedding/search fixture；若允许远程 provider，则需要明确测试凭据、网络许可、超时和数据出境规则。默认测试不得依赖真实互联网。

## 2. 基线命令

在仓库根目录执行：

```text
bun run typecheck
bun run test
bun run build
bun run test:smoke
```

预期：

- `typecheck` 覆盖 shared/main/preload/renderer 的 DTO 和 bridge 类型。
- `test` 覆盖 model invariants、identity、adapter contract、fixture search/rebind 纯逻辑；不得只测 UI 状态。
- `build` 验证选定依赖能被 Electron/preload/renderer 的现有编译链接受。
- `test:smoke` 通过 compiled Electron 启动真实 renderer↔preload↔main，验证 sender validation、IPC envelope、项目 fixture、保存/恢复和安全错误；不得用 mock IPC 代替这个边界。

当前 foundation 只实现 runtime-info，因此在 007 实现前不能把上述命令的绿色结果解释为 feature 已完成。

## 3. 端到端场景 A：关键词与自然语言检索

**Fixture**：

- `source-ready-a` 和 `source-ready-b` 均为 ready/eligible，但资料名可重复且 tags 不同。
- `source-processing`、`source-partial`、`source-failed` 有文本或旧产物，但不满足完整 evidence 条件。
- ready chunks 各自带 parsed Markdown locator、original page/region、图片和表格关联。

**步骤与预期**：

1. 打开 fixture 项目，确认 main 报告 index status 和 canonical source revision；renderer 不能看到绝对路径。
2. 以关键词搜索，结果必须包含资料名称、chunk text、解析后位置和原始位置；高亮/匹配文本不能注入 HTML。
3. 以自然语言或 hybrid mode 搜索；若 query embedding/provider 不可用，应显示 `EMBEDDING_UNAVAILABLE`/`EXTERNAL_PROVIDER_UNAVAILABLE`，不能静默当作关键词结果。
4. 按 source identity 和 tag 过滤；同名资料不可合并，空标签和未知 tag 按已冻结的 contract 语义处理。
5. 搜索 `processing/partial/failed` 中只存在的内容；它们不得成为 `citationEligibility=eligible` 的完整证据。若产品允许诊断性展示，必须明确为 ineligible。
6. 搜索无匹配词和空白 query；前者是明确 no-results，后者是字段错误，不应显示无依据结果。
7. 打开一个 result context；应显示相邻文本、Markdown locator、原始页码和图片/表格 refs。缺失 asset/context 必须有解释性 fallback。

## 4. 端到端场景 B：插入、保存、重开和回链

**Fixture**：一个 004 章节包含多个稳定 block，准备一个有效 search result 和同一 chunk 的第二次引用位置。

1. 从有效 result 请求 `getSourceContext`，再请求 `insertCitation`；main 必须重新验证 source version、chunk provenance、target fingerprint 和 block content revision。
2. 保存成功后，章节应有可识别 citation marker；target identity 记录 source/version/chunk/locator fingerprint，placement identity 记录 block/placement。
3. 关闭并重新打开 fixture 项目，查询 `listBlockCitations`；资料名称、片段/位置和回链仍存在，且 citation target 不依赖旧的 resultId。
4. 把同一 chunk 插入第二个 block；应保留两个 binding/placement，但不产生两个无法区分的 source identity。
5. 在请求期间先修改目标 block，再提交旧 result；应返回 `CONTENT_REVISION_CONFLICT` 或等价需要重载/确认的状态，不能覆盖手动编辑。

## 5. 端到端场景 C：替换、删除、失效和显式重绑

**Fixture**：先建立一条 valid citation，再准备 source replacement：一个候选能通过 fingerprint/locator 对应，一个 replacement 产生多个相似候选，另一个 source 被删除。

1. 替换 source 后重新打开章节；原 binding 必须显示 `stale`，正文不得被静默改写，snapshot 仍可解释原来的资料名称/位置。
2. 删除 source 后重新打开章节；binding 必须显示 `missing`，并提供 rebind 或 remove，而不是返回旧 source 的“有效”状态。
3. 请求 rebind candidate 列表；单候选、零候选、多候选分别显示明确原因。renderer 不能直接提交路径或任意 chunk text。
4. 用户明确选择单个 candidate 后提交 `rebindCitation`；main 校验 candidate、expected status、block revision 和 canonical provenance，保存成功后才回到 valid。
5. 对 ambiguous candidate 不选择自动项；应保留 ambiguous/needs-review。选择 remove 只移除指定 placement，不影响其他 block 对同一 target 的 binding。
6. 在 rebind/remove 保存中模拟 pending transaction、索引损坏或 project revision conflict；系统应进入可恢复错误，不报告正文已成功更新。

## 6. 性能、恢复和无障碍口径

- 以 500 份已处理资料 fixture 测量 SC-001；至少记录冷启动、热查询、首次 index、增量 update、全量 rebuild、关键词、自然语言和过滤查询的 p50/p95。spec 只给出“90% 在 5 秒内”，p95、chunk 总数、内存/磁盘阈值和测量环境仍为 **NEEDS DECISION**。
- 断开网络/删除 model cache/停止 local service/损坏 index 后重启应用，确认状态可解释、canonical source 不损坏、可 rebuild；是否提供 keyword-only offline fallback 需先决策。
- 以键盘完成 query、filter、结果列表、context、citation status、rebind candidate、remove 和 error recovery；焦点、读屏名称、loading/no-results/ineligible/stale 状态需有可验证要求。当前 spec 没有足够细的 a11y acceptance，不能以“能操作”代替。
- `test:smoke` 只覆盖可自动化的 runtime 边界；60 秒定位原始片段、2 分钟完成搜索/过滤/插入等 SC 需要冻结用户测试 protocol，不应伪装成单元测试。

## 7. 依赖准备清单

在实现前由评审者补全并勾选：

- [ ] `007` spec Accepted，`001/004/006` 输入/输出 contract Accepted。
- [ ] ADR-001 Accepted，或新增 ADR 已说明 index/cache/provider/worker/迁移边界。
- [ ] 全文、向量、embedding、worker/service 选型和 exact/lockfile/version policy 已决定；`package.json` 与 `bun.lock` 尚未因为本规划修改。
- [ ] IPC method/DTO/error codes、schemaVersion、hash/model identity、rebind semantics 已 freeze。
- [ ] 离线、credentials、telemetry、网络、license、native artifact 和恢复/升级策略已 freeze。
- [ ] fixture、runtime smoke、性能测量、a11y protocol 可在无联网安装的环境中复现。

