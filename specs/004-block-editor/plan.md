# Implementation Plan: Block 章节编辑器

Branch: `codex/v2-greenfield`
Date: 2026-07-12
Spec: [spec.md](./spec.md)
Status: Draft — technical direction selected; implementation remains gated on acceptance

## Summary

以 BlockNote 作为 block editor，通过窄 editor adapter 实现章节创建、Block 操作、引用
关系、保存/恢复和冲突保护。章节的 canonical durable document 是带 WriteLLM wrapper
的 BlockNote JSON；常见 Markdown 语法只作为输入、粘贴和显式导出能力，不作为内容真相。

PRD 不固定 BlockNote 或任何其他技术栈；BlockNote 是本计划和研究阶段选定的实现方案。

## Current baseline

当前仓库只有 Electron main/preload/shared/React renderer startup foundation；`001`–`003`
提供的 project/session/workspace/orientation contract 仍需在实现前被接受。当前没有章节
存储、BlockNote 依赖或 editor adapter。

## Technical Context

**Language/Version**: TypeScript 5.8、React 19、Electron 40、Vite 6、Bun 1.3.4。
**Primary Dependencies**: 选定 BlockNote editor family（`@blocknote/core`、`@blocknote/react` 及接受后的 UI adapter）；精确版本、UI package、许可证和 Electron/Bun 兼容性需在实现前锁定。
**Storage**: main-owned `ChapterDocumentStore`；canonical payload 为 `writellm.chapter.blocknote` JSON。底层可以是项目内 JSON 文件或之后接受的项目内数据库，但不能改变 shared document contract。
**Testing**: Bun unit/contract/integration tests，加上 compiled Electron smoke；必须覆盖 BlockNote adapter、schema validation、Markdown lossy warning、citation identity、stale save 和恢复失败。
**Target Platform**: Electron desktop app，macOS、Windows、Linux；单作者、单机、首版不做实时协作。
**Project Type**: 沙箱化 Electron desktop app。
**Performance Goals**: 满足 spec 的 SC-001–SC-005；100 次 Block 操作和保存/重开测试不得丢失未选中内容、块顺序或引用关联。本 feature 不新增未经接受的毫秒级 SLA。
**Constraints**: renderer 不接触文件路径、数据库连接、Git、凭据或 generic IPC；main 验证所有 document/command/revision 输入；未知 block type、schema 和 Markdown 不可表达内容不得静默丢失或重绑定。

## Constitution Check — pre-research gate

| Principle | Status | Evidence / gate |
|---|---|---|
| I. Secure Desktop Boundary | PASS WITH ACCEPTANCE CONDITION | BlockNote 只运行在 renderer/editor adapter；文件、数据库、路径、revision 和恢复由 main/storage owner 管理。 |
| II. Typed, Minimal IPC | PASS WITH ACCEPTANCE CONDITION | `contracts/contract.md` 只列出 load/validate/apply/save/export named methods；preload 不暴露 editor instance、path 或 generic IPC。 |
| III. Specification-Driven, Minimal Evolution | BLOCKED UNTIL ACCEPTED | 004 spec、storage ADR、依赖 feature contract 和本 plan 尚未 Accepted；本计划不授权实现。 |
| IV. Verification at the Failure Boundary | PASS WITH PLAN | unit/contract/integration/compiled Electron smoke 分别覆盖 editor、IPC、storage 和 runtime failure boundary。 |

**Gate conclusion**: 技术方向已经从候选编辑器收敛为 BlockNote，但 package/version、
document schema、Markdown interop、revision/conflict 和 storage ADR 仍需接受后才能进入
tasks/implementation。

## Design decisions

1. **Canonical**: `ChapterDocument.editorFormat = "blocknote-json"`，BlockNote JSON
   是章节正文、Block identity、嵌套结构和高级 props 的唯一 durable truth。
2. **Markdown interop**: 常见 Markdown 可输入、粘贴和导出；转换允许 lossy，必须对
   不可表达内容给出明确结果。Markdown 不负责恢复 block id 或 citation relation。
3. **Identity**: 使用 BlockNote block id；不使用 Markdown HTML comments 作为 identity
   codec，也不维护第二套独立的 durable `Block` schema。
4. **Repository**: editor adapter 只转换 BlockNote editor state 与 bounded DTO；main
   repository 负责 schema、revision、atomic save、transaction、migration/recovery。
5. **Physical storage**: 当前计划不因 BlockNote 非 Markdown 而强制 SQLite。JSON 文件与
   数据库都是 repository implementation choice，必须保持 portable project 和同一逻辑 contract。

## Project Structure

```text
src/
├── shared/
│   └── document.ts                         # ChapterDocument/BlockNote DTO/error types
├── main/project/
│   ├── content-repository.ts               # main-owned load/save/revision/transaction
│   ├── document-validation.ts              # wrapper/block/schema/citation validation
│   └── markdown-interchange.ts             # explicit import/export boundary
├── preload/preload.cts                     # named chapter IPC wrappers only
└── renderer/features/editor/
    ├── adapter/blocknote-adapter.ts        # BlockNote ↔ bounded editor contract
    ├── commands.ts                         # user-intent/block command mapping
    └── components/ChapterEditor.tsx        # BlockNote UI composition

test/
├── unit/editor/                            # pure commands, validation, adapter mapping
├── contract/editor/                        # DTO/error/redaction/preload methods
├── integration/editor/                     # chapter and Markdown user journeys
└── runtime/editor/                         # compiled Electron and storage failure smoke
```

