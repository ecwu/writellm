# ADR 070: Stable Bibliographic Reference And Zotero Workflow

Status: accepted for Checkpoints 78.0–78.3
Date: 2026-08-31

## Context

Knowledge currently derives `display_name` from a local filename and uses that title both as a
human label and as the identity embedded in readable citations. That works for chunk provenance,
but it cannot reliably represent an article's authors, venue, year, DOI, ISBN, URL, or stable
bibliography key. A model can consequently mistake a filename for a citable work, and publication
cannot generate a trustworthy bibliography.

ADR 020 deliberately rejected persisted numeric reference IDs and formatted citation strings in
manuscript revisions because they would become a second truth source. ADR 030 deliberately refused
to fabricate BibTeX from title-only records while reserving a future structured-metadata decision.
The architecture also deferred external-edit synchronization and project-wide file watching. A
Zotero workflow needs a narrower external-file capability without weakening any of those reasons.

The dependency gate rechecked Citation.js 0.8.x. The already exact-pinned
`@citation-js/core@0.8.2` and `@citation-js/plugin-bibtex@0.8.2` provide the existing import and
BibTeX conversion boundary. `@citation-js/plugin-csl@0.8.2` adds registered CSL styles, locales,
citation formatting, bibliography formatting, and an application-controlled citeproc engine
behind the same API. It depends on `citeproc`; WriteLLM also exact-pins `citeproc@2.4.63` so its
runtime and license cannot drift through a transitive caret. Citation.js is MIT licensed and its
0.8 line remains maintained. citeproc is offered under CPAL-1.0 or AGPL-1.0; WriteLLM selects and
records the CPAL-1.0 distribution option and carries the required source/network-use notice in the
third-party notices and packaged application. The user explicitly accepted this dependency and
distribution boundary for CP78.

## Decision

### Reference identity and authority

`project.sqlite` gains a Reference authority separate from Knowledge search data:

- `reference_items` owns one immutable, project-unique `citation_key`, validated bounded CSL-JSON,
  common searchable fields, completeness, and timestamps.
- `reference_creators` owns ordered creator names and roles.
- `reference_import_bindings` relates a Reference to one upstream connector item while retaining
  the upstream key, source format, fingerprint, and explicit synchronization state.
- `knowledge_reference_links` relates a Reference to zero or more Knowledge items as a primary or
  supplemental attachment.
- `reference_settings` owns the project CSL style and locale. Custom CSL is a hashed,
  project-relative resource, never an absolute project record path.

Knowledge files remain the authority for copy, parse, normalization, indexing, retrieval, and
chunk provenance. `citationId` remains a chunk pointer. Reference metadata changes never alter
chunks, embeddings, retrieval ranking, or `index.sqlite`.

Manuscript revisions continue to store ordinary text, not `reference_id`, numeric order, or a
formatted citation. A token such as `[@smith2024]` is a portable external citation key and behaves
as a checked textual foreign key. `reference_items` owns bibliographic metadata only. Numbers,
author-year forms, formatted clusters, and References are derived from the current manuscript,
metadata, style, and locale. Metadata synchronization therefore does not change revision identity.
A citation key cannot be deleted or renamed while cited, and synchronization never automatically
changes a project citation key.

This is a narrow revision of ADR 020: LLM output may now contain a citation key, but only one
returned by an evidence tool and validated against the run's expanded evidence. The model may not
derive a key from a filename, `display_name`, title, or metadata-only record. Existing readable
title citations remain accepted. Their conversion to citekeys is a separate, user-confirmed plan
that fails closed for ambiguous, unmatched, or insufficiently proven occurrences.

Project citation keys are case-sensitive and match
`^[A-Za-z0-9][A-Za-z0-9._:+-]{0,127}$`. A valid, unused upstream key is retained. Invalid keys
become a safe slug plus an eight-hex SHA-256 suffix; missing keys become
`ref-<year|nd>-<eight-hex-sha256>`; valid collisions append the same stable suffix. The upstream
key remains in the binding after the project key is created.

Existing stored Knowledge items receive an incomplete Reference during forward migration. Its
temporary title is the current `display_name`; its stable key is `doc-` plus a deterministic
hexadecimal fragment derived from `knowledge_item_id`. The migration does not rewrite manuscript
revisions or touch the rebuildable index.

### Bibliography connector capability

The architecture now permits exactly one kind of external-file synchronization: a user explicitly
selects one `.json` or `.bib` bibliography file through a Main-owned native picker. Main creates a
read-only connector capability. Its absolute path lives only in `app.sqlite`; the project stores
an opaque connector ID, a validated metadata snapshot, and path-free binding state. Renderer
never receives the path.

