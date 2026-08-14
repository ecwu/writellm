# Cordis 与 DeepSeek Harness 源码预研

Status: code-first pre-research snapshot; not an accepted WriteLLM architecture decision  
Recorded: 2026-08-14  
Branch: `cordis-reform`

## 1. 目的与边界

本文回答三个问题：

1. Cordis 在代码中究竟提供了什么运行时模型；
2. DeepSeek Harness 如何把这个模型扩展成完整的 Agent Harness；
3. DeepSeek Harness 实际实现、装配了哪些 Cordis 组件与能力插件。

这是一份重新设计前的源码预研，不是旧 Agent 架构的增量改造方案，也不接受现有
WriteLLM 文档作为新架构约束。现有实现只会在下一阶段作为功能、数据、安全和迁移风险清单
使用。

本次明确采用以下证据优先级：

1. 固定提交上的源代码、测试和装配配置；
2. 同一仓库中的维护者文档和教程；
3. package manifest 与发布元数据；
4. 论文只解释研究背景，不用于推出实现结论。

因此，本文不会用论文中的数学性质替代工程分析。论文讨论的时空可组合性及其形式化保证，
与生产系统能否因外部网络、数据库、子进程或未完成 Promise 而长时间等待，不是同一层面的
命题。

## 2. 结论先行

### 2.1 Cordis 是组件运行时，不是 Agent 框架

Cordis 的核心不是 prompt、tool calling、memory 或 agent loop。它提供的是一个带生命周期的
依赖注入和组合运行时：

- `Context` 表示组件可见的服务和作用域；
- plugin 是被装入 `Context` 的运行时组件；
- `Service` 是通过 context key 暴露的能力；
- `inject` 声明组件的依赖，并驱动自动激活、挂起和重激活；
- `Fiber` 持有一个 plugin 实例的状态、依赖 epoch 和资源清理函数；
- `effect` 把资源获得与释放绑定在同一个生命周期里；
- typed event 提供同步通知、并行通知、串行仲裁和 waterfall 中间件；
- Loader/Include/Group 把 YAML 配置变成可热重组的组件树。

换句话说，Cordis 解决的是“能力怎样被声明、组合、替换和撤销”，而不是“Agent 应该怎样
思考”。Agent 的会话、循环、工具、策略和持久化仍需要上层系统定义。

### 2.2 这里的 plugin 不是传统插件市场概念

后续设计必须避免把以下概念都叫作“插件”：

| 概念 | 在 Cordis / DeepSeek Harness 中的含义 |
| --- | --- |
| Cordis plugin | 可被 `ctx.plugin()` 装载并拥有 Fiber 生命周期的函数、类或 `{ apply }` 对象 |
| Service | 通过 context key 暴露的能力契约；一个 provider plugin 可以提供它 |
| Seam | DeepSeek Harness 对可替换能力边界的组织方式，通常含契约、provider、consumer/tool 和 policy |
| Loader entry | 配置树中的一个具名装配节点；不等于一个 npm package |
| npm package | 发布与代码组织边界；可能包含零个、一个或多个 Cordis plugin |
| UI module | 浏览器侧 Cordis 组件或纯 React atom；后者可以明确不依赖 Cordis |
| 外部扩展 | 用户安装或模型动态生成的扩展；只是 plugin 的一种来源，不是 plugin 的定义 |

因此，“把 Agent 功能都重新实现成 Cordis 插件”应理解为：把系统能力拆成由 Cordis
管理生命周期、依赖和作用域的组件，而不是把每项功能包装成第三方扩展包。

### 2.3 DeepSeek Harness 是 Cordis 上的一组协议和默认实现

DeepSeek Harness 的核心做法不是继承一个庞大的 Agent 类，而是定义稳定 service seams，再用
Cordis 组合 provider、policy、tool 和 UI：

```text
能力契约/service key
    -> provider plugin（实现能力）
    -> consumer/tool plugin（使用或暴露能力）
    -> policy/listener plugin（拦截、审批、限制、观测）
    -> bundle/profile/patch（选择并装配实现）
```

它把 Agent Harness 分成六条主要脊柱：

1. `agents` 注册和 agent-specific scope；
2. 可替换的 `agentLoop`；
3. append-only `sessions` 与投影；
4. provider-neutral `llm`；
5. `systemPrompt` 组装流水线；
6. `tools` 注册、执行和策略流水线。

Shell、文件、sandbox、审批、技能、子 Agent、compaction、workflow、web、存储和 UI 都围绕
这些 seam 继续组合，而不是塞入 agent loop。

### 2.4 DeepSeek Harness 依赖的是加固过的 Cordis fork

DeepSeek Harness 将 Cordis 源码 vendored 到仓库并重命名为 `@deepseek-ai/cordis`。它不是
简单地使用当时的上游 npm 包。其本地修改覆盖：

- Fiber 的重入卸载、异步清理可见性和卸载期间 effect 约束；
- Loader/Include 配置重组的事务化提交与失败回滚；
- HMR 更新串行化和精确配置监听；
- 等依赖激活后再解析配置，并在 provider 替换后重新解析；
- patch 对插入节点和后续覆盖的语义修复；
- include 变更、持久化写入和 Node 兼容性。

这意味着如果 WriteLLM 采用 Cordis，不能把“上游 Cordis”和“DeepSeek Harness 当前实际运行的
Cordis”视为等价前提。是否跟随上游、固定 fork，还是抽取必要加固，必须成为单独的架构决策。

## 3. 研究快照与可复现性

| 仓库 | 固定提交 | 预研时版本信息 | 用途 |
| --- | --- | --- | --- |
| `cordiverse/cordis` | `8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4` | `cordis@4.0.0-rc.8` | 上游核心、Loader、测试和教程 |
| `deepseek-ai/deepseek-harness` | `47f943859bef60e4160492346772ded9b24f765a` | repo `0.1.0-rc.5`; vendored package `4.0.1` | Harness、bundles、plugins、Cordis fork |

