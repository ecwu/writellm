# Feature Specification: AI Provider 设置与密钥状态

**Feature Branch**: `005-provider-settings`

**Created**: 2026-07-11

**Status**: Draft

**Input**: 从原 `001-ai-writing-workspace` 的 implementation plan 拆分：配置 AI provider 的非敏感信息、保存密钥并显示可用状态。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 配置 AI Provider (Priority: P1)

作为作者，我希望设置 AI provider 的名称、服务地址和模型信息，以便后续 AI 任务知道使用哪项服务。

**Why this priority**: AI 任务在执行前需要明确的服务配置，但配置本身不应和写作内容混在一起。

**Independent Test**: 打开设置，填写 provider 信息并保存，重新打开设置确认非敏感配置恢复。

**Acceptance Scenarios**:

1. **Given** 尚未配置 provider，**When** 用户填写有效信息并保存，**Then** 系统显示已配置状态和非敏感摘要。
2. **Given** provider 信息无效或不完整，**When** 用户保存，**Then** 系统指出具体字段问题并保留表单内容。
3. **Given** 用户修改 provider 信息，**When** 保存成功，**Then** 后续任务使用新的配置摘要。

### User Story 2 - 安全地保存和替换密钥 (Priority: P1)

作为作者，我希望保存或替换 AI provider 密钥，同时不让密钥出现在项目正文、普通设置展示或可复制的界面内容中。

**Why this priority**: 密钥泄露会影响作者账户和项目安全，是 AI 功能上线前的必要边界。

**Independent Test**: 保存一次密钥、替换一次密钥、重新打开应用，确认只显示是否已配置而不显示密钥原文。

**Acceptance Scenarios**:

1. **Given** 用户输入密钥并提交，**When** 保存完成，**Then** 系统只显示已配置状态，不回显密钥。
2. **Given** 平台无法提供受保护的密钥保存能力，**When** 用户保存密钥，**Then** 系统拒绝保存并说明原因，不降级写入明文文件。
3. **Given** 用户替换密钥，**When** 新密钥保存成功，**Then** 旧密钥不再作为当前配置使用。

### User Story 3 - 验证 provider 可用性 (Priority: P2)

作为作者，我希望测试 provider 连接并看到最近验证状态，以便提交 AI 任务前知道配置是否可用。

**Why this priority**: 清晰的验证结果能减少 AI 任务运行后的不可理解失败。

**Independent Test**: 分别使用可用和不可用配置执行验证，确认状态、错误原因和重试入口正确。

**Acceptance Scenarios**:

1. **Given** provider 配置完整，**When** 用户执行验证，**Then** 系统显示验证成功及时间。
2. **Given** provider 不可达或认证失败，**When** 用户执行验证，**Then** 系统显示失败原因，但不显示密钥原文。
3. **Given** 验证正在进行，**When** 用户关闭设置，**Then** 系统不会丢失已保存配置，也不会把未验证状态显示为可用。

### Edge Cases

- 密钥为空、过短或包含明显不允许的控制字符时，系统必须在提交前提示。
- 设置窗口意外关闭时，未提交的密钥不得被当作已保存配置。
- provider endpoint 改变后，旧的验证状态不得继续显示为当前有效。
- 错误信息不得包含密钥原文或完整请求凭据。
- 不同项目打开时，非敏感 provider 配置与项目正文的归属必须清晰可见。

## Scope

### In Scope

- Provider 名称、服务地址、模型标签等非敏感设置。
- 密钥保存、替换、已配置/未配置状态和失败提示。
- Provider 可用性验证及最近验证状态。
- 设置界面的脱敏展示和重试操作。

### Out of Scope

- AI 写作任务、资料检索和提案生成。
- 将密钥写入项目文件或正文。
- 多账号、团队密钥管理和远程密钥共享。
- Provider 的计费、配额和账单管理。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 系统 MUST 允许用户设置 provider 名称、服务地址和模型标签等非敏感信息。
- **FR-002**: 系统 MUST 允许用户保存和替换 provider 密钥。
- **FR-003**: 系统 MUST 只向用户展示密钥是否已配置，不得回显密钥原文。
- **FR-004**: 密钥保存失败时系统 MUST 不得降级到明文项目文件或普通文本设置。
- **FR-005**: 系统 MUST 能够显示当前 provider 配置摘要和最近验证状态。
- **FR-006**: 用户 MUST 能够主动验证 provider 可用性，并看到成功或失败原因。
- **FR-007**: provider 信息不完整时系统 MUST 阻止验证和 AI 任务依赖的配置提交。
- **FR-008**: 错误和诊断信息 MUST 不包含密钥原文或可直接恢复密钥的内容。
- **FR-009**: 未提交的表单内容 MUST 不被显示为已保存配置。

### Key Entities

- **Provider 配置**：非敏感的 provider 名称、服务地址、模型标签和验证状态。
- **受保护密钥**：用于 provider 认证、只能通过受保护存储边界使用的秘密。
- **验证记录**：一次 provider 可用性检查的时间、结果和可显示错误摘要。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 至少 90% 的作者能在 3 分钟内完成 provider 配置并看到已配置状态。
- **SC-002**: 100% 的设置展示、项目文件和普通导出中都不存在密钥原文。
- **SC-003**: 100% 的受保护存储不可用场景都拒绝明文降级并显示可执行提示。
- **SC-004**: 至少 90% 的作者能在 60 秒内判断 provider 最近一次验证是否成功。
- **SC-005**: 100% 的验证失败都显示不包含密钥的可理解原因。

## Assumptions

- 本 feature 依赖 `001-project-foundation` 和 `002-workspace-shell` 提供应用设置入口。
- 具体 provider 协议由后续 AI 任务 feature 选择；本 spec 只定义配置和安全展示边界。
- 受保护密钥属于应用配置，不随 `.writellm` 项目文件移动。
