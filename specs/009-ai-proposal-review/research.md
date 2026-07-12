# AI 提案审阅技术研究

**研究日期**：2026-07-12
**研究范围**：proposal diff、Block 定位、过期/冲突检测、原子保存/恢复、Electron IPC、schema validation 和 diff UI。
**研究原则**：只记录候选和适配观察，不把任何候选写成已批准依赖；版本号、锁定策略、ADR 接受状态均留待决策。

## 研究摘要

009 的核心风险不是“能否展示两段文本”，而是旧 proposal 不能覆盖作者新编辑、批量应用不能留下半提交正文、renderer 不能伪造有权限的写入请求。因此无论最终选用何种库，都需要保留以下不可替代的 domain rules：

- proposal change 必须带稳定 Block target、生成时的 revision/fingerprint 和资料引用 snapshot；
- diff renderer 只负责可理解的展示，不能成为 patch 真相或写入 authority；
- main 必须重新读取当前 project、校验 sender/DTO/revision/target/source，再在内存中装配 selected changes；
- apply batch 通过 project-owned pending transaction 和恢复协议实现 all-or-nothing；
- library API 只作为实现细节，不能进入 renderer-visible 的长期数据模型。

以下官方资料用于确认候选的能力边界和维护信号；实现阶段仍需重新核对版本、许可证、Electron 43/Bun/TypeScript compatibility 和安全公告。

## Candidate group A — Diff、定位与冲突分析

### 候选 A：平台能力 + 自研 Block/domain diff

**适用范围**：以 `004-block-editor` 的 stable Block ID 和 canonical BlockNote JSON model 为主；对每个 Block 保存 canonical base fingerprint，使用项目自有逻辑判断 stale、overlap、duplicate 和 target missing。Markdown 仅是 interop projection。

**优点**：

- 不新增 runtime package；可以把安全规则直接写成纯 TypeScript domain code。
- 适合 009 的真实语义：变更不是任意文件 patch，而是“针对这些 Block 的可审阅操作”。
- 依赖少，Bun test 和 Electron main 都可以复用；数据模型不绑定某个 diff library。

**风险**：

- 需要自行处理 Unicode、换行、Block split/merge、插入 anchor 和重叠集合。
- UI 的字符/词级高亮仍需另一个算法或有限的可读表示；自研算法若没有规模上限可能阻塞 main。
- 若误把“相同文本”当作“相同 Block”，会造成重复 Block 或跨章节误绑定。

**与现状适配**：TypeScript/ES2022 直接适配；Electron 43 main 可使用 Node `crypto.createHash` 生成 fingerprint；React 19.2.7 只消费已经计算好的 DTO。当前源码没有 Block model，因此必须等待 `004` contract，不能现在以 `App.tsx` 的临时结构代替。