两个项目在预研日期都处于快速演进或 developer preview 阶段。上游 Cordis README 明确警告
API 不稳定；DeepSeek Harness 也明确保留 breaking changes。以下结论是固定提交快照，不应被
当作未来版本的兼容性承诺。

DeepSeek Harness 的 `vendor/README.md` 中仍记录了更早的上游 RC/commit，而 vendored
`package.json` 已写为 `4.0.1`。这说明设计时应以 vendored source、lockfile 和实际构建产物联合
确定来源，不能只依赖说明表格。

## 4. Cordis 的代码模型

### 4.1 Context：服务视图与作用域

`Context` 是一个 Proxy-backed 对象。它同时持有：

- 当前 scope 的 isolate realm 映射；
- service interception metadata；
- 当前 Fiber；
- service registry 与 reflect/provider 状态；
- event dispatcher；
- logger 和派生 context 所需元数据。

`ctx.extend(meta)` 派生新 context。派生 context 共享根注册系统，但可以有不同的作用域元数据、
隔离 realm 和拦截配置。它不是简单的全局 service locator。

读取 service 时，Proxy 会经由 reflect 解析当前 service key 对应的 realm 和 active provider。
读取未声明在 `inject` 中的 service 会抛出错误。这一约束让依赖声明既用于类型提示，也参与
运行时正确性。

### 4.2 Plugin：装载和生命周期单位

Registry 接受三类 plugin：

- 普通函数；
- 构造函数，通常是 `Service` 子类；
- 含 `apply` 的对象。

plugin 可以声明静态元数据：

- `name`：诊断和配置名称；
- `Config`：兼容 Standard Schema 的配置验证器；
- `inject`：必须或可选依赖；
- `provide`：它计划提供的 service keys；
- `intercept`：注入 service 时附加的访问配置。

`ctx.plugin(plugin, config)` 会创建一个 Fiber。Fiber 才是具体运行实例；同一个 plugin 定义可以
在多个 scope、配置和 isolate realm 中产生多个实例。

### 4.3 Service、provider 与 inject

`Service` 子类通过 `super(ctx, key)` 进入 provider 注册流程。service key 是扁平命名空间中的
字符串，因此大型系统必须约定稳定命名，避免无意冲突。

`inject` 是 Cordis 调度的核心：

- 必需 provider 未激活时，consumer Fiber 保持 `PENDING`；
- provider 激活后，consumer 才能加载；
- provider 消失或被替换时，consumer 会卸载；
- 新 provider epoch 可用后，consumer 会以新依赖重新激活。

配置文件中的先后顺序不是组件激活顺序。Loader 可以并发创建条目，真正的顺序由依赖关系
决定。

Cordis 不会在运行时验证两个同名 service 实现是否具有结构兼容性。兼容性仍依赖 TypeScript
声明、包版本约束、契约测试和团队纪律。

### 4.4 Fiber 状态机

上游 Fiber 具有以下状态：

```text
PENDING -> LOADING -> ACTIVE
              |          |
              v          v
            FAILED    UNLOADING -> DISPOSED
```

Provider epoch 变化可以使已激活 consumer 经卸载后重新进入等待和加载流程。Fiber 还持有：

- plugin uid；
- context 和 resolved config；
- dependency epochs；
- disposables；
- plugin-local store；
- inertia/更新协调状态。

DeepSeek Harness 在 vendored Fiber 上补了更多防护，因此评估行为时必须标明观察的是上游还是
vendored 版本。

### 4.5 Effect：获得与释放必须共址

`ctx.effect()` 是 Cordis 最关键的工程原语。一个 effect 可以是：

- 同步 setup，返回 disposer；
- async setup；
- generator；
- async generator。

注册事件监听、提供 service、启动 timer、创建子插件等资源都应由 effect 拥有。Fiber 卸载时，
对应 disposer 只执行一次；同一个 effect 内收集的内部 disposer 逆序运行。

上游 Fiber 对多个顶层异步 effect 的卸载使用并行等待。因此有严格清理顺序的资源必须放在
同一个 effect/disposer 中显式编排，不能依赖多个 effect 的注册顺序。

Effect 只能保证 Cordis 知道如何撤销本地生命周期资源。已经提交到远程 API、数据库或文件
系统的业务副作用不会自动回滚；这些动作仍需要幂等、事务、补偿或 durable recovery。

### 4.6 Isolate 与 intercept

`ctx.isolate(name, label?)` 为一个 service key 切换 realm。相同 service key 可以在不同 realm 中
绑定不同 provider，用于 session-specific 或 agent-specific 实现不泄漏到 root。

`ctx.intercept(name, config)` 不改变 provider 绑定，而是给 consumer 访问 service 时附加元数据。
DeepSeek Harness 可利用这个能力把 scope、策略或调用上下文传给稳定 service seam。

两者解决不同问题：

- isolate 选择“访问哪个 provider”；
- intercept 调整“怎样访问这个 provider”。

### 4.7 Event dispatch 是公开语义

Cordis 不只有一种 event：

| 模式 | 语义 | 典型用途 |
| --- | --- | --- |
| `emit` | 同步广播，不收集返回值 | 状态已经发生后的通知、缓存失效 |
| `parallel` | 等待全部 listener | flush、并行收尾 |
| `serial` | 依序等待，首个有效结果可终止 | 串行仲裁、选择一个处理者 |
| `bail` | 同步串行，首个有效结果终止 | 轻量同步查询 |
| `waterfall` | listener 通过 `next()` 组成 around-middleware | 请求、LLM、工具执行和策略管线 |

Listener 本身由 effect 管理，plugin 卸载后自动移除。事件模式不是实现细节；如果 provider、
policy 和 telemetry 依赖不同模式，它就必须成为 seam 的稳定协议并接受测试。

