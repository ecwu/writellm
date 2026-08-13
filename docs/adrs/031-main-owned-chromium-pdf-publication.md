# ADR 031: Main-Owned Chromium PDF Publication

- Status: Accepted
- Date: 2026-08-13
- Checkpoint: 41A

## Context

Checkpoint 41A needs a stable final PDF from the same immutable Checkpoint 38 publication
assembly used by DOCX and LaTeX. The result must preserve selectable mixed CJK/Latin text,
headings as bookmarks, links, images, formulas, references, page numbers, and a numbered table of
contents. Rendering must not expose filesystem paths or browser authority to the Renderer, create
a local HTTP service, or introduce a second publication model.

Electron's PDF outline generation and Chromium font behavior are platform-dependent, so the
target macOS runtime was spiked before accepting this decision. The spike used Electron 43's
actual hidden browser runtime and independently reopened the result with `pdfjs-dist`. It verified
two pages, selectable mixed CJK/Latin text, both heading bookmarks, an internal destination, and
an external HTTPS annotation.

## Decision

Main owns a single hidden, sandboxed `BrowserWindow` per export. It uses a unique in-memory session
partition, context isolation, no Node integration, JavaScript disabled, denied permissions and
window creation, and a strict content security policy. Captured and hash-verified image bytes are
served only through a dedicated privileged `writellm-pdf-asset:` protocol registered on that
ephemeral session; no raw paths or local server are used.

A pure converter renders the captured publication assembly as print HTML with an
application-owned CJK/Latin font stack, CSS page size and margins, heading hierarchy, figures,
KaTeX output, and references. Mermaid remains readable source with an explicit loss until a
verified rendered candidate exists. The Renderer receives only bounded preflight metadata and a
print-layout representation of the same typed options.

PDF capture uses `printToPDF` with CSS page sizing, background graphics, tagged output, document
outline generation, and page-number footer templates. Table-of-contents page numbers use a
bounded stabilizing pipeline: a first capture without the TOC establishes heading destinations;
a second capture includes them; one final capture is allowed only if inserting the TOC shifted
destinations. `pdfjs-dist`, already in the application, reads outline destinations. Missing
destinations become an explicit loss rather than fabricated page numbers.

The export owns an `AbortController`. Cancellation stops and destroys the browser immediately,
then the existing create-only staging boundary removes partial output. Browser teardown also runs
on every error path. Content-level determinism, not byte equality, is the PDF contract because
Chromium embeds build metadata.

## Consequences

- PDF, DOCX, and LaTeX continue to share one publication assembly and preflight contract.
- There is no PDF editor, general print service, local web server, utility-process browser, or
  bundled office/TeX runtime.
- Runtime verification must inspect selectable text, outline, destinations, and annotations with
  `pdfjs-dist`; the package gate is required because Electron and packaged resources participate.
- The fixed three-capture maximum bounds TOC stabilization. A residual destination mismatch is
  surfaced through validation rather than an unbounded render loop.
