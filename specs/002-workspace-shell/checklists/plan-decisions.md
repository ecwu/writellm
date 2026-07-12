# Planning Decisions Checklist: 写作工作台外壳

**Purpose**: 检查工作台外壳的需求、规划、契约和未决决策是否足够清晰，可在实现前被评审和接受；这些是“需求文字的单元测试”，不是代码或运行行为测试。
**Created**: 2026-07-12
**Feature**: [../spec.md](../spec.md)
**Related plan**: [../plan.md](../plan.md)

**使用说明**：每项都应针对 spec/plan/contract 的文字质量回答“是/否/待补充”。`[Decision]` 表示必须由用户/维护者拍板；`[Gap]` 表示缺少要求或边界；`[Clarity]` 表示已有内容需要量化或消歧；`[Traceability]` 表示需要能追溯到 spec、ADR 或 contract。

## Decision readiness

- [ ] CHK001 是否已经在 [research.md](../research.md) 的浮层/焦点候选 A/B/C 中选定一个实现方向、准确包名和版本策略，而不是把候选误读成已批准依赖？ [Decision, Gap, Plan §Technical Context]
- [ ] CHK002 是否已经明确状态编排采用 React built-ins、候选状态库或 state machine，并说明为什么该复杂度与 Spec §FR-004/FR-005/FR-008 相称？ [Decision, Clarity, Plan §Complexity Tracking]
- [ ] CHK003 是否已经明确样式/布局采用现有 CSS、CSS Modules 或 design-system package，并记录 token、portal、focus ring 和响应式责任？ [Decision, Gap, Plan §Phase 2]
- [ ] CHK004 是否已经确定 DOM/a11y 与 Electron runtime 的测试 harness、版本锁定方式及 React 19/Bun/TypeScript 兼容性验证方式？ [Decision, Traceability, Quickstart §当前仍需准备的能力]
- [ ] CHK005 是否已经接受、修订或明确暂缓 `docs/adr/001-project-storage.md`，并判断 shell UI preference 是否需要新增 ADR？ [Decision, Gap, Plan §Phase 1]
- [ ] CHK006 是否已经确认 `001-project-foundation` 的 project/open/save DTO、revision、错误码和恢复语义可以被本 feature 依赖？ [Decision, Traceability, Spec §Assumptions]
- [ ] CHK007 是否已经记录各项技术选择的 exact version、升级策略、许可审查、Bun lockfile 影响和回滚方式？ [Decision, Gap, Research §兼容性与版本策略记录]

## Scope and ownership clarity

- [ ] CHK008 是否清楚区分当前 startup foundation（BrowserWindow、单一 runtime IPC、foundation renderer）与计划新增的 shell 文件和行为？ [Clarity, Traceability, Plan §已有基础与计划新增]
- [ ] CHK009 是否明确 shell 只提供导航、工具入口、editor slot、状态区、面板和模态边界，而不实现 003/004/005 的业务逻辑？ [Traceability, Spec §Scope, Plan §Phase 2]
- [ ] CHK010 是否为每个未来 feature panel 定义 owner、注册方式、可用/禁用/隐藏条件和可访问名称来源？ [Gap, Clarity, Data model §PanelDescriptor]
- [ ] CHK011 是否明确“持久工作台外壳”指稳定 mounted shell 还是跨重启保存布局偏好，并与 Spec §FR-001 和 data-model 的 session/durable 区分一致？ [Clarity, Gap, Spec §User Story 1]
- [ ] CHK012 是否明确 project summary、editor context 和 status 的字段归属，避免 shell 重新定义项目、章节、provider 或历史实体？ [Traceability, Plan §跨进程与持久化边界]
- [ ] CHK013 是否说明 panel、modal、editor slot 和 status region 的 DOM/语义容器边界，以便后续 feature 不必复制壳层？ [Clarity, Gap, Traceability, Contract §Shell regions]

## IPC, storage schema and errors

