# Data Model: 图标映射、界面审计与验证证据

这些实体是 repository-owned design/audit records，不是新的运行时业务模型，不进入项目文件、应用偏好或 IPC。

## ActionIconMapping

一个规范产品动作的稳定定义。

| Field | Type | Rules |
|---|---|---|
| `actionId` | kebab-case string | 唯一、稳定；以动作结果而非页面命名，例如 `save-chapter`。 |
| `icon` | Lucide exported component name | 必须来自 pinned `lucide-react`；一个 action 只有一个默认 icon。 |
| `coreLabel` | non-empty string | 跨界面保持核心含义；上下文可补充对象但不得改成冲突动词。 |
| `accessibleNamePattern` | string/pattern | 精确描述结果；icon-only placement 必填并能包含对象名称。 |
| `risk` | `safe \| caution \| destructive` | destructive 不得只靠 icon/color 表达。 |
| `defaultPriority` | `primary \| secondary \| dangerous` | 每个 view 当前上下文最多一个 primary。 |
| `presentation` | `label-required \| icon-only-eligible` | `icon-only-eligible` 仍需每个 placement 通过四项 gate。 |
| `locations` | list of feature/view IDs | 至少一个；用于审计覆盖和一致性检查。 |
| `fallback` | string | icon 未呈现时仍可用的 visible/accessible text。 |
| `verificationOwner` | role/string | 新增/例外的验证责任人。 |

### Validation

- `actionId`、icon 与核心语义不得与另一 mapping 冲突。
- `label-required` placement 不得隐藏 visible label。
- `icon-only-eligible` 不是自动批准；placement 必须满足全部四项 gate。
- delete/discard/leave 等高风险动作必须保留结果文字与既有保护。
- 同一 icon 若跨 action 复用，每个 placement 必须有不会冲突的稳定文字或 accessible name。

## ActionPlacement

映射在具体界面中的一次使用，也是审计 coverage unit。

| Field | Type | Rules |
|---|---|---|
| `placementId` | string | 在 audit 中唯一。 |
| `actionId` | reference | 必须引用 `ActionIconMapping`。 |
| `surface` | enum | `launch \| workspace \| orientation \| outline \| editor`。 |
| `control` | source locator | component/file 与稳定 query/role。 |
| `visibleLabel` | string or null | primary/dangerous 通常必填。 |
| `accessibleName` | string/pattern | 每个 interactive control 必填。 |
| `priority` | enum | `primary \| secondary \| dangerous`；可按上下文收紧默认值。 |
| `iconOnlyGates` | four booleans + rationale | icon-only 时四项必须全 true；否则 N/A。 |
| `states` | set | 覆盖适用的 default/hover/focus/pressed/selected/disabled/busy/success/warning/error。 |
| `targetEvidence` | reference | 证明至少 44×44 CSS px 且未缩小既有 target。 |

## InterfaceAuditFinding

| Field | Type | Rules |
|---|---|---|
| `findingId` | string | 唯一且可追溯。 |
| `surface` / `flow` | enum/string | 明确用户上下文。 |
| `placementId` | optional reference | 控件相关 finding 应引用 placement；页面级问题可为空。 |
| `affectedUsers` | list | 例如 keyboard、screen-reader、low-vision、all。 |
| `severity` | `low \| medium \| high` | high 不能无审批 retained。 |
| `requirementRefs` | list | FR/SC/contract clauses。 |
| `expectedImprovement` | string | 可观察的目标结果。 |
| `status` | `open \| resolved \| retained` | 状态转换见下。 |
| `resolution` | string | resolved/retained 必填。 |
| `evidenceRefs` | list | resolved 必须至少一个。 |
| `compensation` | optional string | high + retained 必填。 |
| `productApproval` | optional approval | high + retained 必填。 |
| `accessibilityApproval` | optional approval | high + retained 必填且与 product approval 独立。 |

### State transitions

```text
open -> resolved
open -> retained
retained -> open       (evidence/approval invalidated or context changed)
resolved -> open       (regression or mapping change)
```

`high + retained` 只有 compensation、productApproval、accessibilityApproval 均存在时有效。Finding 不删除；误报用 retained + rationale 或明确的 superseding reference 保留追溯。

## AuditEvidence

| Field | Type | Rules |
|---|---|---|
| `evidenceId` | string | 唯一。 |
| `kind` | `source \| dom-test \| electron-runtime \| manual \| user-flow` | 对应 failure boundary。 |
| `environment` | string | theme、viewport、zoom、media preference、build SHA 等。 |
| `result` | `pass \| fail` | fail 必须生成/引用 finding。 |
| `artifact` | path/command/note | 可重复或可审阅。 |
| `requirementRefs` | list | 明确证明哪些条款。 |
| `reviewer` / `date` | metadata | 人工和用户流程证据必填。 |

## UserFlowObservation

| Field | Type | Rules |
|---|---|---|
| `participantId` | pseudonymous string | 不记录不必要的身份信息。 |
| `flow` | enum | create/open、outline/reorder、start chapter、save、export。 |
| `firstAttemptSuccess` | boolean | SC-004 统计单位。 |
| `errors` | non-negative integer + notes | 区分找不到、误解和错误选择。 |
| `discoverabilityRating` | integer 1–5 | SC-008。 |
| `hierarchyRating` | integer 1–5 | SC-008。 |
| `observations` | concise notes | 不要求改造前 baseline 或硬性样本数。 |

## Relationships

```text
ActionIconMapping 1 --- * ActionPlacement
ActionPlacement    0..1 --- * InterfaceAuditFinding
InterfaceAuditFinding * --- * AuditEvidence
UserFlowObservation    --- * AuditEvidence(user-flow)
```
