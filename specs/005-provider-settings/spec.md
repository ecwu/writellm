# Feature Specification: Pi Agent Provider 设置与密钥状态

**Feature Branch**: `005-provider-settings`

**Created**: 2026-07-11

**Updated**: 2026-07-12

**Status**: Accepted

**Input**: 为作者提供独立于项目正文的 AI 服务设置体验，使其能够配置 Pi Agent harness 可消费的模型、保护密钥，并在使用 AI 功能前确认当前设置是否支持所需的 agent tool loop。

## Clarifications

### Session 2026-07-12

- Q: 首版支持哪些 AI 服务类型？ → A: 仅支持由应用构造为 Pi `openai-completions` provider/model 的自定义端点；“OpenAI-compatible”只描述传输方言，不等于自动满足 agent harness 能力。索引相关端点配置由对应后续 feature 定义。
- Q: 自定义端点允许哪些 URL？ → A: 远程端点必须使用 HTTPS；localhost 或 loopback 地址可以使用 HTTP。
- Q: “验证配置成功”需要实际执行什么检查？ → A: 通过与后续 AI feature 相同的 Pi `Models`/provider/model 路径运行最小 agent tool-loop probe：要求模型生成符合 JSON Schema 的工具调用、接收工具结果并完成最终响应；开始前提示可能产生少量 token 用量。
- Q: Pi harness 需要的模型元数据从哪里来？ → A: 应用保存一个版本化、可构造 Pi `Model` 的 harness profile；用户提供端点、模型、context window、最大输出和 reasoning 能力，应用拥有 API 方言、输入模态、cost placeholder 与保守兼容策略。
- Q: 验证结果是否在应用重启后保留？ → A: 持久保留脱敏结果与完成时间并绑定配置版本；配置或密钥变化时结果过期。
- Q: 成功验证是否会随时间自动过期？ → A: 不按时间自动过期；配置或密钥变化时过期，并持续显示验证完成时间。具体变化字段由后续澄清确定。

### Session 2026-07-13

- Q: 哪些配置变化应使已有验证结果过期？ → A: 端点、模型、context window、最大输出、reasoning 或 API key 任一变化都使验证过期。
- Q: 端点 URL 应接受哪些形式？ → A: 远程端点仅允许 HTTPS；HTTP 仅允许 localhost、IPv4 loopback 或 IPv6 loopback；拒绝带 credentials、query 或 fragment 的 URL。
- Q: 本地保存、替换和移除的 1 秒目标如何处理？ → A: 保留为 plan 中的非阻塞体验目标，不作为实现验收门禁。
- Q: 如何处理实现已完成但前置测试仍未完成的任务状态？ → A: 保留真实实现状态；未完成测试作为 feature 完成前必须通过的回归与验收门禁，不再描述为先于现有实现失败。
- Q: 最终验证应如何记录？ → A: 已完成的测试命令记录为阶段性基线；安全检查完成后重新运行全部构建和测试命令，作为最终门禁。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 配置 AI 服务 (Priority: P1)

作为作者，我希望在应用设置中填写并保存 AI 服务和模型信息，以便后续 AI 功能使用我明确选择的配置。

**Why this priority**: 作者必须先能理解并控制当前使用的服务，AI 功能才有可靠且可预期的运行前提。

**Independent Test**: 在不打开或修改任何项目内容的情况下新增、保存和修改服务设置，重新打开应用后确认已保存摘要可重建同一个 Pi provider/model profile。

**Acceptance Scenarios**:

1. **Given** 尚未配置 AI 服务，**When** 用户填写端点、API key、模型和必需的模型能力信息并保存，**Then** 系统显示保存成功和不含秘密的当前 Pi harness profile 摘要。
2. **Given** 必需信息缺失或格式无效，**When** 用户尝试保存，**Then** 系统阻止保存、指出具体字段问题并保留用户输入以便修正。
3. **Given** 已有服务设置，**When** 用户修改并成功保存，**Then** 当前配置摘要立即反映新设置，旧的可用性验证不再显示为当前有效。
4. **Given** 保存失败，**When** 用户查看结果，**Then** 系统明确说明设置未更新并提供安全重试路径，不把草稿显示为已保存。

