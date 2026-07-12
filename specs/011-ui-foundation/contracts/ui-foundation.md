# Contract: Renderer UI Foundation

**Status**: Accepted — maintainer accepted through design Q&A on 2026-07-12.

This contract defines the interface between shared renderer UI and consuming features. It is not an IPC, network or persistence contract.

## 1. Import and ownership boundary

- Features import primitives from the stable `components/ui` entry paths and patterns from `components/patterns`.
- `components/ui` may import native React types, foundation utilities and the selected Base UI dependency; it must not import a feature, `window.writellm`, Electron, Node, shared project DTOs or main/preload code.
- `components/patterns` may import `components/ui`; it must not own project/workspace/provider/editor/source/history state.
- Features own business copy, handlers, async state and policy decisions.

Allowed direction:

```text
feature -> patterns -> ui -> Base UI/native elements
```

## 2. Theme contract

- Every public visual state uses semantic tokens.
- Every required token has light and dark values.
- Theme mode is `system`, `light` or `dark`; it defaults to `system`, persists application-wide and updates without remounting feature content.
- Only `system` follows runtime OS color-scheme changes. Explicit `light` or `dark` remains stable until the user changes it.
- Reduced motion removes or minimizes non-essential animation.
- Forced-colors/high-contrast mode keeps browser adjustment enabled by default and preserves visible system-color focus, borders and non-color status text.
- Components/patterns do not read localStorage, files or IPC. The appearance provider uses only the separate typed appearance bridge; main owns validation, `nativeTheme` and userData persistence.
- Theme/typography preference never enters project files or document/export semantics.

## 3. Primitive contract

Every interactive primitive must document and verify:

1. rendered native element or accessible role;
2. accessible-name responsibility;
3. keyboard activation/navigation;
4. visible focus behavior;
5. disabled and invalid semantics when applicable;
6. controlled/uncontrolled state expectations when applicable;
7. focus entry, containment and return for overlays;
8. light/dark and reduced-motion behavior;
9. supported variants and extension points.

Consumers must not depend on undocumented generated DOM nesting or upstream private attributes.

### Initial public behavior matrix

| Component | Public behavior / variants | Semantic and state contract |
|---|---|---|
| `Button` | `default`, `secondary`, `ghost`, `destructive`; default and icon sizes | Native `button` by default; consumer supplies accessible name; Space/Enter activation and `disabled` semantics remain native. Polymorphic rendering is not public in 011. |
| `Input` | text-compatible native input; visual invalid/disabled states | Visible or programmatic label required; invalid state exposes `aria-invalid` and FormField error relationship; feature owns value and validation. |
| `Label` | no visual variants | Native `label` associated by `htmlFor` or wrapping; not a substitute for instructions/errors. |
| `Card` | surface container and named header/content/footer composition | No landmark/interactive role by default; feature adds heading/region semantics only when meaningful. |
| `Alert` | `default`, `destructive` | Visible title/message; urgent errors use `role="alert"`; non-urgent updates use `StatusNotice` so static content is not announced on mount unnecessarily. |
| `Badge` | `default`, `secondary`, `destructive`, `outline` | Non-interactive text marker; never the sole carrier of state meaning. |
| `Separator` | horizontal/vertical; decorative by default | Decorative instance is hidden from accessibility tree; semantic instance exposes `role="separator"` and orientation. |
| `Dialog` | controlled/uncontrolled open state; modal only in 011 | `role="dialog"`, `aria-modal="true"`, visible title supplies accessible name; contextual initial focus, native Tab cycle, Escape close, inert background and logical return/fallback focus are mandatory. Outside-click dismissal is enabled for non-destructive dialogs and may be disabled only by documented feature policy. Nested modal dialogs are not public in 011. |
| `Tooltip` | delayed hover/focus disclosure around a non-disabled trigger | Content has `role="tooltip"`; trigger uses `aria-describedby`; focus stays on trigger; Escape/blur dismiss; pointer may move over tooltip without immediate dismissal. No interactive tooltip content. |
| `ScrollArea` | vertical/horizontal overflow composition | Structural by default; when used as a meaningful region, consumer supplies role/name. It must retain native keyboard/wheel scrolling and visible focus when focusable. |
| `Select` | controlled/uncontrolled single selection; no multi-select in 011 | Label/name required; trigger exposes current value/open state; Arrow keys navigate, Enter/Space select, Escape closes, and focus returns predictably according to Base UI contract. |
| `FormField` | label, control, description, error slots | Generates stable label/description/error relationships; feature owns value, validation timing and safe message. |
| `StatusNotice` | `info`, `success`, `warning`, `error`; polite or urgent announcement | Always includes visible text; `error` may be urgent, other levels default polite; no status is color/icon-only. |
| `EmptyState` | heading, description, optional action | Presentational composition with a real heading; feature owns navigation/action behavior. |
| `AppearanceControls` | controlled `themeMode`, status and change callback | Uses Label + Select; exposes System/Light/Dark text choices; never calls IPC, stores preferences or changes project state directly. |

