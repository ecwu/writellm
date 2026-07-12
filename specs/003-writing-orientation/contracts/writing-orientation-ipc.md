# 写作方向 IPC Contract（草案）

**状态**: `NEEDS DECISION`

**消费者**: `src/renderer`、`src/preload/preload.cts`、`src/main/writing-orientation/`

**前置**: 001 的 project session/project IPC contract 和 002 的 workspace state contract 必须先接受。本文件只描述 003 需要的最小能力，不覆盖项目创建/打开/删除。

## 设计要求

- renderer 只能调用具名 typed 方法；preload 不暴露 `ipcRenderer`、generic invoke/send、文件系统或 Git。
- renderer 不发送或接收绝对路径；`projectId` 是 opaque ID，main 从当前窗口/session 再校验。
- 所有 renderer-originated payload 都在 main 运行时校验；schema validator 仍是候选，见 [research.md](../research.md)。
- 返回结构化可判别结果；不能依赖 Electron `ipcMain.handle` 自动透传完整异常。
- request/response 只使用 structured-clone 可序列化 DTO，不跨边界传 Error、Buffer、BrowserWindow、DOM 对象或 class instance。

## 提议的具名方法

以下是候选 contract，不是已冻结的 channel 名称。`src/shared/ipc.ts` 的最终命名与 001 的 `saveProjectWorkspace` 是否合并均 `NEEDS DECISION`。

### `getWritingOrientation`

```text
Request:
  { projectId: string }

Success:
  { ok: true, value: WritingOrientationReadModel }

Failure:
  { ok: false, error: IpcError }
```

主进程读取当前 project session、canonical document、chapter link projection 和 002-owned location contribution，禁止 renderer 自己拼接路径读取文件。

### `saveWritingOrientation`

```text
Request:
  {
    projectId: string;
    baseRevision: number | string;       // exact type NEEDS DECISION
    clientMutationId: string;
    document: {
      motivation: {
        problem: string;
        targetReaders: string;
        desiredOutcome: string;
      };
      outlineItems: Array<{
        outlineItemId: string;
        title: string;
        summary: string;
        status: 'not_started' | 'in_progress' | 'completed';
        chapterRef: string | null;
      }>;
    };
    location?: WritingOrientationLocationContribution;
  }

Success:
  {
    ok: true;
    value: {
      document: WritingOrientationDocument;
      persistence: PersistenceSnapshot;
      locationAccepted: boolean;
    };
  }

Failure:
  { ok: false, error: IpcError }
```

main 补写 `kind/schemaVersion/projectId/contentRevision/updatedAt`，不接受 renderer 伪造这些字段。保存顺序是 validate → project queue → pending transaction → atomic write → Git/history adapter → response；具体是否 location 与内容同事务由 002/storage contract 决定。

### `deleteOutlineItem`

```text
Request:
  {
    projectId: string;
    baseRevision: number | string;
    clientMutationId: string;
    outlineItemId: string;
    confirmChapterImpact: boolean;
  }

Success:
  {
    ok: true;
    value: {
      document: WritingOrientationDocument;
      deletedOutlineItemId: string;
      persistence: PersistenceSnapshot;
    };
  }

Failure:
  { ok: false, error: IpcError }
```

main 必须从 authoritative storage/004 projection 重新判断 chapter association。若有关联且 `confirmChapterImpact` 为 false，返回 `OUTLINE_ITEM_HAS_CHAPTER`，不得删除 outline item，更不得删除 chapter。

## 稳定错误码（提议）

错误 DTO 需要至少包含 `{ code, message, retryable, details? }`；`message` 面向用户的短摘要，`details` 不得包含路径、secret 或原始堆栈。错误 code 的最终命名、可重试性和本地化策略 `NEEDS DECISION`。

| code | 触发条件 | 是否可重试/用户动作 |
|---|---|---|
| `INVALID_ARGUMENT` | DTO 类型、未知字段策略、控制字符或请求大小不合法 | 否；修正输入 |
| `PROJECT_NOT_OPEN` | projectId 不是当前打开 session | 否；重新打开项目 |
| `PROJECT_NOT_FOUND` | session 指向失效项目 | 否；通过 001 重新选择 |
| `SCHEMA_UNSUPPORTED` | 磁盘文档版本未知或迁移未接受 | 否；升级/迁移/只读 |
| `OUTLINE_TITLE_EMPTY` | title trim 后为空 | 否；填写标题 |
| `OUTLINE_ITEMS_INVALID` | 重复 id、非法 status、顺序不一致 | 否；修正草稿 |
| `OUTLINE_ITEM_NOT_FOUND` | delete 目标不在 base revision | 否；重新加载 |
| `OUTLINE_ITEM_HAS_CHAPTER` | 未确认有关联章节的影响 | 否；阅读提示后显式确认 |
| `REVISION_CONFLICT` | base revision 不是当前 durable revision | 否；重新加载/人工合并 |
| `EXTERNAL_CHANGE` | 外部改动导致无法安全合并 | 否；查看/重新加载 |
| `STORAGE_WRITE_FAILED` | 临时文件、权限、磁盘或 Git commit 失败 | 是；保留草稿并重试/另存（策略待定） |
| `STORAGE_RECOVERY_REQUIRED` | pending 或 commit 状态无法判断 | 需恢复流程；不得覆盖 |
| `IPC_SENDER_REJECTED` | 非允许 BrowserWindow/frame 发起 | 否；记录安全事件，不暴露细节 |

## 安全边界与校验顺序

1. `ipcMain.handle` 收到 event 后确认 sender 属于预期主窗口和允许的 frame。
2. 校验 request 的 plain object、字符串长度/控制字符、enum、数组唯一性和 `clientMutationId`。
3. 确认 projectId 与 main 的 current project session 一致；绝对路径、任意 path、Git command 和文件名字段不在 DTO 中。
4. 读取 authoritative revision 和 chapter link state，再做 optimistic concurrency / confirmation 判断。
5. 进入每项目串行写队列，完成 pending/atomic/Git adapter 流程后只返回 DTO。
6. preload 只增加对应的具名 wrapper；renderer 的 TypeScript `Window.writellm` 声明与 shared type 同源。

## 未决项

- **Decision: NEEDS DECISION** — 是否采用上述三个 domain method，还是扩展 001 的 `saveProjectWorkspace`。
- **Decision: NEEDS DECISION** — revision 的全项目/文档级别、数字/字符串类型、冲突和 idempotency 语义。
- **Decision: NEEDS DECISION** — schema validator、error codec、未知字段保留和错误 message 本地化。
- **Decision: NEEDS DECISION** — location 是否与 content 同一次 IPC/save transaction。

