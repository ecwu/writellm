# 003 写作方向技术研究

**研究日期**: 2026-07-12

**研究目的**: 为写作动机、大纲排序、状态、持久化、IPC 和失败恢复提供可落地候选；本文件不批准依赖、不修改 `package.json`，所有版本和最终方案都要经过决策 checklist。

## 当前基线与约束

- 仓库当前为 Electron `40.10.5`、React `^19.0.0`、Bun `1.3.4`、TypeScript `^5.8.2`；源码只有 startup foundation 和 runtime-info typed IPC。
- Electron 官方文档建议通过 preload + `contextBridge` 暴露窄 API，不要把整个 `ipcRenderer` 暴露给 renderer；`ipcMain.handle` / `ipcRenderer.invoke` 适合异步 request/response，但主进程错误不会透明传递完整错误对象，只保证 message 可序列化。见 [Electron IPC tutorial](https://www.electronjs.org/docs/latest/tutorial/ipc)、[contextBridge](https://www.electronjs.org/docs/latest/api/context-bridge) 和 [ipcMain](https://www.electronjs.org/docs/latest/api/ipc-main)。
- Electron 40 发布说明记录该版本线使用 Chromium 144、Node 24.11.1 和 V8 14.4；这里仅作为 runtime 兼容性研究基线，不等于允许本 feature 升级 Electron。见 [Electron 40.0.0 release](https://www.electronjs.org/blog/electron-40-0)。
- ADR-001 已提出 portable folder、canonical JSON、project-local Git、串行写入和 pending recovery，但仍是 Proposed；因此下述“适合 ADR-001”的候选也不是最终决策。

## 候选一：IPC 与边界校验

### 候选 A：Electron 原生 `ipcMain.handle` + preload 具名 wrapper

- **适用范围**：003 的 `get/save/delete` 写作方向 request/response。
- **优点**：不增加包；与当前 `src/shared/ipc.ts` 和 `preload.cts` 直接衔接；结构化克隆适合传递普通 DTO；符合 AGENTS.md 和 constitution 的 least privilege。
- **风险**：TypeScript 类型不等于运行时校验；main 必须验证 sender、project session、revision、字符串、数组唯一性和大小；错误需要显式 `Result` DTO，不能依赖原始 Error 透传。
- **与现状适配**：Electron 40、React 19、Bun 和 TypeScript 均无额外运行时要求；可保持 sandbox、context isolation 和 nodeIntegration 关闭。

### 候选 B：在候选 A 上增加 schema-driven request/response codec

- **适用范围**：共享 DTO 的运行时 parse、错误 issues、版本迁移输入。
- **优点**：把不可信 renderer 输入和磁盘 JSON 校验集中化，降低 main handler 漏校验风险。
- **风险**：增加依赖和 bundle/runtime 约束；schema 与 TypeScript 类型重复或推导方式会影响导出；必须确认 sandbox preload 不加载 Node-only 包。
- **与现状适配**：建议 validator 只放 `src/main`/`src/shared` 可安全使用的位置，不能把 privileged storage code 推入 renderer。

### 候选 C：generic IPC router / 暴露 `ipcRenderer.invoke`

- **适用范围**：表面上可快速增加很多 feature 方法。
- **风险**：违反现有安全基线和 Electron 官方安全建议，形成任意 channel/能力注入面；不作为可接受方案。

**Decision: NEEDS DECISION** — 平台机制暂按候选 A 设计；是否引入候选 B、method 粒度、Result/error DTO 和 003 与 001 `saveProjectWorkspace` 的合并方式需接受 contract 后冻结。候选 C 明确排除。

## 候选二：运行时 schema/业务校验

### 候选 A：手写 TypeScript type guard / parser

- **适用范围**：写作方向小 DTO、enum、revision、条目规则。
- **优点**：零新增依赖、bundle 最小、可精确控制错误码和未知字段保留策略；适合当前 feature 数据量小。
- **风险**：需要维护 type 与 validator 两份表达；深层 schema、版本迁移和逐字段 issue 需要额外代码；容易出现漏校验。
- **适配点**：与 TypeScript 5.8、Bun test、Electron main 原生兼容。

### 候选 B：Zod 4

- **适用范围**：从 schema 推导 TypeScript 类型，并对 IPC request、磁盘 JSON 和 migration 输入做 parse。
- **优点**：官方文档定位为 TypeScript-first、带静态类型推导、零外部依赖；Zod 4 已稳定。见 [Zod official documentation](https://zod.dev/)。
- **风险**：需要确认 Electron 40/renderer bundle 的最终依赖体积和错误格式；Zod API major 迁移会影响 schema；不能因此省略 main 的 sender/path/authorization 检查。
- **适配点**：Node/Electron main 与现代浏览器均有明确使用路径，React 19 只消费推导出的 DTO，不直接依赖 Zod。

### 候选 C：Valibot

- **适用范围**：模块化、可组合的 schema/action 校验，适合希望控制 bundle 的项目。
- **优点**：官方文档强调 modular、type-safe，schema/action 为可组合的独立单元；见 [Valibot schemas](https://valibot.dev/guides/schemas/) 和 [Valibot architecture](https://valibot.dev/guides/internal-architecture/)。
- **风险**：团队需要接受其 API/issue 模型并建立迁移约定；与现有代码没有既有使用经验；依赖版本和类型推导策略仍需比较。
- **适配点**：纯 TypeScript/JavaScript library，适合 shared/main；仍需验证 Electron 40 build 和 Bun test 的实际解析。

**Decision: NEEDS DECISION** — 需按错误 DTO、未知字段保留、schema migration、bundle、维护经验和版本策略选 A/B/C；本规划不把任何一个写入 package.json。

## 候选三：原子文件写入

### 候选 A：Node `node:fs/promises` + 同目录临时文件 + rename

- **适用范围**：ADR-001 要求的单文件原子替换和 pending transaction 外层协议。
- **优点**：无新增包；Electron 40 对应 Node runtime 能力；可显式控制 temp 命名、fsync、权限、hash、rename 和恢复日志；与项目 main-owned storage 边界最透明。Node 文档提供 [fs/promises](https://nodejs.org/api/fs.html) 的 `writeFile`、`rename` 和并发修改警告。
- **风险**：跨平台 rename/锁/权限/磁盘满语义需要自己测试；`fs/promises` API 本身不是线程安全同步器，必须有每项目串行写队列；仅 rename 不能替代跨文件 transaction/recovery。
- **适配点**：不进入 renderer；main 可使用；与 Bun test 的 temp fixture 可验证。

### 候选 B：`write-file-atomic`

- **适用范围**：封装临时文件、rename 和可选 fsync 的单文件写入。
- **优点**：成熟、体积小、使用者多，API 直接针对 atomic replacement；公开说明包含 fsync 和临时文件回调。见 [npm package README](https://www.npmjs.com/package/write-file-atomic) 与 [npm source repository](https://github.com/npm/write-file-atomic)。
- **风险**：只解决单文件 writer，不解决 003 的 multi-file pending/Git recovery；依赖版本、Electron packaging、Windows 行为和 fsync 策略仍需验收；封装细节可能掩盖项目需要的 transaction metadata。
- **适配点**：只应在 main/storage adapter 使用，不能放 preload/renderer。

### 候选 C：`atomically`

- **适用范围**：希望在 atomic writer 之上处理更多重试或磁盘异常的项目。
- **优点**：公开说明强调比 `write-file-atomic` 默认重试更多失败情形。见 [atomically package](https://www.npmjs.com/package/atomically)。
- **风险**：重试策略可能延长用户看到保存失败的时间；同样不能替代项目级 transaction、Git commit 和 recovery 状态；需要审计 API 和跨平台语义。
- **适配点**：main-only 候选，需在 Electron 40 packaged build 中验证。

**Decision: NEEDS DECISION** — ADR-001 的逻辑边界倾向候选 A 或“候选 A + 已审计小封装”，但是否引入 B/C、fsync/重试阈值和多文件 transaction policy 留空。

## 候选四：Git history adapter

### 候选 A：随应用携带的固定 Git executable + main-owned adapter

- **适用范围**：每个 `.writellm` 项目初始化/提交/读取 status/log/diff，支持 ADR-001 的 trailers。
- **优点**：与 ADR-001 的“发布版不能依赖用户系统 Git，应由应用携带已知 runtime”一致；canonical Git repository 与用户生态互操作；main 可固定 executable、cwd、参数和环境。
- **风险**：每个平台要打包/签名/升级 Git runtime；二进制体积、许可、安全更新和进程失败要纳入发布策略；不能直接传 renderer 参数。
- **适配点**：`node:child_process` 或 Electron utility boundary 的具体使用需另行审查；与 Bun test 可使用 fixture repository。

### 候选 B：`isomorphic-git`

- **适用范围**：纯 JavaScript/TypeScript Git 实现，可直接修改 `.git`，避免依赖外部 native executable。
- **优点**：官方/包说明定位为 browser/Node 可用、无 native C++ module、带 TypeScript declarations，并可通过函数导入控制 bundle。见 [isomorphic-git docs](https://isomorphic-git.org/docs/en) 与 [npm package](https://www.npmjs.com/package/isomorphic-git)。
- **风险**：需要对 ADR-001 所需的 binary tracking、commit trailers、status/diff/restore、性能、异常和版本兼容逐项验证；与 canonical Git 的互操作目标不等于所有命令语义都已满足；不得把 Git fs 直接暴露给 renderer。
- **适配点**：可放 main adapter；需验证 Electron 40 Node/ESM 构建、项目大文件和 Bun test fixture。

### 候选 C：调用用户系统 `git` command

- **适用范围**：开发环境快速原型。
- **优点**：实现直观，Git CLI 行为和生态成熟；官方 [git-init](https://git-scm.com/docs/git-init) 与 [git-add](https://git-scm.com/docs/git-add) 文档定义了基础操作。
- **风险**：版本、路径、locale、用户 config、权限和是否安装不可控；直接违背 ADR-001 的发布/固定 executable 目标，不能作为默认生产方案。
- **适配点**：可以在本地开发 fixture 中作为对照，不应形成 renderer 可调用接口。

**Decision: NEEDS DECISION** — 需在 ADR-001 接受时明确 A/B，C 仅可作开发诊断工具；Git runtime、binary/cache policy、失败重试和 commit metadata 需一并冻结。

## 候选五：大纲排序交互

### 候选 A：语义列表 + 上移/下移/置顶按钮，指针拖动作为增强

- **适用范围**：单层列表、少量条目、要求可靠键盘路径的写作工具。
- **优点**：核心排序不依赖包；按钮行为易于读屏、测试和持久化；可在没有拖放支持时完整工作。
- **风险**：需要自己实现拖动动画、pointer edge cases、live region 和焦点恢复；视觉拖放体验成本较高。
- **适配点**：React 19 + DOM 原生；与 002 的 focus rules 易组合；最符合最小演进原则。

### 候选 B：`@dnd-kit` sortable

- **适用范围**：React 中的 pointer/touch/keyboard sortable list。
- **优点**：官方文档提供 sortable preset、sensors 和 keyboard sensor；无障碍指南覆盖键盘、screen reader instructions、live regions 和 Escape 取消。见 [dnd-kit overview](https://docs.dndkit.com/)、[sortable preset](https://docs.dndkit.com/presets/sortable) 和 [accessibility](https://docs.dndkit.com/guides/accessibility)。
- **风险**：官方文档同时存在 legacy 包和新 `@dnd-kit/react` 文档，迁移路径/包名必须先确定；默认辅助功能不是产品级完成品，仍要本地化和验证；React 19 兼容性、bundle 和 focus 与 002 shell 需要实测。
- **适配点**：只负责交互，不负责 order persistence、IPC 或 storage；需要把条目 id 作为稳定 key。

### 候选 C：Atlassian Pragmatic Drag and Drop 或 React Aria hooks + 自建排序

- **适用范围**：希望采用低层 drag/drop primitives 或同时加强 accessible collection behavior。
- **优点**：Pragmatic DnD 面向多 view layer、低层可组合；见 [Atlassian repository](https://github.com/atlassian/pragmatic-drag-and-drop)。React Aria 是无样式的 accessible React components/hooks，适合自建一致的 focus/interaction layer；见 [React Aria getting started](https://react-spectrum.adobe.com/react-aria/getting-started.html)。
- **风险**：低层工具给实现团队更多责任，排序、键盘语义、live announcement 和 React 19 integration 仍需自建；若只为单层列表，复杂度可能超过收益。
- **适配点**：可以留在 renderer；不能改变 main 对 order/id 的校验。

**Decision: NEEDS DECISION** — 第一版优先比较 A 与 B；C 仅在 002 已采用相同 interaction stack 时再评估。无论选择，键盘等价路径和 WAI-ARIA 语义都必须写入验收；参考 [W3C APG listbox rearrangeable options](https://www.w3.org/WAI/ARIA/apg/patterns/listbox/)。

## 候选六：稳定 ID 生成

### 候选 A：runtime `crypto.randomUUID()`

- **适用范围**：projectId/outlineItemId/clientMutationId 等 opaque IDs。
- **优点**：无新增依赖；Node 文档定义为 CSPRNG 生成 RFC 4122 v4 UUID。见 [Node crypto.randomUUID](https://nodejs.org/api/crypto.html#cryptorandomuuidoptions)。
- **风险**：若采用时间排序的 UUID v7，要确认 Electron 40 runtime 实际暴露能力和时钟语义；ID 格式一旦落盘不能随意切换；renderer 生成 ID 与 main 生成 ID 的信任边界需要明确。
- **适配点**：建议由 main 生成 durable IDs，renderer 只回传已有 opaque ID；临时 client mutation ID 可按同一策略生成。

### 候选 B：`uuid` 包

- **适用范围**：需要明确 v4/v7/解析和跨 runtime 统一实现时。
- **优点**：团队熟悉、API 明确；可隔离 runtime 差异。
- **风险**：增加依赖和版本维护；对小 feature 可能是不必要的包；仍要冻结格式和 migration。

### 候选 C：确定性 ID（由 projectId + 内容/位置派生）

- **适用范围**：只在实体生命周期严格可重算且无需跨移动/复制去重时。
- **风险**：标题/顺序变更会破坏 identity，无法满足 outline item 稳定关联和未来 chapterRef；不作为本 feature 的默认方案。

**Decision: NEEDS DECISION** — ID 是 v4/v7、main/client 生成位置和格式校验的决策项；候选 C 排除。

## 候选七：测试与 runtime smoke

### 候选 A：沿用 Bun test + 现有 shell scripts

- **适用范围**：domain、contract、integration、compiled Electron smoke。
- **优点**：仓库已有 `bun test`，官方文档说明支持 TypeScript/JSX、异步测试、timeout、retry/repeats；见 [Bun test runner](https://bun.sh/docs/test) 和 [writing tests](https://bun.sh/docs/test/writing-tests)。不引入另一套 runner。
- **风险**：Bun 的 Jest compatibility 不是完整 Jest 兼容；Electron runtime 测试仍要显式 build/spawn，不能只靠 Bun test。
- **适配点**：直接对应 `bun run test`、`bun run build`、`bun run test:smoke`；临时项目 fixture 要隔离真实用户目录。

### 候选 B：引入另一个 JS test runner

- **适用范围**：若未来 renderer DOM、coverage 或 Electron integration 对 Bun 不足。
- **风险**：增加配置、依赖和运行时差异；本 feature 没有证据表明当前 scope 需要它。

### 候选 C：只做编译和静态 contract 检查

- **风险**：无法发现 sandbox preload、main storage、atomic failure、pending recovery 或真实重启问题；不满足 constitution IV，不作为完整方案。

**Decision: NEEDS DECISION** — 当前保持候选 A 作为验证基线；是否需要 B 由实际失败边界和 002/004 共用测试需求决定，C 排除为唯一验证方案。

## 结论与决策登记

本研究给出可落地的接口和边界，但不把任何候选写入已批准依赖：

| 决策面 | 当前可行候选 | 最终决策 |
|---|---|---|
| IPC 方式/粒度 | Electron named handlers；可选 schema codec | **NEEDS DECISION** |
| DTO/schema validator | 手写 guard / Zod / Valibot | **NEEDS DECISION** |
| atomic writer | Node fs / write-file-atomic / atomically | **NEEDS DECISION** |
| Git history | bundled executable / isomorphic-git / system Git（仅开发） | **NEEDS DECISION** |
| 排序交互 | semantic controls / dnd-kit / Pragmatic DnD 或 React Aria | **NEEDS DECISION** |
| durable ID | runtime crypto / uuid package / deterministic（排除） | **NEEDS DECISION** |
| 测试 runner | Bun test + Electron smoke / 额外 runner | **NEEDS DECISION** |
| 版本策略 | 当前 package major + lockfile，具体 pin/range/升级窗口 | **NEEDS DECISION** |

