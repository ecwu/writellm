# Contract: reusable writing workspace UI

本 contract 定义 renderer 内部可复用的工作台壳层、panel/modal state、BlockNote editor session 和底部命令栏。它不是 IPC API；需要文件、Git、native dialog、secret 或 provider 网络能力时，feature adapter 必须调用 [project-ipc.md](./project-ipc.md) 中的命名 bridge method。

## Shell regions

`WorkspaceShell` MUST render these regions in stable DOM order:

1. `WorkspaceHeader` — project switcher, new project, save state, settings.
2. `ToolRail` — narrow left rail with accessible icon buttons.
3. `EditorStage` — current chapter/motivation/outline editor region.
4. `QuickActionBar` — AI assistant, markup, citations, history and save commands.
5. `ModalHost` — named dialog/sheet host rendered above the shell.

The editor remains mounted while a rail panel or modal is open unless the user changes chapter/project. Opening or closing a panel MUST NOT reset selection, dirty state, or BlockNote document.

## Tool rail and floating panel

```ts
type ToolId = 'outline' | 'sources' | 'assistant' | 'citations' | 'history';

type ToolPanelState = {
  activeTool: ToolId | null;
  open: boolean;
};
```

Rules:

- Clicking an inactive tool sets `activeTool` and opens exactly one panel anchored to the left rail.
- Clicking the active tool, pressing `Escape`, or clicking outside the panel closes it.
- A panel MUST expose a visible heading, close button, keyboard focus target, and empty/loading/error state.
- The rail MUST remain usable when the panel is open; the active button MUST have a non-color-only visual state.
- A panel MUST NOT accept an absolute filesystem path, raw IPC channel, secret, or arbitrary HTML as input.

## Modal host

```ts
type ModalDescriptor =
  | { kind: 'new-project'; source: 'launch' | 'header' }
  | { kind: 'project-switcher' }
  | { kind: 'settings'; tab: 'general' | 'providers' | 'appearance' }
  | { kind: 'proposal-review'; proposalId: string }
  | { kind: 'history-diff'; leftRevision: number; rightRevision: number }
  | { kind: 'confirm'; action: 'delete-project' | 'discard-draft' | 'restore-revision' };
```

Rules:

- Modal presentation MUST use the shared shadcn/Radix dialog primitives or the shared sheet primitive; feature code MUST NOT implement a second focus trap.
- A modal MUST add a scrim, lock background scrolling, move focus into the modal and return focus to the invoking control on close.
- `Escape` closes a dismissible modal. Dirty forms and destructive actions MUST intercept close with an explicit confirmation step.
- Background blur is visual presentation only; it MUST NOT be used as a security boundary or as a signal that content has been saved.
- Modal payloads are typed domain IDs and safe DTOs. They MUST NOT include API key plaintext or absolute paths.

## BlockNote editor session

```ts
type EditorSession = {
  chapterId: string | null;
  document: BlockNoteDocument;
  focusedBlockId: string | null;
  selectedBlockIds: string[];
  baseRevision: number;
  dirty: boolean;
  identityStatus: 'valid' | 'needs_review' | 'external_change';
};
```

Rules:

- `BlockNoteView` MUST be created with a project schema that extends the default schema for product-specific citation/proposal blocks.
- The editor MUST subscribe to BlockNote `onChange` and selection events without copying every transaction into global shell state.
- Top-level blocks MUST have stable IDs. IDs are used by citations, AI proposal targets and version diff references; DOM position or array index MUST NOT be used as identity.
- Chapter switch MUST destroy/recreate the BlockNote editor instance with the newly validated `initialContent`; panel/modal toggles MUST NOT recreate it.
- BlockNote Markdown helpers are lossy. The UI MAY use them for paste/export preview, but save MUST submit the BlockNote document to the main-owned project codec, which preserves identity metadata.
- A document with `identityStatus='needs_review'` or `external_change` MUST show an actionable banner and MUST NOT silently overwrite the canonical chapter file.

## Bottom quick action bar

```ts
type QuickActionId =
  | 'open-assistant'
  | 'open-markup'
  | 'open-citations'
  | 'open-history'
  | 'save';

type QuickAction = {
  id: QuickActionId;
  label: string;
  iconName: string;
  enabled: boolean;
  shortcut?: string;
};
```

Rules:

- Every action has visible label text at normal desktop width and an accessible tooltip/label in compact mode.
- Disabled actions explain why they are unavailable; for example, `open-assistant` is disabled when no block is selected or provider configuration is incomplete.
- The bar MUST reserve editor bottom padding so it never obscures the current line or selection.
- `save` reports `saving`, `saved`, `dirty`, `error` or `conflict`; a green check alone is insufficient to communicate persistence.

## Provider settings UI

```ts
type ProviderSettingsSummary = {
  providerId: string;
  endpoint: string;
  modelLabel: string;
  secretConfigured: boolean;
  lastValidatedAt: string | null;
};

type ProviderSettingsForm = ProviderSettingsSummary & {
  apiKey: string;
};
```

- The API key field MUST be password-like and MUST NOT be prefilled with the existing key.
- The existing key is represented only by `secretConfigured=true`; it MUST never be returned to the renderer.
- Submit calls a named bridge method and clears plaintext from form state after success or terminal failure.
- Error rendering MUST use typed codes and redacted messages; it MUST NOT include request headers, provider response secrets or the key value.

## Accessibility and keyboard contract

- All rail buttons, panel close buttons, modal controls and quick actions are reachable with Tab/Shift+Tab and have visible focus rings.
- `Escape` closes the active panel or dismissible modal; `Mod+S` invokes the save command; `Mod+Shift+O` toggles outline.
- Tooltips supplement, rather than replace, accessible names.
- Status is communicated with text and/or icon plus color; color alone MUST NOT distinguish active, invalid, saving or model-originated changes.
- Focus must not be lost when a modal closes or when a panel toggles.
