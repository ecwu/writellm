# Contract: Workspace IPC Boundary

**Status**: Draft / `Decision: NEEDS DECISION`

**Scope**: 记录 shell 触及 renderer↔preload↔main 时的最小边界。当前只存在 foundation runtime method；项目/存储方法依赖 001，不能由本 feature 自行发明或实现。

## Existing method

当前仓库已经实现：

```text
channel: 'writellm:runtime-info'
renderer API: window.writellm.getRuntimeInfo(): Promise<RuntimeInfo>

RuntimeInfo = {
  appName: string,
  appVersion: string,
  platform: string,
  isPackaged: boolean
}
```

该 method 只用于 foundation/runtime 状态；不应被扩展成读取窗口对象、路径、文件、环境变量或任意 Electron capability。当前 `src/shared/ipc.ts`、`src/preload/preload.cts` 和 `src/main/main.ts` 是实际实现位置。

## Planned dependency inputs（未冻结）

shell 需要一个由 001 project foundation 提供的安全 project-ready snapshot 和 owner status/action 输入，但 exact method/DTO/error code 仍 `NEEDS DECISION`：

```text
ProjectReadySnapshot (proposed shape, not frozen) = {
  projectId: opaque string,
  displayName: string,
  schemaVersion: string,
  contentRevision: number,
  editorContext?: opaque string,
  status: 'ready' | 'needs-action' | 'invalid' | 'recovery-required'
}

OwnerStatusInput (proposed shape, not frozen) = {
  owner: 'project' | 'editor' | 'orientation' | 'provider' | 'system',
  kind: 'idle' | 'unsaved' | 'saving' | 'saved' | 'error' | 'needs-action',
  safeMessage?: string,
  actionId?: string,
  retryable?: boolean
}

OwnerActionRequest (proposed shape, not frozen) = {
  actionId: string,
  projectId?: opaque string,
  expectedRevision?: number
}
```

这些 shape 只说明 shell 的最小消费面，不批准 001 的 method name、revision semantics 或错误 enum。精确方法/DTO 必须在 001 contract 与本 feature 的 shared type review 中同时冻结。

## Proposed method inventory

| Method | Owner | 当前状态 | 要求 |
|---|---|---|---|
| `getRuntimeInfo` | foundation/main | 已存在 | 保持 read-only、typed、无额外 capability。 |
| project open/close snapshot | 001/main | `NEEDS DECISION` | shell 只消费安全摘要；renderer 不传 path，不自行扫描项目。 |
| save/retry/recover action | 001 或具体 owner | `NEEDS DECISION` | actionId 白名单、main 重验 project/revision、结构化 safe error；shell 不直写文件。 |
| native window bounds/min-size | main | `NEEDS DECISION`，当前可能不需要 | 默认保留创建时 1200×800 / 960×640；若新增，只允许语义化 named method 和白名单尺寸。 |

本 feature 默认不新增 shell-specific IPC。panel/modal/focus/layoutMode 都在 renderer；原生窗口能力只有在明确需求和 contract 接受后才增加。

## Error contract

跨进程错误必须最终映射为安全的 typed result 或 typed rejection，至少能区分：

```text
ErrorCode (candidate, not frozen) =
  | 'PROJECT_NOT_READY'
  | 'VALIDATION_FAILED'
  | 'SAVE_FAILED'
  | 'STORAGE_RECOVERY_REQUIRED'
  | 'EXTERNAL_CHANGE'
  | 'OWNER_UNAVAILABLE'
  | 'UNSUPPORTED_SCHEMA'
  | 'UNKNOWN'
```

每个错误需要 `code`、safe user message、`retryable`/action semantics 和可选 correlation id；不能包含 absolute path、secret、raw stack、provider request headers、完整文件内容或未验证的 renderer payload。底层错误码到 shell code 的映射、是否区分 canceled、schema migration 和 external change，均为 `NEEDS DECISION`。

## Security requirements

1. Renderer 不接收 absolute project path；recent index/path 只由 main 保管，遵循 ADR-001。
2. Preload 只能逐项暴露 `WriteLLMIpc` 中声明的方法；禁止 `ipcRenderer`, `send`, `invoke`, `on`, `once` 等 generic wrapper 穿透。
3. Main 对所有 renderer-originated request 重新校验结构、projectId、revision、actionId、尺寸白名单和 sender context。
4. Shell state、React refs、DOM nodes、provider secret、Git command、raw file content 不得进入 IPC DTO。
5. `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true` 继续是运行时 gate；contract 变化要有 compiled preload smoke。

## Open decisions

- `ProjectReadySnapshot` 的真正 method、DTO 与版本迁移：`NEEDS DECISION`。
- error code、safe message、canceled/retry/recovery semantics：`NEEDS DECISION`。
- shell status 是否由 001 转发还是由各 owner 直接提供：`NEEDS DECISION`。
- 是否需要 native window bounds/min-size IPC：`NEEDS DECISION`。
- IPC contract、storage schema、ADR-001 的接受顺序和 review owner：`NEEDS DECISION`。
