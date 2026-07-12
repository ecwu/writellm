# Data Model: 共享 UI Foundation

本 feature 不修改 project schema 或文档数据，但新增一个 main-owned、版本化的应用级 AppearancePreferences 文件与对应 typed IPC DTO。其余模型为源码配置或运行时派生状态。

## ThemeToken

表示一个语义用途，不表示 feature-specific palette value。

| Field | Type | Rules |
|---|---|---|
| `name` | stable semantic identifier | 不能包含 feature 名；移除/重命名是 breaking UI contract |
| `lightValue` | CSS-compatible value | 必须在 light theme 定义 |
| `darkValue` | CSS-compatible value | 必须在 dark theme 定义 |
| `purpose` | documentation | 说明允许用途，例如 surface/text/border/focus/status |
| `contrastPair` | optional token name | 文本/图标 token 必须记录预期背景 pair |
| `forcedColorBehavior` | browser-adjusted or explicit system color | 默认允许浏览器调整；焦点/边界/状态如需覆盖必须使用系统颜色并验证 |

### Required token groups

- surface: `background`, `card`, `popover`, `muted`
- content: `foreground`, `card-foreground`, `popover-foreground`, `muted-foreground`
- action: `primary`, `primary-foreground`, `secondary`, `secondary-foreground`, `accent`, `accent-foreground`
- feedback: `destructive`, `destructive-foreground`, `warning`, `warning-foreground`, `success`, `success-foreground`
- structure: `border`, `input`, `ring`
- shape/elevation/motion: approved radius, shadow, duration and easing variables

## AppearancePreferences

Application-global durable state stored by main in `userData/appearance-preferences.json`.

| Field | Type / default | Validation |
|---|---|---|
| `schemaVersion` | literal `1` | unknown versions are rejected read-only and fall back in memory |
| `themeMode` | `system \| light \| dark`; `system` | exact enum |
| `editorTypographyPreset` | `editor \| reading \| compact`; `editor` | exact enum |
| `bodyFontId` | `system-serif \| system-sans`; `system-serif` | audited ID only |
| `headingFontId` | `system-serif \| system-sans`; `system-serif` | audited ID only |
| `monoFontId` | `system-mono`; `system-mono` | audited ID only |
| `baseSize` | finite number; `16` | inclusive `12..32` CSS px |
| `leading` | finite number; `1.75` | inclusive `1.2..2.4` |
| `flow` | finite number; `1.25` | inclusive `0.75..3`, interpreted as `em` |

Rules:

- Main validates disk data and every renderer update independently.
- Missing file returns defaults without warning. Corrupt, unknown-version or invalid data returns defaults plus a safe warning and is not overwritten until a successful user update.
- Successful updates write an entire normalized v1 snapshot through atomic replacement.
- The renderer receives no path, raw JSON or raw exception.
- This entity never appears in `.writellm`, project DTOs, document content or exports.
- Safe warning codes are `APPEARANCE_PREFERENCES_CORRUPT` and `APPEARANCE_PREFERENCES_UNSUPPORTED`; update errors are `APPEARANCE_INVALID_INPUT` and `APPEARANCE_STORAGE_UNAVAILABLE`.

## ThemeMode

```text
stored system + OS light -> effective light
stored system + OS dark  -> effective dark
stored light             -> effective light regardless of OS changes
stored dark              -> effective dark regardless of OS changes
successful update        -> persist normalized preference, update nativeTheme, update renderer
```

Main applies the stored mode to `nativeTheme.themeSource` before BrowserWindow creation. Reduced motion and forced colors remain system-derived and are not stored.

## TypesetPreset

Source-owned CSS configuration for rendered HTML/Markdown; it is not document state.

| Preset | Default purpose | Rhythm |
|---|---|---|
| `editor` | standard writing surface | 16px size, 1.75 leading, 1.25em flow |
| `reading` | roomier long-form reading | 18px size, 1.9 leading, 2em flow |
| `compact` | dense auxiliary/preview content | 14px size, 1.6 leading, 1em flow |

