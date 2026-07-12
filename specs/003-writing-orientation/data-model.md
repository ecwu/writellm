# 003 写作方向数据模型

## Canonical document

`workspace/writing-orientation.json` 保存一个项目的一份完整快照：

```ts
type WritingOrientationDocument = {
  kind: "writellm.writing-orientation";
  schemaVersion: 1;
  projectId: string;
  revision: number;
  updatedAt: string;
  motivation: {
    problem: string;
    targetReaders: string;
    desiredOutcome: string;
  };
  outlineItems: OutlineItem[];
};

type OutlineItem = {
  outlineItemId: string;
  title: string;
  summary: string;
  status: "not-started" | "in-progress" | "completed";
  chapterRef: string | null;
};
```

数组位置是唯一顺序；不保存独立 `position`。`chapterRef` 是 004/shared storage contract 管理的不透明 ID，003 不读取正文。

### Save input model

renderer 保存的是可编辑字段与条目 identity，不得回传或修改 main-owned 的
`chapterRef`。已保存条目和新建草稿条目使用可判别联合：

```ts
type MotivationInput = {
  problem: string;
  targetReaders: string;
  desiredOutcome: string;
};

type ExistingOutlineItemInput = {
  outlineItemId: string;
  clientDraftId?: never;
  title: string;
  summary: string;
  status: "not-started" | "in-progress" | "completed";
};

type NewOutlineItemInput = {
  outlineItemId?: never;
  clientDraftId: string;
  title: string;
  summary: string;
  status: "not-started" | "in-progress" | "completed";
};

type OutlineItemSaveInput = ExistingOutlineItemInput | NewOutlineItemInput;
```

`clientDraftId` 是 renderer 为当前未保存条目生成的 UUID，只用于把一次 save 的
新条目与响应中的 durable `outlineItemId` 对应起来。main 为每个新条目生成
`outlineItemId`，并在成功结果的 `createdItemIds` 中返回映射。renderer 随后必须用
durable ID 替换 draft ID，包括当前 selection。

普通 `save` 不承担删除：input 中出现的 durable `outlineItemId` 集合必须与当前磁盘
snapshot 完全相同。缺少已有 ID、提交未知 ID、同时提交两种 ID、重复 ID 或重复
`clientDraftId` 均返回 `INVALID_INPUT`，且不写盘。删除只能通过具名
`deleteOutlineItem` command 完成，因此 renderer 不能通过从 snapshot 省略条目来绕过
关联状态检查。main 从当前 canonical document 合并并保留 `chapterRef`；renderer input
中不存在可写的 `chapterRef` 字段。

## Validation

- `kind` 和 `schemaVersion` 必须精确匹配；未知版本只读失败，不自动迁移。
- `projectId` 必须与 main-owned active project session 相同。
- `revision` 为安全的非负整数；save 的 `baseRevision` 必须等于磁盘 revision。
- 三个 motivation 字段允许空字符串；所有 string 拒绝 NUL。
- `outlineItemId` 在数组中唯一；ID 为 UUID string。
- `title.trim()` 必须非空；保存保留作者输入，但 UI 显示/校验以 trim 后值判断。
- `summary` 可为空；status 只能取三个 literal；新条目默认为 `not-started`。
- `chapterRef` 为 null 或 opaque UUID；一个 chapter 不得关联多个条目。
- 序列化后的 request/document 不得超过 2 MiB safety ceiling。

## Runtime draft

```ts
type NewOutlineItemDraft = NewOutlineItemInput & {
  chapterRef: null;
};

type OrientationDraftDocument = Omit<WritingOrientationDocument, "outlineItems"> & {
  outlineItems: Array<OutlineItem | NewOutlineItemDraft>;
};

type OrientationDraftState = {
  baseline: WritingOrientationDocument;
  draft: OrientationDraftDocument;
  selectedOutlineItemId: string | null;
  saveState: "saved" | "dirty" | "saving" | "failed";
  lastError: OrientationError | null;
};
```

`selectedOutlineItemId` 可以暂时保存 durable `outlineItemId` 或 `clientDraftId`；成功
save 后必须使用 response mapping 替换后者。save mapper 将已有条目投影为
`ExistingOutlineItemInput`、将新条目投影为 `NewOutlineItemInput`，并剥离所有
`chapterRef`。`selectedOutlineItemId`、save state 和 error 不属于 canonical document。
dirty 由 draft 与 baseline 的 content fields 比较得出；保存中继续编辑时，成功结果只
更新已提交 snapshot 的 baseline，后续编辑仍保持 dirty。

## Commands and state transitions

- **Create item**: renderer 生成 `clientDraftId` 并插入 draft，默认 `not-started`，进入 dirty；成功保存时 main 分配 durable `outlineItemId` 并返回 identity mapping。
- **Edit/move**: 只变更 draft；上移、下移和 drag 共享 `moveItem(from,to)`。
- **Save**: `dirty/failed → saving → saved`；若保存期间 draft 又变化则 `saving → dirty`。失败为 `saving → failed`，draft 不变。
- **Select**: 改变 runtime location，不改变 content revision。
- **Delete unlinked**: confirmed command 成功后返回新 snapshot/revision。
- **Delete linked**: 003 返回 `LINKED_DELETE_NOT_AVAILABLE`，canonical document 和 draft 均不改变；004 accepted extension 后再定义原子删除状态机。
- **Leave**: dirty 时 `save`、`discard`、`stay`；save 失败保持当前项目和 draft。

## Empty and recovery states

- motivation 三字段为空是有效的 saved empty state。
- outlineItems 为空是有效空状态。
- 若 selected ID 不存在，选择第一项；无条目则为 null。
- malformed/unknown document 返回错误，不伪装为空状态。
