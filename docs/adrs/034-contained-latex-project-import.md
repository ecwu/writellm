# ADR 034: Contained LaTeX Project Import

- Status: Accepted
- Date: 2026-08-13
- Checkpoint: 37B

## Context

Real LaTeX manuscripts commonly split source across `\input`/`\include`, keep figures beside the
source, and resolve citations from BibTeX or BibLaTeX files. Import must support that useful
project shape without turning TeX into an executable language or giving the parser filesystem or
network authority.

The mature-library gate rechecked current official documentation and npm metadata.
`@citation-js/core@0.8.2` and `@citation-js/plugin-bibtex@0.8.2` are MIT, pure JavaScript, were
published in the actively maintained 0.8 line, and expose local string-to-CSL-JSON parsing.
Context7's high-reputation Citation.js index confirms that importing the BibTeX plugin registers
BibTeX/BibLaTeX input and `Cite(...).format('data', { format: 'object' })` returns CSL-JSON.
`@retorquere/bibtex-parser@10.0.1` is an actively maintained fallback but has a materially heavier
NLP dependency tree. Citation.js is selected and exact-pinned.

## Decision

The existing import command accepts `.md`, `.tex`, and bounded `.zip` files; a sibling command
selects a LaTeX project directory. A direct `.tex` selection is the explicit entry file. Directory
or archive selection prefers root `main.tex`, otherwise requires exactly one source containing a
document environment. Main captures only regular contained files from a strict extension
allowlist, rejects symlinks and duplicate normalized paths, and enforces file-count, per-file,
expanded-byte, compression-ratio, and total-text limits. ZIP extraction reuses the existing
bounded yauzl extraction primitive.

Main records a deterministic manifest hash over every staged relative path, byte count, and
SHA-256 and revalidates the full manifest before apply. It sends only bounded relative paths,
UTF-8 TeX/BibTeX strings, and image-path inventory to the disposable CP37A utility process. The
worker resolves includes with normalized relative paths, an extension allowlist, depth/file
limits, cycle detection, and no filesystem calls. Citation.js receives only captured BibTeX
strings. The Main build bundles Citation.js while aliasing both of its fetch dependencies to a
throwing module, making network denial structural even if a future parser path is reached.

The neutral projection adds tables and figure references. Main resolves only worker-returned
relative image references against the captured manifest, validates and registers those bytes
through the ordinary manuscript asset service, and then mints BlockNote/figure IDs. Labels are
collected deterministically; duplicate labels and unresolved references stay explicit. Exact
bibliography keys become bounded readable author-year text derived only from CSL-JSON fields.
Missing or ambiguous keys remain literal citation commands. No DOI lookup, citation model,
compiler, package hook, macro expansion, or external converter is permitted.

## Consequences

- Project import inherits ADR 032/CP36's session-bound staging, 30-minute plan TTL, preview/apply,
  and cleanup boundary, and remains a larger fixture around the same staged plan/apply authority,
  not a new conversation, model endpoint, or mutation path.
- A selected directory can expose only bounded captured files; the parser never learns its real
  path.
- Citation rendering is intentionally conservative and loss-reported rather than pretending to
  reproduce an arbitrary TeX bibliography style.
- Full TeX compatibility, runtime macro behavior, generated figures, and remote bibliography
  lookup remain out of scope.