### 4.8 Loader、Include、Group 与 HMR

Loader 把 YAML entries 解析为组件树。每个 entry 有稳定 ID、plugin specifier 和 config；Group
提供嵌套，Include 引用其他配置，isolate 配置建立 realm。配置还支持 schema validation 和变量
插值。

DeepSeek Harness 使用 patch layer 修改这棵树，而不是手写一个固定 bootstrap：

```text
bundle patches（按用户选择顺序）
    -> profile patch
    -> home patch
    -> CLI overlays
    -> candidate Cordis tree
```

对同一个 entry 的 config patch 是整体替换，不是任意深度 merge。此处若理解错误，会出现
“只覆盖一个字段却丢掉其余配置”的隐蔽问题。

DeepSeek vendored 实现中，重载不是简单的 dispose 后重新 import：

- `Entry.update()` 对普通 config 先尝试在旧 Fiber 上更新；失败后恢复旧 config 并再次更新；
  更换 module/inject/group 时，先卸载旧 Fiber、启动候选，失败则重新启动旧 plugin；
- `EntryGroup.update()` 并发 settle 候选 entries，任一失败就删除新增项、按旧顺序恢复旧项；
- `Include.refresh()` 先把文件读取、解析、顶层结构校验为 detached candidate，child tree 更新成功
  后才提交 content/data cache；失败时保持上一棵树；
- child-tree mutation 走串行 queue，避免初始化 apply 与 watcher refresh 交错产生 teardown deadlock；
- HMR 对同一路径的刷新用 `dirty + running` 合并突发事件，disposer 会关闭 watcher 并等待所有
  refresh task；失败通过 `hmr/config-update-failed` 暴露，不会让 watcher 崩掉；
- module watcher `ignoreInitial: true`，避免启动扫描重复触发尚未完成的 include apply；配置专用
  watcher则精确匹配文件并保留初次读取语义。

这些细节说明产品级“重载”必须定义 candidate、commit、rollback、并发串行化和 shutdown drain，
而不能只定义一个 Reload 按钮。对 WriteLLM，配置/内容重载可以进入生产面；代码 module HMR 与任意
包加载则应保持为不同信任等级。

### 4.9 代码层面的保证边界

Cordis 能提供：

- 显式依赖驱动的激活与撤销；
- provider 替换后的 dependent 重组；
- scope/effect 绑定的资源清理；
- 可组合的事件中间件；
- 配置驱动的组件树。

Cordis 本身不提供：

- OS、进程或权限级 sandbox；
- 网络、数据库和文件副作用的自动事务；
- 任意 plugin 的终止保证；
- service 契约的运行时结构兼容验证；
- Agent 会话协议、loop、prompt、tool policy 或恢复语义；
- “缺失 provider 必须失败”的默认产品策略——consumer 可以一直 `PENDING`。

DeepSeek Harness 的 boot activation audit 正是为了把最后一点从框架行为提升成产品级 fail-loud
规则。

## 5. DeepSeek Harness 怎样围绕 Cordis 建立 Harness

### 5.1 启动不是导入主类，而是求解一棵组合树

CLI profile boot 创建 root `Context`，装载 Loader/Include/Group，然后按 bundle、profile、home 和
命令行 overlay 生成配置树。Bundle 是带 `dsh.bundle.patch` manifest 的 npm package；profile 是
用户选择的组合，不是 plugin 类。

`app-boot` 在树加载后执行两种审计：

- entry 是否实际获得 Fiber、是否 load failed；
- entry 是否进入 `ACTIVE`，还是因缺依赖停留在 `PENDING`。

若启动失败，它会清理已经建立的部分树。用户 patch 的 HMR 重组采用 candidate/commit 思路：
候选树失败时保留上一个可用组合。这些事务化行为有一部分来自 DeepSeek 的 Cordis fork。

### 5.2 Agent registry 与 agent loop 被刻意分开

`@deepseek-ai/dsh-agent` 定义 agent 接口、live registry、initiator scope 和事件，但不依赖具体
loop。`dsh-agent-loop` 再向 `ctx.agents` 安装默认 factory/loop。

这让以下替换不要求改动 session、UI 或 tool registry：

- 单步或多步 loop；
- 不同 stopping policy；
- 不同模型请求编排；
- 不同子 Agent driver；
- 测试用 fake loop。

一个 agent 的 `Agent.ctx` 是独立 Cordis scope。注册在该 scope 的 tool、prompt section 和
listener 只影响该 agent，并在 agent dispose 时一起撤销。`scopeTarget` 让事件按 scope chain
过滤；需要独立 provider 时再配合 isolate realm。

### 5.3 Durable session events 与 live Cordis events 分工

DeepSeek Harness 没有把 Cordis event bus 当成数据库。它明确分成两层：

| 层 | 责任 | 示例 |
| --- | --- | --- |
| SessionEvent log | 可恢复、可重放的事实 | user message、assistant chunk/message、tool call/result、turn/step 边界 |
| Cordis live event | 当前进程内的控制和扩展点 | pre-step、LLM stream、tool policy、stopping arbitration |

其核心不变量可以概括为：进入模型请求的任何内容，都必须能从 session log 重建。Prompt
assembly、compaction 或 tool-result pruning 可以改变当前模型视图，但不能产生无法解释的隐藏
历史。

典型 turn 轨迹为：

```text
turn/start
  step/start
    user/message（首步或新输入）
    agent/pre-step
    agent/request
      system-prompt/assemble
      llm/stream
    assistant/chunk*
    assistant/message
    tool/call* -> tool/result*
  step/end
  ... 0..n additional steps ...
turn/end
```

一个 turn 可以包含多个 model steps；一个 step 是一次模型请求及其随后触发的工具执行。

### 5.4 LLM 是 provider-neutral seam

