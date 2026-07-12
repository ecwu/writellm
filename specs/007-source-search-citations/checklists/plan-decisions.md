# Plan Decisions Checklist: 资料检索与可追溯引用

**Purpose**: 作为“英文单元测试”审查 007 的规划是否足够清楚、完整、可追溯，尤其是尚未拍板的库、平台、跨进程、持久化和运行边界。此清单检查的是 spec/plan 的书写质量，不是代码是否运行。
**Created**: 2026-07-12
**Feature**: [spec.md](../spec.md) · [plan.md](../plan.md) · [research.md](../research.md)

**使用约定**：每个问题在实现授权前都应有明确答案，或显式记录为 Accepted 的 Gap/Decision。`[Decision]` 表示需要拍板，`[Gap]` 表示当前缺少需求/边界，`[Clarity]` 表示已有内容需量化或消歧，`[Traceability]` 表示需要能回指 spec/contract/ADR。

## 决策与治理完整性

- [ ] CHK001 `007` spec 是否已从 Draft 变为 Accepted，并明确该接受状态是实现授权的前置条件？ [Decision, Spec §Status]
- [ ] CHK002 ADR-001 是否已 Accepted，或是否明确新增 ADR 来记录索引介质、runtime cache、provider/worker、迁移和恢复边界？ [Decision, Gap, ADR-001]
- [ ] CHK003 全文/混合检索候选是否已在 SQLite FTS5、Orama、Meilisearch 及辅助 fallback 之间选定，并写明不选其他候选的理由？ [Decision, Gap, research §3]
- [ ] CHK004 向量索引候选是否已在 sqlite-vec、LanceDB 和可重建进程内方案之间选定，并明确 native/服务/内存风险的接受人？ [Decision, Gap, research §4]
- [ ] CHK005 natural-language query 的 embedding 来源是否已选定，并明确 005 provider、Transformers.js、ONNX Runtime 或其他候选的模型/维度兼容策略？ [Decision, Gap, Spec §FR-001, research §5]
- [ ] CHK006 main、worker/utility process、child process 或 local service 的执行位置是否已选定，并说明为何符合最小复杂度原则？ [Decision, Gap, Plan §Architecture]
- [ ] CHK007 依赖的 exact/semver 策略、Electron 43 ABI/native artifact 支持矩阵和 `bun.lock` 更新 cadence 是否已明确？ [Decision, Gap, research §7]

## IPC、数据契约与持久化清晰度

- [ ] CHK008 renderer↔preload↔main 的 named method 是否已冻结，且每个方法的请求、响应、取消/progress 语义没有与 001 project IPC 冲突？ [Decision, Gap, Spec §FR-001–FR-009, contracts/ipc.md]
- [ ] CHK009 IPC DTO 是否明确禁止绝对路径、任意文件内容、generic IPC、provider secret、SQL 和 engine-specific options？ [Clarity, Traceability, AGENTS.md, contracts/ipc.md]
- [ ] CHK010 error code、safe message、retryable 和 details 是否覆盖空 query、无结果、不可引用、索引 stale、provider 不可用、revision conflict 和 recovery-required？ [Completeness, Gap, contracts/ipc.md]
- [ ] CHK011 `Source`、`SourceVersion`、`SourceChunk` 的 ownership、字段、processing state 和 006 输出契约是否已足以让 007 不重新定义 PDF/解析职责？ [Decision, Traceability, Spec §Assumptions, Spec 006 §FR-003–FR-009]
- [ ] CHK012 `SearchIndexEntry` 是否被清楚定义为可重建派生数据，并写明 canonical source、index revision、stale/error/rebuild 关系？ [Clarity, Traceability, Plan §持久化, data-model §2.4]
- [ ] CHK013 index schema、runtime 路径、文件/数据库格式、schemaVersion、migration 和未知版本错误是否已形成可接受的 storage decision？ [Decision, Gap, ADR-001, data-model §5]
- [ ] CHK014 source/chunk/citation 的 hash/fingerprint 算法、规范化、碰撞和版本化规则是否已明确而没有被某个未决库硬编码？ [Decision, Clarity, data-model §2.3, §2.8]
- [ ] CHK015 top-k、limit/cursor、排序稳定性、过滤 AND/OR 及空标签语义是否有可客观解释的契约？ [Clarity, Gap, Spec §FR-001, §FR-003, contracts/ipc.md]

## 引用 identity、失效与跨 feature 追溯