---

### User Story 2 - 安全地保存、替换和移除密钥 (Priority: P1)

作为作者，我希望保存、替换或移除 AI 服务密钥，同时界面和项目内容始终不显示密钥原文，以便保护我的服务账户。

**Why this priority**: 密钥泄露可能产生账户、费用和隐私风险，安全状态必须先于任何 AI 调用建立。

**Independent Test**: 依次保存、替换和移除密钥并重启应用，确认界面只显示密钥状态，项目移动或导出不会携带密钥。

**Acceptance Scenarios**:

1. **Given** 用户输入密钥并确认保存，**When** 保存成功，**Then** 系统清除输入中的秘密并只显示“已配置”状态。
2. **Given** 已有密钥，**When** 用户成功保存替换密钥，**Then** 系统确认替换完成，旧密钥不再作为当前凭据使用。
3. **Given** 已有密钥，**When** 用户确认移除，**Then** 系统显示“未配置”，依赖密钥的验证和 AI 操作不再被视为可用。
4. **Given** 应用无法安全保存密钥，**When** 用户提交密钥，**Then** 系统拒绝保存并说明可执行的下一步，不以明文或其他不受保护方式降级保存。
5. **Given** 用户取消或关闭包含未提交密钥的设置界面，**When** 用户再次打开设置，**Then** 未提交密钥不会恢复，也不会显示为已配置。

---

### User Story 3 - 验证当前配置是否可用 (Priority: P2)

作为作者，我希望主动验证当前 AI 服务设置并看到最近一次结果，以便在开始 AI 工作前判断是否需要修正配置。

**Why this priority**: 清晰的运行前检查能把认证、连接或模型选择问题与后续写作任务失败区分开。

**Independent Test**: 分别使用支持完整工具循环、只支持普通文本、返回无效工具参数、错误密钥、不可用服务和过期验证状态的 fixture 执行检查，确认只有完整工具循环成功时才可用。

**Acceptance Scenarios**:

1. **Given** 当前设置和密钥完整，**When** 用户开始验证，**Then** 系统通过当前 Pi harness profile 执行最小工具循环，显示正在验证，并在完成后显示成功或可理解的失败类别与验证时间。
2. **Given** 验证失败，**When** 用户查看结果，**Then** 系统不显示密钥、完整凭据或敏感诊断，并指向可修正的设置或重试操作。
3. **Given** 验证正在进行，**When** 用户关闭设置，**Then** 已保存配置保持不变，进行中或未知结果不会被显示为可用。
4. **Given** 已验证配置的端点、模型、context window、最大输出、reasoning 或 API key 发生变化，**When** 用户返回设置，**Then** 旧结果明确显示为过期或被清除，直到用户重新验证。
5. **Given** 用户已完成一次验证且配置未变化，**When** 用户重启应用并重新打开设置，**Then** 系统恢复与该配置版本对应的脱敏结果和完成时间，不恢复生成响应正文。

### Edge Cases

- 密钥为空、仅包含空白或包含无法接受的控制字符时，系统不得将其保存为有效密钥。
- 远程端点使用明文 HTTP 时，系统必须拒绝保存并指出需改用 HTTPS；只有 localhost、IPv4 loopback 或 IPv6 loopback 地址可使用 HTTP。任何包含 credentials、query 或 fragment 的端点 URL 都必须拒绝保存并指出具体问题。
- 多次快速提交保存或验证时，界面必须明确哪次结果对应当前设置，不得让较早结果覆盖较新结果。
- 验证超时或结果未知时，不得显示为成功。
- 服务只能完成普通文本、拒绝 tools、产生无法通过 schema 校验的工具参数、无法关联 tool call/result，或工具结果后无法完成最终响应时，不得显示为 harness 可用。
- 错误、状态摘要和可复制内容不得包含密钥原文或可直接恢复密钥的信息。
- 用户切换项目时，AI 服务设置不得被误解为项目正文的一部分，也不得因项目移动而丢失或随项目传播。
- 在窄窗口、200% 文本缩放、键盘操作、明暗主题和减少动态效果条件下，字段、状态和恢复操作必须保持可达且可理解。

