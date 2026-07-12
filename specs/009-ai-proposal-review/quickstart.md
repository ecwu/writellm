# AI 提案审阅 Quickstart

**目的**：在实现完成后，用仓库已有 Bun scripts 验证“读取提案 → 逐项/批量审阅 → 过期/冲突检测 → 原子应用 → 重启恢复”的完整边界。
**当前状态**：仅 startup foundation 已存在；以下场景是实现完成后的可执行验收，不代表本轮已经有 proposal fixture 或 runtime recovery。

## 前置准备

实现前必须先完成：

1. 接受 `009` spec、`001` storage ADR、`004`/`007`/`008` contracts，并确认提案审阅 owner 统一为 `009-ai-proposal-review`。
2. 冻结 `contracts/` 中的 IPC DTO、error codes、proposal/storage envelope、Block identity、content revision、source validity 和 `010` history handoff。
3. 准备一个临时 `.writellm` fixture project，包含：
   - 一个 chapter 和至少三个 stable Blocks；
   - 一份带两个互不重叠 change 的已完成 proposal；
   - 每个 change 的原文、建议、意图、一个 valid evidence 和一个 insufficient/invalid evidence；
   - 可重放的 baseProjectRevision/baseBlockFingerprints；
   - 一份可观察的 project revision/history fixture。
4. 准备故障注入能力：在 files replaced 前、files replaced 后、history handoff 前后分别模拟可控失败；不能通过真实破坏用户项目来验证 recovery。
5. 确认 selected storage/diff/schema candidates、版本和 license policy。不要为了 quickstart 临时安装候选包。
6. provider 不需要联网：009 应使用 008 产出的 fixture proposal；外部服务、凭据、离线 fallback 属于 005/008，若验收要求联网 provider 必须另行定义凭据隔离和网络失败场景。

## 基线命令

在仓库根目录运行：

~~~sh
bun run typecheck
bun run test
bun run build
bun run test:smoke
~~~

预期：四条命令均以退出码 0 完成；`test:smoke` 必须针对编译后的 Electron/preload，不得只检查 renderer 静态文件。`bun run test:all` 可作为合并前快捷入口，但它会重复 build/smoke，不能替代下面的针对性场景。

不执行任何联网依赖安装作为本验证的一部分；若某候选依赖尚未进入锁文件，该场景应先标为决策/准备失败，而不是临时安装。

## 场景 A：查看 diff 与资料依据

**Fixture**：proposal 有三个 change：一个 supported replace、一个 evidence insufficient replace、一个 delete。

1. 启动应用并打开 fixture project。
2. 从 proposal review 入口读取 proposal。
3. 对每个 change 查看 target chapter/block、original、suggested、intent、evidence/insufficient 提示。
4. 用键盘在 change 列表、diff detail、evidence link、decision actions 间移动。

**预期**：

- original 与 suggested 可区分，target stable ID 以用户可理解的章节/Block 摘要呈现；
- evidence 不足不会被标成已验证事实；
- diff added/removed/blocked 语义不只依赖颜色；
- renderer 只收到脱敏 DTO，不显示绝对路径、secret 或 provider raw response；
- 对应 `FR-001`、`FR-002`、`SC-001` 和 accessibility 决策项。

## 场景 B：逐项决定与部分审阅

**Fixture**：三个 pending changes。

1. 接受 change-1，拒绝 change-2，暂缓 change-3。
2. 离开 proposal，再次打开。
3. 只选择 change-1 做 apply；也可先分别持久化 decision，再调用 apply contract。

**预期**：

- change-1 成功应用后正文只出现 change-1；
- change-2 的 rejection 保留，正文没有建议文本；
- change-3 仍可继续审阅；
- proposal review state 和正文 content revision 的变化边界可解释；
- 对应 `FR-003`、`FR-005`、`FR-006`、`SC-002`、`SC-004`。

## 场景 C：过期提案保护

**Fixture**：proposal 生成后，直接在 project fixture 中修改目标 Block，使当前 fingerprint/revision 不同。

1. 打开旧 proposal。
2. 读取 review snapshot 和 apply preview。
3. 尝试 apply 原 change。

**预期**：

- main 返回 `STALE_PROPOSAL` 或明确的 `CONTENT_REVISION_MISMATCH`，并列出受影响 change ID；
- 正文不被旧建议覆盖，current revision 不回退；
- UI 要求重新确认或重新生成；不得静默三方合并；
- 对应 `FR-007`、`SC-003`。

