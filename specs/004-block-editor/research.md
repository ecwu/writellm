# Research: Block editor

All technical unknowns used by this accepted plan are resolved below. The exact
package lock remains subject to the verification gate listed at the end.

## Decision: BlockNote JSON is the canonical editor payload

**Decision**: Use BlockNote and persist `editor.document` inside a versioned
WriteLLM `ChapterDocument` wrapper. Preserve native `id`, `type`, `props`,
`content` and `children`; do not create a parallel durable block model.

**Rationale**: BlockNote documents directly model the feature's block operations,
and its official guidance identifies JSON as the durable lossless format. Stable
block IDs also provide the correct first anchor for citation transforms.

**Alternatives considered**: Markdown canonical storage with HTML-comment IDs was
rejected because it is lossy and fragile. A second domain block schema was
rejected because two writable truths require permanent codecs and migration.

## Decision: Pin BlockNote 0.51.4 with the Ariakit UI adapter

**Decision**: At implementation acceptance, pin `@blocknote/core`,
`@blocknote/react` and `@blocknote/ariakit` to exactly `0.51.4`, subject to a clean
Bun peer-dependency, typecheck, build and compiled Electron compatibility gate.
Use no `@blocknote/xl-*` package.

**Rationale**: Ariakit is the official accessible/headless adapter and can use the
project's semantic CSS without introducing Mantine as a second design system or
assuming Radix/shadcn DOM beneath ADR-003's Base UI foundation. Standard BlockNote
packages use MPL-2.0; the XL family has different GPL/commercial terms and is not
needed by 004.

**Alternatives considered**: Mantine is BlockNote's default standalone UI but adds
a second UI foundation. The BlockNote shadcn adapter assumes a different source
and theme integration than this repository's accepted Base UI/Rhea foundation.
Custom headless composition would own more editor chrome than the first release
requires.

## Decision: Fixed CommonMark/GFM-derived Markdown boundary

**Decision**: Freeze the built-in BlockNote baseline required by FR-013: headings,
paragraphs, bullet/number/task lists, tables, code, blockquotes, links, images,
emphasis, strike-through and hard breaks. Use the selected version's
`tryParseMarkdownToBlocks`/explicit Markdown paste path and
`blocksToMarkdownLossy`; normalize possibly sync/async library behavior behind an
awaitable adapter.

Every conversion is treated as lossy. Product-owned preflight analysis returns
structured warnings because unsupported syntax can otherwise become ordinary
text without a library error. Markdown paste is an explicit preview-and-confirm
flow; ordinary rich clipboard HTML behavior is not a promise to support another
Markdown dialect.

**Alternatives considered**: Adding remark, marked, markdown-it or a Markdown→HTML
fallback was rejected because it expands the accepted dialect and creates two
parsers. Silent best-effort conversion was rejected by FR-014–FR-016.

## Decision: JSON files behind a main-owned chapter repository

**Decision**: Store each chapter at logical path
`workspace/chapters/<chapterId>.json`. Main alone resolves the validated project
root, serializes content writes and applies ADR-001 transaction/Git recovery.

**Rationale**: Access is by opaque chapter ID, JSON remains inspectable/diffable,
and the selected canonical editor format already is JSON. SQLite provides no
needed query or transaction advantage beyond the shared content transaction and
would add a durable dependency/migration boundary.

**Alternatives considered**: Project SQLite remains a future ADR-level option but
is unnecessary for this feature. Renderer filesystem access violates the
constitution and security baseline.

## Decision: Atomic 003↔004 chapter creation/link

**Decision**: `openForOutlineItem` reloads the 003 orientation aggregate. If the
item has no link, main creates a revision-0 valid empty chapter and sets its
`chapterRef` in one pending transaction and Git commit. If linked, it opens that
exact chapter. The request includes `baseOrientationRevision` and an idempotent
`mutationId`; renderer never writes `chapterRef`.

Chapter title is a read-time projection of the orientation item's title, not a
second writable field in the chapter file.

**Alternatives considered**: Independent writes can leave orphan chapters or
dangling links. A chapter-owned editable title duplicates 003's authoritative
outline title.

## Decision: Snapshot saves, local editor commands and optimistic revision

**Decision**: Block edits remain renderer-local. Save sends one bounded full
snapshot plus exact `baseRevision` and `mutationId`; main validates and commits it.
Chapter revision starts at zero and increments once only after file replacement
and the required Git commit succeed. Cross-view stale saves return
`REVISION_CONFLICT` without overwriting either version.

**Alternatives considered**: Main-process `applyBlockCommand` is chatty and creates
a second editor authority. Last-writer-wins violates FR-011. Patch persistence adds
ordering/idempotency complexity without a requirement.

## Decision: Citation relation and conservative transforms

**Decision**: Persist citations separately from editor JSON with citation/source/
chunk IDs, block ID, UTF-16 text range, quoted text and validity. A visible custom
inline token may use a namespaced `writellmCitation` schema type, but the relation
collection is authoritative. Move/split/merge remaps only provable complete
ranges; all ambiguous, cut, missing or deleted ranges become `needs-review`.

**Alternatives considered**: Nearest-text matching can silently attach evidence to
unrelated prose. Markdown citation syntax cannot preserve the durable relation.
004 validates relation shape, while source/chunk existence remains owned by
future accepted 006/007 contracts.

## Sources

- [BlockNote supported formats](https://www.blocknotejs.org/docs/foundations/supported-formats)
- [BlockNote document structure](https://www.blocknotejs.org/docs/foundations/document-structure)
- [BlockNote Markdown import](https://www.blocknotejs.org/docs/features/import/markdown)
- [BlockNote custom schemas](https://www.blocknotejs.org/docs/features/custom-schemas)
- [BlockNote Ariakit integration](https://www.blocknotejs.org/docs/getting-started/ariakit)
- [BlockNote package](https://www.npmjs.com/package/@blocknote/core)
- [BlockNote repository and license](https://github.com/TypeCellOS/BlockNote)
- [ADR-001](../../docs/adr/001-project-storage.md)
- [ADR-003](../../docs/adr/003-ui-foundation.md)

## Remaining implementation gate

No research item remains `NEEDS CLARIFICATION`. The accepted 003 and 004 plans
freeze the shared create/link transaction; linked deletion remains safely refused
by 003 and outside 004 scope. Before implementation proceeds beyond dependency
setup, the exact package lock must pass license/peer/build/Electron checks. FR-011
is exercised by two primary-instance-owned compiled Electron test windows sharing
the same main repository; no user-facing multi-window manager is added.