## Scope

### In Scope

- 应用级 Pi harness provider/model profile 的填写、校验、保存与摘要展示；首版 profile 使用 `openai-completions` API 方言。
- 构造后续 AI feature 可直接消费的 Pi `Models`、provider 和 plain-data model descriptor 所需的最小元数据。
- 密钥的保存、替换、移除以及已配置/未配置状态。
- 当前配置的主动验证、验证时间、过期状态、脱敏失败说明和重试入口。
- 一致的设置表单、状态、确认和可访问性交互体验。

### Out of Scope

- AI 写作任务、资料检索、上下文选择和提案生成。
- 自动选择、推荐或切换 AI 服务和模型。
- 用户编辑任意 Pi provider implementation、headers、OAuth、环境变量、cost、工具 schema 或底层 compatibility flags。
- 服务费用、配额、账单和购买流程。
- 多账号、团队密钥共享、远程同步或密钥导入导出。
- 在项目文件、正文或普通导出中保存密钥。
- 索引、嵌入或重排序服务所需的端点、凭据与模型配置；这些配置由对应的 source processing 或 search feature 定义。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 系统 MUST 允许用户查看、填写、校验、保存和修改一套 Pi Agent harness provider/model profile；必需输入为端点、API key、模型、context window、最大输出 token 和是否支持 reasoning，其中 API key 按密钥要求处理，其余为非敏感设置。
- **FR-001a**: 系统 MUST 要求远程 LLM 端点使用 HTTPS，只允许 localhost、IPv4 loopback 或 IPv6 loopback 地址使用 HTTP，并 MUST 在保存前拒绝其他明文 HTTP 端点以及任何包含 credentials、query 或 fragment 的端点 URL。
- **FR-001b**: 系统 MUST 把保存设置映射为版本化的 Pi plain-data model descriptor 和 provider registration；首版 API 方言固定为 `openai-completions`、输入模态固定包含 text，provider id、model name、cost placeholder 与 compatibility policy 由应用生成，不接受 renderer 提供任意实现或底层 flags。
- **FR-001c**: 系统 MUST 拒绝无法形成内部一致 model descriptor 的设置，包括非正 context/output 上限、最大输出超过 context window、未知 profile version 或不受支持的 API 方言。
- **FR-002**: 保存失败或输入无效时，系统 MUST 保留可安全保留的非敏感输入、指出具体问题，并 MUST NOT 将草稿显示为已保存配置。
- **FR-003**: 系统 MUST 允许用户保存、替换和移除当前密钥，并在每次操作后显示明确结果。
- **FR-004**: 系统 MUST 只显示密钥的“已配置”或“未配置”状态；设置界面、状态、错误、项目内容和普通导出 MUST NOT 回显密钥原文或可直接恢复密钥的信息。
- **FR-005**: 当密钥无法被安全保存时，系统 MUST 拒绝该操作、保持先前状态并提供可执行提示，MUST NOT 降级为明文或其他不受保护的保存方式。
- **FR-006**: 未提交或已取消的密钥输入 MUST NOT 被视为已保存、在下次打开时恢复或影响当前可用状态。
- **FR-007**: 用户 MUST 能够主动验证当前配置，并看到与当前设置对应的进行中、成功、失败、未知或过期状态以及最近完成时间。
- **FR-007a**: 在用户开始验证前，系统 MUST 说明验证将通过当前保存的 Pi provider/model profile 运行一次最小 agent tool loop 且可能产生少量 token 用量；只有模型产生通过 schema 校验的指定工具调用、系统回填对应工具结果且模型随后完成最终响应时，系统才 MUST 将当前配置显示为验证成功。
- **FR-007b**: 验证 MUST 使用与后续 AI feature 相同的 Pi `Models.streamSimple` 与 agent loop 语义，不得用手写的 reachability、`/models`、普通 completion 或单独 JSON response 代替 harness compatibility probe。
- **FR-008**: 验证失败、超时或未知时，系统 MUST 提供脱敏且可理解的结果和适用的修正或重试路径，并 MUST NOT 显示为成功。
- **FR-009**: 端点、模型、context window、最大输出、reasoning 或 API key 任一变化后，系统 MUST 将先前验证结果标记为过期或清除，直到当前配置重新验证成功。
- **FR-009a**: 系统 MUST 在应用重启后恢复与当前配置版本对应的最近一次脱敏验证结果和完成时间，MUST NOT 为此保存或恢复验证生成的响应正文。
- **FR-009b**: 验证成功结果 MUST NOT 仅因经过固定时长而自动过期；系统 MUST 持续显示其完成时间，并 MUST 仅在端点、模型、context window、最大输出、reasoning 或 API key 任一变化时将其标记为过期。
- **FR-010**: 缺少必需设置或密钥时，系统 MUST 明确阻止验证，并向依赖该配置的后续功能提供“不可用”状态。
- **FR-011**: AI 服务设置和密钥状态 MUST 保持为应用设置，不得因创建、打开、移动或导出项目而写入、丢失或传播到项目内容。
- **FR-012**: 设置中的字段、状态、错误、确认和操作 MUST 沿用 011 定义的主题、排版、键盘、焦点、非颜色状态和受控共享交互规则。