Each preset maps `--typeset-font-body`, `--typeset-font-heading`, `--typeset-font-mono`, `--typeset-size`, `--typeset-leading` and `--typeset-flow`. Layout owns measure/max-width. Typeset styles content without rewriting it and must keep previously rendered blocks stable while new content streams in.

Selecting a preset seeds its canonical size/leading/flow. The stored numeric fields are the normalized effective values and may support future bounded user adjustments; 011's launch UI changes theme only and does not expose those controls.

## UIPrimitive

| Field | Type | Rules |
|---|---|---|
| `name` | stable component name | unique within `components/ui` |
| `elementContract` | native/Base UI mapping | preserve correct role and native behavior |
| `variants` | named finite set | every variant has a documented semantic purpose |
| `states` | supported state set | default plus applicable hover/focus/disabled/invalid/selected/open |
| `themeCoverage` | light + dark | every visible state covered in both themes |
| `a11yContract` | names/keyboard/focus | required for every interactive primitive |
| `dependencies` | source/runtime imports | minimal and reviewable; never imports a feature or IPC |
| `owner` | UI foundation | changes require shared review |

### Initial primitive inventory

`Button`, `Input`, `Label`, `Card`, `Alert`, `Badge`, `Separator`, `Dialog`, `Tooltip`, `ScrollArea`, `Select`.

## UIPattern

| Field | Type | Rules |
|---|---|---|
| `name` | stable component name | unique within `components/patterns` |
| `composition` | primitives + slots | cannot duplicate a primitive implementation |
| `ownedState` | presentational only | no project/workspace/domain truth |
| `contentContract` | labels/descriptions/actions | feature supplies business copy and handlers |
| `a11yContract` | composed semantics | cannot weaken child primitive semantics |

### Initial patterns

- `FormField`: visible label, control slot, optional description and error relationship.
- `StatusNotice`: status level, visible title/message, optional safe action slot; status never color-only.
- `EmptyState`: heading, explanation and optional action slots; owns no navigation or project state.
- `AppearanceControls`: controlled theme selection using `Select`; receives normalized value/change/status props and never calls IPC or owns persistence.

## ComponentVariant

| Field | Rules |
|---|---|
| `name` | describes purpose (`default`, `secondary`, `destructive`, etc.), not a color |
| `trigger` | feature selects explicitly; no implicit business-state lookup |
| `states` | covers relevant interaction states and both themes |
| `extensionEvidence` | points to an accepted feature need and tests |

## FoundationExtensionRequest

A review record expressed in a PR/task description, not persisted at runtime.

| Field | Required content |
|---|---|
| consumer | accepted feature and concrete reuse case |
| gap | why existing primitive/pattern/variant cannot satisfy it |
| proposed owner | `ui`, `patterns`, or feature-local composition |
| state matrix | default/interaction/error/open states as applicable |
| accessibility | role/name/keyboard/focus/announcement rules |
| theme | light/dark/high-contrast/reduced-motion impact |
| verification | DOM/runtime/manual coverage |
| upgrade impact | generated source/dependencies and affected consumers |

## MigrationBaseline

Read-only references used to assess the 001 presentation migration:

- six named methods in the accepted project IPC contract;
- `LaunchState` transitions and safe fallback messages;
- first launch, create, open, recent, relink, remove and empty workspace flows;
- recent maximum of five and availability mappings;
- main-owned project/recent disk effects and error redaction;
- existing 001 test suites and quickstart scenarios.

The baseline has no state transition. If migration requires changing it, the change is out of scope for 011.

## Relationships

```text
ThemeToken 1..* -> UIPrimitive
AppearancePreferences -> ThemeMode + TypesetPreset variables
TypesetPreset -> rendered HTML/Markdown container
UIPrimitive 1..* -> UIPattern
UIPrimitive/UIPattern 1..* -> feature composition
FoundationExtensionRequest -> zero or one new/changed primitive, pattern, or variant
MigrationBaseline -> constrains LaunchPage composition only
```

AppearancePreferences crosses only the separate appearance preload contract. It has no relationship to `ProjectSnapshot`, project paths, recent index storage or the six-method project bridge; MigrationBaseline forbids changing those contracts.
