# Data Model: Workspace navigation redesign

These models are renderer session state or owner projections unless explicitly marked as an amendment to the 006 read contract. They are not new durable records.

## WorkspaceNavigationSession

```ts
type WorkspaceCategoryId = 'sections' | 'knowledge-base'
type CompactPane = 'list' | 'detail'

type WorkspaceNavigationSession = {
  projectId: string
  activeCategory: WorkspaceCategoryId
  lastValidItemId: Record<WorkspaceCategoryId, string | null>
  visitedCategories: ReadonlySet<WorkspaceCategoryId>
  sidebarExpanded: boolean
  compactPane: CompactPane
  settings: null | SettingsReturnPoint
  focusReturnKey: string | null
}
```

### Invariants

- Exactly one project category is active; Settings never becomes an `activeCategory`.
- `sidebarExpanded` is desktop layout state only, defaults to expanded for a new project session, and is never persisted or cookie-backed.
- Item IDs are navigation identities only and must be revalidated against the current owner projection before use.
- `visitedCategories` controls lazy-first-mount, not data loading authority.
- The model is reset when project identity changes or the user returns to the launch surface.
- No field is written to project files, `userData`, localStorage, URL, or IPC.

### Transitions

| Event | Result |
|---|---|
| `category.activate(id)` | Set active category, preserve the other category’s last valid item, show its list/detail default. |
| `item.activate(category,id)` | Accept only an owner-present ID; store it and show detail in compact mode. |
| `sidebar.toggle` | Expand/collapse the desktop context sidebar without unmounting owners; main header trigger remains available. |
| `category.activate(id)` while collapsed | Activate the category and expand the context sidebar, matching the reviewed block behavior. |
| `item.invalidate(category,id)` | Clear matching selection; owner chooses safe default or empty state. |
| `list.show` | Compact mode returns to list and records detail focus fallback. |
| `settings.open(returnPoint)` | Keep category state, make project workspace inert, mount Settings. |
| `settings.close` | Unmount Settings, restore still-valid category/item and Settings trigger/fallback focus. |
| `project.leave` | Discard the entire navigation session after owner leave rules complete. |

## SettingsReturnPoint

```ts
type SettingsReturnPoint = {
  category: WorkspaceCategoryId
  itemId: string | null
  focusKey: string
}
```

- The item may become invalid while Settings is open; restore falls back to category list heading/first item.
- Settings owner panels are unmounted on close so write-only secret drafts are cleared according to 005/006 rules.

## SectionNavigationItem

```ts
type SectionNavigationItem = {
  id: string                // outlineItemId or owner-local clientDraftId
  title: string
  summary: string
  status: 'not-started' | 'in-progress' | 'completed'
  chapter: { kind: 'linked'; chapterId: string } | { kind: 'not-created' }
  ownerRevision: number
  persisted: boolean
}
```

- Projection order is the orientation owner draft order.
- Empty/long title and summary validation remains owned by 003.
- `not-created` never causes implicit chapter creation; the owner-provided Start writing action does.
- Navigation cannot mutate status, order, title, summary, or chapter link.

## SourceNavigationItem

```ts
type SourceNavigationItem = {
  id: string
  revision: number
  displayName: string
  state: SourceState
  progress: SourceSummary['progress']
  eligibility: SourceSummary['eligibility']
  retrying: boolean
  retryable: boolean
}
```

- It is a direct projection of `SourceSummary`; no state or eligibility is inferred.
- A later revision replaces an earlier projection for the same source ID.
- Removal invalidates current selection and every pending detail/page request.

## SourceDetailViewState

```ts
type SourceDetailViewState = {
  sourceId: string
  sourceRevision: number
  sourceVersionId: string
  generation: number
  phase: 'loading' | 'ready' | 'partial' | 'error'
  mode: 'original-pdf' | 'structured-markdown'
  detail: SourceDetail | null
  blocks: BlockPreview[]
  nextCursor?: string
  error?: SourceError
}
```

### Invariants

- A result applies only when source ID, version ID, and request generation match the current selection.
- Appended block pages must have the same version ID and strictly follow owner ordinal order.
- `mode='original-pdf'` is available only when the owner descriptor says so.
- Existing blocks remain visible during partial processing; absent blocks are not represented as empty successful content.

## SourceDetail amendment (006-owned)

```ts
type SourceDetail = SourceSummary & {
  sourceVersionId: string
  parseSummary: {
    markdownAvailable: boolean
    originalPreviewAvailable: boolean
    mediaCount: number
    blockCount: number
    indexedBlockCount: number
    failedBlockCount: number
    incompleteBlockCount: number
  }
  failure?: {
    code: SourceErrorCode
    messageKey: string
    stage: 'import' | 'parse' | 'index' | 'remove'
  }
}
```

- `sourceVersionId` is an app-owned bounded ID, never a path or remote provider ID.
- Counts are supplied by 006 and internally reconciled to its current version; 013 does not derive them from files.
- `originalPreviewAvailable` means the current project/session/version resolver can serve the canonical original; it does not imply structured or searchable readiness.

## OwnerRequestFence

```ts
type OwnerRequestFence = {
  owner: 'sections' | 'knowledge-base'
  itemId: string
  ownerRevision: number
  sourceVersionId?: string
  generation: number
}
```

- Generation increases on category/item/mode changes and owner resync.
- A late result whose fence no longer matches is ignored without changing visible errors or selection.

## Relationships

```text
WorkspaceNavigationSession
  ├─ active/last ID ──> SectionNavigationItem ──> 003 OutlineItem ──> 004 Chapter
  ├─ active/last ID ──> SourceNavigationItem  ──> 006 SourceSummary/SourceDetail
  └─ SettingsReturnPoint ──> 005 Provider owner + 006 SourceServices owner

SourceDetailViewState ── OwnerRequestFence ──> current 006 source version
```