Main rejects symbolic links, unknown extensions, non-regular files, and files above the bounded
connector limit. To support atomic replacement it watches only the selected file's parent
directory and exact basename using Node `fs.watch`; it does not scan the directory. A debounced
reader confirms stable size and modification time before parsing outside a database transaction.
Manual Refresh remains available. A complete valid snapshot commits in one short transaction;
parse failure retains last-known-good data and records a safe error. Bad entries are isolated and
reported without erasing valid entries. New upstream entries appear as import candidates and are
never silently added. Missing or changed upstream keys become `relink_required`; title or DOI
similarity never causes an automatic merge.

This is the explicit product requirement anticipated by the prior `chokidar` non-choice, but it
does not authorize `chokidar`, a project-wide watcher, generic external editing, directory
scanning, or arbitrary filesystem access. The existing project-root containment invariant remains
unchanged for project resources. This connector is a separately scoped, app-global, read-only
capability whose exact external file was selected by the user.

Better CSL JSON is preferred; Better BibTeX and BibLaTeX `.bib` are compatible inputs. `.bib`
attachments come first from the `file` field, resolving relative paths against the selected file's
directory. Better CSL JSON may query only the fixed loopback Better BibTeX JSON-RPC endpoint and
only after the user selects “also import PDF”, using `item.attachments(citekey, '*')`. RPC failure
leaves a metadata-only Reference. Every returned path is untrusted and appears in a bounded import
preview before confirmation. Main then revalidates regular-file type, PDF signature/MIME, size,
extension, and link policy before reusing the existing Knowledge copy/hash/MinerU pipeline.

### Citation syntax, formatting, and publication

The canonical English forms are `[@key]`, `[@key, p. 12]`, and
`[@key; @other, pp. 20-22]`. The canonical Chinese forms are `【@key】`,
`【@key，第 12 页】`, and `【@key；@other，第 20–22 页】`. One bracketed token is one CSL
citation cluster; adjacent tokens remain distinct clusters. Version one supports page and page
range locators. Agent tools may emit only a single page, while users may type a range. Display is
one-based; preview sources continue to use zero-based internal page indices.

`full`, `numbered`, and `icon` retain their existing meaning. The new opt-in `formatted` mode uses
the selected CSL style and locale. Formatting runs in `background-worker`, never Renderer or a
Main transaction. A snapshot hash covers style, locale, cited metadata, ordered clusters, and
locators. Requests are debounced, obsolete work is cancelled, Main retains a bounded LRU, and
Renderer accepts only the matching current hash. Ordinary prose edits that preserve the citation
sequence do not reformat. While numbered styles reorder, the source token/preparing state is shown
instead of stale numbers. Custom CSL must declare `class="in-text"`; note styles fail closed.

Publication assembly carries citation keys, clusters, locators, and a bounded Reference metadata
projection. Bibliography-aware PDF, DOCX, HTML, LaTeX, sidebar, and Markdown package output use the
same formatter snapshot. Existing presets keep their old behavior; a new preset opts into the
bibliography workflow. Pandoc package mode retains citekey tokens and writes a deterministic
`references.bib` or `references.json`, optionally with the project CSL resource. Bibliography
scope is either cited-only or all-project.

This supersedes ADR 030 only where authoritative structured CSL metadata now permits BibTeX,
CSL-JSON, and formatted References. CSL-to-BibTeX fixes every CSL `id` to the project citation key,
sorts deterministically, reparses the output, compares important fields, and reports irreversible
loss. A LaTeX package may include `.bib`, but the application still does not invoke or bundle
BibTeX, Biber, TeX, templates, paths, or shell execution. Initial `.tex` output continues to use
application-formatted References.

## Consequences

- Metadata-only References are manually citable and exportable but cannot satisfy Agent evidence.
  PDF-only incomplete References remain searchable and receive a stable local key. A complete
  Reference linked to indexed PDF content supports both citation and evidence.
- Stable citekeys make Zotero synchronization and deterministic export portable without placing
  database identifiers or formatted output in manuscript revisions.
- The external-file exception is auditable and revocable because Main owns the app-global path and
  project sessions see only opaque connector IDs and snapshots.
- Numeric styles may require a full ordered recomputation; bounded hashing, debouncing,
  cancellation, and caching keep that cost outside interactive text editing.
- CP78 adds no worker role, generic permission framework, remote DOI lookup, automatic Zotero
  mutation, project-wide watch, bibliography compiler, or change to the RAG storage pipeline.

## Alternatives Rejected

- Treating `display_name` or a filename as bibliography identity remains ambiguous and lets the
  model invent citations.
- Persisting `reference_id`, numeric order, or formatted text in revisions recreates ADR 020's
  second-source-of-truth problem.
- Querying Zotero's database directly couples WriteLLM to private schema and filesystem layout.
- Making Better BibTeX RPC the only attachment path adds a runtime dependency where `.bib` already
  carries a usable `file` field.
- `chokidar`, directory scans, and project-wide watchers exceed the single-file capability.
- Using raw `citeproc` throughout product code duplicates Citation.js integration; only one
  adapter may expose application-owned formatter contracts.
- Executing BibTeX, Biber, or TeX would introduce an executable document and shell boundary that
  this checkpoint does not need.