`dsh-llm` 暴露 adapter registry/stream seam；DeepSeek、Pi AI 和 retry 分别由其他 plugin 提供。
Agent loop 不直接绑定具体模型 SDK。Token meter 又作为独立能力参与统计和 compaction 决策。

这不是为了追求“所有代码都抽象”，而是把以下变化隔开：

- provider SDK 和凭证格式；
- 模型选择；
- stream event normalization；
- retry/backoff；
- token accounting。

### 5.5 System prompt 是可组合流水线

`dsh-system-prompt` 维护 prompt sections 和 tool schemas，并通过
`system-prompt/assemble` waterfall 允许作用域内组件组装模型上下文。Agent instructions、time
context、skills、plan mode、goal 和 workspace context 可以作为独立 plugin 参与，而不是由一个
prompt builder 了解所有功能。

Prompt 变化用同步事件触发相关 cache/invalidation；assembly 则用 waterfall，因为它需要有序的
中间件语义。

#### 5.5.1 实现上值得直接借鉴的 prompt contribution 模型

`packages/core/system-prompt/src/index.ts` 并没有只暴露一个“追加字符串”的 hook，而是区分：

- `section`：具名、排序、可同步或延迟求值的 prompt section；
- `context`：独立排序的上下文贡献；
- `variable`：命名受限、按 scope 解析的变量 provider；
- `tools`：同时提供 model-visible schemas 和 known tool names；
- `complete` section：唯一、显式的完整 prompt provider。

注册表由全局层和 agent scope chain 组成。更具体 scope 中的同名注册项覆盖全局项，排序稳定；
每次注册都由当前 Fiber effect 持有 disposer。配置或内容改变会触发
`system-prompt/change`，真正组装则经过 `system-prompt/assemble` waterfall。完整 prompt provider
在 waterfall 后再次被强制落实，防止普通中间件暗中替换它。

这套实现的价值是把“提示词注入”变成可归属、可排序、可撤销、可重载、可对比的结构化贡献，
并为每次请求记录“谁贡献了什么”留下稳定身份，而不是让任意 plugin 在未知时点修改一大段文本。

#### 5.5.2 动态事实不一定属于 system prompt

`packages/context/time-context/src/index.ts` 在 `agent/pre-step` 注入的是带来源信息的 durable
`user/message`：来源明确标记 `kind: plugin`、plugin 名、`form: snapshot` 和 section 信息。它还会
检查历史事件并限流，避免每一步重复写入。

因此 DeepSeek Harness 实际区分了两类“注入”：稳定规则进入 prompt contribution；时效性事实
进入可重放、可追踪的 runtime-context snapshot。这对 WriteLLM 很重要，因为项目快照、当前任务、
时间等内容若只隐式拼进 system prompt，会破坏请求重建、cache 稳定性和调试可解释性。

### 5.6 Tool 是注册项，执行则是策略管线

工具定义通过 `ctx.tools` 注册，注册 disposer 由 plugin Fiber 持有。一次执行经过：

```text
模型 tool call
  -> 写入 durable tool/call
  -> tools/pre-execute waterfall
  -> 单调收紧的 guard / permission / approval
  -> tools/execute waterfall
       timeout / retry / metrics / tracing
       -> tool body
  -> tools/post-execute waterfall
  -> normalize / finalize
  -> 同步 tools/result 通知
  -> 写入 durable tool/result
  -> projection / UI
```

关键设计是把安全和运维策略做成 listener/guard plugin，而不是散落在每个工具函数中。同时，
策略必须“单调收紧”：后置扩展不应把前面已经要求的审批或拒绝重新放宽。

### 5.7 持久化、查询和投影彼此分离

`sessions` 负责 append-only 事件语义；`sessionPersistence` 有 JSONL 和 SQLite provider；
`sessionQuery`、`sessionProjections`、projection cache、stats、title 和 telemetry 是独立消费者。

这使 UI 不需要直接解释原始日志，也使更换持久化 backend 不必改 Agent loop。但 durable append
仍必须有自己的事务、flush 和恢复规则，不能仅靠 Cordis effect。

#### 5.7.1 请求头与 executable invariants

`packages/core/agent-loop/src/agent.ts` 在模型 dispatch 前写入完整 `request/header`，其中包含
provider/model 配置、assembled system prompt 和 tool schemas；初始、resume 或相较上一步改变时
都有明确 reason。请求对象随后被冻结，messages 从 durable session 派生。

`packages/core/agent-loop/src/invariant.ts` 再以独立 diagnostics plugin 检查：请求已经冻结、step
和 request header 已存在、messages 等于 `session.deriveMessages()`、header 与实际 provider request
完全一致。`runtime-diagnostics/invariants` 允许每个 package 发布 `./invariant` companion，覆盖
session enclosure、call/result 配对、状态转换、inbox FIFO、prompt assembly、compaction、stream
grammar、tool pipeline 等约束。

这比只写普通 unit test 更适合可组合系统：生产行为保持精简，而 debug/test 组合可以装入可执行
契约，直接在真实 plugin graph 上发现“某个新 plugin 破坏了什么不变量”。

#### 5.7.2 Telemetry seam 的可借鉴与不足

`session-telemetry` 规定 sink 的 `emit()` 必须非阻塞入队，`shutdown()` 负责有限期 drain；canonical
session log 不会因 telemetry 成败而改变。导出前经过 `session-telemetry/record` redaction
waterfall，任何 redactor 异常都应 withholding record。HMR 期间用 module-level cursor 避免重放旧
live events，但它明确只是 best-effort/at-most-once，不是 durable outbox。

`session-telemetry-otel` 使用 OpenTelemetry Logs 和 OTLP HTTP，并非完整的分布式 request spans；
默认关闭，而且代码明确警告：没有 redaction plugin 时，完整 message、prompt 和 tool output 可能
离开本机。因此 WriteLLM 可以借鉴非阻塞 sink、显式同意、fail-closed redaction 和有界 shutdown，
但用户需要的请求 Trace 仍应作为单独的本地 span service 实现，不能把现有 telemetry 当作已经满足。

