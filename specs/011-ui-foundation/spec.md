# Feature Specification: 共享 UI Foundation

**Feature Branch**: `011-ui-foundation`

**Created**: 2026-07-12

**Status**: Accepted — maintainer accepted through design Q&A on 2026-07-12

**Input**: 为 WriteLLM v2 建立跨 feature 的共享 UI foundation，统一采用 shadcn/ui 风格和组件体系；迁移 001 已完成启动页且保持既有行为与验收结果不变；在 002 workspace shell 实现前提供可复用基础。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 在统一界面中开始或打开项目 (Priority: P1)

作为作者，我希望启动页在视觉、交互和状态表达上保持一致且易于理解，同时继续提供已经可用的新建、打开、最近项目和重新关联能力，以便界面迁移不会打断现有工作。

**Why this priority**: 启动页是当前唯一已完成的产品入口；任何 UI foundation 都必须先证明它不会改变已经接受的用户行为。

**Independent Test**: 在不依赖 002 或后续 feature 的情况下，重复执行 001 的启动页验收场景，并比较迁移前后的入口、结果、错误处理、键盘路径和项目文件副作用。

**Acceptance Scenarios**:

1. **Given** 用户首次启动应用，**When** 启动页完成加载，**Then** 用户仍能找到并使用新建项目、打开项目和最近项目入口。
2. **Given** 用户创建、打开、重新关联或移除最近记录，**When** 操作成功、取消或失败，**Then** 页面呈现与 001 已接受契约一致的结果，并且不新增项目或 recent 数据副作用。
3. **Given** 用户仅使用键盘和可见焦点，**When** 遍历并操作启动页，**Then** 所有既有操作仍可完成，状态与错误仍能被辅助技术识别。

---

### User Story 2 - 在合适的主题和排版中获得一致且可访问的界面 (Priority: P1)

作为作者，我希望 WriteLLM 能跟随系统或使用我选择的明暗外观，并为未来编辑器提供稳定、可调整的字体与阅读节奏，以便在不同环境中阅读和操作都不会依赖颜色猜测或精细鼠标操作。

**Why this priority**: 主题、焦点、对比度和运动规则属于全局基础；若后续 feature 各自处理，会产生不一致且难以修复的可访问性问题。

**Independent Test**: 分别在 System、Light、Dark、减少动态效果和键盘导航条件下打开启动页，重启应用并检查排版 preset，验证偏好保留、内容可读、状态可辨、焦点可见且行为一致。

**Acceptance Scenarios**:

1. **Given** 用户选择 System、Light 或 Dark，**When** 应用启动、重启或系统外观发生变化，**Then** 界面采用有效主题、保留选择，且内容、边界、状态和焦点保持清晰；只有 System 跟随运行中的系统变化。
2. **Given** 用户启用减少动态效果偏好，**When** 界面发生状态或层级变化，**Then** 非必要动画被移除或显著减弱，操作结果仍可理解。
3. **Given** 某状态需要用户注意，**When** 状态出现，**Then** 它至少通过文字或语义信息表达，不仅依赖颜色。
4. **Given** 未来编辑器呈现 HTML 或 Markdown，**When** 选择编辑、阅读或紧凑排版 preset，**Then** 正文、标题、代码、字号、行距和块间距通过统一语义 token 变化，不改写文档内容。

---

### User Story 3 - 后续功能复用同一组件语言 (Priority: P2)

作为实现 002 和后续 feature 的产品团队成员，我希望常用界面元素拥有统一的使用契约、视觉状态和定制边界，以便构建新界面时不重复解决按钮、表单、提示、浮层、焦点和主题问题。

**Why this priority**: 共享基础的主要跨 feature 价值是减少重复并防止界面分叉，但它应建立在 001 迁移不回归之后。

**Independent Test**: 使用 foundation 提供的公开组件和规则组装一个不包含业务逻辑的 workspace shell 示例，验证常见布局、表单、状态、提示和模态需求无需复制基础组件实现。

**Acceptance Scenarios**:

1. **Given** 002 需要按钮、字段、卡片/表面、状态提示、分隔、滚动区域、工具提示或模态交互，**When** 团队检查共享 foundation，**Then** 能找到明确的可复用组件或已记录的扩展流程。
2. **Given** 某 feature 需要调整共享组件外观，**When** 开发者遵循定制规则，**Then** 调整通过语义 token、已定义变体或组合完成，而不是复制并分叉基础组件。
3. **Given** 共享组件需要升级或修订，**When** 变更被评审，**Then** 受影响的 feature、可访问性行为和视觉状态均可被识别并验证。

### Edge Cases

