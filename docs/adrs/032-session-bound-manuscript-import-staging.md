# ADR 032: Session-Bound Manuscript Import Staging

- Status: Accepted
- Date: 2026-08-13
- Checkpoint: 36

## Context

Checkpoint 36 replaces the Renderer-owned Markdown file input with a review-before-apply import
boundary. An import may contain a manuscript structure, rich text, and local images, but the
Renderer is untrusted and must not receive file paths, source bytes, or filesystem authority. The
preview and the eventual mutation must also be derived from exactly the same captured source and
mapping plan.

The Markdown parser gate rechecked `unified`/`remark-parse`, `markdown-it`, and `micromark` from
their official npm metadata. All are MIT licensed, pure JavaScript, Electron 43 compatible, and
have no native packaging impact. `unified@11.0.5`, `remark-parse@11.0.0`, and the existing
`remark-gfm@4.0.1` are selected and exact-pinned: they expose a stable mdast boundary, preserve
source structure needed for an exact loss report, and are bounded by application-owned byte/node
limits. `markdown-it@15.0.0` primarily exposes rendering tokens, while `micromark@4.0.2` is the
lower-level tokenizer used by the selected stack and would require more application mapping code.

## Decision

Main owns selection, capture, parsing, resource resolution, planning, and application. A picker
accepts one regular `.md` file. Main rejects symbolic links, captures at most 8 MiB into
`.writellm/temp/manuscript-import/<plan-id>/source.md` with mode `0600`, records its SHA-256, and
never returns the selected path or bytes to Renderer. A format adapter receives only captured
bytes plus a constrained local-resource resolver. It cannot access the network, execute embedded
content, start a process, or open arbitrary paths.

The selected file's real parent directory is the resource root. Relative image references may
contain only normal path segments beneath that root; absolute paths, URL schemes, `..`, encoded
escapes, links, non-regular files, unsupported MIME content, and resources outside the byte/count
budget are rejected. Identical image bytes are deduplicated by hash. Resource bytes are also
copied into the plan directory, so later preview and apply never reread mutable external files.

The immutable `ImportPlan` is an opaque capability bound to the active project session, source
hash, current brief version, outline version, and active-section revision. It expires after 30
minutes. Staging is removed after apply or cancellation; project switch revokes that session's
plans. On project open, all old manuscript-import staging directories are removed because no
capability survives process restart. Renderer receives only a bounded typed projection: source
identity, proposed metadata/sections/content, assets, warnings, unsupported constructs, and loss
records.

Markdown level-one headings start new proposed sections. Text before the first heading becomes an
`Imported preface`; a file without level-one headings becomes one section named from the source
file. Lower headings remain body headings. Empty input produces a non-applicable no-op plan.
`create_sections` appends all proposed sections; `replace_active_section` flattens multiple
proposals into the active body with their titles as headings. Whole-manuscript replacement is not
implemented and remains a separate reviewed mutation.

During planning, captured images are published through the existing immutable asset service so
the typed preview and final BlockNote body share the same registered opaque URLs; no manuscript
revision changes. Before apply, Main verifies the staged source and resource hashes and
revalidates the captured brief, outline, and active revision. The manuscript database mutation is
then atomic: either all imported sections and
their initial import revisions are installed with Main-minted section/revision/block IDs, or none
are. Active-section replacement uses the existing import revision optimistic-concurrency path.
Materializations are published after commit and remain repairable from canonical SQLite state.
If asset publication succeeds but the manuscript transaction fails, the deduplicated unreferenced
asset is an explicit partial outcome and the existing orphan cleanup lifecycle reclaims it after
its grace period; no manuscript state is partially applied.

## Consequences

- Previewed and applied content share one captured source hash and one in-memory mapping plan.
- Import is a filesystem/parser fixture around the existing manuscript and asset authorities, not
  a second conversation, model extraction endpoint, general plugin system, or durable workflow.
- Parse cancellation is cooperative between bounded filesystem phases; synchronous mdast mapping
  is protected by the 8 MiB source and application node/document limits.
- The adapter can later be joined by the CP37 LaTeX adapters without granting them filesystem or
  mutation authority.
- Crash recovery intentionally discards unapplied plans rather than attempting to resume an
  approval capability after restart.