### 5.8 Host 和浏览器各自有 Cordis context

Web app 不只是把 host plugin 暴露给 React。DeepSeek Harness 还有 browser-side Cordis tree：
client packages 通过 `dsh.client` metadata 被装入浏览器 runtime，负责 connection、modules、
locale、layout、settings、conversation、tools、permission、workflow 等 UI 能力。

与此同时，一些纯 React atoms 明确保持 zero-Cordis。这个边界表明“everything is a plugin”是
针对可组合产品能力，而不是要求每个无状态 view primitive 都成为 plugin。

#### 5.8.1 Trajectory 与 plugin inventory 的 UI 组织

`packages/client/ui-trajectory` 把 trajectory 作为独立 client plugin：它注册 conversation view
slot、event definitions、locale 和自己的 session projection，不修改 Chat snapshot。其 snapshot
builder 按 step 查找 `request/header`，显示 prompt/tool schema 相较前一 header 的变化，并组合
turn/step、assistant request、tool call/result、compaction、interruption、token usage、TTFT 和 decoding
duration。长会话支持分页、虚拟化、搜索、折叠和 streaming tail-follow。

`packages/host/plugin-inventory` 则每次直接读取 `ctx.loader.entries()` 和 live Fiber state，只投影
entry ID、module、effective enablement 与 `pending/loading/active/failed/unloading`，避免复制第二份
lifecycle truth。浏览器端通过 settings slot 懒加载只读列表，插件卸载时 tab 也随 effect 撤销。

WriteLLM 应借鉴两点：Chat、Trajectory、Diagnostics 是同一 durable truth 的独立只读投影；插件
诊断直接投影 Loader/Fiber，而不是另外维护一份容易漂移的状态机。DeepSeek 当前 inventory 没有
provenance、历史和 mutation，这些正是 WriteLLM 可以进一步补齐的产品体验。

### 5.9 动态 Cordis 扩展是单独能力

`dsh-cordis-host-runner`、client runner、`tool-cordis` 和 UI Cordis 支持在 VM-backed host/client
环境中动态定义和运行 Cordis extension。这是模型自扩展能力，不应与仓库内置 plugin 混在
一起评估。

对 WriteLLM 而言，它会显著扩大代码执行、权限、供应链和持久化边界；即使采用 Cordis 核心，
也不代表必须在第一阶段采用动态代码插件。

## 6. DeepSeek Harness 的能力 seams

固定提交的 capability seam 文档和源代码暴露了约 56 个主要 context keys。按责任分组如下：

| 领域 | 主要 service keys |
| --- | --- |
| Agent 核心 | `agents`, `agentLoop`, `agentDefaultModel`, `agentPresets`, `invariants` |
| 会话与视图 | `sessions`, `sessionPersistence`, `sessionQuery`, `sessionProjections`, `sessionProjectionCache`, `sessionTelemetry`, `sessionTitle`, `sessionReferenceResolver` |
| 模型上下文 | `llm`, `tokenMeter`, `systemPrompt`, `compaction`, `toolResultPruner` |
| 工具与交互 | `tools`, `commands`, `userQuestions`, `approval`, `permissionPresets`, `planMode`, `goals`, `jobs` |
| 环境与执行 | `subprocess`, `shell`, `shellEnv`, `terminals`, `sandbox`, `sandboxPolicy`, `codeRuntime`, `fs`, `e2b` |
| 知识与扩展 | `skills`, `web`, `workspaceRegistry`, `attachments`, `spillStore`, `workflowEngine`, `lsp` |
| 应用基础设施 | `settings`, `credentials`, `storage`, `storageDomain`, `messageFeedback`, `directoryPicker` |
| Web / 动态运行 | `webServer`, `clientModules`, `apiProxy`, `dynamicCordisRunner`, `cordisInspect` |

完整设计价值不在 key 的数量，而在每个 key 周围形成一致模式。例如 `fs` 领域同时具有：

- service 契约 `dsh-fs`；
- local 和 sandbox providers；
- observation policy；
- 面向模型的 filesystem/search/editor tools。

这比“为 filesystem 写一个 plugin”更准确地描述了 Harness 的组合方式。

## 7. 插件与包盘点

### 7.1 计数口径

固定提交下 `packages/*/*/package.json` 共 219 个 package manifests，分布在约 49 个顶层领域。
这个数字不能称为“219 个 Cordis 插件”，因为其中包含：

- 协议和类型包；
- provider plugins；
- tool/policy plugins；
- boot/bundle packages；
- React atoms 和 UI feature plugins；
- SDK、test support 和 utilities。

更接近运行时默认组合的口径是 bundle entries：base bundle 有 78 个具名 entry；web-app 和
headless bundle 再通过覆盖、删除和插入改变这棵树。但一个 entry 仍不必与 package 或 plugin
定义一一对应。

### 7.2 仓库实现领域