- [ ] CHK016 citation target identity 与正文 block placement 是否明确区分，并能解释同一片段多次出现在不同正文位置的关系？ [Clarity, Spec §Edge Cases, data-model §2.8–§2.9]
- [ ] CHK017 资料替换、资料删除、chunk 内容漂移、locator 漂移、block identity 丢失和正文 revision 冲突是否分别对应 valid/stale/missing/ambiguous/removed 状态？ [Completeness, Spec §FR-008–FR-009, data-model §4]
- [ ] CHK018 rebind 是否明确要求用户选择候选，并定义零候选、单候选、多候选、候选过期和再次保存冲突的规则？ [Clarity, Spec §FR-009, data-model §2.10]
- [ ] CHK019 rebind/remove 是否会保留 snapshot、审计/版本事件和其他 placement，且没有“自动重绑”或“删除整个 target”的歧义？ [Consistency, Spec §Edge Cases, Plan §Phase 4]
- [ ] CHK020 004 的 stable block ID、split/merge、save conflict 和 external edit 语义是否已被 007 contract 明确引用而不是重复发明？ [Decision, Traceability, Spec 004 §FR-005–FR-009]
- [ ] CHK021 008/009/010 消费的 citation/context/status/event DTO 是否已定义版本、失效提示和责任边界？ [Gap, Traceability, Spec 008 §FR-002/FR-008, Spec 009 §FR-002/FR-009]

## 外部服务、凭据、离线与供应链

- [ ] CHK022 外部 provider、local service、worker 和模型是否各自有明确的网络、凭据、数据出境、timeout、retry、cancellation 和错误脱敏要求？ [Gap, Decision, Spec 005 §FR-003–FR-008, contracts/index-provider.md]
- [ ] CHK023 是否明确“完全离线、cache-only、keyword-only fallback、允许远程 fallback”中的产品策略，而不是笼统写成 offline-capable？ [Clarity, Gap, research §5–§6]
- [ ] CHK024 远程 provider 是否明确不会把密钥、绝对路径或未经授权的完整资料发送到 renderer/外部服务，并且 005 是唯一的 secret authority？ [Completeness, Traceability, Spec 005 §FR-002–FR-008]
- [ ] CHK025 第三方包、二进制、模型、telemetry、许可证、SBOM、签名、漏洞升级和撤销策略是否已由负责人接受？ [Decision, Gap, research §2, §3–§7]
- [ ] CHK026 当索引库/模型/服务不可用时，需求是否明确用户看到什么、哪些检索可继续、哪些引用操作必须拒绝？ [Clarity, Exception Flow, Spec §FR-005, §Edge Cases]

## 性能、可访问性与用户体验

- [ ] CHK027 SC-001 的“500 份资料、90% 在 5 秒内”是否定义了 chunk 总量、设备、冷/热状态、p50/p95、超时和“有效搜索”的判定？ [Clarity, Spec §SC-001]
- [ ] CHK028 索引首次建立、增量更新、全量 rebuild、启动恢复和 source replacement 的时间/内存/磁盘阈值是否已量化？ [Gap, Clarity, Plan §Phase 5]
- [ ] CHK029 SC-002/SC-005 的作者耗时口径是否明确了起点、终点、无结果/不可用/重绑分支以及可用性测试对象？ [Clarity, Spec §SC-002, §SC-005]
- [ ] CHK030 空输入、无结果、processing/failed source、重复名称、空标签、缺少 locator/text/representation 的用户提示是否已逐一规定？ [Completeness, Spec §Edge Cases, §FR-005]
- [ ] CHK031 图片、表格、Markdown context 缺失或无法安全展示时，是否有可访问的文本 fallback、缺失说明和不可引用提示？ [Gap, Accessibility, Spec §FR-004]
- [ ] CHK032 键盘焦点、结果/过滤控件名称、loading/no-results/ineligible/stale/rebind/error 状态是否有可测试的可访问性要求？ [Gap, Clarity]
- [ ] CHK033 搜索结果到 context、citation insert、stale warning、rebind/remove 和 save conflict 的信息层级是否保持一致且不把 score 误写成证据可信度？ [Consistency, Spec §FR-002, §FR-007–FR-009]

## 恢复、迁移与验收追溯

- [ ] CHK034 索引缺失、损坏、半成品 rebuild、worker 崩溃、provider 超时和应用退出的恢复路径是否明确，且不覆盖 canonical source/正文？ [Completeness, Recovery Flow, ADR-001, Plan §Cross-Process]
- [ ] CHK035 项目移动、重开、外部 source replacement、外部正文修改和 pending transaction 是否都有明确的引用/index 行为？ [Coverage, Spec §Edge Cases, ADR-001]
- [ ] CHK036 schema migration、未知 schemaVersion、旧 model identity、旧 index revision 和 citation snapshot 的兼容/拒绝规则是否已写清楚？ [Gap, Decision, data-model §5]
- [ ] CHK037 每个 FR-001–FR-009、SC-001–SC-005 是否都能追溯到 data-model 字段/不变量、IPC/provider contract 和 quickstart 场景？ [Traceability, Spec §Requirements, §Success Criteria]
- [ ] CHK038 是否明确只有 spec、ADR、IPC、storage schema、error codes、provider/offline/a11y/性能和恢复决策都 Accepted 后，才生成 tasks.md 并开始实现？ [Decision, Traceability, AGENTS.md, Plan §Phase 5]

## Notes

- 本 checklist 是 requirements/plan quality checklist，不是单元测试、QA 步骤或实现完成度清单。
- 当前所有未选库、协议、版本和平台能力都应继续写作 `NEEDS DECISION`，直到维护者明确接受；不要用打勾替代决策记录。
- 现有 `requirements.md` 保持不变；本文件只补充第一版规划的决策清晰度审查。