**官方资料**：[Node.js `crypto.createHash`](https://nodejs.org/api/crypto.html#cryptocreatehashalgorithm-options)、[Node.js filesystem API](https://nodejs.org/api/fs.html)。

**Decision: NEEDS DECISION**

### 候选 B：`diff` / jsdiff

**适用范围**：对 Block 原文与建议文本做 line/word/char/sentence/array diff，或生成统一 patch 供展示；不单独解决 stable ID、source validity、跨 Block overlap 或原子保存。

**优点**：

- 官方仓库说明支持多种 token 粒度、`diffArrays`、patch 生成和 TypeScript declarations；可用 `timeout`/`maxEditLength` 限制异常输入成本。
- 纯 JS/TS，既可在 main 做可信分析，也可在 renderer 做只读 presentation（最终位置仍需 main 再校验）。
- 对 proposal 的 `originalText`/`suggestedText` 能较快提供可读的 inline diff。

**风险**：

- Myers-style text diff 的结果不等于安全 merge；不能用 diff 输出直接覆盖当前正文。
- line/word tokenization 对 Markdown identity comments、中文分词、换行规范和 block boundary 可能产生不理想的视觉结果。
- 需要审查包版本、bundle 体积、timeout 行为和异常输入；不能把 package 的成功返回当成 conflict-free。

**与现状适配**：ESM/TypeScript 形态与 Vite、Bun、Electron 43 可作为候选适配；现有 `package.json` 未声明它，不能在本轮安装或写入 package.json。

**官方资料**：[jsdiff 官方 GitHub README/API](https://github.com/kpdecker/jsdiff)、[`diff` npm 元数据](https://www.npmjs.com/package/diff)。

**Decision: NEEDS DECISION**

### 候选 C：Git patch/check/3-way 能力

**适用范围**：把 canonical file 的变化表达为 unified patch，在 main 的受控 Git adapter 中做 `--check` 或有限 3-way 分析；适合与 `001-project-storage` 的 Git-backed history 方向一起评估。

**优点**：

- Git 官方文档明确区分 `--check`（只检查是否可应用）和 `--3way`（尝试三方合并并在冲突时留下冲突信息）。
- 可以利用已有项目 revision/blob identity 和 history handoff，减少自建文件 patch 格式的长期维护。
- 适合保存后生成 `010` 所需的 changed files/diff 元信息。

**风险**：

- Git patch 主要是文件/行级语义，不天然理解 Block identity、citation validity 或“只应用被接受的 change IDs”。
- 依赖 app-managed Git runtime、跨平台命令参数、超时、stderr 脱敏和 binary policy；不能直接把任意 Git command 暴露给 renderer。
- `--3way` 能产生冲突标记，不代表产品可以自动接受；需要把结果转换为稳定 error/blocked DTO。

**与现状适配**：只有 main 可以调用受控 adapter；preload/renderer 不能接触 Git。由于 ADR 当前 `Proposed`，Git runtime 是否随应用携带、如何固定 executable、是否允许 fallback 都是跨边界决策。

**官方资料**：[Git `git-apply` 官方文档](https://git-scm.com/docs/git-apply)。

**Decision: NEEDS DECISION**

### Diff/冲突结论

建议先冻结与库无关的 `ProposalChange` 操作、Block fingerprint、overlap 判定和 atomic apply contract，再在小型 fixture 上比较候选 A/B/C 的结果、超时和错误可解释性。**不批准任何候选作为实现依赖。**

## Candidate group B — Schema/runtime validation

IPC 和项目 JSON 是不可信输入边界；TypeScript compile-time 类型本身不能替代 main runtime validation。候选如下。

### 候选 A：Zod

**适用范围**：在 shared 中定义 DTO schema，main 对 IPC request、proposal envelope、storage envelope 做 parse/safeParse；可由 schema 推导 TypeScript 类型。

**优点**：TypeScript-first、Node 和现代 browser 可用、错误包含具体 path；可直接表达 discriminated union 和自定义 refine，适合 proposal operation/state。

**风险**：schema 与类型双向推导的组织方式需统一；错误格式可能需要映射为稳定的产品 error code；如果 schema 进入 renderer bundle，需评估体积和敏感字段处理；不能让“parse 成功”替代业务 revision/权限校验。

**与现状适配**：React 19.2.7/Vite/Bun/TS 5.8 均可作为候选环境；目前没有依赖，也未决定是否让同一 schema 在 main 和 renderer 共用。

**官方资料**：[Zod 官方 GitHub](https://github.com/colinhacks/zod)。

**Decision: NEEDS DECISION**

### 候选 B：TypeBox + Ajv

**适用范围**：用 TypeBox 生成 JSON Schema，以 Ajv 在 main 验证 JSON/IPC；适合需要持久化 schema、schemaVersion、外部 fixture 和跨语言/工具链可读性的设计。

**优点**：TypeBox 产出 JSON Schema 并从 schema 推断 TypeScript；Ajv 支持 JSON Schema/JTD、多 draft、编译验证函数和 tagged validation errors。

**风险**：需要同时管理 TypeBox schema、Ajv validator、JSON Schema draft 和错误映射；draft 选择会变成持久化兼容承诺；复杂 refine/business rule 仍需手写；两个包的版本组合和 bundle/compile 行为需要锁定。

**与现状适配**：main 可做 compiled validator；JSON envelope 与 ADR 的 `schemaVersion` 相容性较好；现有 TypeScript 7.0.2 要避开只针对未来 compiler 的候选主版本，具体版本策略未决定。

**官方资料**：[TypeBox 官方文档](https://sinclairzx81.github.io/typebox/)、[TypeBox 官方 GitHub](https://github.com/sinclairzx81/typebox)、[Ajv TypeScript 指南](https://ajv.js.org/guide/typescript.html)、[Ajv JSON Schema 指南](https://ajv.js.org/json-schema.html)。

**Decision: NEEDS DECISION**

### 候选 C：Valibot

**适用范围**：用模块化 schema/action 在 shared/main 做运行时验证，按需导入，或作为 schema-agnostic boundary 的实现。

**优点**：官方文档强调模块化、无依赖、可运行于 Node/Bun/Deno/浏览器；支持 strict/loose object、静态推断和 Standard Schema v1 互操作。

**风险**：项目仍需决定持久化 schema 是否需要 JSON Schema 文档；unknown field、版本迁移和 error code 不能交给默认 object 行为；若 main/renderer 用不同 import 方式，需检查 bundler 和 ESM 行为。

**与现状适配**：官方指南列出 Node/Bun、TypeScript strict 和 ES2020 目标，和现有 ES2022/strict 基线匹配；当前 repo 没有 Valibot，不能把其能力当成已安装。

**官方资料**：[Valibot introduction](https://valibot.dev/guides/introduction/)、[Valibot installation/compatibility](https://valibot.dev/guides/installation/)、[Valibot Standard Schema integration](https://valibot.dev/guides/integrate-valibot/)。

**Decision: NEEDS DECISION**

### Schema 结论

无论最终选 A/B/C，稳定对外的必须是 feature 自有 DTO、明确的 `kind/schemaVersion`、未知版本错误和产品 error code，不是 validator 的原生异常。若不引入第三方 validator，也必须在 main 保留同等覆盖范围的纯函数校验。

**Decision: NEEDS DECISION**

## Candidate group C — 原子写入与持久化

### 候选 A：Node `fs/promises` + 同目录 temp/rename + pending journal

**适用范围**：采用 ADR 提出的 domain files，main 自己实现单文件 atomic replace、跨文件 pending transaction、hash/recovery。

**优点**：无新增包；`rename`、`writeFile`、`mkdtemp`、`crypto` 都是 Electron 43 所带 Node 能力；能把 proposal/review/content/history 语义集中在项目 storage owner。

**风险**：Node 文档也说明异步 filesystem 操作的排序/并发需要谨慎；跨文件 rename 不是数据库事务，必须自行记录阶段、before/after hash、fsync/commit 状态和 recovery policy；跨平台权限、文件锁、外部编辑和 Git working tree 需要 fixture。

**与现状适配**：完全适配现有 main TypeScript/ESM，不影响 renderer bundle；最符合当前“无数据库、main-owned storage”的 foundation，但依赖 ADR 接受和较多测试。

**官方资料**：[Node.js `fsPromises.rename`/`writeFile`](https://nodejs.org/api/fs.html#fspromisesrenameoldpath-newpath)、[Node.js filesystem concurrency guidance](https://nodejs.org/api/fs.html)、[Node.js crypto hash](https://nodejs.org/api/crypto.html#cryptocreatehashalgorithm-options)。

**Decision: NEEDS DECISION**

### 候选 B：`write-file-atomic` 或 `atomically` 辅助包 + 自建 transaction coordinator

**适用范围**：让成熟辅助包处理单文件 temp/fsync/rename/同路径排队，再由 main 自建多文件 pending journal 和 Git/history handoff。

**优点**：候选包文档提供单文件 atomic write、temp file、fsync 和同路径串行化能力；可减少低层重复代码。

**风险**：辅助包不能自动提供 proposal-level multi-file transaction、revision check、Git commit 或恢复判定；必须审查许可证、依赖、Electron/Bun/Node 版本和是否需要 CJS/ESM bridge；引入包容易让团队误以为“atomic write = 全部保存成功”。

**与现状适配**：main-only 使用可行；不应进入 renderer。现有 package.json 和 bun.lock 没有这些包，版本、锁定和是否接受第三方写入辅助均未决定。

**官方/权威资料**：[npm `write-file-atomic`（含官方仓库链接、API 和版本信息）](https://www.npmjs.com/package/write-file-atomic)、[npm `atomically`（候选对照）](https://www.npmjs.com/package/atomically)。

**Decision: NEEDS DECISION**

### 候选 C：项目内 SQLite transaction

**适用范围**：将 proposal/review/content metadata 放进本地数据库，以数据库事务解决多实体更新；仍需决定 Markdown/source 文件如何与 DB 一致。

**优点**：SQLite 官方保证 serializable、atomic、consistent、isolated、durable transactions；适合查询大量 proposal/review 状态和事务边界。

**风险**：会增加与 ADR-001 editor-native domain files、Git history、Electron native binding/packaging、Bun test、迁移、备份和 binary/source 文件一致性的协调范围；数据库事务不能自动覆盖外部 canonical document 修改或 Git commit handoff。

**与现状适配**：理论上可在 main 使用，但当前 package.json 没有 SQLite binding，也没有 native rebuild 流程；不能在本轮把它写成默认存储。

**官方资料**：[SQLite transactional guarantees](https://www.sqlite.org/transactional.html)、[SQLite transactions](https://www.sqlite.org/lang_transaction.html)。

**Decision: NEEDS DECISION**

### Storage 结论

proposal review 不需要新的数据库才能落地；第一版可保持 storage adapter interface，让 A/B/C 只影响 adapter 内部。但是否采用 ADR 的 domain files + pending protocol、是否引入 helper、是否改为 SQLite 是跨 feature durable decision，必须由 ADR/决策清单关闭。

**Decision: NEEDS DECISION**

## Candidate group D — Diff viewer / React integration

### 候选 A：现有/未来 Block editor 的 React 原生 view

**适用范围**：proposal review 以 Block card/detail view 展示结构化原文、建议、证据和状态；字符级差异使用稳定 DTO 的 `segments`，不引入完整编辑器。

**优点**：与作者审阅语义一致；小 bundle；可直接控制键盘、ARIA、颜色替代和 conflict banner；不把 renderer 绑定到 Monaco/CodeMirror 数据模型。

**风险**：需要自建文本 diff renderer 和大文本折叠；未来 `004` 编辑器若选用不同模型，需定义 adapter；React render 大 proposal 时必须设上限/virtualization policy。

**与现状适配**：React 19.2.7 直接适配；当前只有基础 `App.tsx`，没有可复用 editor component，故它是架构候选而不是现成能力。

**Decision: NEEDS DECISION**

### 候选 B：CodeMirror 6 `@codemirror/merge`

**适用范围**：提供 split/unified merge view、折叠 unchanged、inline change 和可编辑/只读文档组合；适合文本型 diff viewer，不负责 proposal domain state。

**优点**：官方文档和 changelog 显示 merge package 持续发布；支持 unified view，文档可设为 read-only；TypeScript/ESM 生态适合 Vite。

**风险**：引入多个 CodeMirror packages 和 editor lifecycle；其 merge chunks 不是 Block-level apply contract；需要自建 ARIA labels、accepted/rejected action wiring 和 large-document policy；如果未来 Block editor 非 CodeMirror，可能出现两套编辑器体验。

**与现状适配**：React 19.2.7 可通过 component lifecycle 接入，Bun/Vite 可作为候选；package 及版本未进入当前依赖。

**官方资料**：[CodeMirror merge package 文档/发布页](https://www.npmjs.com/package/%40codemirror/merge)、[CodeMirror changelog](https://codemirror.com/docs/changelog/)。

**Decision: NEEDS DECISION**

### 候选 C：Monaco diff editor

**适用范围**：提供成熟的双栏/inline code diff UI、accessible diff navigation 和 editor models；适合把正文作为文本编辑模型展示。

**优点**：Microsoft 官方项目，diff editor API 明确；长文本编辑能力和开发者熟悉度较高。

**风险**：比 Block review 所需能力重；bundle/worker/CSP/worker URL、memory/lifecycle 和 Electron packaging 需要专项验证；Monaco model URI/line diff 仍不能代表 stable Block identity 或 safe apply；会把“提案审阅”拉向完整 code editor。

**与现状适配**：浏览器/Vite/Electron 可以作为候选，但需额外 worker 配置和 React wrapper 设计；当前没有 editor runtime。版本和 license review 未决定。

**官方资料**：[Monaco Editor 官方 GitHub](https://github.com/microsoft/monaco-editor)、[Monaco `createDiffEditor` API](https://microsoft.github.io/monaco-editor/typedoc/functions/editor.createDiffEditor.html)。

**Decision: NEEDS DECISION**

## 固定平台基线与验证工具

这些不是本轮要重新选择的产品依赖，而是必须遵守的现状/官方能力：

- Electron 官方建议 context isolation、sandbox、named contextBridge wrapper、IPC sender validation，并明确不要暴露完整 `ipcRenderer`；详见 [contextBridge](https://www.electronjs.org/docs/latest/api/context-bridge)、[Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security)、[ipcMain.handle](https://www.electronjs.org/docs/latest/api/ipc-main)。
- Bun 提供内建 Jest-compatible test runner、TypeScript/JSX 支持、timeout/retry/rerun 等能力；现有 `bun run test` 是验证入口，不代表必须把 Electron runtime 当作 Bun 环境运行。详见 [Bun test](https://bun.sh/docs/test)、[Bun writing tests](https://bun.sh/docs/test/writing-tests)。
- `ipcMain.handle` 的异常只会以序列化后的 `message` 传回 renderer，因此产品 error code/message DTO 必须显式返回，不能依赖原始 Error class；这与 `contracts/proposal-ipc.md` 的错误 envelope 一致。

## 未决研究项清单

1. **Decision: NEEDS DECISION** — diff domain 是自研 Block-first、jsdiff 辅助还是受控 Git patch；最终不应允许任意 patch 直接写正文。
2. **Decision: NEEDS DECISION** — Zod、TypeBox+Ajv、Valibot 或无第三方 validator；需要同步冻结 unknown fields、schema draft、error mapping。
3. **Decision: NEEDS DECISION** — Node 原生 pending protocol、single-file atomic helper 或 SQLite；需与 ADR-001 一起决定。
4. **Decision: NEEDS DECISION** — React 原生 Block view、CodeMirror merge 或 Monaco diff；需以 a11y、bundle、长文本和未来 004 编辑器为比较维度。
5. **Decision: NEEDS DECISION** — 每个候选的精确版本、Bun lockfile 策略、Electron 43 packaging/native rebuild/CSP/worker 策略和许可证审查。
6. **Decision: NEEDS DECISION** — 允许的 proposal/Block/批量规模、timeout、p95、内存和取消语义。
7. **Decision: NEEDS DECISION** — ADR-001 是否直接接受、追加 proposal-specific ADR，或在 storage owner 中增加迁移/recovery ADR。