| 领域 | package 数 | 主要实现 |
| --- | ---: | --- |
| `core` | 8 | agent registry、default model、agent loop、scope、session、system prompt、tools |
| `llm` | 5 | LLM seam、DeepSeek、Pi AI、retry、token meter |
| `session` | 13 | checkpoint policy、JSONL/SQLite persistence、projection/cache、stats、telemetry、title |
| `client` | 39 | browser runtime、connection/HMR、layout/settings/conversation/tool/permission/workflow 等 UI |
| `host` | 8 | web host、runtime bridge、API、Cordis inspection 等 host 能力 |
| `subagent` | 11 | in-process、fork、spawn、ACP/Claude/Codex/SDK drivers、control/report tools |
| `shell` | 9 | shell seam、env、local/sandbox bash/pwsh、persistent shell tool |
| `fs` | 7 | filesystem seam、local/sandbox providers、observation policy、read/search/edit tools |
| `web` | 6 | fetch、DeepSeek/Exa/Perplexity search providers、model-facing web tool |
| `test-support` | 6 | harness 测试辅助，不属于产品插件面 |
| `interaction` | 5 | commands、permission presets、approval、questions |
| `code-runtime` / `workflow` | 2 / 4 | worker-thread code runtime、workflow engine、workflow/Ralph tools |
| `compaction` | 4 | compaction seam、basic provider、result pruner、compact command |
| `storage` | 4 | storage seam/domain、JSON/SQLite providers |
| `skill` | 4 | skill seam、filesystem source、badge、model tool |
| `goal` | 4 | goal service、round driver、command、tool |
| `sandbox` | 4 | sandbox seam/local provider、policy、Windows ACL |
| `typert` | 4 | typed runtime/loader/gateway integration |
| `session-query` | 4 | query seam、providers和查询扩展 |
| `attachment` / `credentials` / `settings` | 2 each | seam + local/file provider |
| `jobs` / `terminal` / `spill` / `lsp` / `e2b` | 3 each | service、provider 和对应 tools/policies |
| `boot` / `bundle` | 2 / 3 | app boot、profile/bundle composition、base/web/headless defaults |
| `extensions` | 4 | host/client Cordis runners、Cordis tool 和 UI |
| `api`, `feedback`, `subprocess`, `preset`, `guard` | 2 each | 对应契约、provider 或策略 |
| `acp`, `mcp`, `plan`, `schedule`, `todo`, `workspace` | 1 each | 专项协议或插件 |
| `identity`, `runtime-diagnostics` | 1 each | 匿名身份与运行时诊断 |
| `sdk`, `examples`, `context`, `hooks`, `util` | 3 / 3 / 4 / 3 / 7 | SDK、示例、上下文插件、hooks 和通用库 |

### 7.3 Base bundle 的 78 个具名 entries

下列清单来自 `packages/bundle/base/cordis.patch.yml`，代表默认 host/headless 基础组合，不代表
整个仓库的全部能力：

```text
timer
hmr
llm
session
typert
typert-loader
typert-gateway
session-title
session-title-llm
user-questions
agent
agent-default-model
jobs
llm-retry
settings
credentials
llm-pi-ai
session-persistence-jsonl
attachment-local
session-query-sqlite
session-projection
session-telemetry-otel
subprocess
sandbox
sandbox-policy
bash-sandbox
pwsh-sandbox
approval
permission
shell-env
tool-bash
tool-pwsh
tool-jobs
fs-observation-policy
tool-fs
tool-fs-search
agent-instructions
skill
skill-filesystem
skill-badge
tool-skill
commands
command-feedback
goal
goal-round-driver
command-goal
plan-mode
token-meter
compaction-basic
command-compact
subagent
subagent-spawn-in-process
subagent-fork-in-process
tool-subagent-control
tool-subagent-list-agents
tool-subagent
tool-subagent-fork
tool-subagent-report
workflow-worker-thread
tool-workflow
timeout-policy
spill-local
spill-policy
session-checkpoint-policy
tool-result-pruner
tool-todo
tool-goal
tool-ralph
tool-str-replace-editor
repeat-tool-reminder
web
web-search-deepseek
tool-web
tools
system-prompt
agent-loop
fs-sandbox
llm-deepseek
```

这 78 个 entry 展示了重要粒度：协议 service、provider、policy、tool 和 orchestration 各自是
可替换组件。例如 `web`、`web-search-deepseek` 和 `tool-web` 不是同一个大插件。

### 7.4 Web-app bundle 追加的主要组件

Web-app bundle 会覆盖或移除部分 base entries，并插入以下主要能力：

- host 基础设施：`code-runtime`, `storage`, `storage-json`, `storage-domain`, `webserver`,
  `api-gateway`, `cordis-host-runner`, `web-startup`, `web-runtime`；
- 会话与工作区：`message-feedback`, `session-log-download`, `workspace`,
  `session-projection-cache`, `session-stats`, `directory-picker`, `plugin-inventory`；
- browser runtime：`client-hmr`, `modules`, `connection`, `api-remotes`, `client-runtime`,
  `cordis-client-runner`；
- UI shell：`ui-theme`, `locale`, `ui-layout`, `ui-sidebar`, `ui-settings`；
- UI features：general/models/plugins settings、conversation、tool、Cordis、workflow、deliverables、
  workspace、commands、skill、subagent、jobs、goal、feedback、model selection、permission、agent
  preset、plan、questions 和 trajectory；
- presets：`agent-presets`。

因此 web UI 也是按 feature plugin 组合的，但底层按钮、atom 和无状态 view 不必全部进入
Cordis。

### 7.5 Headless bundle 的差异

Headless bundle 很小：它主要覆盖少量 base 配置，并插入 worker-thread code runtime、headless
startup 和 headless runner。它证明同一套 service seams 和 Agent plugins 可以由不同应用壳
组合，而不要求 web runtime 存在。

### 7.6 Base bundle 未穷尽的可选实现

仓库还实现了但未全部进入 base 默认组合的替代或扩展能力，包括：

- SQLite session/storage backend；
- Exa、Perplexity web search；
- E2B sandbox/runtime；
- MCP、ACP 和不同 subagent drivers；
- local 与 persistent shell/terminal；
- LSP；
- schedule；
- dynamic Cordis host/client extensions；
- richer web UI、API 和 SDK surfaces。

“实现了哪些插件”必须同时看仓库 package inventory 和具体 bundle，不能只看默认配置。

## 8. DeepSeek Cordis fork 的工程含义

Vendoring 带来两个相反效果：

- 正面：框架代码可审计、可固定、可针对 Harness 的热重组和生命周期要求修复；
- 成本：需要自己承担 fork 差异、上游同步、契约回归和发布来源一致性。