- 系统主题在应用运行期间变化时，当前页面必须更新且不得丢失输入、recent 列表或操作状态。
- Light 或 Dark 明确选择不得被系统主题变化覆盖；仅 System 模式跟随系统。
- 外观偏好缺失、损坏、未知版本或包含越界数值时，应用必须安全回退到默认值并给出不含敏感信息的提示。
- 选择的系统字体不可用时，排版必须使用已验证的 fallback stack，不下载远程字体或阻断内容。
- 高对比或自定义系统配色无法完整映射时，界面必须保持可读文本、可见焦点和非颜色状态信息。
- 文本放大、翻译后字符串变长或窗口处于 001 已支持的窄尺寸时，主要入口不得被截断为不可访问。
- 共享浮层或模态嵌套、触发元素消失或操作失败时，焦点必须回到合理且可预测的位置。
- 组件升级改变默认标记、键盘交互或视觉状态时，变更不得静默覆盖仓库定制或绕过回归验证。
- foundation 暂时没有覆盖某个新模式时，feature 必须通过受控扩展流程补充，而不是引入第二套并行组件体系。

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: 系统 MUST 提供一个由 renderer feature 共享的 UI foundation，涵盖语义视觉 token、System/Light/Dark 主题、Typeset 排版、间距、圆角、边界、层级、焦点和动态效果规则。
- **FR-002**: 系统 MUST 提供一组由项目统一拥有和维护的基础组件，至少覆盖 001 启动页和 002 workspace shell 已明确需要的操作、选择、表单、表面、状态、分隔、滚动、工具提示和模态模式。
- **FR-003**: 001 启动页 MUST 迁移到共享 foundation，同时保持其已接受的项目 IPC 契约、状态转换、可见操作、文案含义、recent 上限、错误脱敏和磁盘副作用不变。
- **FR-004**: 迁移后的启动页 MUST 继续满足 001 已接受的首次启动、新建、打开、移动后重新关联、最近记录管理、取消、失败和空工作区验收场景。
- **FR-005**: 共享交互组件 MUST 定义并验证可访问名称、键盘操作、可见焦点、禁用状态、错误/状态语义，以及适用时的焦点进入、约束和恢复行为。
- **FR-006**: 主题 MUST 提供 System、Light 和 Dark 三种模式，默认 System；选择 MUST 在应用重启后保留，且 MUST NOT 成为项目或文档状态。
- **FR-007**: 界面 MUST 尊重用户的减少动态效果偏好；任何状态含义 MUST NOT 仅通过颜色、动画或位置表达。
- **FR-008**: foundation MUST 定义定制规则，要求 feature 优先使用语义 token、受支持变体和组件组合；复制基础组件、添加平行设计体系或绕过共享可访问性行为必须经过明确评审。
- **FR-009**: foundation MUST 定义组件所有权和升级规则，使外部来源的组件进入仓库后成为可审查的项目源码；后续更新必须保留本地定制并通过差异审查和回归验证。
- **FR-010**: 共享组件 MUST 保持 renderer-only；外观偏好只能通过独立、命名、typed 的最小 preload API 读写，不得引入 generic IPC、暴露 Node/Electron/绝对路径，或改变 main 对项目文件和 recent index 的所有权。
- **FR-011**: 本 feature MUST 为 002 提供基础 UI 能力但 MUST NOT 实现 workspace shell 的布局、业务槽位、项目状态编排或后续 feature 的业务界面。
- **FR-012**: 本 feature MUST 记录与 001、002 的依赖关系：001 的已接受行为与实现是迁移基线；本 feature 在 001 之后实施；002 及所有新 renderer 产品界面在本 feature 被接受并实现后再实施。
- **FR-013**: foundation MUST 提供一个受控扩展流程，要求新增共享组件说明复用场景、状态、可访问性契约、主题覆盖、测试责任和维护 owner。
- **FR-014**: 系统 MUST 提供源码归项目所有的 Typeset 排版层，至少包含 editor、reading 和 compact preset，并以 body、heading、mono、size、leading 和 flow 语义变量表达。
- **FR-015**: 外观偏好 MUST 使用版本化、应用级、main-owned 的原子持久化；缺失、损坏、未知版本或非法值 MUST 回退到标准默认值且不泄露路径或 raw exception。
- **FR-016**: 字体能力 MUST 仅使用已审查的系统安全字体栈与 fallback；本 feature MUST NOT 枚举本机字体、下载远程字体或导入用户字体文件。

### Key Entities

