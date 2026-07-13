# Action and state inventory

This inventory is the review baseline for feature 012. `Status` is updated only
when linked evidence exists in [evidence.md](./evidence.md). Source locators are
stable component paths rather than generated bundle locations.

| Surface | Placement / state | Canonical action | Presentation | Source locator | Status | Evidence |
|---|---|---|---|---|---|---|
| Launch | New-project submit | `create-project` / `FolderPlus` | icon + label | `src/renderer/launch/LaunchPage.tsx` | closed | E-US1-DOM |
| Launch | Open-project dialog | `open-project` / `FolderOpen` | icon + label | `src/renderer/launch/LaunchPage.tsx` | closed | E-US1-DOM |
| Launch | Open recent project | `open-project` / `FolderOpen` | icon + label | `src/renderer/launch/LaunchPage.tsx` | closed | E-US1-DOM |
| Launch | Relink unavailable recent | `open-project` / `FolderOpen` | icon + label | `src/renderer/launch/LaunchPage.tsx` | closed | E-US1-DOM |
| Launch | Remove recent pointer | `delete` / `Trash2` | icon + label | `src/renderer/launch/LaunchPage.tsx` | closed | E-US1-DOM |
| Launch | Loading, working, error, warning, empty | non-action state | text + semantic state | `src/renderer/launch/LaunchPage.tsx` | closed | E-US3-DOM |
| Launch | Appearance selector | existing settings control | visible label | `src/renderer/components/patterns/AppearanceControls.tsx` | reviewed | E-BOUNDARY |
| Workspace | Return to projects | `return-to-projects` / `ArrowLeft` | icon + label | `src/renderer/workspace/components/ProjectNavigation.tsx` | closed | E-US1-DOM |
| Workspace | AI provider settings tool | `settings` / `Settings` | icon + label | `src/renderer/App.tsx`, `ToolRail.tsx` | closed | E-US1-DOM |
| Workspace | Writing orientation tool | `workspace-tool` / `Map` | icon + label | `src/renderer/App.tsx`, `ToolRail.tsx` | closed | E-US1-DOM |
| Workspace | Close active tool panel | `close-panel` / `X` | icon-only | `src/renderer/workspace/components/ToolPanelHost.tsx` | closed | E-US2-MATRIX |
| Workspace | Status recovery action | owner action mapping | icon + label when canonical | `src/renderer/workspace/components/WorkspaceStatusRegion.tsx` | closed | E-US3-DOM |
| Workspace | Ready, progress, complete, warning, error | non-action state | text + semantic state | `WorkspaceStatusRegion.tsx` | closed | E-US3-DOM |
| Workspace | Leave: save and leave | `save` / `Save` | icon + label | `src/renderer/workspace/WorkspaceShell.tsx` | closed | E-US1-DOM |
| Workspace | Leave: discard and leave | destructive leave | label-required | `src/renderer/workspace/WorkspaceShell.tsx` | closed | E-US3-DOM |
| Workspace | Leave: stay | cancel | label-required | `src/renderer/workspace/WorkspaceShell.tsx` | closed | E-US3-DOM |
| Orientation | Save orientation | `save` / `Save` | icon + label | `WritingOrientationPanel.tsx` | closed | E-US1-DOM |
| Orientation | Motivation empty, dirty, saving, saved, failed | non-action state | text + semantic state | `WritingOrientationPanel.tsx` | closed | E-US3-DOM |
| Outline | Add outline item | `add-outline-item` / `Plus` | icon + label | `WritingOrientationPanel.tsx` | closed | E-US1-DOM |
| Outline | Select outline item | selection | visible title + `aria-pressed` | `WritingOrientationPanel.tsx` | closed | E-US2-DOM |
| Outline | Move item up | `move-up` / `ArrowUp` | icon-only | `WritingOrientationPanel.tsx` | closed | E-US2-MATRIX |
| Outline | Move item down | `move-down` / `ArrowDown` | icon-only | `WritingOrientationPanel.tsx` | closed | E-US2-MATRIX |
| Outline | Start / continue writing | chapter entry | label-required | `WritingOrientationPanel.tsx` | closed | E-US3-DOM |
| Outline | Delete item | `delete` / `Trash2` | icon + label | `WritingOrientationPanel.tsx` | closed | E-US1-DOM |
| Outline | Empty, invalid, linked-item restriction | non-action state | text + semantic state | `WritingOrientationPanel.tsx` | closed | E-US3-DOM |
| Editor | Paste Markdown | `paste-markdown` / `ClipboardPaste` | icon + label | `ChapterEditor.tsx` | closed | E-US1-DOM |
| Editor | Export Markdown | `export-markdown` / `Download` | icon + label | `ChapterEditor.tsx` | closed | E-US1-DOM |
| Editor | Save now | `save` / `Save` | icon + label | `ChapterEditor.tsx` | closed | E-US1-DOM |
| Editor | Saved, dirty, saving, failure, citation warning | non-action state | text + semantic state | `ChapterEditor.tsx` | closed | E-US3-DOM |
| Editor | Conflict keep / reload / cancel | conflict resolution | label-required | `ChapterConflictDialog.tsx` | closed | E-US3-DOM |
| Editor | Paste confirm / cancel | paste resolution | label-required | `MarkdownPasteDialog.tsx` | closed | E-US3-DOM |
| Editor | Export confirm / cancel / busy / success | export resolution | icon + label / text state | `MarkdownExportDialog.tsx` | closed | E-US3-DOM |

## Icon-only admission records

| Placement | Auxiliary | Space constrained | Convention clear | Audit owner | Decision |
|---|---|---|---|---|---|
| Panel close | yes | yes, fixed panel heading | yes (`X`) | 012 accessibility review | admitted with `aria-label` + tooltip |
| Outline move up/down | yes | yes, repeated outline rows | yes (direction arrows) | 012 accessibility review | admitted with item-specific `aria-label` + tooltip |