## Implementation phases

### Phase 0 — Product/architecture acceptance

1. 接受 004 PRD 的用户行为要求，不把 BlockNote 名称写入 PRD 的实现性要求或 success criteria。
2. 接受本 plan、[data-model.md](./data-model.md)、[contracts/contract.md](./contracts/contract.md)
   和 editor storage ADR。
3. 锁定 BlockNote package/version/UI adapter、custom block schema、Markdown subset/lossy
   policy、unknown block migration 和 citation anchor 规则。

### Phase 1 — Document schema and storage boundary

1. 实现 `ChapterDocument` wrapper、schemaVersion/editorSchemaVersion、block validation、
   stable id、revision 和 unknown-version/read-only policy。
2. 实现 main-owned content repository；保存顺序为 validate → serialize canonical
   BlockNote JSON → atomic write/transaction → return revision。
3. 把 Markdown import/paste/export 放在独立 adapter；export 失败不得伪装成 canonical
   save 失败，除非用户明确请求的是 export operation。

### Phase 2 — BlockNote editor adapter and commands

1. 创建 BlockNote editor 并加载 canonical `blocks`，将编辑器变更映射到 bounded domain
   commands；renderer 不直接持有 persistence authority。
2. 实现新增、编辑、移动、拆分、合并、删除和空章节状态，保持 BlockNote IDs 与 children。
3. 处理 dirty baseline、selection、保存中继续编辑、保存失败后的可恢复草稿和 stale revision。

### Phase 3 — Citations and Markdown interop

1. 以 `blockId/sourceId/chunkId/range/validity` 保存引用关系；Block 操作后执行关系校验。
2. 支持常见 Markdown 输入/粘贴和显式 Markdown 导出；不可表达的 custom block/props 必须
   产生 warning 或可识别降级结果。
3. 禁止用 Markdown marker 自动恢复缺失、重复或冲突的 Block identity；异常进入 needs-review。

### Phase 4 — IPC, recovery and failure-boundary verification

1. 实现 `loadChapter`、`validateChapter`、`applyBlockCommand`、`saveChapter` 和
   `exportChapterMarkdown` named IPC；main 校验 sender、project session、revision、大小和 schema。
2. 通过 compiled Electron smoke 验证 renderer/preload/main 的真实路径、无 path/editor
   instance/secret 泄漏以及失败不假成功。
3. 覆盖 malformed BlockNote JSON、unknown block type、duplicate/missing id、citation
   invalid、stale save、外部修改、权限/写入中断、重启恢复和 Markdown lossy warning。

## Boundary and validation

| Boundary | Owner | Must not cross |
|---|---|---|
| BlockNote renderer | Editor adapter/UI | 文件路径、数据库连接、Git、凭据、raw IPC |
| Preload | Named typed wrappers | editor instance、generic channel、raw Error、任意 document write |
| Main/repository | Schema/revision/storage/interop | 未验证的 blocks、任意路径、renderer 伪造的 identity/revision |
| Markdown adapter | Explicit import/export | canonical identity、citation truth、silent lossy conversion |

## Constitution Check — Phase 1 design re-check

| Principle | Status | Design evidence / remaining gate |
|---|---|---|
| I. Secure Desktop Boundary | PASS WITH ACCEPTANCE CONDITION | BlockNote 只在 renderer；main owns document storage and validation；compiled smoke 必须证明没有 privileged object 泄漏。 |
| II. Typed, Minimal IPC | PASS WITH ACCEPTANCE CONDITION | 五个 named document methods及 bounded DTO 已定义；完整 error/cancel/recovery contract 仍需冻结。 |
| III. Specification-Driven, Minimal Evolution | BLOCKED UNTIL ACCEPTED | 004 spec、plan、storage ADR、依赖 feature contracts 和 BlockNote schema decisions 仍需 review/acceptance。 |
| IV. Verification at the Failure Boundary | PASS WITH ACCEPTANCE CONDITION | 设计包含 editor adapter、IPC、storage、Markdown interop 和 compiled Electron failure tests。 |

**Post-design gate**: BlockNote 已被选为实现方向，但这不是实现授权。所有跨 durable/process
boundary 的 schema、revision、interop、recovery 和 IPC decisions 必须先接受。

## Implementation gate decisions still required

1. 精确 BlockNote package/version、UI adapter、许可证和 React 19/Electron 40/Bun 兼容性。
2. `ChapterDocument` schema、custom block namespace、unknown block migration 和 document revision。
3. 常见 Markdown 支持子集、导入/粘贴/导出 API、lossy warning 和不可表达 block 的 fallback。
4. Citation range/anchor 与 BlockNote block split/merge 的保留或 needs-review 规则。
5. stale save、外部修改、storage failure、recovery 和 `exportChapterMarkdown` error semantics。

## Complexity Tracking

无 Constitution exception。BlockNote adapter、canonical wrapper 和 Markdown interop adapter
是为了隔离第三方 editor schema 与产品 durable schema；不新增第二套 block truth，也不因
Markdown export 自动引入数据库或实时协作。