DeepSeek 的修改揭示了几类对 WriteLLM 也会关键的问题：

1. 异步 plugin 在卸载期间继续注册 effect；
2. dispose 重入或父子 Fiber 同时清理；
3. candidate config 已局部生效后才失败；
4. provider 尚未激活时过早解析 config；
5. 快速连续 HMR 导致更新交错；
6. patch 插入节点无法被后续 layer 精确修改；
7. 配置写入和内存状态不一致。

这也说明 Cordis 的价值不能只从很小的 core API 判断；面向桌面 Agent 的可靠性取决于 Loader、
Fiber 和产品 boot policy 是否一起经过验证。

## 9. 对 WriteLLM 重构前置设计的约束性发现

以下不是最终方案，但应成为下一阶段 ADR/架构方案的输入。

### 9.1 这是替换运行时内核，不是套一层 plugin wrapper

若保留当前单体 Agent 控制流，只把各模块包进 `ctx.plugin()`，不会获得 DeepSeek Harness 的
主要收益。真正的重构至少要重新定义：

- durable session protocol；
- live control events；
- agent scope 与 project/session scope；
- model、prompt、tool、policy、persistence 的 service seams；
- boot composition 与 activation audit；
- provider replacement 和 partial failure 行为。

### 9.2 每项能力应拆成契约、实现、暴露面和策略

以 WriteLLM 的写作能力为例，“稿件工具 plugin”仍然过粗。更合适的问题是：

- manuscript/project service 的契约是什么；
- 哪个 main-process provider 拥有数据库和文件 authority；
- 哪些 model-facing tools 消费该 service；
- approval、proposal、validation 和 audit 由哪些 policy plugins 拦截；
- renderer 如何通过安全投影观察 durable 结果。

这符合 DeepSeek Harness 的 seam 组织方式，也不会把 renderer、worker 和 main 的安全边界误当成
普通 DI 问题。

### 9.3 Cordis 不能替代 Electron 安全边界

Context/isolate 不是 sandbox，service key 也不是 capability token。WriteLLM 仍需要：

- main process 保有文件、数据库、凭证和外部进程 authority；
- renderer 只接收验证和裁剪后的 IPC/projection；
- project session capability 保持可撤销；
- model-facing tool input/output 经过 schema validation；
- secrets 与私人内容不进入日志和无权限插件。

### 9.4 Durable facts 与 live composition 必须分开

Cordis event 适合运行时扩展，但不能作为恢复状态。写作任务、消息、工具调用、proposal、审批、
变更应用和产物发布等 durable facts 应继续有可重放协议。Cordis plugin 负责产生、消费或投影
这些事实。

### 9.5 第一阶段不应默认开放任意第三方或模型生成代码

采用 Cordis 作为内部运行时，与开放 plugin marketplace、动态 `tool-cordis` 或 VM code runtime
是三个独立决策。后两者会改变信任模型，不应从“完全插件化”自动推出。

### 9.6 需要固定版本和兼容性测试

上游 API 不稳定，DeepSeek 又依赖自有 fork。任何实施方案都需要：

- 明确选择的 Cordis source 和固定 commit/version；
- service contract tests；
- lifecycle、pending、provider swap、partial boot 和 teardown tests；
- config patch/HMR 的事务性测试；
- packaged Electron 中的运行验证。

### 9.7 提示词扩展必须是结构化 contribution，不是通用文本 hook

WriteLLM 应至少区分稳定 prompt sections、durable runtime-context snapshots、variables、tool
schema providers 和显式 complete provider。每项贡献都需要稳定 ID、plugin/source、scope、order、
revision、sensitivity 和 disposer；每个 request header 持久化有序 contributor manifest，才能让
重载、diff、cache invalidation 和用户调试有统一语义。

### 9.8 生产重载应限于 trusted catalog，并以 request generation 为边界

采用 Loader/HMR 不等于开放任意模块。生产配置应只引用 WriteLLM 内置 catalog ID 和闭合 schema；
prompt/instruction/skill 内容与内置 plugin config 可事务重载，代码 HMR 只用于开发。已 dispatch
的请求保持冻结 generation，新 generation 从下一 step 生效。失败候选必须保留 last-good tree，
并在 plugin diagnostics 中显示失败阶段和恢复状态。

### 9.9 Trajectory、request trace 与 telemetry 是三层能力

- trajectory 从 durable events/request snapshots 重建“模型实际看到了什么”；
- local request trace 用 spans 回答“时间花在哪里、跨进程经过哪些 plugin/policy/authority”；
- telemetry 是可选的外部导出，必须非阻塞、显式同意且 fail-closed redaction。

三者不能共享一个含完整内容的无界日志。Trace 应默认只存 metadata 和 durable body references；
关闭或丢失 trace sink 不能改变 Agent 行为或恢复结果。

## 10. 下一阶段需要回答的问题

在写完整重构方案前，应单独完成以下设计决策：

1. 直接使用上游 Cordis、维护 WriteLLM fork，还是复用 DeepSeek vendored fork 的哪种方式可接受；
2. WriteLLM 的 root/project/session/run/agent scope 和 isolate realm 如何映射；
3. 哪些事实进入新的 append-only Agent session protocol，哪些留在现有项目数据库；
4. main、agent worker 和 renderer 各运行一棵 Cordis tree，还是只在受信任进程运行；
5. 跨进程 service seam 如何映射到现有 Zod IPC 和 revocable project capability；
6. agent registry 与 agent loop 的最小稳定契约是什么；
7. 现有 20 个写作工具怎样拆成 domain service、tool adapter 和 approval/proposal policy；
8. job、subagent、compaction、skill、context、LLM、telemetry 如何定义 provider-neutral seams；
9. boot/profile/bundle/patch 是否进入用户产品面，还是只作为内部装配机制；
10. 旧 session、runs、messages、proposals 和 queued inputs 怎样并行迁移与回滚；
11. 哪些 DeepSeek Cordis hardening 是桌面生产必需，如何用测试而不是复制补丁来证明；
12. plugin 安装、签名、权限、更新和动态执行是否明确延后。