### Key Entities

- **Harness Provider Profile**：用户可查看和修改的端点、模型与容量/推理能力，加上应用拥有的 profile version、provider/API identity、输入模态与兼容策略；可确定性构造 Pi provider 和 plain-data model descriptor。
- **密钥状态**：当前服务是否具有可用密钥，以及最近一次保存、替换或移除操作的结果；不包含密钥原文。
- **验证状态**：与配置版本关联的最近一次脱敏检查结果及完成时间；可持久保留成功、失败、未知或过期结果，但不包含生成响应正文，进行中状态不作为可用结果恢复。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001** *(post-launch outcome; non-blocking for implementation acceptance)*: 后续可用性测试中，至少 90% 的首次使用者能在 3 分钟内保存一套完整配置并正确判断密钥状态。
- **SC-002**: 在保存、替换、移除、取消、失败、重启、项目移动和普通导出测试中，100% 的可见内容与项目内容均不包含密钥原文或可恢复密钥的信息。
- **SC-003**: 100% 的安全保存不可用场景拒绝不受保护的降级保存，并显示明确的未保存状态和恢复提示。
- **SC-004**: 在有效、认证失败、服务不可达、超时、未知和过期场景中，100% 的验证结果能被用户通过文字判断，且不会把非成功结果显示为可用。
- **SC-004a**: 100% 的验证成功结果均来自当前保存 profile 经 Pi agent loop 完成一次 schema-valid tool call → matching tool result → final assistant response；格式检查、网络可达、模型列表、普通文本 completion 或单独 JSON response 不得产生成功状态。
- **SC-004b**: 对 tools 不受支持、工具参数无效、tool call/result 无法关联和工具结果后无法继续四类 harness incompatibility fixture，100% 显示为不可用且提供可理解的兼容性提示。
- **SC-005** *(post-launch outcome; non-blocking for implementation acceptance)*: 后续可用性测试中，至少 90% 的使用者能在 60 秒内判断当前设置是否可用于 AI 功能以及下一步应采取的操作。
- **SC-006**: 在仅键盘、System/Light/Dark、减少动态效果、960×640 和 200% 文本缩放条件下，100% 的必需字段、保存/移除/验证操作和错误恢复入口可达。

## Assumptions

- 001 已提供可移动项目入口，002 将提供项目内设置入口，011 已定义所有后续界面应复用的共享 UI 和外观行为。
- 首版面向单作者、单机环境，并维护一套当前 Pi `openai-completions` harness profile。
- `@earendil-works/pi-agent-core` 与 `@earendil-works/pi-ai` 是后续 AI 生成能力的 harness/runtime contract；005 只建立其 provider/model/auth 可用性前置，不实现写作 agent。
- 密钥属于应用级秘密，不属于任何写作项目，也不随项目移动或导出。
- 后续 AI 功能负责其任务行为；本 feature 只承诺配置、密钥状态和运行前验证体验。