- [ ] CHK014 是否已经冻结 IPC contract 的方法名、request/response DTO、错误码、取消/重试语义和 sender validation，而不是只写“通过 IPC”？ [Decision, Gap, Contract §Proposed method inventory]
- [ ] CHK015 是否已经明确 `getRuntimeInfo` 是否保持唯一 foundation method，以及任何新增 window/project method 的最小权限和理由？ [Decision, Traceability, Contract §Existing method]
- [ ] CHK016 是否已经冻结 shell status code 与 001/storage/editor/provider 底层错误的映射，包含 `SAVE_FAILED`、`STORAGE_RECOVERY_REQUIRED`、external change 和 unknown 行为？ [Decision, Gap, Data model §WorkspaceErrorNotice]
- [ ] CHK017 是否已经定义 safe error message 的禁止内容（绝对路径、密钥、raw stack、完整文件内容）及安全脱敏责任？ [Clarity, Traceability, Contract §Error contract]
- [ ] CHK018 是否已经冻结 `ui-state.json`/相关 durable schema 的 `kind`、`schemaVersion`、`projectId`、字段 owner、未知版本、迁移、损坏恢复和 Git/revision 边界？ [Decision, Gap, ADR-001 §Make writes recoverable and main-owned]
- [ ] CHK019 是否已经明确 active panel、active modal、focus origin、layout mode、selection/scroll context 哪些永不持久化，哪些若持久化必须经 ADR？ [Decision, Clarity, Data model §持久化候选与未决边界]
- [ ] CHK020 是否已写明 shell 不接收 path/secret/DOM ref/raw content，也不通过 local store 覆盖 main 返回的 project/storage truth？ [Traceability, Contract §Security requirements]

## Interaction and accessibility requirements

- [ ] CHK021 是否明确同一时刻只能有一个 active panel，以及打开、切换、再次点击、Escape、outside click 的优先级和冲突处理？ [Clarity, Traceability, Spec §FR-004/FR-009]
- [ ] CHK022 是否为每种 modal 内容明确初始焦点、Tab/Shift+Tab 范围、Escape、显式关闭、outside click 和关闭后焦点 fallback？ [Completeness, Clarity, Spec §FR-005]
- [ ] CHK023 是否明确何时禁止 outside click/Escape（例如未保存或破坏性操作），以及用户如何完成安全取消，而不是依赖库默认值？ [Gap, Decision, Contract §Interaction guarantees]
- [ ] CHK024 是否明确 modal 背景的 inert/aria-modal/scroll-lock 行为，并区分视觉遮罩与真正不可误操作？ [Clarity, Traceability, WAI-ARIA APG reference in Contract]
- [ ] CHK025 是否为所有 icon-only 入口、面板、modal、status、错误 action 定义 accessible name、可见文字/tooltip、heading/description 和 live-region 策略？ [Completeness, Gap, Spec §FR-006/FR-008]
- [ ] CHK026 是否明确键盘用户完成“打开、浏览、关闭一个面板”的可达路径、焦点顺序和窄窗口下仍可发现的文字提示？ [Clarity, Traceability, Spec §SC-003/FR-007]
- [ ] CHK027 是否明确状态不能只用颜色表达，并定义 saving/saved/error/needs-action 的文字、图标、语义 role 和可执行下一步？ [Clarity, Traceability, Spec §FR-008/User Story 3]
- [ ] CHK028 是否覆盖 panel/modal 打开期间发生重要错误或未保存变化时的发现、公告和不打断编辑流规则？ [Completeness, Gap, Spec §User Story 3 scenario 3]

## Responsive, performance and platform boundaries