这些问题得到回答后，才能形成真正的 `cordis-reform` 目标架构、迁移阶段和 acceptance gates。

## 11. 主要源码索引

### Cordis

- [固定提交](https://github.com/cordiverse/cordis/tree/8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4)
- [Context](https://github.com/cordiverse/cordis/blob/8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4/packages/core/src/context.ts)
- [Fiber lifecycle](https://github.com/cordiverse/cordis/blob/8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4/packages/core/src/fiber.ts)
- [Plugin registry](https://github.com/cordiverse/cordis/blob/8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4/packages/core/src/registry.ts)
- [Service](https://github.com/cordiverse/cordis/blob/8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4/packages/core/src/service.ts)
- [Provider reflection](https://github.com/cordiverse/cordis/blob/8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4/packages/core/src/reflect.ts)
- [Event dispatch](https://github.com/cordiverse/cordis/blob/8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4/packages/core/src/events.ts)
- [Loader](https://github.com/cordiverse/cordis/tree/8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4/packages/loader)
- [Core tests](https://github.com/cordiverse/cordis/tree/8cc9e33fab69e2d0476d126baaf2acb24e6a6ab4/packages/core/tests)

### DeepSeek Harness

- [固定提交](https://github.com/deepseek-ai/deepseek-harness/tree/47f943859bef60e4160492346772ded9b24f765a)
- [Cordis primer](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/cordis-primer.md)
- [Architecture](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/architecture.md)
- [Capability seams](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/docs/capability-seams.md)
- [Vendored Cordis 与修改记录](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/vendor/README.md)
- [Vendored Loader entry/group transaction](https://github.com/deepseek-ai/deepseek-harness/tree/47f943859bef60e4160492346772ded9b24f765a/vendor/loader/src/config)
- [Vendored Include candidate refresh](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/vendor/include/src/index.ts)
- [Vendored HMR refresh serialization](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/vendor/hmr/src/index.ts)
- [App boot 与 activation audit](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/boot/app-boot/src/index.ts)
- [CLI profile boot](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/apps/cli/src/profile-boot.ts)
- [Base bundle](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/bundle/base/cordis.patch.yml)
- [Web-app bundle](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/bundle/web-app/cordis.patch.yml)
- [Headless bundle](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/bundle/headless/cordis.patch.yml)
- [Agent service](https://github.com/deepseek-ai/deepseek-harness/tree/47f943859bef60e4160492346772ded9b24f765a/packages/core/agent)
- [Agent loop](https://github.com/deepseek-ai/deepseek-harness/tree/47f943859bef60e4160492346772ded9b24f765a/packages/core/agent-loop)
- [Agent-loop executable invariant](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/core/agent-loop/src/invariant.ts)
- [Session](https://github.com/deepseek-ai/deepseek-harness/tree/47f943859bef60e4160492346772ded9b24f765a/packages/core/session)
- [System prompt](https://github.com/deepseek-ai/deepseek-harness/tree/47f943859bef60e4160492346772ded9b24f765a/packages/core/system-prompt)
- [Time context durable injection](https://github.com/deepseek-ai/deepseek-harness/blob/47f943859bef60e4160492346772ded9b24f765a/packages/context/time-context/src/index.ts)
- [Tools](https://github.com/deepseek-ai/deepseek-harness/tree/47f943859bef60e4160492346772ded9b24f765a/packages/core/tools)
- [LLM seam](https://github.com/deepseek-ai/deepseek-harness/tree/47f943859bef60e4160492346772ded9b24f765a/packages/llm/llm)
- [Runtime invariant registry](https://github.com/deepseek-ai/deepseek-harness/tree/47f943859bef60e4160492346772ded9b24f765a/packages/runtime-diagnostics/invariants)
- [Session telemetry](https://github.com/deepseek-ai/deepseek-harness/tree/47f943859bef60e4160492346772ded9b24f765a/packages/session/session-telemetry)
- [OTel telemetry provider](https://github.com/deepseek-ai/deepseek-harness/tree/47f943859bef60e4160492346772ded9b24f765a/packages/session/session-telemetry-otel)
- [Trajectory UI](https://github.com/deepseek-ai/deepseek-harness/tree/47f943859bef60e4160492346772ded9b24f765a/packages/client/ui-trajectory)
- [Host plugin inventory](https://github.com/deepseek-ai/deepseek-harness/tree/47f943859bef60e4160492346772ded9b24f765a/packages/host/plugin-inventory)

## 12. 最终判断

Cordis 的核心思想在代码中可以概括为：**用依赖、作用域和可撤销 effect 管理运行时组件，
让组件在空间上可组合、在时间上可替换。** DeepSeek Harness 则在这套内核上补齐了 Agent
需要的 durable protocol、service seams、策略流水线、boot 事务、默认 providers 和多端 UI。

因此，WriteLLM 的“完全替换”不应该以复刻 DeepSeek 的 219 个 packages 为目标，也不应该把
现有函数机械改名为 plugins。合理目标是先定义 WriteLLM 自己的 durable 写作协议和 capability
seams，再选择哪些 DeepSeek 模式值得复用、哪些产品能力必须按桌面写作和 Electron 信任边界
重新实现。尤其值得优先复用的不是某个 coding-agent tool，而是结构化 prompt/context
contributions、事务式 last-good reload、request-header reconstruction、独立 trajectory projection、
live plugin inventory、executable invariant companions，以及非阻塞且可 fail-closed redaction 的
telemetry seam。这些能力会直接改善可解释性、可调试性和后续扩展体验。
