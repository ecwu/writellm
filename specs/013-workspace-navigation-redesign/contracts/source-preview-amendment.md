# Proposed amendment: 006 source detail and original PDF preview

**Status**: Draft producer-contract amendment required before 013 implementation.

This document does not itself amend the accepted 006 contract or ADR-005. Its clauses must be incorporated into and accepted in those source documents before implementation.

## Read-model delta

`SourceDetail` adds:

```ts
type SourceDetailPreviewAmendment = {
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
}
```

- `sourceVersionId` is an app-owned bounded opaque identity for the current canonical version.
- It is not a filesystem path, signed URL, remote task ID, content hash, or credential.
- All counts and availability are resolved by 006 for the same source version as the returned block page.
- `getSource` must not return a detail/page pair from different versions; version change during the read returns conflict/resync rather than mixed data.

## Fixed original-PDF route

The existing `writellm-source` protocol adds one reserved route shape:

```text
writellm-source://<sourceId>/__original__/<sourceVersionId>.pdf
```

The renderer constructs it only from a successful current `SourceDetail`. Arbitrary paths, query strings, fragments, extra segments, alternate extensions, encoded traversal, and non-current versions return 404.

## Resolver rules

Before serving bytes, main must:

1. Resolve the active project session itself.
2. Validate bounded safe source/version IDs and exact route shape.
3. Load the current 006 source record and require exact current `sourceVersionId`.
4. Resolve only the owner-defined canonical `original.pdf` path under that source/version.
5. Verify regular-file identity, `%PDF-` signature, accepted size ceiling, and stored size/hash. A streamed verification may be cached only for the active project session + source + version + file identity.
6. Invalidate cached descriptors when project/session/source/version changes or the file identity no longer matches.

No resolved path or raw verification error may leave main.

## Request/response contract

- Methods: `HEAD` and `GET` only.
- `GET` supports no Range or one valid bytes range. Multi-range, suffix overflow, malformed, or unsatisfiable requests return 416.
- Full responses use 200; ranged responses use 206 with exact `Content-Range`, `Content-Length`, and `Accept-Ranges: bytes`.
- The implementation streams bounded bytes and must not `readFile`/copy a 200 MB PDF into both main and renderer memory.
- Successful headers include `Content-Type: application/pdf`, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and a restrictive sandbox CSP.
- Invalid/stale/unauthorized/unavailable identities return the same safe 404 response. Internal details are logged only as accepted safe codes.
- Closing/moving/switching project invalidates prior URLs because the active-session/current-version check fails.

## Renderer viewer

- Use a locally bundled, exact reviewed `pdfjs-dist` display build and worker. No CDN, remote worker, remote cMap/font resource, or runtime registry access.
- PDF.js fetches only the fixed current route and renders page canvas plus an accessible text layer where supported.
- Initial controls are previous/next page, page count, zoom in/out/reset, and retry. Annotation editing, JavaScript, embedded attachments, form submission, printing/exporting, and remote links/resources are not added.
- Viewer errors use safe product copy and never display PDF internals, path, stack, or provider data.
- The viewer must cancel loading/render work on source/version/mode change and ignore late page results.
- Original-preview success never implies Markdown availability, indexing completion, or search eligibility.

## CSP and scheme privilege

- Keep the scheme `standard`, `secure`, and Fetch-capable only to the degree already required; do not enable `bypassCSP`, service workers, storage, code cache, or extensions for this feature.
- Renderer CSP adds only the minimum directive needed for the fixed scheme/worker implementation.
- Electron plugin/PDF viewer support must remain disabled; `<embed>`/`<iframe>` is not the accepted rendering boundary.

## Verification

- Exact route/input tests, traversal/encoding tests, active-session/current-version tests, file replacement/hash/signature tests.
- HEAD, full GET, first/middle/final range, malformed/multi/unsatisfiable ranges, cancellation, and maximum-size streaming tests.
- Compiled Electron PDF.js load from the production scheme/CSP with network disabled.
- Project switch/move/removal/version update invalidates stale viewer requests.
- Security assertions confirm no path, PDF bytes through preload IPC, raw exception, remote request, or expanded scheme privilege.
