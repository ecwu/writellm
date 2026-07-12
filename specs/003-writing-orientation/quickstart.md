# 003 写作方向端到端验证指南

**状态**: 规划阶段的可执行验证场景；当前仓库尚未实现 003，场景在实现后运行。所有技术选择和阈值见 [plan-decisions checklist](./checklists/plan-decisions.md)。

## 前置条件

- 已接受 003 spec、ADR-001、001 project storage/IPC contract、002 workspace/location contract。
- 已按最终决策准备依赖；本次规划不运行联网安装命令、不修改 `package.json`。
- 本地已存在仓库当前 lockfile 与 Bun；Electron binary 可由 `bun install` 后的既有依赖提供。
- runtime smoke 使用临时目录和 fixture project，不使用真实 `app.getPath('userData')` 中的项目，也不把绝对路径打印到 renderer。
- 需要准备的 fixture：有效 `.writellm` project manifest、空 `content/writing-orientation` 文档、至少三个 outline item、已关联 chapterRef 的条目、以及可控的 `runtime/pending` transaction；fixture schema/path 等待 ADR/001 contract 冻结。
- 外部 provider、网络服务和凭据不是本 feature 前置条件；默认离线验证。若最终 Git 方案需 packaged runtime，smoke runner 还需准备受控 Git fixture/runtime。

## 先运行现有仓库检查

在仓库根目录执行：

```sh
bun run typecheck
bun run test
bun run build
bun run test:smoke
```

预期：现有 startup foundation、shared IPC contract、Electron build 和 compiled preload smoke 均通过。若新增 003 测试仍使用仓库默认 `bun test` discovery，可直接包含在 `bun run test`；不要为本 feature 假设尚未存在的新 script。

手工打开开发运行时：

```sh
bun run dev
bun run dev:electron
```

`bun run dev` 应先保持运行；`bun run dev:electron` 启动 Electron。开发窗口中应能看到 002 shell 和 003 writing-orientation panel（实现后），而不是把 storage 操作移到 Vite renderer server。

## 场景 A：空项目填写动机并恢复

1. 用 001 的创建/打开流程打开一个空 `.writellm` fixture。
2. 在写作方向面板填写问题、目标读者和预期结果，允许其中一项或全部为空；观察状态从 dirty/saving 到 saved 的文字反馈。
3. 关闭并重新打开项目。
4. 预期：三段已保存文本完整恢复；空动机显示“尚未填写”而不是 error；project identity、其他项目内容和大纲不被改变。

边界：构造一次 storage write failure。预期当前草稿仍在 renderer、状态不是 saved、错误给出可执行 retry；retry 成功后才更新 `contentRevision` 和 saved 状态。对应 [data-model.md](./data-model.md) 的 persistence state 与 [IPC contract](./contracts/writing-orientation-ipc.md)。

## 场景 B：大纲增删改、排序和状态

1. 新增至少三个条目，分别设置标题、摘要和默认/手动状态。
2. 修改一个标题和摘要；将第三个条目移到第一位；删除一个无 chapterRef 的条目。
3. 保存，关闭应用，再打开同一项目。
4. 预期：列表顺序、标题、摘要、状态和剩余条目稳定；没有重复条目；保存方向不改变未来章节/其他项目内容。
5. 重复提交相同 save request 或快速触发两次保存。
6. 预期：main 串行队列/幂等策略不会制造重复项或错误顺序；具体 replay 结果按最终决策的 `clientMutationId` contract 判断。

## 场景 C：空白标题、冲突和关联章节删除

1. 新增标题为空、仅空格和包含未支持控制字符的条目。
2. 预期：标题为空白时不能保存，反馈指出修改内容；动机为空仍可保存；控制字符错误不泄露路径或堆栈。
3. 使用两个基于同一个旧 `baseRevision` 的 save request，先提交一个，再提交另一个。
4. 预期：过期请求得到 `REVISION_CONFLICT` 或最终接受的等价错误，不能覆盖较新保存；renderer 保留可恢复草稿。
5. 选择有 chapterRef 的条目删除但不确认影响。
6. 预期：得到 `OUTLINE_ITEM_HAS_CHAPTER`，条目和 chapter 都保留；显式确认后只执行 003 约定的 outline 删除，chapter lifecycle 按 004 contract 处理。

## 场景 D：重启、最后位置与工作台接入

1. 在 002 shell 中打开写作方向面板，选中一个条目并离开项目；保存位置贡献。
2. 重启 Electron，重新打开项目。
3. 预期：工作台恢复到写作方向入口和可用的 selected item；若 item 已删除，回退到合理位置并明确状态；未保存草稿不能被显示为已保存。
4. 打开/关闭其他 panel，再回到写作方向。
5. 预期：主要编辑上下文、焦点/滚动和保存状态遵循 002 contract，不由 003 重建整个 shell。

## 场景 E：pending transaction / external change recovery

准备两个 fixture：

- `pending-before-write`：pending intent 存在，canonical 文件仍为旧 hash。
- `pending-after-write-before-commit`：canonical 文件已替换但 Git commit 标志/transaction 阶段未完成。

分别重新打开项目：

- 可安全重试的阶段应由 main/storage adapter 重试并完成或进入明确 recovery UI；
- 无法证明安全关系时应返回 `STORAGE_RECOVERY_REQUIRED`，保留原文件，不静默重建空文档或覆盖新内容；
- 外部修改应返回 `EXTERNAL_CHANGE`/最终等价错误，并提供重新加载或人工处理路径。

这个场景必须在真实 compiled Electron runtime 中运行一次；只在 renderer 单元测试中模拟不满足 constitution IV。

## 场景 F：排序与可访问性

1. 只用键盘在列表中定位条目，执行上移/下移或最终选定的 keyboard drag 操作；使用 Escape 取消未完成拖动（若有拖动模式）。
2. 用读屏/可访问性树检查条目身份、当前位置、状态、删除影响和保存错误均有可理解名称/announcement；状态不能只靠颜色。
3. 在 960×640 最小窗口运行，打开/关闭面板、编辑摘要和找到 retry。
4. 预期：排序有不依赖 pointer 的等价路径；焦点不被面板切换吞掉；主要写作区和保存错误入口可达。具体库即使选 dnd-kit/Pragmatic DnD，也不能替代这些要求。

## 结果记录与退出条件

每次验证记录：fixture schemaVersion、Electron/Bun 版本、平台、save/reopen 次数、是否触发 failure/recovery、错误 code、最后 durable revision。不要记录绝对项目路径、正文 secret 或 provider credential。

003 可进入实现阶段的最低退出条件：

1. 003 spec、ADR-001、001/002 contracts 和 [plan-decisions.md](./checklists/plan-decisions.md) 中的阻塞项已处理；
2. IPC DTO、stable error codes、storage schema/path、migration/recovery、performance/accessibility/offline boundaries 已冻结；
3. 场景 A～F 至少有对应的 Bun/unit、storage integration、compiled Electron smoke 或明确的 accepted exclusion；
4. `bun run typecheck`、`bun run test`、`bun run build`、`bun run test:smoke` 均可在无网络条件下运行通过。

