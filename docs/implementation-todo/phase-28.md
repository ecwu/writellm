# Phase 28: Unified Reference Import And Attachment Association

Status: Checkpoint 79 is complete under ADR 070.
Recorded: 2026-08-31

## Checkpoint 79: Unified Reference Import

- [x] Replace the split metadata/PDF flow with one bounded prepare/confirm import plan while
  retaining the existing bibliography connector, snapshot, refresh, and Reference authority.
- [x] Preserve explicit attachment consent: selecting candidates does not call Better BibTeX RPC;
  the visible `Review references and PDFs` action authorizes the bounded loopback lookup.
- [x] Support user-confirmed completion of incomplete/unbound References and explicit
  `relink_required` recovery without title, DOI, filename, or similarity matching.
- [x] Route bibliography PDFs through the existing Knowledge copy/hash/parse pipeline without
  creating orphan `doc-*` References, and fail closed when an existing PDF belongs elsewhere.
- [x] Replace the two import dialogs with one Reference-first flow and explicit citation-only,
  primary-PDF, supplementary-file, partial-success, and retry states.
- [x] Add focused contract, Main, Renderer, watcher, RPC-consent, deduplication, and Electron E2E
  coverage, then pass the approved CP79 gates.

## Decision notes

- `includePdf` defaults on in Renderer, but opening the dialog, selecting candidates, and ordinary
  connector refresh never query Better BibTeX. The explicit Review action is the user selection
  required by ADR 070; disabling the option follows the metadata-only path without RPC.
- Completing or relinking an existing Reference always requires the user to select that exact
  target. Project citekeys and Knowledge links remain stable, and no similarity matcher is added.
- The existing project schema already models one Reference with zero or more primary/supplemental
  Knowledge attachments. CP79 changes application contracts and workflow only; it adds no
  migration and does not modify RAG or `index.sqlite`.

## Acceptance criteria

One visible import task creates or updates project-authoritative References, optionally imports one
primary PDF plus supplements, reports per-Reference outcomes, and never exposes filesystem paths to
Renderer. Preview capabilities remain bounded, expiring, one-use, and session-authorized. Metadata
changes do not alter citekeys, manuscript revisions, chunks, embeddings, retrieval ranking, or
index generations. Metadata-only References remain unavailable as Agent evidence.

## Verification plan

- Focused shared-contract, Reference service, connector, IPC, preload, Knowledge import, and
  Renderer tests, including 1/50/51 PDF and 1/500/501 metadata-only boundaries.
- Injected attachment lookup tests prove RPC is called only by the explicit Review action.
- Electron E2E uses a `.bib` fixture with relative `file` PDF paths and never depends on Zotero or
  a real `127.0.0.1:23119` service.
- Scoped Impeccable detector, `pnpm check:fast`, canonical Electron suite, production build, full
  Electron E2E, and `git diff --check`. No package gate is required because CP79 adds no dependency,
  native module, worker entrypoint, or packaged resource.

## Local evidence

Verification evidence: [archived record](https://github.com/ecwu/writellm/blob/493f02a26ccb18172de7390f5b3c5df9f2026905/docs/implementation-todo/phase-28.md#local-evidence).