Public exports use named component entry paths. Generated internal slots/private attributes and Base UI types are not re-exported as foundation API. New variants follow the extension request process.

## 4. Pattern contract

- Patterns expose semantic slots/props and compose primitives; they do not proxy arbitrary component internals.
- `FormField` creates valid label/description/error relationships but the feature owns validation and messages.
- `StatusNotice` exposes visible non-color status meaning; the feature owns safe content and retry policy.
- `EmptyState` exposes heading/description/action slots; the feature owns navigation and business events.
- A pattern cannot call IPC or silently transform business state.

## 5. Overlay and focus guarantees

For `Dialog`:

- open moves focus inside using content-appropriate initial placement;
- Tab and Shift+Tab remain inside while modal;
- background is non-interactive while modal;
- Escape and explicit close behavior are available unless a consuming feature explicitly documents an accepted safety exception;
- close restores focus to the trigger or a documented fallback when the trigger no longer exists;
- visible title/accessibility name is required.

For `Tooltip`:

- content is available on keyboard focus as well as pointer hover;
- content has `role="tooltip"` and is referenced from the trigger with `aria-describedby`;
- focus remains on the trigger; Escape and blur dismiss it, and hover remains open while the pointer is over trigger or tooltip;
- tooltip does not contain required interactive content;
- icon-only triggers retain their own accessible name; tooltip is supplementary.

## 6. Customization contract

Preferred order:

1. compose existing primitive/pattern;
2. use an existing named variant;
3. add feature-local layout using semantic utilities;
4. propose a shared variant/pattern with a `FoundationExtensionRequest`;
5. add a new source-owned primitive only after accepted need and review.

Disallowed without explicit architecture review:

- copying a shared primitive into a feature;
- importing Base UI directly from a feature;
- hard-coded palette values when a semantic token exists;
- arbitrary z-index/elevation scales or `!important` overrides;
- a second button/input/dialog/tooltip/theme foundation;
- overwriting generated source without reviewing local diff and tests.

## 7. Initial public inventory

| Category | Public components |
|---|---|
| Action/form | Button, Input, Label, FormField |
| Selection/appearance | Select, AppearanceControls |
| Surface/content | Card, Separator, ScrollArea, EmptyState, source-owned Typeset presets |
| Feedback | Alert, Badge, StatusNotice |
| Overlay | Dialog, Tooltip |

Anything outside this list is not pre-approved. 002 may request additions after its accepted shell design proves need.

## 8. Appearance preference and IPC contract

The accepted 001 project bridge remains exactly:

```text
window.writellm -> six accepted project methods
```

011 adds a separate namespace:

```text
window.writellmAppearance -> getAppearancePreferences, updateAppearancePreferences
```