## 场景 D：重叠、无法定位和失效资料

准备三类 change：同一 Block 重叠、被删除 Block、source snapshot 已失效。

1. 打开 proposal 并执行 preview。
2. 选择含有冲突的 batch。
3. 观察 blocked reason 和可继续的人工处理路径。

**预期**：

- 返回 `CONFLICTING_CHANGES`、`TARGET_NOT_FOUND`、`SOURCE_INVALID` 的稳定错误/状态；
- 冲突 change 不自动排序、覆盖或绑定到相邻 Block；
- 部分处理不会静默丢掉未处理 change；
- 对应 `FR-008`、Edge Cases 和 007 citation boundary。

## 场景 E：批量接受的原子应用

**Fixture**：change-1 和 change-2 互不重叠且均为 accepted；第三个 change 保持 pending。

1. 预览 batch。
2. 调用 `applyAcceptedProposalChanges`。
3. 重新读取正文、proposal、content revision 和 history handoff fixture。

**预期**：

- 正文只包含 change-1/change-2；
- pending change-3 仍存在且未自动应用；
- content revision 只按一次成功 batch 递增；
- taskId、proposalId、source refs 和 affected Block 关联保留；
- 010 可消费一个 model content event，而不是多个无法解释的碎片事件；
- 对应 `FR-004`、`FR-005`、`FR-009`、`SC-002`。

## 场景 F：批次内失败和恢复

**Fixture**：在同一 apply batch 中让一个 selected change 触发可控写入或 history handoff failure。

1. 调用 apply。
2. 在每个故障注入点终止/返回失败。
3. 重启应用并重新打开 project。
4. 读取 recovery status，执行已批准的 retry/cleanup 流程。
5. 比较 before/after content hash、proposal states、revision 和 history event。

**预期**：

- apply 失败不返回正文已成功保存；
- 若 batch 未完成，selected change 不出现虚假的 applied；结果明确给出 applied/pending/blocked IDs；
- pending transaction 能被 main 检出；可判定状态只 retry/cleanup，ambiguous 状态返回 `STORAGE_RECOVERY_REQUIRED`；
- 恢复前不覆盖可读正文，不静默丢失已保存的手动编辑；
- 恢复成功后才出现 applied state 和 history event；
- 对应 `FR-010`、`SC-005`、ADR-001 transaction/recovery 边界。

## 场景 G：Electron 跨进程与安全 smoke

在 compiled build 上运行 `bun run test:smoke`，并在实现后的 runtime fixture 中扩展 smoke：

1. renderer 调用 `getProposalReview` 和 `previewProposalApply`；
2. preload 只使用显式 named wrapper；
3. main 对正常 request、错误 projectId、过期 revision、未知 changeId 和非允许 sender 分别返回 DTO/error；
4. 尝试发送绝对路径、任意 channel、raw patch、secret-like text 和超长 payload。

**预期**：

- 正常 request 能跨 renderer→preload→main→fixture storage 往返；
- 非法 request 在 main 被拒绝；
- preload 不暴露 generic IPC；
- `contextIsolation`、`nodeIntegration`、`sandbox` 等基线仍保持；
- 结果映射不依赖 Electron 原始 Error class。

## 场景 H：性能和可访问性基线

在最终决策确定规模后，使用小/中/上限三档 fixture 记录：

- proposal load；
- diff/analysis；
- preview；
- apply；
- recovery scan；
- renderer first meaningful review view。

阈值、取消语义、最大 proposal/Block/batch、内存预算必须先写进 `checklists/plan-decisions.md` 并接受后再判定 pass/fail。可访问性至少记录键盘顺序、focus return、状态 announcement、diff 的非颜色表达、冲突/失败/成功的可读文本。

## 当前仍需准备的 runtime/fixture/external dependency

- 当前源码没有 `src/main/proposals/`、proposal storage、Block editor 或真实 history owner；
- 当前 smoke 只检查 runtime info 和 compiled preload，尚未覆盖 proposal IPC；
- 当前没有测试 fixture、故障注入 seam、recovery journal、外部编辑模拟；
- diff viewer、schema validator、atomic write helper、Git runtime/SQLite 均未选定、未安装；
- 009 本身不需要 provider 网络，但 008→009 的 completed proposal fixture 和 005/008 的 credential/offline boundary 必须先冻结；
- 只有这些准备项完成并由决策 checklist 关闭后，才可把上述命令结果作为 feature implementation 的验收证据。