- **Theme Token**: 表达用途而非具体颜色值的共享视觉语义，包括背景、前景、强调、危险、边界、焦点和层级等角色，并具有浅色与深色取值。
- **UI Primitive**: 项目拥有的最小交互或呈现组件，具有稳定公开属性、状态、主题和可访问性契约。
- **UI Pattern**: 由 primitives 组合而成的可复用交互模式，例如字段、状态提示、空状态或模态内容结构；不拥有 feature 业务状态。
- **Component Variant**: 共享组件经批准的视觉或行为选项；必须有明确用途，且在主题与交互状态下保持一致。
- **Migration Baseline**: 001 已接受的启动页行为、契约、验收场景和测试集合，是迁移前后比较的权威基线。
- **Appearance Preference**: 应用级的主题模式和未来编辑器排版选择；由 main 验证与持久化，不属于项目或文档。
- **Typeset Preset**: 对 HTML/Markdown 容器应用的排版语义变量集，只改变呈现节奏，不改变内容语义。

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 001 已接受的所有自动化检查和 quickstart 启动页场景在迁移后保持 100% 通过，`window.writellm` 仍恰好只有六个 project methods，且 project/recent 磁盘契约没有变化；appearance 在独立 namespace 中仅有两个 methods。
- **SC-002**: 启动页的 100% 既有用户操作可仅用键盘完成，并在浅色、深色和减少动态效果设置下具有可见焦点与可理解状态。
- **SC-003**: 对 foundation 初始公开的每个交互组件，至少验证默认、键盘焦点、禁用以及适用的错误/选中/打开状态；所有状态在浅色和深色主题下均有可辨识结果。
- **SC-004**: 002 已明确的基础 UI 需求中，至少 90% 可直接使用 foundation primitive 或 pattern 满足；剩余需求必须有不分叉设计体系的受控扩展说明。
- **SC-005**: 在 001 已支持的最小窗口条件和 200% 文本缩放下，启动页的新建、打开、recent 操作、状态和错误入口 100% 可到达且无阻断性内容截断。
- **SC-006**: 抽查任意 3 个后续 renderer 界面设计时，不存在未经批准的第二套基础按钮、字段、模态或主题 token 实现。
- **SC-007**: System/Light/Dark 三种选择在运行时和重启后 100% 生效，启动时不先渲染错误主题，且损坏偏好能安全回退。
- **SC-008**: editor、reading、compact 三个 Typeset preset 均通过正文、标题、列表、表格、代码、深色、forced-colors 和流式追加验证，且不修改原始内容。

## Assumptions

- `001-project-foundation` 的 spec、plan、ADR-002、IPC contract 和完成实现是不可回写的迁移基线；本 feature 只修改当前 renderer 表现层及新增共享 UI 文件。
- “采用 shadcn/ui 风格和组件体系”表示采用其源码归项目所有、可组合、语义 token 驱动的组件模式；具体工具、底层 primitive、样式运行时和版本策略由 plan 与 UI architecture ADR 决定。
- 首版主题提供 System/Light/Dark，并在 main-owned 应用偏好中持久化；System 是默认值。
- shadcn/typeset 用作未来编辑器的呈现基础，但本 feature 不实现编辑器或完整 settings 页。
- foundation 为单个 Electron renderer 服务，不在本 feature 中拆成独立发布包或建立远程组件 registry。
- 002 的现有 Draft spec/plan 可以作为需求输入，但其实现必须等待本 feature 完成；后续如 002 设计与本 foundation 冲突，应更新 002 的未接受设计，而不是修改 001 历史文档。

## Scope Boundaries

### In Scope

- 跨 feature 的 renderer 组件目录、主题 token、主题应用、可访问性基线和定制/升级规则。
- 轻量 System/Light/Dark 选择器、应用级外观偏好持久化、独立 typed appearance IPC 和 shadcn/typeset 排版基础。
- 满足 001 启动页与 002 已知共性需求的最小 primitive/pattern 集合。
- 001 启动页表现层迁移及其既有行为回归验证。
- UI foundation 的使用 contract、验证指南和跨 feature 实施顺序。

### Out of Scope

- 修改 001 的 spec、plan、ADR、六方法 project IPC contract、project/recent 行为或其 main/preload 实现路径；011 的独立 appearance repository/bridge 是已接受的新边界。
- 实现 002 workspace shell、编辑器、资料库、AI、设置或版本历史界面。
- 安装依赖、生成 implementation tasks 或在本轮编写产品代码。
- 完整 settings 界面、自定义颜色主题编辑器、本机字体枚举、用户字体文件导入、远程字体或第三方主题市场。
- 将 UI foundation 发布为独立包、远程 registry 或多应用设计系统。

## Dependencies and Sequencing

1. `001-project-foundation` 已完成并提供迁移基线；它不依赖本 feature，也不被回写。
2. `011-ui-foundation` 读取 001 的现有 renderer 行为和测试作为兼容性约束，在其上建立共享表现层。
3. `002-workspace-shell` 的实现依赖本 feature 的 accepted spec、accepted plan、accepted UI architecture ADR 和完成实现；002 的 Draft 设计可在接受前同步引用新的 foundation。
4. 003–010 及任何新 renderer feature 在需要新增基础组件时遵循本 feature 的扩展规则，并继续遵守各自原有业务依赖。