It must not expose paths, files, `nativeTheme`, generic settings, generic IPC or arbitrary CSS values.

Conceptual shared types:

```ts
type ThemeMode = 'system' | 'light' | 'dark';
type TypographyPresetId = 'editor' | 'reading' | 'compact';
type BodyFontId = 'system-serif' | 'system-sans';
type MonoFontId = 'system-mono';

type AppearancePreferences = {
  schemaVersion: 1;
  themeMode: ThemeMode;
  editorTypographyPreset: TypographyPresetId;
  bodyFontId: BodyFontId;
  headingFontId: BodyFontId;
  monoFontId: MonoFontId;
  baseSize: number;
  leading: number;
  flow: number;
};

type AppearancePreferenceInput = Omit<AppearancePreferences, 'schemaVersion'>;
type AppearanceWarningCode =
  | 'APPEARANCE_PREFERENCES_CORRUPT'
  | 'APPEARANCE_PREFERENCES_UNSUPPORTED';
type AppearanceErrorCode =
  | 'APPEARANCE_INVALID_INPUT'
  | 'APPEARANCE_STORAGE_UNAVAILABLE';
```

`getAppearancePreferences()` returns `{ preferences, warning? }` with a normalized snapshot and optional stable warning. `updateAppearancePreferences(input)` accepts a complete `AppearancePreferenceInput`, revalidates every field in main, atomically stores the normalized v1 snapshot, updates `nativeTheme.themeSource`, and returns `{ status: 'updated', preferences }` or `{ status: 'error', error: { code, message } }`.

Stable outcomes distinguish invalid input from storage failure. Corrupt/unknown disk data returns defaults plus a safe warning and is not overwritten until a valid update succeeds. No raw exception or persisted content crosses preload.

Main reads and applies the stored theme before BrowserWindow creation. The renderer owns only controlled UI state while an update is pending; failed updates retain the last normalized preference and show a safe status.

## 9. Typeset contract

- `typeset.css` is committed source, imported after Tailwind and owned by the foundation.
- `.typeset` enables prose styling; `.typeset-editor`, `.typeset-reading` and `.typeset-compact` select reviewed presets.
- Font IDs map to audited system-safe fallback stacks; no local enumeration, remote font, font upload or arbitrary font-family string is accepted in 011.
- Size, leading and flow are finite and main-validated within the bounds in `data-model.md`.
- Layout owns measure/max-width. Typeset owns element rhythm, theme integration, opt-out behavior and append-stable streaming styles.
- Typeset changes presentation only; it must not mutate HTML/Markdown, editor state, project files or exports.

## 10. 001 migration compatibility

The launch feature may change imports, markup composition and styling only. It must preserve:

- `LaunchPage({ api: WriteLLMIpc })` responsibility and all six accepted method calls;
- `launchState` transitions and safe fallback behavior;
- visible meanings of new/open/recent/relink/remove actions;
- loading, warning, error and empty workspace outcomes;
- recent count/availability behavior and project/recent side effects;
- renderer/main/preload security boundary;
- exact six-method `window.writellm` project namespace and project/recent storage behavior.

The separate two-method appearance namespace and `appearance-preferences.json` are additive 011 contracts. They must not share project channels, DTOs, repositories or files.

Any proposed change to these items belongs to a separate feature, not this migration.

## 11. Upgrade contract

For each shadcn/Base UI update:

1. use an exact reviewed CLI/source version;
2. update one logical component group at a time;
3. inspect dependency and lockfile delta;
4. inspect local source diff, public props, DOM semantics and token usage;
5. run component, consumer and Electron runtime checks;
6. record breaking changes and migration notes before merge.

Automated generation is an input to review, never authority to discard project-owned changes.

## 12. Non-contracts

This foundation does not define WorkspaceShell regions, panel IDs, editor content/state, project DTOs, custom color themes, font files/enumeration, project typography, generic settings IPC or project business error codes.