- [ ] CHK029 是否将 960×640 的“主要入口可访问”具体化为区域、控件、滚动和错误入口的可客观判断，而不是笼统的“响应式”？ [Clarity, Acceptance Criteria, Spec §SC-005]
- [ ] CHK030 是否定义“保持编辑上下文”同时包括内容、selection、scroll position、focus 和 editor node identity，并说明 100 次切换的可测量范围？ [Clarity, Traceability, Spec §SC-002/FR-003]
- [ ] CHK031 是否已经决定首屏、panel switch、status update、focus return 的性能阈值，或明确本轮不设置这些阈值及其后续 owner？ [Decision, Gap, Plan §Technical Context Performance Goals]
- [ ] CHK032 是否明确 Electron 原生 min size、renderer CSS breakpoint、DPI、macOS/Windows/Linux 和 Wayland 限制的责任边界？ [Completeness, Traceability, Research §决策区块 E]
- [ ] CHK033 是否明确是否需要 native `setMinimumSize`/`setSize` IPC；如果不需要，是否把当前 1200×800/960×640 作为 foundation 前提而非新增 feature？ [Decision, Clarity, Contract §Proposed method inventory]

## Failure, recovery and dependencies

- [ ] CHK034 是否为保存中、已保存、保存失败、需要恢复、外部变更和 owner unavailable 定义互不矛盾的状态转换与展示边界？ [Completeness, Clarity, Data model §WorkspaceStatus]
- [ ] CHK035 是否明确 retry/recover action 的 owner、actionId 白名单、revision/transaction 检查和失败后的再次展示规则？ [Decision, Traceability, Contract §Owner/action boundary]
- [ ] CHK036 是否明确 shell 在 project snapshot 无效、schema 不支持、pending transaction、存储失败或 IPC rejection 时的恢复/重新选择边界？ [Gap, Traceability, Quickstart §场景 5]
- [ ] CHK037 是否明确本 feature 的离线策略、外部服务/worker/凭据依赖和“provider 真实连通性不在 scope”的理由？ [Clarity, Gap, Plan §Constraints/quickstart]
- [ ] CHK038 是否准备了不依赖真实 provider 的 project/editor/status fixtures，并定义 fixture 不得替代 001/004 真实 contract 的边界？ [Traceability, Gap, Quickstart §前置条件]
- [ ] CHK039 是否定义窗口关闭、项目切换、未保存 panel/modal、owner action in-flight 时的恢复/取消/迁移规则？ [Completeness, Gap, Spec §Edge Cases]
- [ ] CHK040 是否明确 schema migration、recent/project movement、external edit 与 shell session state 的责任归属，避免把 storage recovery 隐藏在 renderer？ [Decision, Traceability, ADR-001 §Make writes recoverable and main-owned]

## Acceptance and traceability

- [ ] CHK041 是否能从每个 Spec §FR-001–FR-009 追溯到 plan phase、data-model rule、contract clause 和 quickstart scenario？ [Traceability, Gap]
- [ ] CHK042 是否能从 Spec §SC-001–SC-005 追溯到可接受的测量方法、fixture/runtime 前提和失败时的解释，而不是只写“人工观察”？ [Clarity, Acceptance Criteria, Spec §Success Criteria]
- [ ] CHK043 是否明确哪些验证使用 `bun run typecheck/test/build/test:smoke`，哪些必须真实 Electron runtime，哪些不能由静态/DOM 测试替代？ [Traceability, Contract §Verification strategy in Plan]
- [ ] CHK044 是否在实现前把所有 `NEEDS DECISION` 转成已接受的选择、明确拒绝或拆分后的新 scope，并同步 spec/ADR/contract/schema/checklist？ [Decision, Traceability, Plan §Post-design gate]
- [ ] CHK045 是否确认本 checklist 只审查需求/计划文字质量，没有把“按钮能点”“代码能运行”当作 checklist item？ [Clarity, Traceability, Checklist purpose]

## Notes

- [ ] 维护者应在每个 Decision/Gap 项旁记录结论、依据、owner 和日期，而不是只勾选。
- [ ] 任何新增跨系统、跨进程或 durable boundary 的决定都应回写 ADR 或对应 contract。
- [ ] 本文件是追加创建的 plan decision checklist；已有 `checklists/requirements.md` 保持不变。
